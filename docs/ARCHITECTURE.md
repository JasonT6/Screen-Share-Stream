# Architecture

## Product contract

Private Stream is a static web app for multi-participant, full-source-resolution screen streaming with captured source audio. Attendees use a special link, enter a username and shared password, and connect automatically. No host accounts, viewer accounts, waiting lobby, per-viewer approval, microphone, camera, voice chat, or media servers.

## Runtime topology

```text
HTTPS static files ──► Host browser
                  └─► Viewer browsers

PeerServer WSS ◄─────► auth, roster, SDP, ICE, control (no media)
Google STUN ◄───────► network-address discovery only

Host browser ◄─────► Attendee A ◄─────► Attendee B
     └───────────────────────────────────┘
Each publisher sends separate direct screen/audio connections to all others.
```

The user operates no backend. Static file hosting, public signaling, and STUN are still required. No TURN, LiveKit, SFU, database, API routes, Docker, server tokens, or recording pipeline is used. Do not describe this as guaranteed connectivity without any infrastructure.

## Stack and routes

Next.js and TypeScript build a static export (`output: "export"`) into `frontend/out/`. React renders the client UI. A native `WebSocket` connects to the existing public PeerServer service over TLS. No PeerJS client, `DataConnection`, or `RTCDataChannel` is used. Native `RTCPeerConnection` handles each authenticated one-way media connection.

- `/`: public landing page with a Create a room entry point.
- `/#create`: host setup and active stream controls.
- `/#room=ps-<256-bit-random-id>`: attendee username/password entry, publishing, and playback on the same static page.
- Invalid fragments show an invalid-invitation state.

There are no dynamic server routes. Invitations contain a room identifier only; the URL fragment is not sent in HTTP requests to the static host. The room identifier necessarily reaches the signaling service. Reloading a viewer requires the password again. Reloading the host ends the session; a new stream has a new identifier.

## Connection and authentication

1. The host chooses a username and any nonblank password and invokes `getDisplayMedia` directly from a user gesture.
2. Require live video; audio is optional. Show a quiet notice to the publisher when no live audio track is present. Stop all tracks if video capture fails.
3. Generate a 256-bit random host peer ID with Web Crypto. Current clients also accept legacy 128-bit room invitations. Derive a non-exportable HMAC-SHA256 key from the password using PBKDF2-SHA256, 210,000 iterations, and a versioned room-specific salt.
4. Register the ephemeral host ID over secure WebSocket with PeerServer. Only then display the invitation. `lib/signaling.ts` isolates the service adapter: `/peerjs?key=peerjs&id=…&token=…`, server `OPEN`, transport `HEARTBEAT`, and opaque application payloads inside the server’s forwarded `CANDIDATE` envelope. This wire envelope is just WebSocket JSON routing; it does not negotiate ICE or allocate a data channel. The random registration token is independent of the password and never exported in diagnostics.
5. The attendee enters a username and password. Their browser creates its own ephemeral ID and connects to the same WebSocket service. Authentication and rosters work even when direct ICE connectivity is impossible.
6. Exchange fresh 256-bit viewer/host nonces. The transcript includes protocol version, host ID, viewer ID, and both nonces. The viewer sends a role-specific HMAC proof; the raw password and derived key are never transmitted.
7. The host verifies before allocating a media connection or adding any source tracks. Wrong proofs are rejected automatically.
8. Authenticate every SDP/ICE/control message with HMAC, the transcript, sending role, and a monotonically increasing sequence. Verification covers the SDP DTLS fingerprint, prevents message substitution, and rejects replay/reflection across sessions and roles. This also authenticates the host to the viewer before accepting media signaling.
9. After proof verification, the attendee sends a signed username profile. The host distributes a signed roster with participant IDs, display names, and active publication IDs. Only authenticated members may announce publications or route media signaling. The host binds forwarded sender IDs to their authenticated transport and validates publisher/target membership.
10. Every publisher offers send-only video/audio transceivers to each other attendee. Receivers answer receive-only on each link. ICE candidates are queued until remote SDP is applied. Each logical host/attendee WebSocket channel serializes inbound verification and outbound signing. Incoming messages, pending verification queues, candidate queues, and socket buffering are bounded. A fresh publication ID on each restart prevents stale signaling from reviving stopped streams. The host forwards signaling only, never media.
11. Media streams directly over DTLS-SRTP. Stats are local browser measurements. No application server touches media.

