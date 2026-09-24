# Implementation status

## Behavior-preserving organization cleanup — 2026-09-23

- Split the application shell from the session lifecycle hook and focused setup, playback, participant, sharing, quality, and diagnostics components. Split the session engine into host/viewer authentication, shared room lifecycle, signed transport, and one-way media link modules. Capture gestures, cancellation generations, authentication, message ordering, recovery limits, and cleanup retain their existing behavior.
- Organized global styling into base, workspace, landing, diagnostics, and theme files while preserving cascade order. Removed seven unreferenced CSS rules, unused Tailwind theme extensions, ignored media-status callback work, unused exported access, the redundant root environment example, and the empty `frontend/types/` directory. Removed tracked TypeScript build metadata and placed future incremental caches under ignored `.next/cache/`.
- Updated the README and architecture source map. Dependencies, invitation compatibility, protocol formats, public signaling defaults, capture policy, launcher commands, and deployment entry points are unchanged.
- Validation: the original baseline passed lint, type checking, all 23 unit tests, formatting, and all 20 Edge browser tests. The refactored source passed the same checks, stricter unused-local/parameter checking, launcher help/syntax checks, and the production static build. Browser/build validation ran in isolated copies to avoid the existing development-server lock; the final copy was verified against the workspace source and configuration.
- Production comparison: all 20 combinations of landing, host setup, advanced settings, invitation, and invalid invitation at 1440px/390px in light/dark mode matched the original DOM, computed styles, and settled screenshot pixels exactly. Compiled CSS matches the original after removing the seven unused rules. No component or library modules are left without consumers.
- Browser tests use synthetic screen video/audio and local signaling with real WebRTC. Actual OS screen selection, physical-device audio, public-service connectivity, and cross-network delivery were not retested. No deployment was performed.

## Optional screen-share audio — 2026-09-18

- Hosts and attendees can start sharing live video without an audio track. A small inline status notice explains that audio is not shared and can be enabled by stopping and selecting again with audio enabled. Share buttons now say “Share screen”.
- Capture continues to request source audio, offers system audio where supported, and prefers window-only audio for windows. The browser owns the selector and its checkbox defaults; no consent bypass or microphone capture is added.
- Validation: lint, type checking, all 23 unit tests, formatting, and the production static build passed. The build needed local-port permission and a fresh cache after a sandbox failure. All 16 Edge browser tests passed using synthetic capture and local signaling, including host video-only startup, attendee video-only remote playback, notice cleanup, audio RTP, authentication, and connection cleanup. Actual picker defaults, native capture permissions, and physical-device audio playback remain manual checks.

Requirements reset on 2026-09-11: a static browser app for direct one-way video streaming with source audio, password invitations, and immediate connection. Historical LiveKit/account/approval milestones no longer apply.

## Native WebSocket signaling and Advanced Diagnostics — 2026-09-18

- Removed the PeerJS browser dependency and all RTC data-channel setup. Native WSS to the existing public PeerServer service carries authentication, signed rosters, SDP/ICE, publishing/quality/health controls, restart requests, and presence. The `peer` dev dependency remains only for local test signaling. Static hosting and STUN-only direct screen/audio media remain in place.
- Preserved PBKDF2/HMAC challenges, role/session/sequence binding, replay rejection, publication IDs, membership/sender/direction validation, and the rule that media is allocated only after password authentication. WSS is enforced for public service endpoints; plaintext WS is limited to loopback tests. Old clients must reload after the protocol upgrade.
- Added bounded signed presence heartbeats and explicit cleanup/rejoin guidance on WebSocket loss. Signed sequence numbers are not resumed across a broken socket. This replaces the former data channel’s ability to keep control signaling alive during a public signaling outage.
- Kept one publisher-owned ICE restart per media link, including receiver requests and setup-timeout recovery. Restart-generation candidates are queued until their SDP; failure snapshots remain visible without ejecting authenticated participants.
- Added the bottom Advanced Diagnostics tab with socket/authentication and RTC/ICE states, candidate types/protocols, selected pair, interval metrics, numeric ICE errors, restart count, setup time and conservative diagnoses. Copy diagnostics exports an explicit allowlist; addresses are redacted and raw SDP, candidate strings, URLs, identities and secret material are excluded. Clipboard denial offers the same sanitized JSON for manual copying.
- Validation for this change: `npm run check` (lint, type checking, all 22 unit tests, production static build), formatting, and all 16 Edge browser tests passed. Browser tests use synthetic capture with real WebRTC and fail if any RTC data channel is created. New checks cover authentication with ICE suppressed, no media allocation on wrong passwords, selected-pair/metric reporting, secret/IPv4/IPv6/mDNS exclusion, clipboard fallback, repeated failure events, retry exhaustion, receiver-requested actual ICE restart/recovery, and socket-loss cleanup. Existing simultaneous publishing, audio RTP, source dimensions, quality controls, cancellation and leave/end tests passed. Desktop and 390px diagnostics screenshots were inspected.
- Build validation needed local worker-socket access and clearing the generated cache of an initial sandbox-related failure. No deployment was performed. Automatic approval review blocked the optional public-WSS static-export smoke test because it sends test authentication/signaling and ICE metadata to an external service; public-service compatibility remains unverified for this change. Actual screen/audio capture, separate-device playback and cross-network NAT/STUN behavior remain manual checks.

