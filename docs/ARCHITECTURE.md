# Architecture

## Product contract

Private Stream is a static web app for multi-participant, full-source-resolution screen streaming with captured source audio. Attendees use a special link, enter a username and shared password, and connect automatically. No host accounts, viewer accounts, waiting lobby, per-viewer approval, microphone, camera, voice chat, or media servers.

## Runtime topology

```text
HTTPS static files ──► Host browser
                  └─► Viewer browsers

PeerJS Cloud ◄───────► browser rendezvous/signaling only
Google STUN ◄───────► network-address discovery only

Host browser ◄─────► Attendee A ◄─────► Attendee B
     └───────────────────────────────────┘
Each publisher sends separate direct screen/audio connections to all others.
```

The user operates no backend. Static file hosting, public signaling, and STUN are still required. No TURN, LiveKit, SFU, database, API routes, Docker, server tokens, or recording pipeline is used. Do not describe this as guaranteed connectivity without any infrastructure.

## Stack and routes

Next.js and TypeScript build a static export (`output: "export"`) into `frontend/out/`. React renders the client UI. PeerJS opens a reliable direct data channel, using its public signaling service. Native `RTCPeerConnection` handles the separately authenticated one-way media connection.

- `/`: host setup and active stream controls.
- `/#room=ps-<128-bit-random-id>`: attendee username/password entry, publishing, and playback on the same static page.
- Invalid fragments show an invalid-invitation state.

There are no dynamic server routes. Invitations contain a room identifier only; the URL fragment is not sent in HTTP requests to the static host. The room identifier necessarily reaches the signaling service. Reloading a viewer requires the password again. Reloading the host ends the session; a new stream has a new identifier.

## Connection and authentication

1. The host chooses a username and any nonblank password and invokes `getDisplayMedia` directly from a user gesture.
2. Require both live video and audio tracks; stop all tracks and explain a missing-audio failure.
3. Generate a 128-bit random host peer ID. Derive a non-exportable HMAC-SHA256 key from the password using PBKDF2-SHA256, 210,000 iterations, and a versioned room-specific salt.
4. Register the ephemeral host ID with PeerJS Cloud. Only then display the invitation.
5. The attendee enters a username and password. Their browser creates its own ephemeral ID and opens a reliable WebRTC data channel to the host.
6. Exchange fresh 256-bit viewer/host nonces. The transcript includes protocol version, host ID, viewer ID, and both nonces. The viewer sends a role-specific HMAC proof; the raw password and derived key are never transmitted.
7. The host verifies before allocating a media connection or adding any source tracks. Wrong proofs are rejected automatically.
8. Authenticate every SDP/ICE/control message with HMAC, the transcript, sending role, and a monotonically increasing sequence. Verification covers the SDP DTLS fingerprint, prevents message substitution, and rejects replay/reflection across sessions and roles. This also authenticates the host to the viewer before accepting media signaling.
9. After proof verification, the attendee sends a signed username profile. The host distributes a signed roster with participant IDs, display names, and active publication IDs. Only authenticated members may announce publications or route media signaling. The host binds forwarded sender IDs to their authenticated transport and validates publisher/target membership.
10. Every publisher offers send-only video/audio transceivers to each other attendee. Receivers answer receive-only on each link. ICE candidates are queued until remote SDP is applied. The data-channel handler and outbound signing run sequentially. A fresh publication ID on each restart prevents stale signaling from reviving stopped streams. The host forwards signaling only, never media.
11. Media streams directly over DTLS-SRTP. Stats are local browser measurements. No application server touches media.

This is a shared-secret scheme, not a PAKE or identity system. A transcript can be used for offline dictionary attacks, so recommend a strong password and offer optional random generation. Any nonblank password is accepted; no minimum length or complexity is enforced. Usernames are display names, are trimmed and limited to 40 characters, may be duplicated, and are not verified identities. Participants with the password can forward access; individual revocation and impersonation resistance between password holders are out of scope. Host passwords and key material are not persisted. Do not put them in logs or local/session storage.

## Regular-use launcher

The root `run.command` invokes `frontend/scripts/share.mjs` (also `npm run share`). It prepares dependencies/build only when needed, starts the static-file helper on an OS-assigned free port, and forwards that exact server through a temporary Cloudflare Quick Tunnel. It never attaches a tunnel to an arbitrary existing port. The external tunnel serves web assets only and is not a media relay or a runtime application backend. Permanent static HTTPS hosting remains supported.

The launcher prints a verified public host link for manual opening in the user's browser. It has no browser process, temporary profile, or browser-exit shutdown dependency. It keeps the Mac awake while active and stops its own tunnel/file server on Ctrl+C. Closing a host tab still ends that stream, but cannot terminate the launcher. The next launch has a fresh public address; invitations must be copied from the new page. Build-state hashes, a cached pinned official tunnel binary, and a diagnostic log live in ignored `.runtime/`.

The public page is checked every 15 seconds, without overlapping requests. Two consecutive failures produce a terminal warning, and recovery is reported once. Checks distinguish Cloudflare 1033 from generic HTTP/network failures and reject unexpected HTML. They stop and abort in-flight requests on shutdown. The tunnel helper handles transient reconnects; the launcher does not silently replace a URL while invitations are in use. A stopped process requires a new command, address, and invitations.

## Media behavior

Capture stays in a direct user gesture through `getDisplayMedia`. No automatic screen selection, current-tab preference, source filtering, or permission bypass is used. `surfaceSwitching: "exclude"` asks the browser to omit the direct tab-switch shortcut; selecting a new source requires a new picker. The website cannot invoke Apple's picker directly: the browser owns that implementation, and the project must work with the normally launched browser without special launch arguments or experimental settings. Native-picker acceptance in Edge remains unresolved. Window/screen native-picker behavior must be checked manually; browser tab selection remains browser-owned. Canceling the picker is final and never triggers a capture fallback.

