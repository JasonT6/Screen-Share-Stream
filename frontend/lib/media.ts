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
    systemAudio: "exclude",
    windowAudio: "window",
    // Source changes require a fresh user-initiated picker, not a tab-switch
    // shortcut. The browser, not this webpage or launcher, owns native UI.
    surfaceSwitching: "exclude"
  };
  const stream = await navigator.mediaDevices.getDisplayMedia(options);
  const video = stream.getVideoTracks()[0];
  const audio = stream.getAudioTracks()[0];
  if (
    !video ||
    !audio ||
    video.readyState !== "live" ||
    audio.readyState !== "live"
  ) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error(
      "No shared audio was captured. Share a browser tab and enable ‘Share tab audio’. For a screen or window, your browser and operating system must support sharing its audio."
    );
  }
  video.contentHint = "detail";
  audio.contentHint = "music";
  return stream;
}

export async function tuneSender(sender: RTCRtpSender): Promise<void> {
  const parameters = sender.getParameters();
  if (!parameters.encodings?.length) return;
  if (sender.track?.kind === "video") {
    parameters.degradationPreference = "maintain-resolution";
    parameters.encodings[0].scaleResolutionDownBy = 1;
    // A ceiling, not a guarantee or constant bitrate. WebRTC still adapts to the link.
    parameters.encodings[0].maxBitrate = 40_000_000;
  } else if (sender.track?.kind === "audio") {
    parameters.encodings[0].maxBitrate = 192_000;
  }
  try {
    await sender.setParameters(parameters);
  } catch {
    // Some browsers do not implement all sender hints. Native defaults remain usable.
  }
}

export type StreamStats = {
  width?: number;
  height?: number;
  fps?: number;
  mbps?: number;
  audio: boolean;
};

export async function readStats(
  pc: RTCPeerConnection,
  sending: boolean,
  previous: { bytes: number; time: number }
): Promise<StreamStats> {
  const reports = await pc.getStats();
  const result: StreamStats = { audio: false };
  reports.forEach((report) => {
    if (
      report.type !== (sending ? "outbound-rtp" : "inbound-rtp") ||
      report.isRemote
    )
      return;
    if (report.kind === "audio" || report.mediaType === "audio") {
      result.audio = (sending ? report.bytesSent : report.bytesReceived) > 0;
    }
    if (report.kind !== "video" && report.mediaType !== "video") return;
    result.width = report.frameWidth;
    result.height = report.frameHeight;
    result.fps = report.framesPerSecond;
    const bytes = Number(sending ? report.bytesSent : report.bytesReceived);
    if (previous.time && report.timestamp > previous.time)
      result.mbps = Math.max(
        0,
        ((bytes - previous.bytes) * 8) /
          ((report.timestamp - previous.time) * 1000)
      );
    previous.bytes = bytes;
    previous.time = report.timestamp;
  });
  return result;
}