## Retained TryCloudflare testing workflow — 2026-09-18

- Confirmed the existing local launcher remains available alongside Vercel. Documented using the same app source for public pre-deployment testing, rebuilding after changes, and distributing fresh invitations without requiring testers to install the project.
- Validation: launcher help, shell and JavaScript syntax checks, and diff whitespace checks passed. No runtime code changed; no public tunnel was started, remote streaming tested, or Vercel deployment performed for this documentation update.

## Frame rate priority default — 2026-09-18

- Publishing now defaults to Frame rate priority (motion), including the sender fallback. Viewers continue to follow the streamer by default; explicit priority choices remain available.
- Updated the existing default sender assertion and the product/setup documentation.
- Validation: lint, type checking, all 16 unit tests, formatting, and the production static build passed. Browser tests were attempted but could not start because an existing Next.js development server holds the project lock; that server was left running. Real bandwidth adaptation and screen/audio capture were not manually tested.

## Vercel landing page and stronger room IDs — 2026-09-18

- Added a prerendered, responsive landing page with **Create a room**, a short explanation of the sharing flow, and browser/audio guidance. Host setup uses `/#create`; direct invitation links still open attendee entry. Leaving the session for the landing page releases capture and closes the room.
- Added `frontend/vercel.json` for static deployment: Other preset, `npm ci`, `npm run build`, output `out`, and capture/referrer/content-type response headers. Documentation now recommends the hosted website, with `./run.command` retained as an optional local tool. Hosts and attendees need only the deployed website.
- New room IDs use 256 bits from Web Crypto, encoded as 64 hexadecimal characters. Room and participant-message validation accept the new format and legacy 128-bit room IDs. Invitations retain the page origin and exclude passwords.
- Validation: lint, type checking, all 16 unit tests, formatting, and the production static build passed. The build required allowing the local Next.js worker socket after clearing the sandbox-failed cache. All 13 browser tests passed in Edge with synthetic capture and real WebRTC, including longer-ID authentication, multi-participant media, quality controls, and cleanup. The two desktop/mobile navigation and layout tests also passed against the production static export. Landing-page screenshots at 1440px and 390px were inspected; the export contains the landing content in its HTML.
- No Vercel deployment was performed. Deployed response headers/access settings, real screen/audio capture, and delivery between different physical networks remain manual checks.

## Advanced stream settings — 2026-09-17

- Added expandable stream and playback settings with video quality priority, frame rate priority, and balanced adaptation; viewers default to following each streamer and can override priority independently.
- Added live high/standard/low-data audio bitrate ceilings (192/128/64 kbps), bounded by the publisher’s limit. Settings carry into new connections and sharing restarts within the session.
- Extended signed quality requests with validated optional preferences; video tuning remains per sender and never changes the shared capture hint for other viewers. Existing source/resolution/frame-rate ceilings and capture permissions remain in effect.
- Validation: lint, type checking, 16 unit tests, 12 browser tests, formatting, and the production static build passed. The build required clearing a cached sandbox socket error and allowing the local build-worker socket. Automated Edge tests use synthetic capture with real WebRTC: they verify encoder parameters, independent viewer preferences, publisher audio limits, restoration, restart, attendee publishing, decoded frames/audio RTP, authentication, and cleanup. Desktop/mobile screenshots were inspected; long priority labels were shortened to fit narrow controls. The three affected browser tests and static build passed again after that adjustment.
- Real bandwidth-constrained adaptation, audible fidelity differences, native screen/audio capture, and cross-network delivery remain manual checks.

## Quality and connection diagnostics — 2026-09-13