`lib/media.ts` captures source dimensions at requested 30/60 fps and uses `contentHint=detail`. `Stream quality` controls every local sender; `Playback quality` sends a signed per-viewer request to each incoming publisher. Each sender applies the lower ceiling: source (40 Mbps/60 fps), 1080p (8 Mbps/30 fps), 720p (3 Mbps/30 fps), or 480p (1 Mbps/24 fps). `scaleResolutionDownBy` limits the short edge without upscaling; `maxFramerate` and `maxBitrate` bound the encoding. Capture is retained so quality can be restored without another picker. Changes are serialized through `setParameters` and carried into new connections. Unsupported tuning surfaces a notice. Advanced stream/playback settings add video priority (detail, motion, balanced; playback defaults to follow streamer) and audio ceilings (192/128/64 kbps). The signed quality message includes validated optional preferences; omitted preferences retain the original follow-streamer/high-audio behavior. Each link resolves video priority from the viewer override or publisher default, and audio bitrate from the lower ceiling. The explicit per-sender `degradationPreference` takes precedence over the shared capture track’s detail hint, without changing hints for other viewers. Priority does not increase preset or capture frame-rate limits. Settings persist across new connections and publication restarts within the session. Capture voice processing remains disabled. These are browser encoding preferences and maximum bitrates, not guarantees of visual or audible quality.

Every two seconds, an authenticated session samples all its media links without overlapping polls. Interval packet loss, throughput, frame drops, jitter, selected-path RTT, connection state, and `qualityLimitationReason` drive local diagnostics. Counter resets and sampling gaps of ten seconds or more invalidate rate measurements. A signed, publication-bound health message sends aggregate outgoing-path counts and the current path’s encoding limitation to each viewer. Remote summaries expire after ten seconds; stopping/restarting a publication clears its measurements. No speed-test traffic or network addresses are sent in health messages.

Network warning thresholds are at least 3% packet loss, 50 ms jitter, 400 ms RTT, reported bandwidth limitation, or a disconnected/failed path. Multiple bandwidth-limited outgoing paths support a _likely_ upload diagnosis. Multiple troubled incoming streams plus a sender’s healthy delivery to other viewers support a _likely_ download diagnosis. A single affected path remains ambiguous. Encoding CPU pressure and at least 10% dropped frames are presented separately when network pressure is absent. These heuristics cannot isolate an ISP, distinguish all shared-path problems, or guarantee that lag is network-related. Missing measurements stay unknown; low resolution, low frame rate, or low bitrate alone never imply bad internet.

The field definitions and encoding controls follow the [W3C WebRTC statistics specification](https://www.w3.org/TR/webrtc-stats/), [WebRTC sender parameters](https://www.w3.org/TR/webrtc/#dom-rtcrtpencodingparameters), and [per-sender degradation preferences](https://www.w3.org/TR/mst-content-hint/#behavior-of-an-rtcpeerconnection).

Quality is bounded by capture support, source size, hardware encoding, bandwidth, and WebRTC congestion control. No lossless, fixed resolution, or fixed frame-rate guarantee is made. Each publisher’s upload/encoding cost grows with participant count. All publications are received for immediate selection; only the selected stream is attached to a player and produces audio.

Both data and media connections explicitly use STUN-only ICE configuration. No default TURN configuration may leak in through a library. Direct connections can fail across restrictive NAT/firewalls; the UI times out with network guidance. Each publisher attempts one media ICE restart after failure. Established streams survive signaling-only disconnection; the host attempts signaling reconnection so new viewers can join.

## Lifecycle and UI

The host starts a session, copies the invitation, sees named participants, selects any active stream, and ends the session. Every attendee can start, stop, and restart screen sharing without leaving. Browser Stop sharing or ended source audio stops only that publication; the invitation and other streams remain active. Explicit host End stream or host departure ends the session and stops all participant captures.

The player defaults to the first active stream and falls back when the selected publisher stops or leaves. Participant buttons show usernames, live/viewing state, and a muted own preview. Viewers can retry authentication, cancel, leave, control playback volume, and fullscreen. Autoplay rejection surfaces an explicit sound/play button. No microphone or camera access is requested; screen capture occurs only after the participant clicks Share.

Async startup uses cancellation generations so a canceled/unmounted screen cannot retain a late connection or capture. Connections, tracks, timeouts, polling, and listeners are cleaned up on exit. Authentication and media have bounded connection timeouts. The host limits concurrent unauthenticated handshakes to bound resource use; it does not enforce a room capacity goal.

## Source map

- `frontend/components/StreamApp.tsx`: host/viewer flow, player, stats, cancellation.
- `frontend/lib/stream-session.ts`: rendezvous, authenticated transport, media negotiation, lifecycle.
- `frontend/lib/protocol.ts`: validation, key derivation, proofs, signed envelopes.
- `frontend/lib/media.ts`: capture policy, STUN configuration, quality presets, sender controls, interval stats.
- `frontend/lib/connection-quality.ts`: upload summaries and conservative connection attribution.
- `frontend/tests/`: protocol tests and real browser media tests.
- `frontend/scripts/serve.mjs`: reusable static-file server and local preview command.
- `frontend/scripts/share.mjs`: regular-use launcher, build cache, tunnel, and lifecycle.
- `frontend/scripts/tunnel-health.mjs`: public page readiness and outage/recovery monitoring.
- `run.command`: executable entry point for Terminal or Finder.
