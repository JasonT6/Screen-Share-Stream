export type FrameRate = 30 | 60;

export const rtcConfiguration: RTCConfiguration = {
  // Explicit STUN-only configuration: no PeerJS default TURN or media relay.
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }
  ],
  bundlePolicy: "max-bundle"
};

export function browserError(host: boolean): string | null {
  if (!window.isSecureContext)
    return "Open this app over HTTPS (or localhost) to stream securely.";
  if (!window.RTCPeerConnection || !crypto.subtle)
    return "This browser does not support direct streaming. Try a current version of Chrome or Edge.";
  if (host && !navigator.mediaDevices?.getDisplayMedia)
    return "Screen sharing is unavailable here. Start the stream in desktop Chrome or Edge.";
  return null;
}

export async function captureDisplay(
  frameRate: FrameRate
): Promise<MediaStream> {
  // No width/height cap: capture the selected source at its available resolution.
  const options: DisplayMediaStreamOptions & {
    systemAudio: string;
    windowAudio: string;
    surfaceSwitching: string;
  } = {
    video: { frameRate: { ideal: frameRate, max: frameRate } },
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    },
    systemAudio: "include",
    windowAudio: "window",
    // Source changes require a fresh user-initiated picker, not a tab-switch
    // shortcut. The browser, not this webpage or launcher, owns native UI.
    surfaceSwitching: "exclude"
  };
  const stream = await navigator.mediaDevices.getDisplayMedia(options);
  const video = stream.getVideoTracks()[0];
  const audio = stream.getAudioTracks()[0];
  if (!video || video.readyState !== "live") {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error(
      "No live screen video was captured. Choose a tab, window, or screen to share."
    );
  }
  video.contentHint = "detail";
  if (audio) audio.contentHint = "music";
  return stream;
}

export const QUALITY_PRESETS = {
  source: {
    label: "Source / automatic",
    height: Infinity,
    bitrate: 40_000_000,
    fps: 60
  },
  "1080p": { label: "1080p · high", height: 1080, bitrate: 8_000_000, fps: 30 },
  "720p": {
    label: "720p · balanced",
    height: 720,
    bitrate: 3_000_000,
    fps: 30
  },
  "480p": { label: "480p · low data", height: 480, bitrate: 1_000_000, fps: 24 }
} as const;
export type StreamQuality = keyof typeof QUALITY_PRESETS;
export function isStreamQuality(value: unknown): value is StreamQuality {
  return typeof value === "string" && Object.hasOwn(QUALITY_PRESETS, value);
}

export const VIDEO_PRIORITIES = {
  detail: {
    label: "Quality priority · detail",
    degradation: "maintain-resolution"
  },
  motion: {
    label: "Frame rate priority · motion",
    degradation: "maintain-framerate"
  },
  balanced: { label: "Balanced", degradation: "balanced" }
} as const;
export const AUDIO_QUALITIES = {
  high: { label: "High · up to 192 kbps", bitrate: 192_000 },
  standard: { label: "Standard · up to 128 kbps", bitrate: 128_000 },
  low: { label: "Low data · up to 64 kbps", bitrate: 64_000 }
} as const;
export type StreamPreferences = {
  priority: keyof typeof VIDEO_PRIORITIES | "streamer";
  audio: keyof typeof AUDIO_QUALITIES;
};
export const PUBLISH_PREFERENCES: StreamPreferences = {
  priority: "motion",
  audio: "high"
};
export const PLAYBACK_PREFERENCES: StreamPreferences = {
  priority: "streamer",
  audio: "high"
};

export function isStreamPreferences(
  value: unknown
): value is StreamPreferences {
  if (typeof value !== "object" || value === null) return false;
  const preferences = value as Record<string, unknown>;
  return (
    typeof preferences.priority === "string" &&
    (preferences.priority === "streamer" ||
      Object.hasOwn(VIDEO_PRIORITIES, preferences.priority)) &&
    typeof preferences.audio === "string" &&
    Object.hasOwn(AUDIO_QUALITIES, preferences.audio)
  );
}

export function resolvePreferences(
  publisher: StreamPreferences,
  viewer: StreamPreferences
): StreamPreferences {
  return {
    priority:
      viewer.priority === "streamer" ? publisher.priority : viewer.priority,
    audio:
      AUDIO_QUALITIES[publisher.audio].bitrate <=
      AUDIO_QUALITIES[viewer.audio].bitrate
        ? publisher.audio
        : viewer.audio
  };
}

