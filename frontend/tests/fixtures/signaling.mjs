// Test-only PeerServer WebSocket router for auth and signaling. No media.
import { PeerServer } from "peer";
const server = PeerServer({ host: "127.0.0.1", port: 9001, path: "/" });

// The bundled test server otherwise accepts malformed envelopes that Cloud
// closes immediately. Mirror the required shape so that joins catch regressions.
server.on("message", (client, message) => {
  if (message.type !== "CANDIDATE") return;
  const payload = message.payload;
  if (
    payload?.type !== "data" ||
    typeof payload.connectionId !== "string" ||
    !payload.candidate?.candidate?.startsWith("candidate:") ||
    typeof payload.candidate.sdpMid !== "string" ||
    !Number.isInteger(payload.candidate.sdpMLineIndex)
  )
    client.getSocket()?.close(1000);
});