This is a shared-secret scheme, not a PAKE or identity system. A transcript can be used for offline dictionary attacks, so recommend a strong password and offer optional random generation. Any nonblank password is accepted; no minimum length or complexity is enforced. Usernames are display names, are trimmed and limited to 40 characters, may be duplicated, and are not verified identities. Participants with the password can forward access; individual revocation and impersonation resistance between password holders are out of scope. Host passwords and key material are not persisted. Do not put them in logs or local/session storage.

## Hosted entry point

Vercel is the recommended static host. Import with Root Directory `frontend`; `vercel.json` selects the Other preset, installs with `npm ci`, builds with `npm run build`, publishes `out`, and sets the capture/referrer/content-type security headers. No Vercel functions or application backend are used. The landing page is included in the static HTML; client-side fragment navigation selects host setup or invitation entry. Navigating away from a session unmounts it and releases its resources.

Users open the production HTTPS site and create a room entirely in the browser. The host tab and computer must remain active, but no local terminal, tunnel, or launcher is needed. Invitations retain the deployed origin and keep the random room identifier in the URL fragment.

## Optional local launcher

The TryCloudflare path is retained for testing local changes before Vercel deployment. It builds the same application source and temporarily exposes the local static export; testers need only the public room invitation and password. Restart with `./run.command --rebuild` after edits and create a fresh room on the new tunnel address. This workflow does not update the Vercel deployment.

The root `run.command` invokes `frontend/scripts/share.mjs` (also `npm run share`). It prepares dependencies/build only when needed, starts the static-file helper on an OS-assigned free port, and forwards that exact server through a temporary Cloudflare Quick Tunnel. It never attaches a tunnel to an arbitrary existing port. The external tunnel serves web assets only and is not a media relay or a runtime application backend. Permanent static HTTPS hosting remains supported.

The launcher prints a verified public host link for manual opening in the user's browser. It has no browser process, temporary profile, or browser-exit shutdown dependency. It keeps the Mac awake while active and stops its own tunnel/file server on Ctrl+C. Closing a host tab still ends that stream, but cannot terminate the launcher. The next launch has a fresh public address; invitations must be copied from the new page. Build-state hashes, a cached pinned official tunnel binary, and a diagnostic log live in ignored `.runtime/`.

The public page is checked every 15 seconds, without overlapping requests. Two consecutive failures produce a terminal warning, and recovery is reported once. Checks distinguish Cloudflare 1033 from generic HTTP/network failures and reject unexpected HTML. They stop and abort in-flight requests on shutdown. The tunnel helper handles transient reconnects; the launcher does not silently replace a URL while invitations are in use. A stopped process requires a new command, address, and invitations.

## Media behavior

Capture stays in a direct user gesture through `getDisplayMedia`. No automatic screen selection, current-tab preference, source filtering, or permission bypass is used. `surfaceSwitching: "exclude"` asks the browser to omit the direct tab-switch shortcut; selecting a new source requires a new picker. The website cannot invoke Apple's picker directly: the browser owns that implementation, and the project must work with the normally launched browser without special launch arguments or experimental settings. Native-picker acceptance in Edge remains unresolved. Window/screen native-picker behavior must be checked manually; browser tab selection remains browser-owned. Canceling the picker is final and never triggers a capture fallback.

`lib/media.ts` captures source dimensions at requested 30/60 fps and uses `contentHint=detail`. `Stream quality` controls every local sender; `Playback quality` sends a signed per-viewer request to each incoming publisher. Each sender applies the lower ceiling: source (40 Mbps/60 fps), 1080p (8 Mbps/30 fps), 720p (3 Mbps/30 fps), or 480p (1 Mbps/24 fps). `scaleResolutionDownBy` limits the short edge without upscaling; `maxFramerate` and `maxBitrate` bound the encoding. Capture is retained so quality can be restored without another picker. Changes are serialized through `setParameters` and carried into new connections. Unsupported tuning surfaces a notice. Advanced stream/playback settings add video priority (detail, motion, balanced; publishing defaults to motion/frame rate priority and playback defaults to follow streamer) and audio ceilings (192/128/64 kbps). The signed quality message includes validated optional preferences; omitted preferences retain the original follow-streamer/high-audio behavior. Each link resolves video priority from the viewer override or publisher default, and audio bitrate from the lower ceiling. The explicit per-sender `degradationPreference` takes precedence over the shared capture track’s detail hint, without changing hints for other viewers. Priority does not increase preset or capture frame-rate limits. Settings persist across new connections and publication restarts within the session. Capture voice processing remains disabled. These are browser encoding preferences and maximum bitrates, not guarantees of visual or audible quality.

