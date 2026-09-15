import {
  summarizeUpload,
  emptyMeasurements,
  type RemoteHealth,
  type SenderHealth,
  type SessionMeasurements
} from "./connection-quality";
import type Peer from "peerjs";
import type { DataConnection } from "peerjs";
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
  type StreamQuality,
  type StatsHistory,
  rtcConfiguration,
  tuneSender,
  type StreamStats
} from "./media";

const CONNECTION_TIMEOUT = 25_000;
export const NETWORK_HELP =
  "A direct connection could not be established. Try another network or disable your VPN. Some networks require a relay, which this app does not use.";

function errorMessage(error: unknown): string {
  const type = isRecord(error) ? error.type : undefined;
  if (type === "peer-unavailable")
    return "The host is offline or this link has expired. Ask the host to start sharing and send the current link.";
  if (type === "unavailable-id")
    return "This stream address is already in use. Start a new stream.";
  if (type === "network" || type === "server-error" || type === "socket-error")
    return "The connection service is unavailable. Check your internet connection and try again.";
  return error instanceof Error ? error.message : NETWORK_HELP;
}

async function openPeer(id: string): Promise<Peer> {
  const { default: PeerClient } = await import("peerjs");
  const peer = new PeerClient(id, {
    host: process.env.NEXT_PUBLIC_PEER_HOST || "0.peerjs.com",
    port: Number(process.env.NEXT_PUBLIC_PEER_PORT || 443),
    path: process.env.NEXT_PUBLIC_PEER_PATH || "/",
    secure: process.env.NEXT_PUBLIC_PEER_SECURE !== "false",
    config: rtcConfiguration,
    debug: 0
  });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        fail(
          new Error(
            "The connection service timed out. Check your internet connection and retry."
          )
        ),
      CONNECTION_TIMEOUT
    );
    const fail = (error: unknown) => {
      clearTimeout(timeout);
      peer.destroy();
      reject(new Error(errorMessage(error)));
    };
    peer.once("error", fail);
    peer.once("open", () => {
      clearTimeout(timeout);
      peer.off("error", fail);
      resolve(peer);
    });
  });
}

// Each publisher offers a separate direct, one-way media connection to each attendee.
class MediaLink {
  readonly pc = new RTCPeerConnection(rtcConfiguration);
  private candidates: RTCIceCandidateInit[] = [];
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private retries = 0;
  private closed = false;
  private previous: StatsHistory = new Map();
  private requestedQuality: StreamQuality = "source";
  private tuning = Promise.resolve();
  remoteHealth?: RemoteHealth;
  private stream = new MediaStream();

  constructor(
    private source: MediaStream | null,
    private send: (message: MediaSignal) => Promise<void>,
    private status: (state: string) => void,
    private fail: (message: string) => void,
    private publishQuality: StreamQuality,
    receive?: (stream: MediaStream) => void
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
      if (candidate)
        void send({ type: "candidate", candidate: candidate.toJSON() }).catch(
          () => this.fail(NETWORK_HELP)
        );
    };
    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      if (state === "closed" || this.closed) return;
      this.status(state === "connected" ? "Watching" : "Connecting");
      if (state === "connected") {
        clearTimeout(this.timeout);
        this.timeout = undefined;
      } else if (state === "disconnected" || state === "failed") {
        this.armTimeout();
        if (source && state === "failed" && this.retries++ < 1) {
          void this.offer(true).catch(() => this.fail(NETWORK_HELP));
        }
      }
    };
    this.armTimeout();
  }

  private armTimeout() {
    if (!this.timeout)
      this.timeout = setTimeout(() => {
        if (!this.closed) this.fail(NETWORK_HELP);
      }, CONNECTION_TIMEOUT);
  }

  async offer(restart = false) {
    await this.pc.setLocalDescription(
      await this.pc.createOffer({ iceRestart: restart })
    );
    await this.send({
      type: "description",
      description: this.pc.localDescription!.toJSON()
    });
  }

  async handle(message: MediaSignal) {
    if (this.closed) return;
    if (message.type === "quality") {
      if (!this.source) throw new Error("Only viewers can request quality.");
      this.requestedQuality = message.quality;
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
      if (this.pc.remoteDescription)
        await this.pc.addIceCandidate(message.candidate);
      else if (this.candidates.length < 128)
        this.candidates.push(message.candidate);
      else throw new Error("Too many connection candidates.");
    }
    if (message.type === "description") {
      if (message.description.type !== (this.source ? "answer" : "offer"))
        throw new Error("Unexpected media direction.");
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
      for (const candidate of this.candidates.splice(0))
        await this.pc.addIceCandidate(candidate);
    }
  }

  setPublishQuality(quality: StreamQuality) {
    this.publishQuality = quality;
    return this.applyQuality();
  }
  requestQuality(quality: StreamQuality) {
    return this.send({ type: "quality", quality });
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
        const results = await Promise.all(
          this.pc.getSenders().map((sender) => tuneSender(sender, quality))
        );
        if (results.some((result) => !result))
          this.status(
            "This browser could not apply the requested stream quality. Delivery uses browser defaults."
          );
      });
    return this.tuning;
  }

  stats() {
    return readStats(this.pc, !!this.source, this.previous);
  }

  close() {
    this.closed = true;
    clearTimeout(this.timeout);
    this.pc.onconnectionstatechange = null;
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.close();
    this.stream.getTracks().forEach((track) => track.stop());
  }
}

