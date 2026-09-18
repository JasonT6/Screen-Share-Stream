import { isPeerId, isRecord, randomHex } from "./protocol";

export type SocketState = "idle" | "connecting" | "open" | "closed" | "error";
const MAX_MESSAGE = 120_000;

// PeerServer is a WebSocket message router. Its CANDIDATE envelope forwards an
// opaque payload, but Cloud requires the standard nonempty candidate fields.
// This fixed, non-routable placeholder is only the service envelope. It is never
// passed to RTCPeerConnection; real SDP/ICE stays in the authenticated message.
// No PeerJS connection or RTC data channel is created.
// Keep the service adapter here, separate from the authenticated app protocol.
export function signalingUrl(id: string, token: string): URL {
  const host = process.env.NEXT_PUBLIC_PEER_HOST || "0.peerjs.com";
  const secure = process.env.NEXT_PUBLIC_PEER_SECURE !== "false";
  const port = process.env.NEXT_PUBLIC_PEER_PORT || (secure ? "443" : "80");
  const path = process.env.NEXT_PUBLIC_PEER_PATH || "/";
  const url = new URL(
    `${secure ? "wss" : "ws"}://${host}:${port}${path.replace(/\/$/, "")}/peerjs`
  );
  if (!secure && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error("Signaling requires a secure WebSocket (wss).");
  url.search = new URLSearchParams({ key: "peerjs", id, token }).toString();
  return url;
}

export class SignalingSocket {
  private socket: WebSocket;
  private heartbeat?: ReturnType<typeof setInterval>;
  state: SocketState = "connecting";
  readonly secure: boolean;
  closeCode: number | null = null;
  onmessage?: (from: string, payload: unknown) => void;
  onclose?: () => void;
  onstate?: (state: SocketState) => void;

  private constructor(
    readonly id: string,
    url: URL
  ) {
    this.secure = url.protocol === "wss:";
    this.socket = new WebSocket(url);
  }

  static open(
    id: string,
    state: (state: SocketState, secure: boolean) => void
  ): Promise<SignalingSocket> {
    const url = signalingUrl(id, randomHex());
    state("connecting", url.protocol === "wss:");
    return new Promise((resolve, reject) => {
      const transport = new SignalingSocket(id, url);
      const ws = transport.socket;
      let registered = false;
      const update = (next: SocketState) => {
        transport.state = next;
        if (!transport.onstate) state(next, transport.secure);
        transport.onstate?.(next);
      };
      const fail = () => {
        clearTimeout(timeout);
        clearInterval(transport.heartbeat);
        update("error");
        ws.close();
        if (!registered)
          reject(
            new Error(
              "The WebSocket signaling service is unavailable. Check your internet connection and retry."
            )
          );
        else transport.onclose?.();
      };
      const timeout = setTimeout(fail, 25_000);
      ws.onerror = fail;
      ws.onclose = (event) => {
        transport.closeCode = event.code;
        clearTimeout(timeout);
        clearInterval(transport.heartbeat);
        if (transport.state === "closed" || transport.state === "error") return;
        update("closed");
        if (!registered)
          reject(
            new Error(
              "The WebSocket signaling connection closed before registration."
            )
          );
        else transport.onclose?.();
      };
      ws.onmessage = (event: MessageEvent<unknown>) => {
        if (typeof event.data !== "string" || event.data.length > MAX_MESSAGE)
          return;
        let message: unknown;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (!isRecord(message)) return;
        if (message.type === "OPEN" && !registered) {
          registered = true;
          clearTimeout(timeout);
          update("open");
          transport.heartbeat = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN)
              ws.send(JSON.stringify({ type: "HEARTBEAT" }));
          }, 5000);
          resolve(transport);
        } else if (["ERROR", "ID-TAKEN"].includes(String(message.type))) fail();
        else if (
          registered &&
          message.type === "CANDIDATE" &&
          isPeerId(message.src) &&
          message.dst === id &&
          isRecord(message.payload) &&
          message.payload.protocol === "private-stream-ws-v1"
        ) {
          transport.onmessage?.(message.src, message.payload.message);
        }
        // Service LEAVE/EXPIRE messages are unauthenticated. Signed application
        // heartbeats detect departed peers without trusting these notifications.
      };
    });
  }

  send(to: string, message: unknown) {
    if (this.state !== "open" || this.socket.readyState !== WebSocket.OPEN)
      throw new Error("WebSocket signaling is disconnected. Please reconnect.");
    const data = JSON.stringify({
      type: "CANDIDATE",
      dst: to,
      payload: {
        type: "data",
        connectionId: "private-stream-ws-v1",
        candidate: {
          candidate: "candidate:0 1 udp 1 0.0.0.0 9 typ host",
          sdpMid: "0",
          sdpMLineIndex: 0
        },
        protocol: "private-stream-ws-v1",
        message
      }
    });
    if (data.length > MAX_MESSAGE || this.socket.bufferedAmount > 1_000_000)
      throw new Error("WebSocket signaling buffer exceeded.");
    this.socket.send(data);
  }

  close() {
    clearInterval(this.heartbeat);
    this.state = "closed";
    this.socket.onclose = null;
    this.socket.onerror = null;
    this.socket.onmessage = null;
    this.socket.close();
    this.onstate?.("closed");
  }
}
