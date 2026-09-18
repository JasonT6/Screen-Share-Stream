import assert from "node:assert/strict";
import { test } from "node:test";
import { SignalingSocket, signalingUrl } from "../lib/signaling";
import { createRoomId, randomHex } from "../lib/protocol";

class FakeSocket {
  static OPEN = 1;
  static current: FakeSocket;
  readyState = 1;
  bufferedAmount = 0;
  sent: string[] = [];
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  onclose?: (event: { code: number }) => void;
  constructor(readonly url: URL) {
    FakeSocket.current = this;
  }
  send(data: string) {
    this.sent.push(data);
  }
  message(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }
}

test("native WebSocket registers, routes JSON without RTC, validates source/destination, and closes", async (t) => {
  const native = globalThis.WebSocket;
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  t.after(() => {
    globalThis.WebSocket = native;
    FakeSocket.current?.close();
  });
  const id = createRoomId();
  const from = `viewer-${randomHex(16)}`;
  const states: string[] = [];
  const opened = SignalingSocket.open(id, (state) => states.push(state));
  const ws = FakeSocket.current;
  assert.equal(ws.url.protocol, "wss:");
  ws.message({ type: "OPEN" });
  const socket = await opened;
  const received: unknown[] = [];
  socket.onmessage = (sender, message) => received.push({ sender, message });
  const envelope = {
    type: "CANDIDATE",
    src: from,
    dst: id,
    payload: {
      protocol: "private-stream-ws-v1",
      message: { type: "hello", nonce: "test" }
    }
  };
  ws.message({ ...envelope, src: "attacker" });
  ws.message({ ...envelope, dst: createRoomId() });
  ws.message({ ...envelope, payload: { protocol: "other", message: {} } });
  ws.message(envelope);
  assert.deepEqual(received, [
    { sender: from, message: { type: "hello", nonce: "test" } }
  ]);
  socket.send(from, { seq: 1, body: "test", mac: "test" });
  const wire = JSON.parse(ws.sent[0]);
  assert.deepEqual(wire, {
    type: "CANDIDATE",
    dst: from,
    payload: {
      type: "data",
      connectionId: "private-stream-ws-v1",
      candidate: {
        candidate: "candidate:0 1 udp 1 0.0.0.0 9 typ host",
        sdpMid: "0",
        sdpMLineIndex: 0
      },
      protocol: "private-stream-ws-v1",
      message: { seq: 1, body: "test", mac: "test" }
    }
  });
  assert.deepEqual(states, ["connecting", "open"]);
  ws.bufferedAmount = 1_000_001;
  assert.throws(() => socket.send(from, {}), /buffer/);
  socket.close();
  assert.throws(() => socket.send(from, {}), /disconnected/);
  assert.equal(ws.readyState, 3);
});

test("public signaling requires TLS; only loopback tests can opt out", () => {
  const secure = process.env.NEXT_PUBLIC_PEER_SECURE;
  const host = process.env.NEXT_PUBLIC_PEER_HOST;
  try {
    process.env.NEXT_PUBLIC_PEER_SECURE = "false";
    process.env.NEXT_PUBLIC_PEER_HOST = "example.com";
    assert.throws(
      () => signalingUrl(createRoomId(), randomHex()),
      /secure WebSocket/
    );
    process.env.NEXT_PUBLIC_PEER_HOST = "127.0.0.1";
    assert.equal(signalingUrl(createRoomId(), randomHex()).protocol, "ws:");
  } finally {
    if (secure === undefined) delete process.env.NEXT_PUBLIC_PEER_SECURE;
    else process.env.NEXT_PUBLIC_PEER_SECURE = secure;
    if (host === undefined) delete process.env.NEXT_PUBLIC_PEER_HOST;
    else process.env.NEXT_PUBLIC_PEER_HOST = host;
  }
});

test("unexpected service closure preserves a numeric code without exporting the reason", async (t) => {
  const native = globalThis.WebSocket;
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  t.after(() => {
    globalThis.WebSocket = native;
    FakeSocket.current?.close();
  });
  const opened = SignalingSocket.open(createRoomId(), () => {});
  const ws = FakeSocket.current;
  ws.message({ type: "OPEN" });
  const socket = await opened;
  let notified = false;
  socket.onclose = () => {
    notified = true;
  };
  ws.close();
  assert.equal(notified, true);
  assert.equal(socket.state, "closed");
  assert.equal(socket.closeCode, 1000);
});
