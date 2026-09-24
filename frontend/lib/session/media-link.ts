import type { RemoteHealth, SenderHealth } from "../connection-quality";
import {
  candidateSummary,
  inspectIce,
  type LinkDiagnostics
} from "../diagnostics";
import type { MediaSignal } from "../protocol";
import {
  readStats,
  QUALITY_PRESETS,
  PLAYBACK_PREFERENCES,
  resolvePreferences,
  type StreamPreferences,
  type StreamQuality,
  type StatsHistory,
  rtcConfiguration,
  tuneSender,
  type StreamStats
} from "../media";
import { CONNECTION_TIMEOUT } from "./constants";

// Each publisher offers a separate direct, one-way media connection to each attendee.
export class MediaLink {
  readonly pc = new RTCPeerConnection(rtcConfiguration);
  private candidates: RTCIceCandidateInit[] = [];
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private retries = 0;
  private restartRequested = false;
  private restartPending = false;
  private offering = false;
  private startedAt = performance.now();
  private setupTimeMs: number | null = null;
  private failed = false;
  private finalDiagnostics?: LinkDiagnostics;
  private ice = {
    localCandidates: [],
    remoteCandidates: [],
    selectedPair: null
  } as ReturnType<typeof inspectIce>;
  private iceErrors: number[] = [];
  private latestStats: StreamStats = { audio: false };
  private closed = false;
  private previous: StatsHistory = new Map();
  private requestedQuality: StreamQuality = "source";
  private requestedPreferences = PLAYBACK_PREFERENCES;
  private tuning = Promise.resolve();
  remoteHealth?: RemoteHealth;
  private stream = new MediaStream();

