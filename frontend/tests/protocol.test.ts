import assert from "node:assert/strict";
import { test } from "node:test";
import {
  authContext,
  createRoomId,
  deriveRoomKey,
  passwordError,
  randomHex,
  ROOM_PATTERN,
  sign,
  SignedChannel,
  verify
} from "../lib/protocol";

test("unguessable room IDs and nonces have the expected entropy and format", () => {
  const rooms = new Set(Array.from({ length: 100 }, createRoomId));
  assert.equal(rooms.size, 100);
  for (const room of rooms) assert.match(room, ROOM_PATTERN);
  assert.equal(randomHex().length, 64);
  assert.ok(passwordError("short"));
  assert.ok(passwordError("            "));
  assert.equal(passwordError("correct horse battery staple"), null);
});

test("password verification is salted per room and challenges cannot be replayed", async () => {
  const room = createRoomId();
  const key = await deriveRoomKey("a long private password", room);
  const matching = await deriveRoomKey("a long private password", room);
  const wrongPassword = await deriveRoomKey("a different password", room);
  const otherRoom = await deriveRoomKey(
    "a long private password",
    createRoomId()
  );
  const context = authContext(room, "viewer-a", randomHex(), randomHex());
  const proof = await sign(key, `${context}:join`);
  assert.equal(await verify(matching, `${context}:join`, proof), true);
  assert.equal(await verify(wrongPassword, `${context}:join`, proof), false);
  assert.equal(await verify(otherRoom, `${context}:join`, proof), false);
  assert.equal(await verify(key, `${context}changed:join`, proof), false);
  assert.equal(await verify(key, `${context}:join`, "not-hex"), false);
});

test("SDP and ICE messages are authenticated, ordered, role-bound and not replayable", async () => {
  const key = await deriveRoomKey("a long private password", createRoomId());
  const host = new SignedChannel(key, "session", "host");
  const viewer = new SignedChannel(key, "session", "viewer");
  const offer = await host.pack({
    type: "description",
    description: { type: "offer", sdp: "a=fingerprint:original" }
  });
  await assert.rejects(
    viewer.unpack({
      ...offer,
      body: offer.body.replace("original", "attacker")
    })
  );
  assert.equal((await viewer.unpack(offer)).type, "description");
  await assert.rejects(viewer.unpack(offer));
  const candidate = await host.pack({
    type: "candidate",
    candidate: { candidate: "candidate:1" }
  });
  await assert.rejects(viewer.unpack({ ...candidate, seq: 3 }));
  assert.equal((await viewer.unpack(candidate)).type, "candidate");
  const answer = await viewer.pack({
    type: "description",
    description: { type: "answer", sdp: "a=recvonly" }
  });
  assert.equal((await host.unpack(answer)).type, "description");
  await assert.rejects(
    new SignedChannel(key, "other-session", "viewer").unpack(offer)
  );
  await assert.rejects(new SignedChannel(key, "session", "host").unpack(offer));
});
