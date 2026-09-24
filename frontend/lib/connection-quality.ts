import type { StreamStats } from "./media";

export type SenderHealth = {
  peers: number;
  measured: number;
  troubled: number;
  bandwidth: number;
  cpu: number;
};
export type ConnectionStatus = {
  level: "good" | "warning" | "poor" | "unknown";
  label: string;
  detail: string;
};
export type RemoteHealth = {
  summary: SenderHealth;
  limitation?: StreamStats["limitation"];
  receivedAt: number;
};
export type SessionMeasurements = {
  incoming: Record<string, StreamStats>;
  outgoing: StreamStats[];
  senders: Record<string, RemoteHealth>;
};
export const emptyMeasurements = (): SessionMeasurements => ({
  incoming: {},
  outgoing: [],
  senders: {}
});
export const unknownStatus = (label = "Measuring…"): ConnectionStatus => ({
  level: "unknown",
  label,
  detail:
    "Waiting for recent stream measurements. This is not an internet speed test."
});

function networkTrouble(stats: StreamStats): boolean {
  return (
    stats.state === "failed" ||
    stats.state === "disconnected" ||
    stats.state === "closed" ||
    (stats.loss ?? 0) >= 0.03 ||
    (stats.jitterMs ?? 0) >= 50 ||
    (stats.rttMs ?? 0) >= 400 ||
    stats.limitation === "bandwidth"
  );
}
export function summarizeUpload(stats: StreamStats[]): SenderHealth {
  return {
    peers: stats.length,
    measured: stats.filter((s) => s.measured).length,
    troubled: stats.filter(networkTrouble).length,
    bandwidth: stats.filter((s) => s.measured && s.limitation === "bandwidth")
      .length,
    cpu: stats.filter((s) => s.measured && s.limitation === "cpu").length
  };
}
export function uploadStatus(summary: SenderHealth): ConnectionStatus {
  if (!summary.peers) return unknownStatus("Waiting for viewers");
  if (summary.bandwidth >= 2 && summary.bandwidth === summary.measured)
    return {
      level: "warning",
      label: "Upload may be limited",
      detail:
        "Bandwidth pressure affects multiple viewer paths. Your upload or a shared network path may be limiting delivery; try a lower stream quality."
    };
  if (summary.troubled)
    return {
      level: "warning",
      label: "Viewer connection trouble",
      detail: `${summary.troubled} of ${summary.peers} viewer paths show loss, delay, or bandwidth pressure. A single path cannot distinguish your upload from the viewer’s download.`
    };
  if (summary.measured !== summary.peers) return unknownStatus();
  return {
    level: "good",
    label: "Upload paths healthy",
    detail: summary.cpu
      ? "No network trouble detected. Your browser reports encoding pressure; lower stream quality may help."
      : "Recent delivery to viewers shows no detected network pressure. This measures stream paths, not your total internet capacity."
  };
}

export function playbackStatus(
  selected: StreamStats | undefined,
  all: StreamStats[],
  remote?: RemoteHealth,
  now = Date.now()
): ConnectionStatus {
  if (!selected) return unknownStatus();
  const fresh =
    remote && now - remote.receivedAt <= 10_000 ? remote : undefined;
  if (["failed", "disconnected", "closed"].includes(selected.state ?? ""))
    return {
      level: "poor",
      label: "Stream disconnected",
      detail:
        "The direct stream path is unavailable. Its measurements cannot identify which internet connection failed."
    };
  if (!selected.measured) return unknownStatus();
  if (fresh?.limitation === "cpu" && !networkTrouble(selected))
    return {
      level: "warning",
      label: "Streamer encoding is limited",
      detail:
        "The streamer’s browser reports CPU pressure. This is a device/encoding issue, not evidence of an internet problem."
    };
  const struggling =
    networkTrouble(selected) || fresh?.limitation === "bandwidth";
  if (struggling) {
    if (
      fresh &&
      fresh.summary.bandwidth >= 2 &&
      fresh.summary.bandwidth === fresh.summary.measured
    )
      return {
        level: "warning",
        label: "Likely streamer upload",
        detail:
          "The streamer reports bandwidth pressure across multiple viewers. Upload or a shared upstream path is a likely cause, not a confirmed diagnosis."
      };
    if (
      all.filter((s) => s.measured && networkTrouble(s)).length >= 2 &&
      fresh &&
      fresh.summary.measured >= 2 &&
      fresh.summary.troubled === 1
    )
      return {
        level: "warning",
        label: "Likely your download",
        detail:
          "Multiple streams reaching you have network trouble, while this streamer’s other viewer paths are healthy. Your download or a shared path to you is a likely cause."
      };
    return {
      level: "warning",
      label: "Network trouble · cause unclear",
      detail:
        "Loss, delay, or bandwidth pressure is present. There is not enough independent evidence to separate the streamer’s upload from your download. Try a lower playback quality."
    };
  }
  if ((selected.dropped ?? 0) >= 0.1)
    return {
      level: "warning",
      label: "Your playback may be limited",
      detail:
        "Your browser is dropping video frames without detected network pressure. Try a lower playback quality or close busy apps."
    };
  return {
    level: "good",
    label: "Receiving smoothly",
    detail:
      "Recent stream measurements show no detected network trouble. A lower selected resolution or a static screen alone does not indicate bad internet."
  };
}
