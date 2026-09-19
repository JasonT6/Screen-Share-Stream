import {
  summarizeUpload,
  emptyMeasurements,
  type RemoteHealth,
  type SenderHealth,
  type SessionMeasurements
} from "./connection-quality";
import { SignalingSocket } from "./signaling";
import {
  candidateSummary,
  inspectIce,
  emptyDiagnostics,
  type LinkDiagnostics,
  type SessionDiagnostics
} from "./diagnostics";
import {
  authContext,
  createRoomId,
  deriveRoomKey,
  isNonce,
  isRecord,
  randomHex,
  ROOM_PATTERN,
  sign,
  SignedChannel,
  verify,
  usernameError,
  passwordError,
  type Participant,
  type RoutedMedia,
  type MediaSignal,
  type Signal
} from "./protocol";
import {
  readStats,
  QUALITY_PRESETS,
  PUBLISH_PREFERENCES,
  PLAYBACK_PREFERENCES,
  resolvePreferences,
  type StreamPreferences,
  type StreamQuality,
  type StatsHistory,
  rtcConfiguration,
  tuneSender,
  type StreamStats
} from "./media";

const CONNECTION_TIMEOUT = 25_000;
export const NETWORK_HELP =
  "A direct connection could not be established. Try another network or disable your VPN. Some networks require a relay, which this app does not use.";

async function openSignaling(id: string, events: SessionEvents) {
  return SignalingSocket.open(id, (websocket, secure) => {
    events.diagnostics?.({
      ...emptyDiagnostics(),
      websocket,
      secure,
      signaling:
        websocket === "error" || websocket === "closed"
          ? "failed"
          : "registering"
    });
  });
}

