import { SignalingSocket } from "../signaling";
import { emptyDiagnostics } from "../diagnostics";
import type { SignedChannel, Signal } from "../protocol";
import type { SessionEvents } from "./room-session";

export async function openSignaling(id: string, events: SessionEvents) {
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

export class Transport {
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
