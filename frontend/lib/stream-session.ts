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
  type Signal
} from "./protocol";
import {
  readStats,
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

// One media connection per viewer. Only the host offers; the viewer has no
// capture code, no local tracks, and only recvonly transceivers.
class MediaLink {
  readonly pc = new RTCPeerConnection(rtcConfiguration);
  private candidates: RTCIceCandidateInit[] = [];
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private retries = 0;
  private closed = false;
  private previous = { bytes: 0, time: 0 };
  private stream = new MediaStream();

  constructor(
    private source: MediaStream | null,
    private send: (message: Signal) => Promise<void>,
    private status: (state: string) => void,
    private fail: (message: string) => void,
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

  async handle(message: Signal) {
    if (this.closed) return;
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
        await Promise.all(this.pc.getSenders().map(tuneSender));
      }
      for (const candidate of this.candidates.splice(0))
        await this.pc.addIceCandidate(candidate);
    }
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

export type ViewerInfo = { id: string; label: string; status: string };
type HostEvents = {
  viewers: (viewers: ViewerInfo[]) => void;
  notice: (message: string) => void;
};

export class HostSession {
  readonly roomId: string;
  private closed = false;
  private clients = new Map<
    string,
    {
      transport: Transport;
      media?: MediaLink;
      timer: ReturnType<typeof setTimeout>;
      info?: ViewerInfo;
    }
  >();
  private nextViewer = 1;
  private reconnect?: ReturnType<typeof setTimeout>;

  private constructor(
    private peer: Peer,
    private key: CryptoKey,
    private source: MediaStream,
    private events: HostEvents
  ) {
    this.roomId = peer.id;
    peer.on("connection", (connection) => this.accept(connection));
    peer.on("call", (call) => call.close());
    peer.on("error", (error) => {
      if (!this.closed) events.notice(errorMessage(error));
    });
    peer.on("disconnected", () => {
      if (this.closed) return;
      events.notice(
        "Reconnecting to the connection service. Existing viewers can keep watching."
      );
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
    source: MediaStream,
    events: HostEvents
  ) {
    const roomId = createRoomId();
    const key = await deriveRoomKey(password, roomId);
    const peer = await openPeer(roomId);
    return new HostSession(peer, key, source, events);
  }

  private update() {
    this.events.viewers(
      Array.from(this.clients.values()).flatMap((client) =>
        client.info ? [client.info] : []
      )
    );
  }

  private accept(connection: DataConnection) {
    if (
      this.closed ||
      this.clients.has(connection.peer) ||
      Array.from(this.clients.values()).filter((client) => !client.info)
        .length >= 32
    ) {
      connection.close();
      return;
    }
    let stage: "hello" | "auth" | "ready" | "rejected" = "hello";
    let context = "";
    const remove = () => {
      const client = this.clients.get(connection.peer);
      if (!client || client.transport !== transport) return;
      this.clients.delete(connection.peer);
      clearTimeout(client.timer);
      client.media?.close();
      transport.close();
      this.update();
    };
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
            // Allow the rejection to flush; never create a media sender on failure.
            setTimeout(remove, 150);
            return;
          }
          if (transport.closed || this.closed) return;
          stage = "ready";
          transport.channel = new SignedChannel(this.key, context, "host");
          const client = this.clients.get(connection.peer)!;
          clearTimeout(client.timer);
          client.info = {
            id: connection.peer,
            label: `Viewer ${this.nextViewer++}`,
            status: "Connecting"
          };
          client.media = new MediaLink(
            this.source,
            (signal) => transport.send(signal),
            (status) => {
              if (client.info) client.info.status = status;
              this.update();
            },
            remove
          );
          this.update();
          await client.media.offer();
        } else {
          const signal = await transport.channel!.unpack(message);
          if (signal.type === "ended") remove();
          else await this.clients.get(connection.peer)?.media?.handle(signal);
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

  async stats(): Promise<StreamStats | null> {
    const client = Array.from(this.clients.values()).find(
      (entry) => entry.media?.pc.connectionState === "connected"
    );
    return client?.media?.stats() ?? null;
  }

  async end() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.reconnect);
    this.source.getTracks().forEach((track) => track.stop());
    const clients = Array.from(this.clients.values());
    clients.forEach((client) => {
      clearTimeout(client.timer);
      client.media?.close();
    });
    await Promise.allSettled(
      clients
        .filter((client) => client.transport.channel)
        .map((client) => client.transport.send({ type: "ended" }))
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    clients.forEach((client) => client.transport.close());
    this.clients.clear();
    this.peer.destroy();
    this.update();
  }
}

type WatchEvents = {
  status: (status: string) => void;
  stream: (stream: MediaStream | null) => void;
  error: (message: string) => void;
  ended: () => void;
};

export class ViewerSession {
  private media?: MediaLink;
  private transport?: Transport;
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;

  private constructor(
    private peer: Peer,
    private events: WatchEvents
  ) {}

  static async join(
    roomId: string,
    password: string,
    events: WatchEvents
  ): Promise<ViewerSession> {
    if (!ROOM_PATTERN.test(roomId))
      throw new Error(
        "This invitation is invalid. Ask the host for a new link."
      );
    const key = await deriveRoomKey(password, roomId);
    const peer = await openPeer(`viewer-${randomHex(16)}`);
    const session = new ViewerSession(peer, events);
    session.connect(roomId, key);
    return session;
  }

  private fail(message: string) {
    if (this.closed) return;
    this.close();
    this.events.error(message);
  }

  private connect(roomId: string, key: CryptoKey) {
    this.peer.on("call", (call) => call.close());
    this.peer.on("connection", (connection) => connection.close());
    this.peer.on("error", (error) => {
      // Signaling outages need not interrupt an already established media stream.
      if (this.media?.pc.connectionState !== "connected")
        this.fail(errorMessage(error));
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
        if (!isRecord(message)) throw new Error("Invalid stream message.");
        if (!challenged) {
          if (message.type !== "challenge" || !isNonce(message.nonce))
            throw new Error("Invalid stream challenge.");
          challenged = true;
          const context = authContext(
            roomId,
            this.peer.id,
            nonce,
            message.nonce
          );
          transport.channel = new SignedChannel(key, context, "viewer");
          const proof = await sign(key, `${context}:join`);
          if (!this.closed) connection.send({ type: "auth", proof });
        } else if (message.type === "rejected" && !this.media) {
          this.fail("Incorrect password. Check with the host and try again.");
        } else {
          const signal = await transport.channel!.unpack(message);
          if (this.closed) return;
          if (signal.type === "ended") {
            this.close();
            this.events.ended();
            return;
          }
          if (!this.media) {
            clearTimeout(this.timer);
            this.events.status("Connecting video and audio");
            this.media = new MediaLink(
              null,
              (outgoing) => transport.send(outgoing),
              this.events.status,
              (error) => this.fail(error),
              this.events.stream
            );
          }
          await this.media.handle(signal);
        }
      },
      () =>
        this.fail(
          "The stream connection was interrupted or could not be authenticated. Please reconnect."
        )
    );
    this.transport = transport;
    connection.on("open", () => {
      if (this.closed) return;
      this.events.status("Checking password");
      connection.send({ type: "hello", nonce });
    });
    connection.on("close", () =>
      this.fail(
        "The host disconnected or ended the stream. Ask for the current link to reconnect."
      )
    );
    this.timer = setTimeout(() => this.fail(NETWORK_HELP), CONNECTION_TIMEOUT);
  }

  async stats(): Promise<StreamStats | null> {
    return this.media?.stats() ?? null;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    this.media?.close();
    this.transport?.close();
    this.peer.destroy();
    this.events.stream(null);
  }
}