  constructor(
    private source: MediaStream | null,
    private send: (message: MediaSignal) => Promise<void>,
    private notice: (message: string) => void,
    private fail: () => void,
    private publishQuality: StreamQuality,
    private publishPreferences: StreamPreferences,
    receive?: (stream: MediaStream) => void,
    private changed: () => void = () => {}
  ) {
    if (source) {
      source.getTracks().forEach((track) =>
        this.pc.addTransceiver(track, {
          direction: "sendonly",
          streams: [source]
        })
      );
    } else {
      this.pc.ontrack = ({ track }) => {
        this.stream.addTrack(track);
        receive?.(this.stream);
      };
    }
    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        if (this.ice.localCandidates.length < 128)
          this.ice.localCandidates.push(candidateSummary(candidate));
        this.changed();
        void send({ type: "candidate", candidate: candidate.toJSON() }).catch(
          () => this.fail()
        );
      }
    };
    this.pc.onicecandidateerror = (event) => {
      // Do not retain event.address, url, port or free-form errorText.
      if (this.iceErrors.length < 32) this.iceErrors.push(event.errorCode);
      this.changed();
    };
    const stateChanged = () => {
      if (this.closed) return;
      const state = this.pc.connectionState;
      if (state === "failed" || this.pc.iceConnectionState === "failed") {
        this.armTimeout();
        this.recover();
      } else if (state === "connected") {
        this.setupTimeMs ??= performance.now() - this.startedAt;
        clearTimeout(this.timeout);
        this.timeout = undefined;
      } else if (state === "disconnected") {
        this.armTimeout();
      }
      this.changed();
    };
    this.pc.onconnectionstatechange = stateChanged;
    this.pc.oniceconnectionstatechange = stateChanged;
    this.pc.onicegatheringstatechange = () => this.changed();
    this.pc.onsignalingstatechange = () => {
      if (this.restartPending && this.pc.signalingState === "stable")
        this.recover();
      this.changed();
    };
    this.armTimeout();
  }

  private recover() {
    if (this.closed) return;
    if (this.source) {
      if (this.retries >= 1) return;
      if (this.offering || this.pc.signalingState !== "stable") {
        this.restartPending = true;
        return;
      }
      this.restartPending = false;
      this.retries++;
      clearTimeout(this.timeout);
      this.timeout = undefined;
      this.armTimeout();
      void this.offer(true).catch(() => this.fail());
    } else if (!this.restartRequested && this.retries === 0) {
      this.restartRequested = true;
      clearTimeout(this.timeout);
      this.timeout = undefined;
      this.armTimeout();
      // Only the publisher offers, preventing glare when both sides fail.
      void this.send({ type: "restart" }).catch(() => this.fail());
    }
    this.changed();
  }

  private armTimeout() {
    if (!this.timeout)
      this.timeout = setTimeout(() => {
        this.timeout = undefined;
        if (this.closed) return;
        if (
          this.retries === 0 &&
          !this.restartRequested &&
          !this.restartPending
        ) {
          this.recover();
          this.armTimeout();
        } else this.fail();
      }, CONNECTION_TIMEOUT);
  }

  async offer(restart = false) {
    this.offering = true;
    try {
      await this.pc.setLocalDescription(
        await this.pc.createOffer({ iceRestart: restart })
      );
      if (this.closed) return;
      await this.send({
        type: "description",
        description: this.pc.localDescription!.toJSON()
      });
    } finally {
      this.offering = false;
    }
  }

  async handle(message: MediaSignal) {
    if (this.closed) return;
    if (message.type === "restart") {
      if (!this.source)
        throw new Error("Only receivers can request an ICE restart.");
      this.recover();
      return;
    }
    if (message.type === "quality") {
      if (!this.source) throw new Error("Only viewers can request quality.");
      this.requestedQuality = message.quality;
      this.requestedPreferences = message.preferences ?? PLAYBACK_PREFERENCES;
      await this.applyQuality();
      return;
    }
    if (message.type === "health") {
      if (this.source)
        throw new Error("Only publishers can send upload health.");
      this.remoteHealth = {
        summary: message.summary,
        limitation: message.limitation,
        receivedAt: Date.now()
      };
      return;
    }
    if (message.type === "candidate") {
      if (message.candidate.candidate && this.ice.remoteCandidates.length < 128)
        this.ice.remoteCandidates.push(
          candidateSummary(new RTCIceCandidate(message.candidate))
        );
      this.changed();
      if (this.candidateMatchesDescription(message.candidate))
        await this.pc.addIceCandidate(message.candidate);
      else if (this.candidates.length < 128)
        this.candidates.push(message.candidate);
      else throw new Error("Too many connection candidates.");
    }
    if (message.type === "description") {
      if (message.description.type !== (this.source ? "answer" : "offer"))
        throw new Error("Unexpected media direction.");
      if (!this.source && this.pc.remoteDescription) {
        const ufrag = (sdp?: string) => sdp?.match(/^a=ice-ufrag:(.+)$/m)?.[1];
        if (
          ufrag(message.description.sdp) !==
          ufrag(this.pc.remoteDescription.sdp)
        ) {
          if (this.retries >= 1) throw new Error("ICE restart limit exceeded.");
          this.retries++;
          clearTimeout(this.timeout);
          this.timeout = undefined;
          this.armTimeout();
        }
      }
      await this.pc.setRemoteDescription(message.description);
      if (!this.source) {
        this.pc.getTransceivers().forEach((transceiver) => {
          transceiver.direction = "recvonly";
        });
        await this.pc.setLocalDescription(await this.pc.createAnswer());
        await this.send({
          type: "description",
          description: this.pc.localDescription!.toJSON()
        });
      } else {
        await this.applyQuality();
      }
      for (const candidate of this.candidates.splice(0)) {
        if (this.candidateMatchesDescription(candidate))
          await this.pc.addIceCandidate(candidate);
      }
    }
  }

  private candidateMatchesDescription(candidate: RTCIceCandidateInit) {
    const description = this.pc.remoteDescription;
    if (!description) return false;
    // Restart trickle may arrive before its SDP. Queue the new generation, and
    // discard obsolete-generation candidates when the new description lands.
    return (
      !candidate.usernameFragment ||
      description.sdp
        .split(/\r?\n/)
        .includes(`a=ice-ufrag:${candidate.usernameFragment}`)
    );
  }

  setPublishQuality(quality: StreamQuality, preferences: StreamPreferences) {
    this.publishQuality = quality;
    this.publishPreferences = preferences;
    return this.applyQuality();
  }
  requestQuality(quality: StreamQuality, preferences: StreamPreferences) {
    return this.send({ type: "quality", quality, preferences });
  }
  sendHealth(
    summary: SenderHealth,
    limitation: "none" | "bandwidth" | "cpu" | "other"
  ) {
    return this.send({ type: "health", summary, limitation });
  }
  private applyQuality() {
    this.tuning = this.tuning
      .catch(() => {})
      .then(async () => {
        if (this.closed || !this.source || this.pc.signalingState !== "stable")
          return;
        const quality =
          QUALITY_PRESETS[this.publishQuality].height <=
          QUALITY_PRESETS[this.requestedQuality].height
            ? this.publishQuality
            : this.requestedQuality;
        const preferences = resolvePreferences(
          this.publishPreferences,
          this.requestedPreferences
        );
        const results = await Promise.all(
          this.pc
            .getSenders()
            .map((sender) => tuneSender(sender, quality, preferences))
        );
        if (results.some((result) => !result))
          this.notice(
            "This browser could not apply all requested stream settings. Some settings may remain unchanged or use browser defaults."
          );
      });
    return this.tuning;
  }

  async stats() {
    if (this.closed) return { ...this.latestStats, state: "closed" as const };
    const reports = await this.pc.getStats();
    const ice = inspectIce(reports);
    this.ice = {
      ...ice,
      localCandidates: ice.localCandidates.length
        ? ice.localCandidates
        : this.ice.localCandidates,
      remoteCandidates: ice.remoteCandidates.length
        ? ice.remoteCandidates
        : this.ice.remoteCandidates
    };
    this.latestStats = await readStats(
      this.pc,
      !!this.source,
      this.previous,
      reports
    );
    return this.latestStats;
  }

  diagnostics(): LinkDiagnostics {
    return (
      this.finalDiagnostics ?? {
        direction: this.source ? "sending" : "receiving",
        connectionState: this.pc.connectionState,
        iceConnectionState: this.pc.iceConnectionState,
        iceGatheringState: this.pc.iceGatheringState,
        signalingState: this.pc.signalingState,
        ...this.ice,
        iceErrors: [...this.iceErrors],
        iceRestartCount: this.retries,
        setupTimeMs: this.setupTimeMs,
        elapsedMs: performance.now() - this.startedAt,
        failed: this.failed,
        stats: { ...this.latestStats }
      }
    );
  }
  markFailed() {
    this.failed = true;
  }

  close() {
    if (this.closed) return;
    this.finalDiagnostics = this.diagnostics();
    if (!this.failed) {
      this.finalDiagnostics.connectionState = "closed";
      this.finalDiagnostics.iceConnectionState = "closed";
      this.finalDiagnostics.signalingState = "closed";
    }
    this.closed = true;
    clearTimeout(this.timeout);
    this.pc.onconnectionstatechange = null;
    this.pc.onicecandidate = null;
    this.pc.onicecandidateerror = null;
    this.pc.oniceconnectionstatechange = null;
    this.pc.onicegatheringstatechange = null;
    this.pc.onsignalingstatechange = null;
    this.pc.ontrack = null;
    this.pc.close();
    this.stream.getTracks().forEach((track) => track.stop());
  }
}
