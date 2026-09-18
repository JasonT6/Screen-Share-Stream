import assert from "node:assert/strict";
import { test } from "node:test";
import {
  candidateSummary,
  diagnoseLink,
  diagnosticsJson,
  emptyDiagnostics,
  inspectIce,
  type LinkDiagnostics
} from "../lib/diagnostics";

function link(): LinkDiagnostics {
  return {
    direction: "receiving",
    connectionState: "connecting",
    iceConnectionState: "checking",
    iceGatheringState: "complete",
    signalingState: "stable",
    localCandidates: [candidateSummary({ type: "host", protocol: "udp" })],
    remoteCandidates: [],
    selectedPair: null,
    iceErrors: [],
    iceRestartCount: 0,
    setupTimeMs: null,
    elapsedMs: 100,
    failed: false,
    stats: { audio: false }
  };
}

test("diagnostics select the actual transport pair and expose only candidate types/protocols", () => {
  const reports = new Map([
    [
      "local",
      {
        type: "local-candidate",
        candidateType: "srflx",
        protocol: "udp",
        address: "192.0.2.1",
        relatedAddress: "10.1.2.3"
      }
    ],
    [
      "remote",
      {
        type: "remote-candidate",
        candidateType: "host",
        protocol: "tcp",
        tcpType: "passive",
        address: "2001:db8::1"
      }
    ],
    ["unused", { type: "candidate-pair", nominated: true, state: "succeeded" }],
    [
      "selected",
      {
        type: "candidate-pair",
        localCandidateId: "local",
        remoteCandidateId: "remote",
        state: "succeeded"
      }
    ],
    ["transport", { type: "transport", selectedCandidatePairId: "selected" }]
  ]) as unknown as RTCStatsReport;
  const result = inspectIce(reports);
  assert.equal(result.selectedPair?.local.type, "srflx");
  assert.equal(result.selectedPair?.remote.protocol, "tcp");
  assert.equal(result.selectedPair?.remote.tcpType, "passive");
  assert.ok(!JSON.stringify(result).includes("192.0.2.1"));
  assert.ok(!JSON.stringify(result).includes("2001:db8"));
  (reports as unknown as Map<string, unknown>).delete("transport");
  assert.equal(inspectIce(reports).selectedPair, null);
});

test("diagnostics export rejects secrets, raw candidates, IPv4/IPv6/mDNS, and injected free text", () => {
  const secret = "sensitive-password-key-proof";
  const candidate = {
    ...candidateSummary({ type: "host", protocol: "udp" }),
    address: "2001:db8::123",
    candidate: "candidate:1 1 udp 1 192.0.2.1 99 typ host",
    url: `wss://example.test/?token=${secret}`,
    usernameFragment: secret
  };
  const data = {
    ...emptyDiagnostics(),
    password: secret,
    proof: secret,
    connections: [
      {
        ...link(),
        key: secret,
        context: secret,
        iceErrors: [701, secret],
        localCandidates: [candidate],
        remoteCandidates: [
          { ...candidate, address: "private.local", protocol: secret }
        ],
        selectedPair: { local: candidate, remote: candidate, state: secret },
        stats: {
          audio: false,
          rttMs: 4,
          mbps: 2,
          loss: 0.01,
          droppedFrames: 7,
          width: 1920,
          height: 1080,
          fps: 30,
          jitterMs: secret,
          sdp: secret
        }
      }
    ]
  };
  const json = diagnosticsJson(
    data as unknown as Parameters<typeof diagnosticsJson>[0]
  );
  for (const forbidden of [
    secret,
    "2001:db8",
    "192.0.2.1",
    "private.local",
    "candidate:1",
    "wss://",
    '"password"',
    '"proof"',
    '"key"',
    '"sdp"',
    '"context"'
  ])
    assert.ok(!json.includes(forbidden), forbidden);
  const parsed = JSON.parse(json);
  assert.equal(parsed.connections[0].localCandidates[0].address, "[redacted]");
  assert.equal(parsed.connections[0].remoteCandidates[0].protocol, "unknown");
  assert.equal(parsed.connections[0].metrics.jitterMs, null);
  assert.equal(parsed.connections[0].metrics.droppedFrames, 7);
  assert.equal(parsed.connections[0].metrics.rttMs, 4);
  assert.deepEqual(parsed.connections[0].iceErrors, [701]);
});

test("diagnoses distinguish uncertain STUN problems, failure, and successful direct connectivity", () => {
  const sample = link();
  sample.iceErrors = [701];
  assert.match(diagnoseLink(sample), /STUN may be unreachable/);
  sample.failed = true;
  assert.match(diagnoseLink(sample), /may require TURN/);
  sample.failed = false;
  sample.connectionState = "connected";
  assert.equal(diagnoseLink(sample), "Direct P2P connected.");
});