class Transport {
  private outgoing = Promise.resolve();
  private incoming = Promise.resolve();
  channel?: SignedChannel;
  closed = false;
  constructor(
    readonly connection: DataConnection,
    handler: (message: unknown) => Promise<void>,
    fail: () => void
  ) {
    connection.on("data", (data) => {
      // PBKDF/HMAC and WebRTC calls are asynchronous; preserve reliable channel order.
      this.incoming = this.incoming
        .then(async () => {
          if (!this.closed) await handler(data);
        })
        .catch(fail);
    });
    connection.on("error", fail);
  }
  send(message: Signal): Promise<void> {
    this.outgoing = this.outgoing.then(async () => {
      if (this.closed || !this.channel || !this.connection.open)
        throw new Error("Connection closed.");
      this.connection.send(await this.channel.pack(message));
    });
    return this.outgoing;
  }
  close() {
    this.closed = true;
    this.connection.close();
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
};

// The host distributes authenticated membership and media signaling only.
// Every publisher sends its screen/audio directly to the other participants.
export abstract class RoomSession {
  readonly id: string;
  protected closed = false;
  protected participants: Participant[] = [];
  protected source: MediaStream | null = null;
  protected streamId: string | null = null;
  private publishQuality: StreamQuality = "source";
  private playbackQuality: StreamQuality = "source";
  private measurement?: Promise<SessionMeasurements>;
  private links = new Map<
    string,
    { media: MediaLink; publisher: string; remote: string; streamId: string }
  >();

