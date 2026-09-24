import {
  summarizeUpload,
  emptyMeasurements,
  type SessionMeasurements
} from "../connection-quality";
import type { SignalingSocket } from "../signaling";
import type { SessionDiagnostics } from "../diagnostics";
import { randomHex, type Participant, type RoutedMedia } from "../protocol";
import {
  PUBLISH_PREFERENCES,
  PLAYBACK_PREFERENCES,
  type StreamQuality,
  type StreamStats
} from "../media";
import { MediaLink } from "./media-link";
import { NETWORK_HELP } from "./constants";

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
      (message) => this.events.notice(message),
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
