import assert from "node:assert/strict";
import { test } from "node:test";
import { captureDisplay, rtcConfiguration } from "../lib/media";

test("capture requests native dimensions and shared audio, and rejects a silent source", async () => {
  const calls: DisplayMediaStreamOptions[] = [];
  let stopped = false;
  const video = {
    readyState: "live",
    contentHint: "",
    stop: () => {
      stopped = true;
    }
  };
  const audio = { readyState: "live", contentHint: "", stop() {} };
  let includeAudio = false;
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: {
      getDisplayMedia: async (options: DisplayMediaStreamOptions) => {
        calls.push(options);
        return {
          getVideoTracks: () => [video],
          getAudioTracks: () => (includeAudio ? [audio] : []),
          getTracks: () => (includeAudio ? [video, audio] : [video])
        };
      }
    }
  });
  await assert.rejects(captureDisplay(60), /No shared audio/);
  assert.equal(stopped, true);
  includeAudio = true;
  await captureDisplay(30);
  assert.deepEqual(calls[0].video, { frameRate: { ideal: 60, max: 60 } });
  assert.deepEqual(calls[1].video, { frameRate: { ideal: 30, max: 30 } });
  assert.ok(calls[0].audio);
  assert.equal("selfBrowserSurface" in calls[0], false);
  assert.equal("preferCurrentTab" in calls[0], false);
  assert.equal(
    (calls[0] as DisplayMediaStreamOptions & { surfaceSwitching: string })
      .surfaceSwitching,
    "exclude"
  );
  assert.equal(video.contentHint, "detail");
  assert.equal(audio.contentHint, "music");
  for (const server of rtcConfiguration.iceServers ?? []) {
    for (const url of [server.urls].flat())
      assert.ok(url.startsWith("stun:"), "Media must never use TURN");
  }
});

test("canceling the system picker is final: no automatic retry or alternate capture", async () => {
  let calls = 0;
  const denied = new DOMException(
    "User canceled the picker",
    "NotAllowedError"
  );
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: {
      getDisplayMedia: async () => {
        calls++;
        throw denied;
      },
      getUserMedia: async () => {
        assert.fail("Never replace a canceled picker with another capture API");
      }
    }
  });
  await assert.rejects(captureDisplay(60), (error) => error === denied);
  assert.equal(calls, 1);
});

test("advanced preferences preserve publisher audio ceilings and allow per-viewer video priority", async () => {
  const {
    resolvePreferences,
    PUBLISH_PREFERENCES,
    PLAYBACK_PREFERENCES,
    tuneSender
  } = await import("../lib/media");
  assert.deepEqual(
    resolvePreferences(PUBLISH_PREFERENCES, PLAYBACK_PREFERENCES),
    PUBLISH_PREFERENCES
  );
  const resolved = resolvePreferences(
    { priority: "detail", audio: "standard" },
    { priority: "motion", audio: "high" }
  );
  assert.deepEqual(resolved, { priority: "motion", audio: "standard" });
  assert.equal(
    resolvePreferences(PUBLISH_PREFERENCES, {
      priority: "balanced",
      audio: "low"
    }).audio,
    "low"
  );
  assert.equal(
    resolvePreferences(
      { priority: "motion", audio: "low" },
      PLAYBACK_PREFERENCES
    ).priority,
    "motion"
  );
  let applied: RTCRtpSendParameters | undefined;
  const track = {
    kind: "video",
    contentHint: "detail",
    getSettings: () => ({ width: 1920, height: 1080 })
  };
  const sender = {
    track,
    getParameters: () => ({ encodings: [{}] }),
    setParameters: async (value: RTCRtpSendParameters) => {
      applied = value;
    }
  } as unknown as RTCRtpSender;
  assert.equal(await tuneSender(sender, "720p", resolved), true);
  assert.equal(applied?.degradationPreference, "maintain-framerate");
  assert.equal(applied?.encodings[0].scaleResolutionDownBy, 1.5);
  assert.equal(applied?.encodings[0].maxFramerate, 30);
  assert.equal(applied?.encodings[0].maxBitrate, 3_000_000);
  assert.equal(
    track.contentHint,
    "detail",
    "Per-viewer tuning must not modify shared capture"
  );
  await tuneSender(sender, "source", { priority: "balanced", audio: "low" });
  assert.equal(applied?.degradationPreference, "balanced");
  assert.equal(applied?.encodings[0].scaleResolutionDownBy, 1);
  await tuneSender(sender);
  assert.equal(applied?.degradationPreference, "maintain-framerate");
  track.kind = "audio";
  await tuneSender(sender, "source", resolved);
  assert.equal(applied?.encodings[0].maxBitrate, 128_000);
  await tuneSender(sender, "source", { priority: "detail", audio: "low" });
  assert.equal(applied?.encodings[0].maxBitrate, 64_000);
  await tuneSender(sender);
  assert.equal(applied?.encodings[0].maxBitrate, 192_000);
  sender.setParameters = async () => {
    throw new Error("Unsupported");
  };
  assert.equal(await tuneSender(sender), false);
});