- Added live publisher and viewer quality ceilings: Source, 1080p, 720p, 480p; each viewer request is independent and respects the publisher ceiling.
- Added authenticated per-publication quality requests and upload-health summaries, interval WebRTC measurements, and expandable connection icons for receiving, the selected streamer, and the local publisher.
- Attribution distinguishes likely upload, likely download, uncertain path trouble, encoding pressure, and playback frame drops; unknown/stale data is not shown as a healthy internet connection.
- Validation: lint, type checking, all 14 unit tests, all 11 browser tests, formatting, and the production static build passed. The quality/telemetry browser test passed again after final cleanup changes and verifies icons advance from measuring to live status. Desktop/mobile screenshots were inspected.
- Browser tests verify real per-viewer resolution changes, publisher ceilings, source restoration, and attendee publishing with synthetic capture. Diagnostic cause cases use simulated metrics in unit tests. Real network shaping, ISP attribution, and physical-device capture/playback remain manual checks.

## Participant streaming update — 2026-09-13

The user expanded the product contract to session usernames, relaxed passwords, and screen sharing by any attendee. Earlier receive-only and one-way product milestones below are historical.

- Added required session usernames (trimmed, 1–40 characters); duplicate display names are allowed and connections retain unique peer IDs.
- Accept any nonblank password with no minimum length or complexity requirement; keep optional password generation and authenticated access.
- Added signed profiles, membership rosters, publication announcements, and routed media signaling. The host forwards signaling while every publication sends media directly to each other participant.
- Added participant stream selection for host and attendees, muted own preview, and audio only from the selected stream.
- Added independent stop/restart sharing, selection fallback, and capture cleanup on departure/session end.
- Validation: lint, TypeScript, all 10 unit tests, and formatting passed. All 10 browser tests passed with synthetic capture over real WebRTC; the two affected authentication/multi-publisher tests passed again after final UI changes. Desktop and 390px active-session screenshots were inspected. The production static build passed after clearing the cached sandbox socket failure.
- Browser coverage includes one-character passwords, wrong-password rejection before media allocation, named rosters, three simultaneous publishers, selected-stream decoded frames/audio RTP, muted own preview, stop/restart, departure/session-end cleanup, missing audio, and canceled attendee capture.
- Real OS picker, audible physical-device playback, and cross-network multi-publisher behavior remain manual checks.

## Implemented

- Removed runtime API routes, host accounts, PostgreSQL/Prisma, LiveKit, approval lobby, and server deployment stack.
- Added a static root page with host setup and fragment-based attendee invitations.
- Added password challenge-response in the host browser before media creation; authenticated, sequenced SDP/ICE messages bind media fingerprints.
- Added one send-only native WebRTC media connection per viewer, receive-only playback, and explicit STUN-only ICE configuration.
- Added mandatory screen/tab audio capture, source-resolution video at requested 30/60 fps, sender quality hints, and measured video/audio statistics.
- Added password retry, missing audio errors, offline/invalid link states, autoplay recovery, invitation copying, viewer count, stop/end handling, and cancellation cleanup.
- Updated all project Markdown documentation and environment examples for the static peer-to-peer product contract.
- Added protocol/capture tests and a browser suite exercising real video/audio RTP with synthetic capture and a local signaling fixture.

## Native picker without browser workarounds

- The user requires native macOS selection in a normally launched browser, with no special launch arguments. Removed the prior workaround instructions from the README, terminal output, and capture error message; recorded this constraint in the product rules.
- Reviewed capture options and upstream Chromium's picker selection. The app uses ordinary `getDisplayMedia`; its options do not directly select the OS picker. No unsupported capture option or native helper was added.
- Cisco's native-picker documentation describes the Webex App. Whether the user's comparison is a Webex browser tab or the installed Mac app needs clarification before concluding they use the same capture path.
- Native picker behavior in normally launched Edge is still unresolved. Removal of workaround instructions is not a claim to have fixed it.

## Link-only launcher and participant-access follow-up

- The default launcher now prints a verified host link and never opens, closes, or configures a browser. The legacy `--no-open` option remains accepted.
- Removed browser-exit shutdown coupling; browser closure no longer terminates the public tunnel. Ctrl+C still stops the launcher and its helpers.
- Added ongoing public-page checks with sustained-outage and recovery messages, explicit error 1033 diagnosis, and fresh-address/invitation guidance.
- Updated regular-browser native-picker instructions and removed obsolete automatic-browser guidance from the UI and current documentation.
- The reported `greatly-ben-persistent-network` link returned HTTP 530 / error 1033; its log records a terminated tunnel. Another still-running session returned HTTP 200 with the app from the host's network. The earlier reported failure time and failures of other participant links are not established by this observation.
- Follow-up validation: lint, type checking, all 8 unit tests, static build, and formatting passed. The new public launcher returned the exact built HTML over HTTPS, printed a copyable link, and spawned only cloudflared and the keep-awake helper. A repeat local launch reused the build, served HTTP 200, and exited cleanly on Ctrl+C with its port closed. The help command and shell syntax check passed.
- Unit tests cover public HTTP 530/error 1033, unexpected HTML, network failure, sustained-outage reporting, recovery, and aborting an in-flight check on shutdown.
- The user confirmed that the fresh public test address loads the host/setup page in the participant check. That root URL was intentionally used to check website reachability; viewing requires the room invitation generated after the host starts sharing. This confirms page access for that check, not end-to-end remote video/audio playback or universal tunnel availability.
- Actual remote video/audio playback and native OS picker selection remain manual checks. An external web-testing tool could not access the tunnel URLs; this was not evidence of a participant connection failure.

