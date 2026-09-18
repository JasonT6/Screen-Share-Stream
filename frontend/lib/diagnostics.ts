import type { StreamStats } from "./media";
import type { SocketState } from "./signaling";

export type CandidateSummary = {
  type: "host" | "srflx" | "prflx" | "relay" | "unknown";
  protocol: "udp" | "tcp" | "unknown";
  tcpType: "active" | "passive" | "so" | "unknown";
  address: "[redacted]";
};
export type LinkDiagnostics = {
  direction: "sending" | "receiving";
  connectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState;
  iceGatheringState: RTCIceGatheringState;
  signalingState: RTCSignalingState;
  localCandidates: CandidateSummary[];
  remoteCandidates: CandidateSummary[];
  selectedPair: {
    local: CandidateSummary;
    remote: CandidateSummary;
    state: string;
  } | null;
  iceErrors: number[];
  iceRestartCount: number;
  setupTimeMs: number | null;
  elapsedMs: number;
  failed: boolean;
  stats: StreamStats;
};
export type SessionDiagnostics = {
  websocket: SocketState;
  websocketCloseCode?: number | null;
  secure: boolean | null;
  signaling:
    | "idle"
    | "registering"
    | "authenticating"
    | "ready"
    | "failed"
    | "closed";
  connections: LinkDiagnostics[];
};
export const emptyDiagnostics = (): SessionDiagnostics => ({
  websocket: "idle",
  secure: null,
  signaling: "idle",
  connections: []
});

const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
function choice<T extends string>(
  value: unknown,
  choices: readonly T[],
  fallback: T
): T {
  return choices.includes(value as T) ? (value as T) : fallback;
}
export function candidateSummary(value: {
  candidateType?: unknown;
  type?: unknown;
  protocol?: unknown;
  tcpType?: unknown;
}): CandidateSummary {
  return {
    type: choice(
      value.candidateType ?? value.type,
      ["host", "srflx", "prflx", "relay", "unknown"],
      "unknown"
    ),
    protocol: choice(value.protocol, ["udp", "tcp", "unknown"], "unknown"),
    tcpType: choice(
      value.tcpType,
      ["active", "passive", "so", "unknown"],
      "unknown"
    ),
    address: "[redacted]"
  };
}

export function inspectIce(reports: RTCStatsReport) {
  const localCandidates: CandidateSummary[] = [];
  const remoteCandidates: CandidateSummary[] = [];
  let pair: RTCIceCandidatePairStats | undefined;
  reports.forEach((report) => {
    if (report.type === "local-candidate")
      localCandidates.push(candidateSummary(report));
    if (report.type === "remote-candidate")
      remoteCandidates.push(candidateSummary(report));
    if (report.type === "transport" && report.selectedCandidatePairId)
      pair = reports.get(report.selectedCandidatePairId);
  });
  // Firefox may expose the selected flag without a transport reference. A
  // nominated pair alone is NOT proof that it is the selected transport.
  if (!pair)
    reports.forEach((report) => {
      if (report.type === "candidate-pair" && report.selected === true)
        pair = report;
    });
  return {
    localCandidates,
    remoteCandidates,
    selectedPair: pair
      ? {
          local: candidateSummary(reports.get(pair.localCandidateId) ?? {}),
          remote: candidateSummary(reports.get(pair.remoteCandidateId) ?? {}),
          state: choice(
            pair.state,
            [
              "frozen",
              "waiting",
              "in-progress",
              "failed",
              "succeeded",
              "unknown"
            ],
            "unknown"
          )
        }
      : null
  };
}

