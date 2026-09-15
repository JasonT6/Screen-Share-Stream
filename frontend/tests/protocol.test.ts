import assert from "node:assert/strict";
import { test } from "node:test";
import {
  authContext,
  createRoomId,
  deriveRoomKey,
  passwordError,
  usernameError,
  isSignal,
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
  assert.equal(passwordError("a"), null);
  assert.equal(passwordError("short"), null);
  assert.ok(passwordError(""));
  assert.equal(passwordError("x".repeat(300)), null);
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

test("usernames and participant control messages are validated", () => {
  assert.ok(usernameError("   "));
  assert.ok(usernameError("x".repeat(41)));
  assert.equal(usernameError("  Alice  "), null);
  const id = createRoomId();
  const participant = { id, username: "Alice", streamId: randomHex() };
  assert.ok(isSignal({ type: "roster", participants: [participant] }));
  assert.equal(
    isSignal({ type: "roster", participants: [participant, participant] }),
    false
  );
  assert.equal(isSignal({ type: "profile", username: " " }), false);
  assert.equal(isSignal({ type: "publish", streamId: "invalid" }), false);
  assert.equal(
    isSignal({
      type: "media",
      from: id,
      to: id,
      publisher: id,
      streamId: randomHex(),
      signal: { type: "ended" }
    }),
    false
  );
});

test("rosters, usernames, and routed media cannot be altered or replayed", async () => {
  const key = await deriveRoomKey("a", createRoomId());
  const host = new SignedChannel(key, "room", "host");
  const viewer = new SignedChannel(key, "room", "viewer");
  const roster = await host.pack({
    type: "roster",
    participants: [{ id: createRoomId(), username: "Alice", streamId: null }]
  });
  await assert.rejects(
    viewer.unpack({ ...roster, body: roster.body.replace("Alice", "Mallory") })
  );
  assert.equal((await viewer.unpack(roster)).type, "roster");
  await assert.rejects(viewer.unpack(roster));
  const profile = await viewer.pack({ type: "profile", username: "Bob" });
  await assert.rejects(
    host.unpack({ ...profile, body: profile.body.replace("Bob", "Mallory") })
  );
  assert.equal((await host.unpack(profile)).type, "profile");
  const from = createRoomId();
  const to = `viewer-${randomHex(16)}`;
  const media = await viewer.pack({
    type: "media",
    from,
    to,
    publisher: from,
    streamId: randomHex(),
    signal: { type: "candidate", candidate: { candidate: "candidate:1" } }
  });
  await assert.rejects(
    host.unpack({
      ...media,
      body: media.body.replace(to, `viewer-${randomHex(16)}`)
    })
  );
  assert.equal((await host.unpack(media)).type, "media");
});

test("quality requests and upload health validate bounds and remain authenticated", async () => {
  assert.equal(isSignal({ type: "quality", quality: "480p" }), true);
  assert.equal(isSignal({ type: "quality", quality: "__proto__" }), false);
  const summary = { peers: 2, measured: 2, troubled: 1, bandwidth: 1, cpu: 0 };
  assert.equal(
    isSignal({ type: "health", summary, limitation: "bandwidth" }),
    true
  );
  assert.equal(
    isSignal({
      type: "health",
      summary: { ...summary, bandwidth: 5 },
      limitation: "none"
    }),
    false
  );
  assert.equal(
    isSignal({
      type: "health",
      summary: { ...summary, peers: Infinity },
      limitation: "none"
    }),
    false
  );
  const key = await deriveRoomKey("a", createRoomId());
  const host = new SignedChannel(key, "quality", "host");
  const viewer = new SignedChannel(key, "quality", "viewer");
  const envelope = await viewer.pack({
    type: "media",
    from: `viewer-${randomHex(16)}`,
    to: createRoomId(),
    publisher: createRoomId(),
    streamId: randomHex(),
    signal: { type: "quality", quality: "480p" }
  });
  await assert.rejects(
    host.unpack({ ...envelope, body: envelope.body.replace("480p", "1080p") })
  );
  assert.equal((await host.unpack(envelope)).type, "media");
});
