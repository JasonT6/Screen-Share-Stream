# Project rules

## Product requirements

- Build for browsers; attendees need only an HTTPS invitation link and a password.
- Stream the host's screen/tab/window video and its audio directly to attendees.
- Respect the macOS private screen picker. Never auto-select sources, grant permissions, or add capture/consent bypass flags. The launcher prints a copyable link without opening or configuring browsers. Do not use or recommend special browser launch arguments, experimental settings, or separate profiles. Native macOS selection remains a requirement to verify in the normally launched browser; never claim it works from synthetic capture tests.
- Require an audio track before going live. Never silently substitute microphone audio.
- Preserve available source resolution; favor resolution over frame rate under pressure. Explain measured quality honestly.
- Automatically connect on a valid password. Do not add accounts, approval, a lobby, or name entry.
- Keep viewers receive-only. Do not request microphone/camera access on either side.
- Keep the app small and usable for private groups. Scalability is not a goal.

## Architecture constraints

- Produce static web files; no runtime application backend operated by the user. A regular-use launcher may serve those files locally through a temporary HTTPS tunnel; media must remain direct.
- Use direct browser WebRTC for media. Native peer connections are allowed and required by this implementation.
- Public signaling and STUN are permitted external connection services and must be documented.
- Do not add an SFU, TURN media relay, LiveKit, database, server-side sessions, or Docker stack.
- Do not claim that a web app can use links or automatic remote discovery with literally no hosting/signaling infrastructure.
- Do not promise every NAT/firewall can connect without TURN.
- Do not override the requested architecture for hypothetical future scale.

## Authentication and safety of the implementation

- Validate room IDs and incoming messages at trust boundaries.
- Verify a fresh password proof in the host browser before allocating media senders.
- Authenticate SDP/ICE fingerprints and control messages, including direction, session context, and order.
- Passwords are never included in invitation URLs, signaling metadata, analytics, or browser persistence.
- Use Web Crypto and unpredictable room IDs/nonces; offer a strong password generator.
- Authentication is shared-password access, not individual identity. Document offline-guessing limitations.
- Incoming viewer media must not be accepted. Hiding UI controls alone is insufficient.
- Stop tracks and close connections when a stream ends, startup fails, or the user leaves.

## Code and validation

Use TypeScript, avoid `any`, keep protocol/media code outside React components, and prefer explicit lifecycle handling. Keep the package lockfile current. Treat browser APIs and package behavior as implementation constraints, not promises.

Run lint, type checking, protocol/capture tests, and static build. For streaming changes, run browser tests checking decoded video and received audio RTP, including negative authentication and cleanup. Report automated versus manual verification separately. Update documentation whenever runtime requirements change.

## Non-goals

No voice chat, webcam publishing, viewer screen sharing, group calls, text chat, reactions, recording, payments, public room directory, desktop installer, persistent rooms, per-viewer approval/removal, or infrastructure scaling. Change these only when the user explicitly asks.