## Previous regular-use and private-picker update

The automatic-browser behavior below is historical and superseded by the link-only launcher above.

- Added `./run.command` / `npm run share` for automatic preparation, a temporary public HTTPS address, and an isolated host browser window.
- The previous launcher enabled an experimental native-picker feature; that launcher behavior and its workaround instructions have since been removed. No auto-selection, fake capture, auto-consent, broad permission changes, or modification of normal browser profiles is used.
- Removed source-filter customization and disabled the direct tab-switch shortcut. Capture cancellation does not retry through another API.
- Added regression checks for capture cancellation, picker-related constraints, safe browser launch options, and URL handling.
- Manual verification of the actual macOS picker remains required; a webpage cannot determine or enforce which OS picker its browser implements.

Follow-up validation on 2026-09-11:

- Lint, TypeScript checking, and all 7 protocol/capture/launcher unit tests passed.
- All 8 browser tests passed with synthetic screen video and audio over real WebRTC connections.
- First-use launcher preparation successfully installed dependencies, built the static app, and downloaded the pinned tunnel helper. Repeated launches reused the current build.
- A public launcher session returned the exact locally built HTML over HTTPS. Tunnel readiness now waits for its connection to register before checking the new hostname.
- Ctrl+C stopped that session with exit code 0, and its local port no longer accepted connections.
- `bash -n run.command` and `./run.command --help` passed.
- The default launcher opened the installed Microsoft Edge with a separate temporary profile, the native-picker feature flag, and the verified public HTTPS page. Actual OS picker selection remains unverified.
- Final formatting checks passed.

The earlier results below describe the preceding implementation; they are retained as test history.

## Verification

Observed on 2026-09-11:

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 4 protocol/capture tests passed.
- `npm run build`: passed; only `/` and the static not-found page are emitted. The final build was run with permission for the local build-worker socket after clearing a sandbox-failed cache.
- `npm run format:check`: passed.
- `npm audit`: 0 vulnerabilities across production and development dependencies after package updates.
- `BROWSER_EXECUTABLE="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" npm run verify:browser`: all 8 tests passed using the isolated local signaling fixture. Includes 1440px/390px host/invitation layout checks and screenshots, inspected visually.
- `TEST_STATIC_EXPORT=1 BROWSER_EXECUTABLE="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" npm run verify:browser`: all 6 media-flow tests present at that run passed against the actual static export and default public PeerJS signaling service. Layout-only tests were added and verified separately afterward.
- Confirmed two independent viewers decode synthetic 1920×1080 video and receive audio RTP; viewer senders have no tracks, media transceivers are receive-only, and no relay candidates appear.
- Wrong-password attempts created no host media senders; correct retry, viewer reload/rejoin, leave, missing-audio rejection, autoplay recovery, canceled startup, stream ending, and browser Stop sharing passed.
- `npm start` static preview: `/` returns 200 with the intended headers; removed `/api/health` returns 404.

Public signaling was exercised from isolated browsers on one computer. This proves the built artifact can use that service, not that all remote NAT pairs can connect. Synthetic media proves transport and decoded dimensions, not real screen picker permissions or audible physical speaker output. Temporary public HTTPS access was verified in the launcher follow-up; no permanent website deployment was performed.

## Still requires real devices and networks

- Actual tab/window/system-audio capture permissions on target browsers/OS versions.
- Audible playback on a separate physical device, including autoplay restrictions.
- 1440p/4K source fidelity and high frame rate under actual hardware/upload constraints.
- End-to-end remote viewing through the public HTTPS address, including different-Wi-Fi and mobile-data connectivity.
- Mobile viewer layout, audio/fullscreen behavior, and restrictive NAT failure UX.

These are manual acceptance checks, not claims that the app can guarantee direct connectivity or capture support on every platform.
