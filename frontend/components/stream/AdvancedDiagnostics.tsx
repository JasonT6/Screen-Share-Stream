"use client";

import { useState, type KeyboardEvent } from "react";
import {
  diagnoseLink,
  diagnoseSession,
  diagnosticsJson,
  type CandidateSummary,
  type SessionDiagnostics
} from "@/lib/diagnostics";

function metric(value: number | undefined | null, unit = "", scale = 1) {
  return value === undefined || value === null
    ? "Unavailable"
    : `${(value * scale).toFixed(1)}${unit}`;
}
function candidate(value: CandidateSummary) {
  return `${value.type} / ${value.protocol}${value.protocol === "tcp" ? ` / ${value.tcpType}` : ""}`;
}
function candidates(values: CandidateSummary[]) {
  return values.length
    ? Array.from(new Set(values.map(candidate))).join(", ")
    : "None observed yet";
}

export default function AdvancedDiagnostics({
  value
}: {
  value: SessionDiagnostics;
}) {
  const [advanced, setAdvanced] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home" ? false : event.key === "End" ? true : !advanced;
    setAdvanced(next);
    event.currentTarget
      .querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next ? 1 : 0]?.focus();
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(diagnosticsJson(value));
      setCopyStatus("Diagnostics copied.");
    } catch {
      setCopyStatus(
        "Clipboard unavailable. Select and copy the sanitized JSON below."
      );
    }
  }
  return (
    <section className="diagnostics" aria-label="Connection diagnostics">
      <div
        className="diagnostics-tabs"
        role="tablist"
        aria-label="Diagnostics views"
        onKeyDown={navigate}
      >
        <button
          id="connection-overview-tab"
          role="tab"
          aria-selected={!advanced}
          tabIndex={advanced ? -1 : 0}
          aria-controls="connection-overview-panel"
          onClick={() => setAdvanced(false)}
        >
          Connection overview
        </button>
        <button
          id="advanced-diagnostics-tab"
          role="tab"
          aria-selected={advanced}
          tabIndex={advanced ? 0 : -1}
          aria-controls="advanced-diagnostics-panel"
          onClick={() => setAdvanced(true)}
        >
          Advanced Diagnostics
        </button>
      </div>
      <div
        id="connection-overview-panel"
        role="tabpanel"
        aria-labelledby="connection-overview-tab"
        hidden={advanced}
      >
        <p>{diagnoseSession(value)}</p>
      </div>
      <div
        id="advanced-diagnostics-panel"
        role="tabpanel"
        aria-labelledby="advanced-diagnostics-tab"
        hidden={!advanced}
      >
        <div className="diagnostics-heading">
          <p>{diagnoseSession(value)}</p>
          <button className="button secondary" onClick={() => void copy()}>
            Copy diagnostics
          </button>
        </div>
        <p className="field-help">
          Addresses are redacted. Exports omit passwords, keys, proofs,
          usernames, invitation IDs, and raw signaling. Unavailable measurements
          stay unknown.
        </p>
        <p role="status">{copyStatus}</p>
        {copyStatus.startsWith("Clipboard unavailable") && (
          <textarea
            aria-label="Sanitized diagnostics JSON"
            readOnly
            value={diagnosticsJson(value)}
            rows={12}
          />
        )}
        <dl className="diagnostics-grid">
          <div>
            <dt>WebSocket</dt>
            <dd>
              {value.websocket}
              {value.websocketCloseCode != null &&
                ` · close code ${value.websocketCloseCode}`}
              {value.secure === null
                ? ""
                : value.secure
                  ? " · secure WSS"
                  : " · local test WS"}
            </dd>
          </div>
          <div>
            <dt>Signaling / authentication</dt>
            <dd>{value.signaling}</dd>
          </div>
        </dl>
        {value.connections.map((link, index) => (
          <article className="diagnostics-link" key={index}>
            <h3>
              Connection {index + 1} · {link.direction}
            </h3>
            <p>{diagnoseLink(link)}</p>
            <dl className="diagnostics-grid">
              <div>
                <dt>WebRTC connection</dt>
                <dd>
                  {link.connectionState}
                  {link.failed ? " · failed attempt" : ""}
                </dd>
              </div>
              <div>
                <dt>ICE connection / gathering</dt>
                <dd>
                  {link.iceConnectionState} / {link.iceGatheringState}
                </dd>
              </div>
              <div>
                <dt>WebRTC signaling</dt>
                <dd>{link.signalingState}</dd>
              </div>
              <div>
                <dt>Local candidate types / protocols</dt>
                <dd>{candidates(link.localCandidates)}</dd>
              </div>
              <div>
                <dt>Remote candidate types / protocols</dt>
                <dd>{candidates(link.remoteCandidates)}</dd>
              </div>
              <div>
                <dt>Selected ICE candidate pair</dt>
                <dd>
                  {link.selectedPair
                    ? `${candidate(link.selectedPair.local)} → ${candidate(link.selectedPair.remote)} (${link.selectedPair.state})`
                    : "Unavailable / not selected"}
                </dd>
              </div>
              <div>
                <dt>RTT</dt>
                <dd>{metric(link.stats.rttMs, " ms")}</dd>
              </div>
              <div>
                <dt>Video bitrate</dt>
                <dd>{metric(link.stats.mbps, " Mbps")}</dd>
              </div>
              <div>
                <dt>Packet loss</dt>
                <dd>{metric(link.stats.loss, "%", 100)}</dd>
              </div>
              <div>
                <dt>Jitter</dt>
                <dd>{metric(link.stats.jitterMs, " ms")}</dd>
              </div>
              <div>
                <dt>FPS</dt>
                <dd>{metric(link.stats.fps)}</dd>
              </div>
              <div>
                <dt>Resolution</dt>
                <dd>
                  {link.stats.width && link.stats.height
                    ? `${link.stats.width} × ${link.stats.height}`
                    : "Unavailable"}
                </dd>
              </div>
              <div>
                <dt>Dropped frames</dt>
                <dd>
                  {link.stats.droppedFrames ?? "Unavailable"} · interval{" "}
                  {metric(link.stats.dropped, "%", 100)}
                </dd>
              </div>
              <div>
                <dt>ICE errors</dt>
                <dd>
                  {link.iceErrors.length
                    ? link.iceErrors
                        .map(
                          (code) =>
                            `${code}${code === 701 ? " (STUN server unreachable from a local candidate)" : " (ICE candidate error)"}`
                        )
                        .join(", ")
                    : "None reported"}
                </dd>
              </div>
              <div>
                <dt>ICE restart count</dt>
                <dd>{link.iceRestartCount} / 1</dd>
              </div>
              <div>
                <dt>Connection setup time</dt>
                <dd>
                  {link.setupTimeMs === null
                    ? `Not connected · ${metric(link.elapsedMs, " s elapsed", 0.001)}`
                    : metric(link.setupTimeMs, " s", 0.001)}
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