  constructor(
    protected peer: Peer,
    protected events: SessionEvents
  ) {
    this.id = peer.id;
    peer.on("call", (call) => call.close());
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
    link.media.close();
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
      (stream) => this.events.stream(publisher, stream)
    );
    this.links.set(key, { media, publisher, remote, streamId });
    if (publisher !== this.id)
      void media.requestQuality(this.playbackQuality).catch(() => {});
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
    if (
      !source.getVideoTracks().some((track) => track.readyState === "live") ||
      !source.getAudioTracks().some((track) => track.readyState === "live")
    ) {
      source.getTracks().forEach((track) => track.stop());
      throw new Error(
        "Screen or shared audio stopped. Share again with audio enabled."
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

  async setPublishQuality(quality: StreamQuality) {
    this.publishQuality = quality;
    await Promise.all(
      Array.from(this.links.values())
        .filter((link) => link.publisher === this.id)
        .map((link) => link.media.setPublishQuality(quality))
    );
  }

  async setPlaybackQuality(quality: StreamQuality) {
    this.playbackQuality = quality;
    await Promise.all(
      Array.from(this.links.values())
        .filter((link) => link.publisher !== this.id)
        .map((link) => link.media.requestQuality(quality))
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
    this.links.clear();
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
  private reconnect?: ReturnType<typeof setTimeout>;

  private constructor(
    peer: Peer,
    private key: CryptoKey,
    private username: string,
    events: SessionEvents
  ) {
    super(peer, events);
    this.roomId = peer.id;
    peer.on("connection", (connection) => this.accept(connection));
    peer.on("error", (error) => {
      if (!this.closed) events.notice(errorMessage(error));
    });
    peer.on("disconnected", () => {
      if (this.closed) return;
      events.notice(
        "Reconnecting to the connection service. Existing participants can keep streaming."
      );
      clearTimeout(this.reconnect);
      this.reconnect = setTimeout(() => {
        if (!this.closed && !peer.destroyed && peer.disconnected)
          peer.reconnect();
      }, 2000);
    });
    peer.on("open", () => {
      if (!this.closed) events.notice("");
    });
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
    const key = await deriveRoomKey(password, roomId);
    const peer = await openPeer(roomId);
    const session = new HostSession(peer, key, username.trim(), events);
    try {
      await session.setPublishQuality(quality);
      await session.startSharing(source);
    } catch (error) {
      session.close();
      throw error;
    }
    events.ready();
    return session;
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
          .catch(() => this.remove(client.transport.connection.peer))
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

  private accept(connection: DataConnection) {
    if (
      this.closed ||
      this.clients.has(connection.peer) ||
      this.clients.size >= 255 ||
      !/^viewer-[a-f0-9]{32}$/.test(connection.peer) ||
      Array.from(this.clients.values()).filter((client) => !client.info)
        .length >= 32
    ) {
      connection.close();
      return;
    }
    let stage: "hello" | "auth" | "profile" | "ready" | "rejected" = "hello";
    let context = "";
    const remove = () => this.remove(connection.peer);
    const transport = new Transport(
      connection,
      async (message) => {
        if (stage === "rejected") return;
        if (!isRecord(message)) throw new Error("Invalid connection message.");
        if (stage === "hello") {
          if (message.type !== "hello" || !isNonce(message.nonce))
            throw new Error("Invalid greeting.");
          const nonce = randomHex();
          context = authContext(
            this.roomId,
            connection.peer,
            message.nonce,
            nonce
          );
          stage = "auth";
          connection.send({ type: "challenge", nonce });
        } else if (stage === "auth") {
          if (
            message.type !== "auth" ||
            !(await verify(this.key, `${context}:join`, message.proof))
          ) {
            stage = "rejected";
            connection.send({ type: "rejected" });
            setTimeout(remove, 150);
            return;
          }
          if (transport.closed || this.closed) return;
          transport.channel = new SignedChannel(this.key, context, "host");
          stage = "profile";
        } else {
          const signal = await transport.channel!.unpack(message);
          if (transport.closed || this.closed) return;
          const client = this.clients.get(connection.peer)!;
          if (stage === "profile") {
            if (signal.type !== "profile")
              throw new Error("Username required.");
            client.info = {
              id: connection.peer,
              username: signal.username.trim(),
              streamId: null
            };
            clearTimeout(client.timer);
            stage = "ready";
            await this.announce();
          } else if (signal.type === "publish") {
            client.info!.streamId = signal.streamId;
            await this.announce();
          } else if (signal.type === "media") {
            if (signal.from !== connection.peer)
              throw new Error("Invalid sender.");
            await this.route(signal);
          } else if (signal.type === "ended") remove();
          else throw new Error("Unexpected session message.");
        }
      },
      remove
    );
    this.clients.set(connection.peer, {
      transport,
      timer: setTimeout(remove, CONNECTION_TIMEOUT)
    });
    connection.on("close", remove);
  }

  async end() {
    if (this.closed) return;
    this.cleanup();
    clearTimeout(this.reconnect);
    const clients = Array.from(this.clients.values());
    clients.forEach((client) => clearTimeout(client.timer));
    await Promise.allSettled(
      clients
        .filter((client) => client.info)
        .map((client) => client.transport.send({ type: "ended" }))
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    clients.forEach((client) => client.transport.close());
    this.clients.clear();
    this.peer.destroy();
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
    const peer = await openPeer(`viewer-${randomHex(16)}`);
    const session = new ViewerSession(peer, events);
    session.connect(roomId, key, username.trim());
    return session;
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
    this.close();
    this.events.error(message);
  }

  private connect(roomId: string, key: CryptoKey, username: string) {
    this.peer.on("connection", (connection) => connection.close());
    this.peer.on("error", (error) => {
      if (!this.ready) this.fail(errorMessage(error));
      else if (!this.closed) this.events.notice(errorMessage(error));
    });
    const connection = this.peer.connect(roomId, {
      reliable: true,
      serialization: "json",
      label: "private-stream-v1"
    });
    const nonce = randomHex();
    let challenged = false;
    const transport = new Transport(
      connection,
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
          connection.send({ type: "auth", proof });
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
            this.ready = true;
            this.setRoster(signal.participants);
            this.events.ready();
          } else if (signal.type === "media") await this.receiveMedia(signal);
          else throw new Error("Unexpected session message.");
        }
      },
      () =>
        this.fail(
          "The session connection was interrupted or could not be authenticated. Please reconnect."
        )
    );
    this.transport = transport;
    connection.on("open", () => {
      if (!this.closed) connection.send({ type: "hello", nonce });
    });
    connection.on("close", () =>
      this.fail(
        "The host disconnected or ended the session. Ask for the current link to reconnect."
      )
    );
    this.timer = setTimeout(() => this.fail(NETWORK_HELP), CONNECTION_TIMEOUT);
  }

  close() {
    if (this.closed) return;
    this.cleanup();
    clearTimeout(this.timer);
    this.transport?.close();
    this.peer.destroy();
  }
}