export async function tuneSender(
  sender: RTCRtpSender,
  quality: StreamQuality = "source",
  preferences: StreamPreferences = PUBLISH_PREFERENCES
): Promise<boolean> {
  const parameters = sender.getParameters();
  if (!parameters.encodings?.length) return false;
  if (sender.track?.kind === "video") {
    const preset = QUALITY_PRESETS[quality];
    const settings = sender.track.getSettings();
    // Explicit per-sender preference overrides the shared capture's detail hint.
    // Never mutate the shared track hint for one viewer's preference.
    parameters.degradationPreference =
      VIDEO_PRIORITIES[
        preferences.priority === "streamer" ? "motion" : preferences.priority
      ].degradation;
    // Limit the short edge, preserving aspect ratio for portrait and ultrawide sources.
    const shortEdge = Math.min(
      settings.width ?? preset.height,
      settings.height ?? preset.height
    );
    parameters.encodings[0].scaleResolutionDownBy =
      quality === "source" ? 1 : Math.max(1, shortEdge / preset.height);
    parameters.encodings[0].maxBitrate = preset.bitrate;
    parameters.encodings[0].maxFramerate = preset.fps;
  } else if (sender.track?.kind === "audio") {
    parameters.encodings[0].maxBitrate =
      AUDIO_QUALITIES[preferences.audio].bitrate;
  }
  try {
    await sender.setParameters(parameters);
    return true;
  } catch {
    return false;
  }
}

export type StreamStats = {
  width?: number;
  height?: number;
  fps?: number;
  mbps?: number;
  audio: boolean;
  measured?: boolean;
  loss?: number;
  jitterMs?: number;
  rttMs?: number;
  dropped?: number;
  droppedFrames?: number;
  limitation?: "none" | "bandwidth" | "cpu" | "other";
  state?: RTCPeerConnectionState;
};
type Sample = {
  time: number;
  bytes: number;
  lost: number;
  packets: number;
  dropped: number;
  frames: number;
};
export type StatsHistory = Map<string, Sample>;

// Rates use consecutive samples, never lifetime counters. Missing stats stay unknown.
export async function readStats(
  pc: RTCPeerConnection,
  sending: boolean,
  previous: StatsHistory,
  snapshot?: RTCStatsReport
): Promise<StreamStats> {
  const reports = snapshot ?? (await pc.getStats());
  const result: StreamStats = {
    audio: false,
    state: pc.connectionState,
    measured: false
  };
  const finite = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);
  reports.forEach((report) => {
    if (report.type === "transport" && report.selectedCandidatePairId) {
      const pair = reports.get(report.selectedCandidatePairId);
      if (finite(pair?.currentRoundTripTime))
        result.rttMs = pair.currentRoundTripTime * 1000;
    }
    if (
      report.type !== (sending ? "outbound-rtp" : "inbound-rtp") ||
      report.isRemote
    )
      return;
    const bytes = sending ? report.bytesSent : report.bytesReceived;
    const before = previous.get(report.id);
    const sample: Sample = {
      time: report.timestamp,
      bytes: finite(bytes) ? bytes : 0,
      lost: finite(report.packetsLost) ? report.packetsLost : 0,
      packets: (sending ? report.packetsSent : report.packetsReceived) ?? 0,
      dropped: report.framesDropped ?? 0,
      frames: report.framesDecoded ?? 0
    };
    const elapsed = before ? sample.time - before.time : 0;
    const valid =
      !!before &&
      elapsed > 0 &&
      elapsed < 10_000 &&
      sample.bytes >= before.bytes;
    if (report.kind === "audio")
      result.audio = valid && sample.bytes > before.bytes;
    if (report.kind === "video") {
      result.width = report.frameWidth;
      result.height = report.frameHeight;
      result.fps = report.framesPerSecond;
      if (finite(report.framesDropped))
        result.droppedFrames = report.framesDropped;
      if (valid) {
        result.mbps = ((sample.bytes - before.bytes) * 8) / (elapsed * 1000);
        result.measured = sample.bytes > before.bytes;
        const lost = Math.max(0, sample.lost - before.lost);
        const received = sample.packets - before.packets;
        if (
          !sending &&
          received >= 0 &&
          lost + received > 0 &&
          finite(report.packetsLost)
        )
          result.loss = lost / (lost + received);
        const dropped = Math.max(0, sample.dropped - before.dropped);
        const decoded = Math.max(0, sample.frames - before.frames);
        if (dropped + decoded > 0)
          result.dropped = dropped / (dropped + decoded);
      }
      if (finite(report.jitter)) result.jitterMs = report.jitter * 1000;
      if (
        ["none", "bandwidth", "cpu", "other"].includes(
          report.qualityLimitationReason
        )
      )
        result.limitation = report.qualityLimitationReason;
      if (sending && report.remoteId) {
        const remote = reports.get(report.remoteId);
        if (finite(remote?.jitter)) result.jitterMs = remote.jitter * 1000;
        if (finite(remote?.fractionLost))
          result.loss = Math.max(0, Math.min(1, remote.fractionLost));
        if (finite(remote?.roundTripTime))
          result.rttMs = remote.roundTripTime * 1000;
      }
    }
    previous.set(report.id, sample);
  });
  return result;
}