Every two seconds, an authenticated session samples all its media links without overlapping polls. Interval packet loss, throughput, frame drops, jitter, selected-path RTT, connection state, and `qualityLimitationReason` drive local diagnostics. Counter resets and sampling gaps of ten seconds or more invalidate rate measurements. A signed, publication-bound health message sends aggregate outgoing-path counts and the current path’s encoding limitation to each viewer. Remote summaries expire after ten seconds; stopping/restarting a publication clears its measurements. No speed-test traffic or network addresses are sent in health messages.

Network warning thresholds are at least 3% packet loss, 50 ms jitter, 400 ms RTT, reported bandwidth limitation, or a disconnected/failed path. Multiple bandwidth-limited outgoing paths support a _likely_ upload diagnosis. Multiple troubled incoming streams plus a sender’s healthy delivery to other viewers support a _likely_ download diagnosis. A single affected path remains ambiguous. Encoding CPU pressure and at least 10% dropped frames are presented separately when network pressure is absent. These heuristics cannot isolate an ISP, distinguish all shared-path problems, or guarantee that lag is network-related. Missing measurements stay unknown; low resolution, low frame rate, or low bitrate alone never imply bad internet.

The field definitions and encoding controls follow the [W3C WebRTC statistics specification](https://www.w3.org/TR/webrtc-stats/), [WebRTC sender parameters](https://www.w3.org/TR/webrtc/#dom-rtcrtpencodingparameters), and [per-sender degradation preferences](https://www.w3.org/TR/mst-content-hint/#behavior-of-an-rtcpeerconnection).

Quality is bounded by capture support, source size, hardware encoding, bandwidth, and WebRTC congestion control. No lossless, fixed resolution, or fixed frame-rate guarantee is made. Each publisher’s upload/encoding cost grows with participant count. All publications are received for immediate selection; only the selected stream is attached to a player and produces audio.

Only media uses ICE, with the existing explicit STUN-only configuration. There is no data-channel negotiation and no TURN. Direct connections can fail across restrictive NAT/firewalls while authentication/rosters still succeed. Each media link gets at most one automatic ICE restart after ICE/connection failure or setup timeout. A receiver sends a signed restart request; only the publisher offers, avoiding glare and duplicate restarts. Initial/restart attempts each have a bounded deadline. Exhaustion closes the failed media link and retains its diagnostic snapshot without removing room membership.

Signed ping/pong controls run every five seconds. Only verified messages refresh the peer’s lease; roughly 30–35 seconds without one removes an abruptly departed attendee or fails a viewer session. Unsigned service LEAVE/EXPIRE messages cannot change membership. Browser background throttling can delay timers. A local WebSocket loss ends the affected session with explicit reconnect guidance and releases tracks/connections. The app does not automatically resume signed sequence numbers across a transport break, where delivered-but-unacknowledged messages would be ambiguous. New connections exchange fresh challenges. This replaces the old data channel’s independent signaling-loss survival behavior.

The public signaling service now forwards signed application messages, including authentication transcripts, usernames and SDP/ICE metadata. WSS protects the browser-to-service hop; HMAC provides integrity/authentication, not payload confidentiality from the service. The existing shared-password offline-guessing limitation still applies.

## Advanced diagnostics and privacy

`lib/diagnostics.ts` collects only candidate type/protocol/TCP type, numeric ICE error codes, connection/ICE/gathering/signaling enums, the actual selected transport pair (or the browser’s explicit selected flag), restart count, elapsed/setup time, and allowlisted media metrics. Error text, URLs, candidate addresses, raw SDP, ICE credentials, and identities are not retained in these snapshots. Rates reuse the existing interval stats sample; collection does not change sender tuning or capture constraints. Missing/unsupported metrics remain unknown, including sender frame drops where the browser does not report them.

The bottom **Advanced Diagnostics** tab is available before/during/after connection attempts and shows every incoming/outgoing media link. Candidate endpoints are redacted even in the UI. **Copy diagnostics** builds a second explicit allowlist of finite numbers and enum strings, never serializing session objects, raw reports, keys, proofs, MACs, arbitrary error text, or signaling bodies. IPv4, IPv6, related addresses, and mDNS names cannot enter the export. Failed attempts retain their final sample; successful connection time is measured from media link creation to the first connected state, separately from auth.

STUN/host-only candidate and TURN-required messages are best-effort hypotheses. A successful direct connection takes precedence over incidental STUN errors; absent server-reflexive candidates alone do not prove STUN failure.

## Lifecycle and UI

The host starts a session, copies the invitation, sees named participants, selects any active stream, and ends the session. Every attendee can start, stop, and restart screen sharing without leaving. Browser Stop sharing or ended source audio stops only that publication; the invitation and other streams remain active. Explicit host End stream or host departure ends the session and stops all participant captures.

The player defaults to the first active stream and falls back when the selected publisher stops or leaves. Participant buttons show usernames, live/viewing state, and a muted own preview. Viewers can retry authentication, cancel, leave, control playback volume, and fullscreen. Autoplay rejection surfaces an explicit sound/play button. No microphone or camera access is requested; screen capture occurs only after the participant clicks Share.

Async startup uses cancellation generations so a canceled/unmounted screen cannot retain a late connection or capture. Connections, tracks, timeouts, polling, and listeners are cleaned up on exit. Authentication and media have bounded connection timeouts. The host limits concurrent unauthenticated handshakes to bound resource use; it does not enforce a room capacity goal.

## Source map

- `frontend/components/StreamApp.tsx`: application shell and fragment navigation; changing rooms unmounts the current session.
- `frontend/components/stream/useStreamSession.ts`: session state, capture gestures, startup/cancellation, measurements, quality updates, invitation copying, and cleanup.
- `frontend/components/stream/`: session composition, entry form, active controls, participant list, player/stats, quality settings, connection indicators, and diagnostics. Components preserve the same DOM and delegate lifecycle work to the session hook.
- `frontend/lib/session/host-session.ts` and `viewer-session.ts`: password authentication, membership, and host/viewer signaling behavior.
- `frontend/lib/session/room-session.ts`: shared publication lifecycle, media routing, roster reconciliation, measurements, and cleanup.
- `frontend/lib/session/media-link.ts`: one-way WebRTC negotiation, ICE recovery, sender tuning, and per-link diagnostics.
- `frontend/lib/session/transport.ts`: session signaling registration, ordered signed messages, and presence heartbeats. Shared timeout and failure text live in `constants.ts`.
- `frontend/lib/signaling.ts`: native secure WebSocket PeerServer adapter, registration, validation and buffer limits.
- `frontend/lib/diagnostics.ts` and `frontend/components/stream/AdvancedDiagnostics.tsx`: allowlisted snapshots/export and diagnostics UI.
- `frontend/lib/protocol.ts`: validation, key derivation, proofs, signed envelopes.
- `frontend/lib/media.ts`: capture policy, STUN configuration, quality presets, sender controls, interval stats.
- `frontend/lib/connection-quality.ts`: upload summaries and conservative connection attribution.
- `frontend/app/globals.css`: global tokens, reset, and shell primitives. `frontend/app/styles/` holds workspace, landing, diagnostics, and theme styles, imported once in `layout.tsx` in cascade order.
- `frontend/tests/`: protocol tests and real browser media tests.
- `frontend/scripts/serve.mjs`: reusable static-file server and local preview command.
- `frontend/scripts/share.mjs`: regular-use launcher, build cache, tunnel, and lifecycle.
- `frontend/scripts/tunnel-health.mjs`: public page readiness and outage/recovery monitoring.
- `run.command`: executable entry point for Terminal or Finder.

Public build-time settings remain documented in `frontend/.env.example`. TypeScript incremental metadata is generated under the ignored `.next/cache/` directory rather than tracked as source. The launcher fingerprints `app`, `components`, and `lib` recursively, including the extracted modules and styles.
