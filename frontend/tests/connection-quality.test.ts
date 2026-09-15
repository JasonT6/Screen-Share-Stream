import assert from "node:assert/strict";
import { test } from "node:test";
import {
  playbackStatus,
  summarizeUpload,
  uploadStatus
} from "../lib/connection-quality";
import {
  readStats,
  tuneSender,
  type StatsHistory,
  type StreamStats
} from "../lib/media";

const healthy: StreamStats = {
  audio: true,
  measured: true,
  state: "connected",
  loss: 0,
  rttMs: 20,
  limitation: "none"
};
const congested: StreamStats = {
  ...healthy,
  loss: 0.1,
  limitation: "bandwidth"
};

test("diagnostics distinguish likely sender, receiver, encoding, and ambiguous trouble", () => {
  const now = 20_000;
  const shared = {
    summary: summarizeUpload([congested, congested]),
    limitation: "bandwidth" as const,
    receivedAt: now
  };
  assert.equal(
    playbackStatus(congested, [congested], shared, now).label,
    "Likely streamer upload"
  );
  assert.equal(uploadStatus(shared.summary).label, "Upload may be limited");
  const isolated = {
    ...shared,
    summary: summarizeUpload([congested, healthy])
  };
  assert.equal(
    playbackStatus(congested, [congested, congested], isolated, now).label,
    "Likely your download"
  );
  assert.equal(
    playbackStatus(congested, [congested], isolated, now).label,
    "Network trouble · cause unclear"
  );
  assert.equal(
    playbackStatus(congested, [congested], shared, now + 10_001).label,
    "Network trouble · cause unclear"
  );
  assert.equal(
    playbackStatus(healthy, [healthy], { ...shared, limitation: "cpu" }, now)
      .label,
    "Streamer encoding is limited"
  );
  assert.equal(
    playbackStatus({ ...healthy, dropped: 0.4 }, [healthy]).label,
    "Your playback may be limited"
  );
  assert.equal(
    playbackStatus({ ...healthy, height: 480, fps: 1 }, [healthy]).level,
    "good"
  );
  assert.equal(playbackStatus({ audio: false }, []).level, "unknown");
  assert.equal(uploadStatus(summarizeUpload([])).level, "unknown");
  assert.equal(
    uploadStatus(summarizeUpload([{ audio: false }])).level,
    "unknown"
  );
  assert.equal(
    playbackStatus({ ...healthy, state: "disconnected" }, [healthy]).level,
    "poor"
  );
});

test("sender presets lower actual encoding, restore source, and do not upscale", async () => {
  let parameters: RTCRtpSendParameters = {
    encodings: [{}],
    codecs: [],
    headerExtensions: [],
    rtcp: {},
    transactionId: "test"
  };
  let height = 2160;
  const sender = {
    track: { kind: "video", getSettings: () => ({ width: 3840, height }) },
    getParameters: () => structuredClone(parameters),
    setParameters: async (value: RTCRtpSendParameters) => {
      parameters = value;
    }
  } as unknown as RTCRtpSender;
  assert.equal(await tuneSender(sender, "720p"), true);
  assert.equal(parameters.encodings[0].scaleResolutionDownBy, 3);
  assert.equal(parameters.encodings[0].maxBitrate, 3_000_000);
  assert.equal(parameters.encodings[0].maxFramerate, 30);
  await tuneSender(sender, "source");
  assert.equal(parameters.encodings[0].scaleResolutionDownBy, 1);
  assert.equal(parameters.encodings[0].maxBitrate, 40_000_000);
  height = 360;
  await tuneSender(sender, "1080p");
  assert.equal(parameters.encodings[0].scaleResolutionDownBy, 1);
  sender.setParameters = async () => {
    throw new Error("Unsupported");
  };
  assert.equal(await tuneSender(sender, "480p"), false);
});

test("network measurements use interval loss and frame drops, recover, and reset after gaps", async () => {
  const video = {
    id: "v",
    type: "inbound-rtp",
    kind: "video",
    timestamp: 1000,
    bytesReceived: 1000,
    packetsReceived: 90,
    packetsLost: 10,
    framesDecoded: 90,
    framesDropped: 10,
    jitter: 0.02
  };
  const reports = new Map<string, object>([
    ["v", video],
    ["transport", { type: "transport", selectedCandidatePairId: "pair" }],
    ["pair", { currentRoundTripTime: 0.03 }]
  ]);
  const pc = {
    getStats: async () => reports,
    connectionState: "connected"
  } as unknown as RTCPeerConnection;
  const history: StatsHistory = new Map();
  assert.equal((await readStats(pc, false, history)).measured, false);
  Object.assign(video, {
    timestamp: 3000,
    bytesReceived: 201000,
    packetsReceived: 180,
    packetsLost: 20,
    framesDecoded: 180,
    framesDropped: 20
  });
  const bad = await readStats(pc, false, history);
  assert.equal(bad.loss, 0.1);
  assert.equal(bad.dropped, 0.1);
  assert.equal(bad.mbps, 0.8);
  assert.equal(bad.jitterMs, 20);
  assert.equal(bad.rttMs, 30);
  Object.assign(video, {
    timestamp: 5000,
    bytesReceived: 401000,
    packetsReceived: 280,
    framesDecoded: 280
  });
  const recovered = await readStats(pc, false, history);
  assert.equal(recovered.loss, 0);
  assert.equal(recovered.dropped, 0);
  video.timestamp = 25_000;
  assert.equal((await readStats(pc, false, history)).measured, false);
  video.timestamp = 26_000;
  video.bytesReceived = 0;
  assert.equal((await readStats(pc, false, history)).measured, false);
});
