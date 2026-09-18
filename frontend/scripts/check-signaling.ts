// Public-service compatibility canary: no room auth, SDP, real candidates or media.
// It exercises the production adapter with disposable IDs and inert text only.
import assert from "node:assert/strict";
import { SignalingSocket } from "../lib/signaling";
import { createRoomId, randomHex } from "../lib/protocol";

async function main() {
  const sockets: SignalingSocket[] = [];
  try {
    const sender = await SignalingSocket.open(createRoomId(), () => {});
    sockets.push(sender);
    const receiver = await SignalingSocket.open(
      `viewer-${randomHex(16)}`,
      () => {}
    );
    sockets.push(receiver);
    // A description-sized body also checks that the service preserves opaque data.
    const payload = { type: "protocol-check", text: "x".repeat(8000) };
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Signaling round-trip timed out.")),
        15_000
      );
      const fail = () => {
        clearTimeout(timeout);
        reject(new Error("Signaling service closed during the round-trip."));
      };
      sender.onclose = fail;
      receiver.onclose = fail;
      receiver.onmessage = (from, message) => {
        try {
          assert.equal(from, sender.id);
          assert.deepEqual(message, payload);
          receiver.send(sender.id, message);
        } catch {
          fail();
        }
      };
      sender.onmessage = (from, message) => {
        try {
          assert.equal(from, receiver.id);
          assert.deepEqual(message, payload);
          clearTimeout(timeout);
          resolve();
        } catch {
          fail();
        }
      };
      sender.send(receiver.id, payload);
    });
    console.log(
      "Signaling compatibility passed: both directions preserved the inert payload. No authentication, real ICE metadata, or media was sent."
    );
  } finally {
    sockets.forEach((socket) => socket.close());
  }
}
void main().catch(() => {
  console.error(
    "Signaling compatibility failed: the service did not complete the inert round-trip."
  );
  process.exitCode = 1;
});