// Each publisher offers a separate direct, one-way media connection to each attendee.
class MediaLink {
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
    private status: (state: string) => void,
    private fail: (message: string) => void,
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
          () => this.fail(NETWORK_HELP)
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
      this.status(state === "connected" ? "Watching" : "Connecting");
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
      void this.offer(true).catch(() => this.fail(NETWORK_HELP));
    } else if (!this.restartRequested && this.retries === 0) {
      this.restartRequested = true;
      clearTimeout(this.timeout);
      this.timeout = undefined;
      this.armTimeout();
      // Only the publisher offers, preventing glare when both sides fail.
      void this.send({ type: "restart" }).catch(() => this.fail(NETWORK_HELP));
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
        } else this.fail(NETWORK_HELP);
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
          this.status(
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

class Transport {
  private outgoing = Promise.resolve();
  private incoming = Promise.resolve();
  private queued = 0;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private lastSeen = Date.now();
  channel?: SignedChannel;
  closed = false;
  constructor(
    readonly peer: string,
    private socket: SignalingSocket,
    private handler: (message: unknown) => Promise<void>,
    private fail: () => void
  ) {}

  receive(data: unknown) {
    if (this.closed) return;
    if (++this.queued > 64) {
      this.fail();
      return;
    }
    // Crypto and RTC operations are async. Never verify two sequence numbers
    // concurrently, even though WebSocket itself delivers messages in order.
    this.incoming = this.incoming
      .then(async () => {
        if (!this.closed) await this.handler(data);
      })
      .catch(this.fail)
      .finally(() => {
        this.queued--;
      });
  }
  raw(message: unknown) {
    if (this.closed) throw new Error("Connection closed.");
    this.socket.send(this.peer, message);
  }
  send(message: Signal): Promise<void> {
    this.outgoing = this.outgoing.then(async () => {
      if (this.closed || !this.channel) throw new Error("Connection closed.");
      const envelope = await this.channel.pack(message);
      this.raw(envelope);
    });
    return this.outgoing;
  }
  startHeartbeat() {
    this.lastSeen = Date.now();
    this.heartbeatTimer = setInterval(() => {
      if (Date.now() - this.lastSeen > 30_000) {
        this.fail();
        return;
      }
      void this.send({ type: "ping" }).catch(this.fail);
    }, 5000);
  }
  async control(signal: Signal): Promise<boolean> {
    this.lastSeen = Date.now(); // Only called after successful HMAC verification.
    if (signal.type === "ping") await this.send({ type: "pong" });
    return signal.type === "ping" || signal.type === "pong";
  }
  close() {
    this.closed = true;
    clearInterval(this.heartbeatTimer);
  }
}

export type { Participant } from "./protocol";
export type SessionEvents = {
  participants: (participants: Participant[]) => void;
  stream: (id: string, stream: MediaStream | null) => void;
  notice: (message: string) => void;
  ready: () => void;
  ended: () => void;
  error: (message: string) => void;
  diagnostics?: (value: SessionDiagnostics) => void;
};

// The host distributes authenticated membership and media signaling only.
// Every publisher sends its screen/audio directly to the other participants.
export abstract class RoomSession {
  readonly id: string;
  protected closed = false;
  protected signalingState: SessionDiagnostics["signaling"] = "authenticating";
  protected participants: Participant[] = [];
  protected source: MediaStream | null = null;
  protected streamId: string | null = null;
  private publishQuality: StreamQuality = "source";
  private playbackQuality: StreamQuality = "source";
  private publishPreferences = PUBLISH_PREFERENCES;
  private playbackPreferences = PLAYBACK_PREFERENCES;
  private measurement?: Promise<SessionMeasurements>;
  private links = new Map<
    string,
    { media: MediaLink; publisher: string; remote: string; streamId: string }
  >();

  constructor(
    protected socket: SignalingSocket,
    protected events: SessionEvents
  ) {
    this.id = socket.id;
    socket.onstate = () => this.reportDiagnostics();
    socket.onclose = () => {
      if (this.closed) return;
      this.signalingState = "failed";
      this.close();
      events.error(
        `WebSocket signaling disconnected${socket.closeCode === null ? "" : ` (close code ${socket.closeCode})`}. Refresh both host and viewer tabs, then reconnect to the session.`
      );
    };
  }

  diagnostics(): SessionDiagnostics {
    return {
      websocket: this.socket.state,
      websocketCloseCode: this.socket.closeCode,
      secure: this.socket.secure,
      signaling: this.signalingState,
      connections: Array.from(this.links.values(), (link) =>
        link.media.diagnostics()
      )
    };
  }
  protected reportDiagnostics() {
    this.events.diagnostics?.(this.diagnostics());
  }

  protected abstract route(message: RoutedMedia): Promise<void>;
  protected abstract announce(): Promise<void>;

  protected setRoster(participants: Participant[]) {
    if (this.closed) return;
    this.participants = participants;
    for (const [key, link] of this.links) {
      if (
        !participants.some((p) => p.id === link.remote) ||
        !participants.some(
          (p) => p.id === link.publisher && p.streamId === link.streamId
        )
      ) {
        link.media.close();
        this.links.delete(key);
        if (link.publisher !== this.id)
          this.events.stream(link.publisher, null);
      }
    }
    this.events.participants(participants);
    if (
      this.source &&
      participants.some((p) => p.id === this.id && p.streamId === this.streamId)
    ) {
      for (const participant of participants) {
        if (participant.id === this.id) continue;
        const key = `${this.id}:${participant.id}`;
        if (!this.links.has(key)) {
          const media = this.makeLink(this.id, participant.id, this.streamId!);
          void media.offer().catch(() => this.linkFailed(key));
        }
      }
    }
  }

  private linkFailed(key: string) {
    const link = this.links.get(key);
    if (!link || this.closed) return;
    link.media.markFailed();
    link.media.close();
    this.reportDiagnostics();
    // Retain a failed entry until the publication changes, avoiding retry storms.
    if (link.publisher !== this.id) this.events.stream(link.publisher, null);
    this.events.notice(NETWORK_HELP);
  }

  private makeLink(publisher: string, remote: string, streamId: string) {
    const key = `${publisher}:${remote}`;
    const media = new MediaLink(
      publisher === this.id ? this.source : null,
      (signal) =>
        this.route({
          type: "media",
          from: this.id,
          to: remote,
          publisher,
          streamId,
          signal
        }),
      (message) => {
        if (message.startsWith("This browser")) this.events.notice(message);
      },
      () => this.linkFailed(key),
      this.publishQuality,
      this.publishPreferences,
      (stream) => this.events.stream(publisher, stream),
      () => this.reportDiagnostics()
    );
    this.links.set(key, { media, publisher, remote, streamId });
    this.reportDiagnostics();
    if (publisher !== this.id)
      void media
        .requestQuality(this.playbackQuality, this.playbackPreferences)
        .catch(() => {});
    return media;
  }

  protected async receiveMedia(message: RoutedMedia) {
    if (this.closed || message.to !== this.id || message.from === this.id)
      return;
    if (
      !this.participants.some((p) => p.id === message.from) ||
      !this.participants.some(
        (p) => p.id === message.publisher && p.streamId === message.streamId
      )
    )
      return;
    if (message.publisher !== message.from && message.publisher !== this.id)
      throw new Error("Invalid publisher.");
    const key = `${message.publisher}:${message.from}`;
    let link = this.links.get(key);
    if (!link) {
      if (message.publisher === this.id) return;
      this.makeLink(message.publisher, message.from, message.streamId);
      link = this.links.get(key)!;
    }
    if (link.streamId !== message.streamId) return;
    try {
      await link.media.handle(message.signal);
    } catch {
      this.linkFailed(key);
    }
  }

  async startSharing(source: MediaStream) {
    if (this.closed) {
      source.getTracks().forEach((track) => track.stop());
      throw new Error("The session has ended.");
    }
    if (!source.getVideoTracks().some((track) => track.readyState === "live")) {
      source.getTracks().forEach((track) => track.stop());
      throw new Error(
        "Screen sharing stopped. Choose a screen to share again."
      );
    }
    if (this.source) await this.stopSharing();
    this.source = source;
    this.streamId = randomHex();
    this.events.stream(this.id, source);
    source.getTracks().forEach((track) =>
      track.addEventListener(
        "ended",
        () => {
          if (this.source === source) void this.stopSharing().catch(() => {});
        },
        { once: true }
      )
    );
    try {
      await this.announce();
    } catch (error) {
      source.getTracks().forEach((track) => track.stop());
      this.source = null;
      this.streamId = null;
      this.events.stream(this.id, null);
      throw error;
    }
  }

  async stopSharing() {
    this.source?.getTracks().forEach((track) => track.stop());
    this.source = null;
    this.streamId = null;
    for (const [key, link] of this.links) {
      if (link.publisher === this.id) {
        link.media.close();
        this.links.delete(key);
      }
    }
    this.events.stream(this.id, null);
    if (!this.closed) await this.announce();
  }

  async setPublishQuality(
    quality: StreamQuality,
    preferences = this.publishPreferences
  ) {
    this.publishQuality = quality;
    this.publishPreferences = preferences;
    await Promise.all(
      Array.from(this.links.values())
        .filter((link) => link.publisher === this.id)
        .map((link) => link.media.setPublishQuality(quality, preferences))
    );
  }

  async setPlaybackQuality(
    quality: StreamQuality,
    preferences = this.playbackPreferences
  ) {
    this.playbackQuality = quality;
    this.playbackPreferences = preferences;
    await Promise.all(
      Array.from(this.links.values())
        .filter((link) => link.publisher !== this.id)
        .map((link) => link.media.requestQuality(quality, preferences))
    );
  }

  measurements(): Promise<SessionMeasurements> {
    if (this.measurement) return this.measurement;
    this.measurement = this.collectMeasurements().finally(() => {
      this.measurement = undefined;
    });
    return this.measurement;
  }

  private async collectMeasurements(): Promise<SessionMeasurements> {
    const result = emptyMeasurements();
    if (this.closed) return result;
    const links = Array.from(this.links.entries());
    const samples = await Promise.all(
      links.map(async ([key, link]) => {
        const stats = await link.media.stats().catch(
          () =>
            ({
              audio: false,
              state: link.media.pc.connectionState
            }) as StreamStats
        );
        if (this.closed || this.links.get(key) !== link) return null;
        if (link.publisher === this.id) result.outgoing.push(stats);
        else {
          result.incoming[link.publisher] = stats;
          if (
            link.media.remoteHealth &&
            Date.now() - link.media.remoteHealth.receivedAt <= 10_000
          )
            result.senders[link.publisher] = link.media.remoteHealth;
        }
        return { link, stats };
      })
    );
    if (this.closed) return emptyMeasurements();
    this.reportDiagnostics();
    const summary = summarizeUpload(result.outgoing);
    await Promise.all(
      samples.map((sample) => {
        if (
          sample?.link.publisher !== this.id ||
          sample.link.media.pc.connectionState !== "connected"
        )
          return;
        return sample.link.media
          .sendHealth(summary, sample.stats.limitation ?? "other")
          .catch(() => {});
      })
    );
    return result;
  }

  protected cleanup() {
    this.closed = true;
    this.source?.getTracks().forEach((track) => track.stop());
    this.source = null;
    for (const link of this.links.values()) link.media.close();
    if (this.signalingState !== "failed") this.signalingState = "closed";
    this.reportDiagnostics();
    this.events.stream(this.id, null);
    this.events.participants([]);
  }
  abstract close(): void;
}

type Client = {
  transport: Transport;
  timer: ReturnType<typeof setTimeout>;
  info?: Participant;
};

export class HostSession extends RoomSession {
  readonly roomId: string;
  private clients = new Map<string, Client>();

  private constructor(
    socket: SignalingSocket,
    private key: CryptoKey,
    private username: string,
    events: SessionEvents
  ) {
    super(socket, events);
    this.roomId = socket.id;
    socket.onmessage = (from, message) => {
      if (this.closed) return;
      if (!this.clients.has(from)) {
        if (
          !isRecord(message) ||
          message.type !== "hello" ||
          !isNonce(message.nonce)
        )
          return;
        this.accept(from);
      }
      this.clients.get(from)?.transport.receive(message);
    };
    this.signalingState = "ready";
    this.reportDiagnostics();
  }

  static async start(
    password: string,
    username: string,
    source: MediaStream,
    events: SessionEvents,
    quality: StreamQuality = "source"
  ) {
    const issue = passwordError(password) || usernameError(username);
    if (issue) throw new Error(issue);
    const roomId = createRoomId();
    let session: HostSession | undefined;
    try {
      const key = await deriveRoomKey(password, roomId);
      const socket = await openSignaling(roomId, events);
      session = new HostSession(socket, key, username.trim(), events);
      await session.setPublishQuality(quality);
      await session.startSharing(source);
      events.ready();
      return session;
    } catch (error) {
      source.getTracks().forEach((track) => track.stop());
      session?.close();
      throw error;
    }
  }

  protected async announce() {
    if (this.closed) return;
    const participants: Participant[] = [
      { id: this.id, username: this.username, streamId: this.streamId },
      ...Array.from(this.clients.values()).flatMap((client) =>
        client.info ? [client.info] : []
      )
    ];
    // Queue the roster before any media signals generated by its application.
    const sends = Array.from(this.clients.values())
      .filter((client) => client.info)
      .map((client) =>
        client.transport
          .send({ type: "roster", participants })
          .catch(() => this.remove(client.transport.peer))
      );
    this.setRoster(participants);
    await Promise.all(sends);
  }

  protected async route(message: RoutedMedia) {
    if (this.closed) return;
    if (
      !this.participants.some(
        (p) => p.id === message.publisher && p.streamId === message.streamId
      )
    )
      return;
    if (message.publisher !== message.from && message.publisher !== message.to)
      throw new Error("Invalid media route.");
    if (message.to === this.id) await this.receiveMedia(message);
    else {
      const target = this.clients.get(message.to);
      if (target?.info)
        await target.transport
          .send(message)
          .catch(() => this.remove(message.to));
    }
  }

  private remove(id: string) {
    const client = this.clients.get(id);
    if (!client) return;
    this.clients.delete(id);
    clearTimeout(client.timer);
    client.transport.close();
    if (!this.closed) void this.announce();
  }

  private accept(id: string) {
    if (
      this.closed ||
      this.clients.has(id) ||
      this.clients.size >= 255 ||
      !/^viewer-[a-f0-9]{32}$/.test(id) ||
      Array.from(this.clients.values()).filter((client) => !client.info)
        .length >= 32
    )
      return;
    let stage: "hello" | "auth" | "profile" | "ready" | "rejected" = "hello";
    let context = "";
    const remove = () => this.remove(id);
    const transport = new Transport(
      id,
      this.socket,
      async (message) => {
        if (stage === "rejected") return;
        if (!isRecord(message)) throw new Error("Invalid connection message.");
        if (stage === "hello") {
          if (message.type !== "hello" || !isNonce(message.nonce))
            throw new Error("Invalid greeting.");
          const nonce = randomHex();
          context = authContext(this.roomId, id, message.nonce, nonce);
          stage = "auth";
          transport.raw({ type: "challenge", nonce });
        } else if (stage === "auth") {
          if (
            message.type !== "auth" ||
            !(await verify(this.key, `${context}:join`, message.proof))
          ) {
            stage = "rejected";
            transport.raw({ type: "rejected" });
            remove();
            return;
          }
          if (transport.closed || this.closed) return;
          transport.channel = new SignedChannel(this.key, context, "host");
          stage = "profile";
        } else {
          const signal = await transport.channel!.unpack(message);
          if (transport.closed || this.closed) return;
          const client = this.clients.get(id)!;
          if (stage === "profile") {
            if (signal.type !== "profile")
              throw new Error("Username required.");
            client.info = {
              id,
              username: signal.username.trim(),
              streamId: null
            };
            clearTimeout(client.timer);
            stage = "ready";
            transport.startHeartbeat();
            await this.announce();
          } else if (await transport.control(signal)) return;
          else if (signal.type === "publish") {
            client.info!.streamId = signal.streamId;
            await this.announce();
          } else if (signal.type === "media") {
            if (signal.from !== id) throw new Error("Invalid sender.");
            await this.route(signal);
          } else if (signal.type === "ended") remove();
          else throw new Error("Unexpected session message.");
        }
      },
      remove
    );
    this.clients.set(id, {
      transport,
      timer: setTimeout(remove, CONNECTION_TIMEOUT)
    });
  }

  async end() {
    if (this.closed) return;
    this.cleanup();
    const clients = Array.from(this.clients.values());
    clients.forEach((client) => clearTimeout(client.timer));
    await Promise.allSettled(
      clients
        .filter((client) => client.info)
        .map((client) => client.transport.send({ type: "ended" }))
    );
    clients.forEach((client) => client.transport.close());
    this.clients.clear();
    this.socket.close();
  }
  close() {
    void this.end();
  }
}

export class ViewerSession extends RoomSession {
  private transport?: Transport;
  private timer?: ReturnType<typeof setTimeout>;
  private ready = false;

  static async join(
    roomId: string,
    password: string,
    username: string,
    events: SessionEvents
  ) {
    if (!ROOM_PATTERN.test(roomId))
      throw new Error(
        "This invitation is invalid. Ask the host for a new link."
      );
    const issue = passwordError(password) || usernameError(username);
    if (issue) throw new Error(issue);
    const key = await deriveRoomKey(password, roomId);
    const socket = await openSignaling(`viewer-${randomHex(16)}`, events);
    const session = new ViewerSession(socket, events);
    try {
      session.connect(roomId, key, username.trim());
      return session;
    } catch (error) {
      session.close();
      throw error;
    }
  }

  protected route(message: RoutedMedia) {
    return this.transport!.send(message);
  }
  protected announce() {
    if (!this.ready)
      return Promise.reject(new Error("Join the session before sharing."));
    return this.transport!.send({ type: "publish", streamId: this.streamId });
  }
  private fail(message: string) {
    if (this.closed) return;
    this.signalingState = "failed";
    this.close();
    this.events.error(message);
  }

  private connect(roomId: string, key: CryptoKey, username: string) {
    const nonce = randomHex();
    let challenged = false;
    const transport = new Transport(
      roomId,
      this.socket,
      async (message) => {
        if (!isRecord(message)) throw new Error("Invalid session message.");
        if (!challenged) {
          if (message.type !== "challenge" || !isNonce(message.nonce))
            throw new Error("Invalid challenge.");
          challenged = true;
          const context = authContext(roomId, this.id, nonce, message.nonce);
          transport.channel = new SignedChannel(key, context, "viewer");
          const proof = await sign(key, `${context}:join`);
          if (this.closed) return;
          transport.raw({ type: "auth", proof });
          await transport.send({ type: "profile", username });
        } else if (message.type === "rejected" && !this.ready) {
          this.fail("Incorrect password. Check with the host and try again.");
        } else {
          const signal = await transport.channel!.unpack(message);
          if (this.closed) return;
          if (signal.type === "ended") {
            this.close();
            this.events.ended();
          } else if (signal.type === "roster") {
            if (
              !signal.participants.some((p) => p.id === this.id) ||
              signal.participants[0]?.id !== roomId
            )
              throw new Error("Invalid session membership.");
            clearTimeout(this.timer);
            if (!this.ready) transport.startHeartbeat();
            this.ready = true;
            this.signalingState = "ready";
            this.setRoster(signal.participants);
            this.reportDiagnostics();
            this.events.ready();
          } else if (this.ready && (await transport.control(signal))) return;
          else if (signal.type === "media" && this.ready)
            await this.receiveMedia(signal);
          else throw new Error("Unexpected session message.");
        }
      },
      () =>
        this.fail(
          "The session signaling was interrupted or could not be authenticated. Please reconnect."
        )
    );
    this.transport = transport;
    this.socket.onmessage = (from, message) => {
      if (from === roomId) transport.receive(message);
    };
    this.reportDiagnostics();
    transport.raw({ type: "hello", nonce });
    this.timer = setTimeout(
      () =>
        this.fail(
          "The host is offline or not responding over WebSocket. Check the invitation and try again."
        ),
      CONNECTION_TIMEOUT
    );
  }

  close() {
    if (this.closed) return;
    this.cleanup();
    clearTimeout(this.timer);
    const finish = () => {
      this.transport?.close();
      this.socket.close();
    };
    if (this.ready && this.socket.state === "open")
      void this.transport!.send({ type: "ended" })
        .catch(() => {})
        .finally(finish);
    else finish();
  }
}
