import { isStreamQuality, type StreamQuality } from "./media";
import type { SenderHealth } from "./connection-quality";
const encoder = new TextEncoder();
export const ROOM_PATTERN = /^ps-[a-f0-9]{32}$/;
const HEX_32 = /^[a-f0-9]{64}$/;

export function randomHex(bytes = 32): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export function createRoomId(): string {
  return `ps-${randomHex(16)}`;
}

export function passwordError(password: string): string | null {
  if (!password.trim()) return "Enter a password.";
  return null;
}

export function usernameError(username: string): string | null {
  if (!username.trim()) return "Enter a username.";
  if (username.trim().length > 40)
    return "Keep your username to 40 characters.";
  return null;
}

export async function deriveRoomKey(
  password: string,
  roomId: string
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: 210_000,
      salt: encoder.encode(`private-stream:v1:${roomId}`)
    },
    material,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"]
  );
}

export async function sign(key: CryptoKey, message: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message)
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export async function verify(
  key: CryptoKey,
  message: string,
  signature: unknown
): Promise<boolean> {
  if (typeof signature !== "string" || !HEX_32.test(signature)) return false;
  const bytes = new Uint8Array(
    signature.match(/../g)!.map((byte) => parseInt(byte, 16))
  );
  return crypto.subtle.verify("HMAC", key, bytes, encoder.encode(message));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonce(value: unknown): value is string {
  return typeof value === "string" && HEX_32.test(value);
}

export function authContext(
  roomId: string,
  viewerId: string,
  clientNonce: string,
  hostNonce: string
): string {
  return JSON.stringify([
    "private-stream:v1",
    roomId,
    viewerId,
    clientNonce,
    hostNonce
  ]);
}

// The MAC also authenticates SDP fingerprints. A signaling intermediary cannot
// substitute its own media endpoint, even if it intercepts the data connection.
export class SignedChannel {
  private sent = 0;
  private received = 0;
  constructor(
    private key: CryptoKey,
    private context: string,
    private role: "host" | "viewer"
  ) {}

  async pack(payload: Signal): Promise<Envelope> {
    const seq = ++this.sent;
    const body = JSON.stringify(payload);
    return {
      seq,
      body,
      mac: await sign(
        this.key,
        JSON.stringify([this.context, this.role, seq, body])
      )
    };
  }

  async unpack(value: unknown): Promise<Signal> {
    if (
      !isRecord(value) ||
      value.seq !== this.received + 1 ||
      typeof value.body !== "string" ||
      value.body.length > 100_000
    ) {
      throw new Error("Invalid or replayed stream message.");
    }
    const remoteRole = this.role === "host" ? "viewer" : "host";
    if (
      !(await verify(
        this.key,
        JSON.stringify([this.context, remoteRole, value.seq, value.body]),
        value.mac
      ))
    ) {
      throw new Error("The stream could not be authenticated.");
    }
    const payload: unknown = JSON.parse(value.body);
    if (!isSignal(payload)) throw new Error("Invalid stream message.");
    this.received++;
    return payload;
  }
}

type Envelope = { seq: number; body: string; mac: string };
export type MediaSignal =
  | { type: "quality"; quality: StreamQuality }
  | {
      type: "health";
      summary: SenderHealth;
      limitation: "none" | "bandwidth" | "cpu" | "other";
    }
  | { type: "description"; description: RTCSessionDescriptionInit }
  | { type: "candidate"; candidate: RTCIceCandidateInit };

export type Participant = {
  id: string;
  username: string;
  streamId: string | null;
};
export type RoutedMedia = {
  type: "media";
  from: string;
  to: string;
  publisher: string;
  streamId: string;
  signal: MediaSignal;
};
export type Signal =
  | MediaSignal
  | RoutedMedia
  | { type: "ended" }
  | { type: "profile"; username: string }
  | { type: "publish"; streamId: string | null }
  | { type: "roster"; participants: Participant[] };

function isPeerId(value: unknown): value is string {
  return typeof value === "string" && /^(ps|viewer)-[a-f0-9]{32}$/.test(value);
}

export function isSignal(value: unknown): value is Signal {
  if (!isRecord(value)) return false;
  if (value.type === "ended") return true;
  if (value.type === "profile")
    return typeof value.username === "string" && !usernameError(value.username);
  if (value.type === "publish")
    return value.streamId === null || isNonce(value.streamId);
  if (value.type === "roster")
    return (
      Array.isArray(value.participants) &&
      value.participants.length <= 256 &&
      value.participants.every(
        (p) =>
          isRecord(p) &&
          isPeerId(p.id) &&
          typeof p.username === "string" &&
          !usernameError(p.username) &&
          (p.streamId === null || isNonce(p.streamId))
      ) &&
      new Set(value.participants.map((p) => p.id)).size ===
        value.participants.length
    );
  if (value.type === "media")
    return (
      isPeerId(value.from) &&
      isPeerId(value.to) &&
      isPeerId(value.publisher) &&
      isNonce(value.streamId) &&
      isRecord(value.signal) &&
      ["description", "candidate", "quality", "health"].includes(
        String(value.signal.type)
      ) &&
      isSignal(value.signal)
    );
  if (value.type === "quality") return isStreamQuality(value.quality);
  if (value.type === "health") {
    if (
      !isRecord(value.summary) ||
      !["none", "bandwidth", "cpu", "other"].includes(String(value.limitation))
    )
      return false;
    const s = value.summary;
    if (
      ![s.peers, s.measured, s.troubled, s.bandwidth, s.cpu].every(
        (n) =>
          typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 255
      )
    )
      return false;
    return (
      Number(s.measured) <= Number(s.peers) &&
      Number(s.troubled) <= Number(s.peers) &&
      Number(s.bandwidth) + Number(s.cpu) <= Number(s.measured) &&
      Number(s.bandwidth) <= Number(s.troubled)
    );
  }
  if (value.type === "description") {
    return (
      isRecord(value.description) &&
      ["offer", "answer"].includes(String(value.description.type)) &&
      typeof value.description.sdp === "string"
    );
  }
  if (value.type === "candidate") {
    return (
      isRecord(value.candidate) &&
      typeof value.candidate.candidate === "string" &&
      value.candidate.candidate.length < 4096
    );
  }
  return false;
}