export function diagnoseLink(link: LinkDiagnostics): string {
  if (link.connectionState === "connected" && !link.failed)
    return "Direct P2P connected.";
  if (
    link.failed ||
    link.connectionState === "failed" ||
    link.iceConnectionState === "failed"
  )
    return "Direct P2P failed; this network may require TURN. No relay is configured.";
  if (
    link.iceErrors.includes(701) &&
    !link.localCandidates.some((candidate) => candidate.type === "srflx")
  )
    return "STUN may be unreachable. This is a best-effort estimate; direct local connections may still work.";
  if (
    link.iceGatheringState === "complete" &&
    link.localCandidates.length > 0 &&
    link.localCandidates.every((candidate) => candidate.type === "host")
  )
    return "Only host candidates are available; STUN may be unreachable or restricted by the browser/network.";
  if (link.connectionState === "disconnected")
    return "The direct media path was interrupted. Waiting for recovery.";
  if (link.connectionState === "closed") return "Media connection closed.";
  return "Gathering candidates or checking the direct path; insufficient evidence to identify a network problem.";
}
export function diagnoseSession(value: SessionDiagnostics): string {
  if (value.signaling === "failed" || value.websocket === "error")
    return "WebSocket signaling or authentication failed. Reconnect before diagnosing the media path.";
  if (value.websocket === "connecting")
    return "Connecting to the WebSocket signaling service.";
  if (value.signaling === "authenticating")
    return "WebSocket connected; waiting for password authentication and the signed roster.";
  if (value.signaling === "closed" || value.websocket === "closed")
    return "Session signaling closed.";
  if (value.connections.length === 0)
    return value.signaling === "ready"
      ? "Signaling ready; no media connection to diagnose yet."
      : "No active session.";
  return "Media diagnostics below are best-effort estimates, not proof of a particular network fault.";
}

// Strict allowlist, not a blacklist or a raw getStats/session dump. Every string
// is an enum or generated text. URLs, SDP, candidate strings, IDs, usernames,
// error text, passwords, keys, proofs, MACs and signaling bodies never enter JSON.
export function diagnosticsJson(value: SessionDiagnostics): string {
  return JSON.stringify(
    {
      version: 1,
      websocketCloseCode: number(value.websocketCloseCode),
      websocket: choice(
        value.websocket,
        ["idle", "connecting", "open", "closed", "error"],
        "idle"
      ),
      secure: typeof value.secure === "boolean" ? value.secure : null,
      signaling: choice(
        value.signaling,
        ["idle", "registering", "authenticating", "ready", "failed", "closed"],
        "idle"
      ),
      connections: value.connections.map((link, index) => ({
        connection: index + 1,
        direction: choice(
          link.direction,
          ["sending", "receiving"],
          "receiving"
        ),
        connectionState: choice(
          link.connectionState,
          [
            "new",
            "connecting",
            "connected",
            "disconnected",
            "failed",
            "closed"
          ],
          "new"
        ),
        iceConnectionState: choice(
          link.iceConnectionState,
          [
            "new",
            "checking",
            "connected",
            "completed",
            "disconnected",
            "failed",
            "closed"
          ],
          "new"
        ),
        iceGatheringState: choice(
          link.iceGatheringState,
          ["new", "gathering", "complete"],
          "new"
        ),
        signalingState: choice(
          link.signalingState,
          [
            "stable",
            "have-local-offer",
            "have-remote-offer",
            "have-local-pranswer",
            "have-remote-pranswer",
            "closed"
          ],
          "stable"
        ),
        localCandidates: link.localCandidates.map(candidateSummary),
        remoteCandidates: link.remoteCandidates.map(candidateSummary),
        selectedPair: link.selectedPair
          ? {
              local: candidateSummary(link.selectedPair.local),
              remote: candidateSummary(link.selectedPair.remote),
              state: choice(
                link.selectedPair.state,
                [
                  "frozen",
                  "waiting",
                  "in-progress",
                  "failed",
                  "succeeded",
                  "unknown"
                ],
                "unknown"
              )
            }
          : null,
        iceErrors: link.iceErrors.map(number).filter((code) => code !== null),
        iceRestartCount: number(link.iceRestartCount),
        setupTimeMs: number(link.setupTimeMs),
        elapsedMs: number(link.elapsedMs),
        failed: link.failed === true,
        metrics: {
          rttMs: number(link.stats.rttMs),
          videoBitrateMbps: number(link.stats.mbps),
          packetLossRatio: number(link.stats.loss),
          jitterMs: number(link.stats.jitterMs),
          fps: number(link.stats.fps),
          width: number(link.stats.width),
          height: number(link.stats.height),
          droppedFrames: number(link.stats.droppedFrames),
          droppedFrameRatio: number(link.stats.dropped)
        },
        diagnosis: diagnoseLink(link)
      }))
    },
    null,
    2
  );
}
