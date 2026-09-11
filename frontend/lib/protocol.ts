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
  if (password.trim().length < 12)
    return "Use a password or phrase with at least 12 characters.";
  if (password.length > 256) return "Keep the password under 257 characters.";
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
export type Signal =
  | { type: "description"; description: RTCSessionDescriptionInit }
  | { type: "candidate"; candidate: RTCIceCandidateInit }
  | { type: "ended" };

function isSignal(value: unknown): value is Signal {
  if (!isRecord(value)) return false;
  if (value.type === "ended") return true;
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
