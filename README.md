# Private Stream

A browser app for private, multi-participant screen sharing with shared audio. The host starts a stream and sends attendees an invitation link and a password. Everyone chooses a username; attendees open the link, enter the password, and connect automatically. Any participant can share their screen and source audio, and everyone can click an active stream in the participant list to watch it. No accounts, installation, voice chat, or approval lobby.

## Host on Vercel (recommended)

Deploy once, then everyone opens the website. Hosts and attendees do not need Node.js, a terminal, or `./run.command`.

1. Import this repository into Vercel and set **Root Directory** to `frontend` (the folder containing `package.json` and `vercel.json`).
2. Select **Other** as the framework preset and Node.js **22.x** or newer. The included `frontend/vercel.json` sets `npm ci`, `npm run build`, and the static output directory `out`, plus the browser security headers. No environment variables are required.
3. Deploy, then open the production HTTPS address. Use the production domain for invitations; attendees must be able to access it without a Vercel login.

The landing page’s **Create a room** button opens host setup. Choose a username and password, click **Share screen**, and enable source audio in the browser picker. Copy the invitation inside the app and share the password separately. Attendees open that invitation and enter their username and password to connect.

Every new room gets a cryptographically random 256-bit ID. Invitations look like `https://your-site.vercel.app/#room=ps-<64 random hex characters>` and never contain the password. The website stays available independently of your computer; keep the host tab open and computer awake for the room itself to stay active. Ending a session invalidates its invitation.

The deployment serves static assets only; video and shared audio remain peer to peer. See [Vercel setup and deployment checks](docs/deployment/PRODUCTION.md).

## TryCloudflare testing on your Mac

The TryCloudflare launcher is retained alongside Vercel for testing local changes with other people before deployment. Both use the same app source; no separate testing branch or version is needed. Only the person running the test site needs the project and Node.js. Testers open the public invitation in their browsers.

From the project folder, run:

```sh
./run.command
```

You can also double-click `run.command` in Finder. Requires Node.js 22+. For hosting a stream, use a desktop browser that supports screen sharing with source audio, such as Microsoft Edge or Google Chrome.

The launcher installs project dependencies on first use or when the dependency lock changes, builds when app/configuration changes, downloads a pinned official Cloudflare helper once if needed, starts its own static file server on a free local port, verifies a temporary public HTTPS address, and prints a host link for you to copy into your existing browser. It never opens, closes, or configures a browser. Repeat the same command for your next session; the public address changes each time.

Open the newly printed host link, click **Create a room**, choose a username and password, click **Share screen**, select your source and enable its audio, then send attendees the **invitation copied inside the app** and the password. Leave the terminal running and the host tab open. **Ctrl+C** stops the tunnel and static file server without touching your browser. Closing the host tab ends its stream but does not stop the launcher. While running on macOS, the launcher prevents idle sleep. It checks the public page every 15 seconds and reports sustained failures and recovery in the terminal.

The [Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) serves only the static webpage; audio and video remain peer to peer. This is a convenient temporary address, not permanent website hosting or guaranteed availability.

Useful alternatives:

```sh
./run.command --local       # Local use, no public tunnel
./run.command --rebuild     # Force a fresh build before sharing
./run.command --no-open     # Compatibility alias; no browser opens by default
./run.command --help
```

After editing the app, stop the launcher with **Ctrl+C**, then run `./run.command --rebuild` to test a fresh production build. Open the newly printed address, create a new room, and send its invitation and password. The local build and tunnel do not deploy to or update Vercel. Use separate devices and networks when evaluating real streaming performance.

From `frontend/`, `npm run share` starts the same launcher. `CLOUDFLARED_BIN` can point to an already installed tunnel helper. Runtime build hashes, the cached helper, and the tunnel log are stored in ignored `frontend/.runtime/`.

## If attendees see Cloudflare error 1033

[Error 1033 means Cloudflare cannot find a connected tunnel](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1033/). The app cannot load to ask for a password while its website address is unavailable.

1. Keep the terminal running and the Mac awake and connected to the internet. Closing the terminal or pressing Ctrl+C invalidates that session's public address. Browser closure no longer stops the tunnel.
2. Run `./run.command` and wait for **Copy this host link into your browser**. The launcher checks that the public HTTPS page returns this app before printing it as ready.
3. Open that **new address**, start sharing, and send the invitation copied inside that page. Do not reuse an older host tab's invitation after restarting the command: it still contains the stopped tunnel's address.
4. If a current link fails while the command is still running, look for the terminal's public-link warning and inspect `frontend/.runtime/tunnel.log`. The helper can reconnect after a transient connection loss; the monitor reports recovery. If the failure persists, restart, open the new address, and resend fresh invitations.

Quick Tunnels do not guarantee availability. A successful check from the host's network does not certify every participant's network. If participants still see 1033 while the host check passes, retain the live URL, error time, and Cloudflare Ray ID for diagnosis. A persistent HTTPS static host can avoid a session-dependent website address without changing the peer-to-peer media design.

## macOS private screen picker

Use your normally opened browser. No special launch arguments, experimental browser settings, or separate profiles are required or configured by this project. `./run.command` prints the host link only.

The app calls `getDisplayMedia` directly from the Share button and requests video plus source audio. It does not enumerate or preselect screens, implement a custom source picker, simulate consent, or retry another capture API after cancellation. Its frame-rate/audio constraints and tab-switching hint do not select the operating system's picker implementation.

The native macOS picker remains an acceptance requirement, not a verified capability of this app in Edge. The current upstream Chromium implementation chooses native window/screen selection inside browser code, based on OS support and browser configuration; there is no native-picker switch in the site's capture request. [Chromium implementation](https://github.com/chromium/chromium/blob/main/chrome/browser/media/webrtc/thumbnail_capturer_mac.mm).

[Cisco documents a native picker option for the Webex Mac app](https://help.webex.com/en-us/article/jgczxu). That alone does not establish how a Webex call in an Edge tab selects its picker. Compare the same browser and capture type when diagnosing differences. Do not add a native helper, extension, or desktop host to this web-only project without an explicitly agreed scope change.

If macOS asks to bypass the private picker, cancel. A browser-owned source chooser alone does not prove that bypass access was granted. Shared audio can require separate permission and is optional. Actual picker behavior and source audio must be checked interactively; synthetic media tests cannot verify them.

## Development / local preview

Use Node.js 22 or newer.

```sh
cd frontend
npm ci
npm run dev
```

Open `http://localhost:3000` in desktop Chrome or Edge. Click **Create a room**, then choose a username and any nonblank password (short passwords are accepted), then **Share screen**. In the browser picker, select a tab and enable **Share tab audio**. Screen/window audio depends on browser and operating-system support. Sharing without audio is allowed, with a small notice explaining how to enable it. Audio is requested by default, including system audio where supported, but the browser controls its picker checkbox; the app cannot force it on.

After the connection service is ready, copy the invitation and share the password separately. Test with another browser window. Keep the host tab open and the computer awake. **Stop sharing** (including the browser’s button) stops only your publication and keeps the session open. You can share again using the same invitation. **End stream** or closing the host tab ends the session for everyone. A new session creates a new invitation; old invitations do not follow the new session.

A localhost link only works on the same computer. For attendees elsewhere, use the Vercel deployment described above. The optional `./run.command` launcher is available for temporary hosting.

## Other static hosts

```sh
cd frontend
npm run build
```

Publish the contents of `frontend/out/` to an HTTPS static host. No Next.js application server, database, containers, SFU, or media relay is needed. The root page handles invitations using `/#room=…`, so dynamic route rewrites are unnecessary. Both host and attendees open the published website.

To preview the static export locally, run `npm start` after building. This serves files on `http://localhost:3000`; it is a development convenience, not a deployed backend.

See [web publishing](docs/deployment/PRODUCTION.md) for configuration and limitations.

## What peer-to-peer means here

- Video and shared audio travel directly from each publisher’s browser to every other participant over encrypted WebRTC connections.
- The static website still needs somewhere to serve its HTML, CSS, and JavaScript.
- [PeerJS Cloud / PeerServer](https://github.com/peers/peerjs-server) provides public WebSocket message routing. The app connects with the browser’s native secure WebSocket API; the PeerJS client and WebRTC data channels are not used. Google STUN provides network discovery. You do not operate either service. They are external dependencies, so this is not an offline or literally infrastructure-free application.
- There is deliberately **no TURN relay**. Networks that cannot establish direct WebRTC connections will fail with an explanation; trying a different network may help. Universal NAT/firewall connectivity would require allowing a relay.
- Every active publisher sends a separate stream to every other participant, even when its stream is not selected. Upload and encoding costs grow with both publishers and participants. This app targets small private groups, not scale.

## Video and audio

Capture keeps the source’s available resolution. **Stream quality** sets your outgoing ceiling, before or during sharing: Source / automatic (up to 40 Mbps, 60 fps), 1080p (8 Mbps, 30 fps), 720p (3 Mbps, 30 fps), or 480p (1 Mbps, 24 fps). The existing capture frame-rate choice also applies. Presets preserve aspect ratio and never upscale; the resolution limit applies to the shorter edge. Audio stays enabled. Browser support, hardware, and bandwidth determine actual delivery.

**Playback quality**, below the player when watching someone else, requests a lower ceiling for streams received by your browser. It does not change another attendee’s playback. The effective quality is the lower of the publisher’s ceiling and your choice. Returning to Source removes your extra limit; it cannot exceed the streamer’s setting. Changes apply live and carry forward to new streams in the session.

Expand **Advanced stream settings** under Stream quality to choose **Quality priority** (preserve sharper detail), **Frame rate priority** (default; preserve smoother motion), or **Balanced** when bandwidth is limited. **Audio quality** sets a bitrate ceiling: High (192 kbps), Standard (128 kbps), or Low data (64 kbps). These settings apply live and carry forward when you restart sharing in the same session.

Viewers have **Advanced playback settings** under Playback quality. Video priority defaults to **Follow streamer**; an override affects only that viewer’s incoming connections. Audio uses the lower of the streamer’s and viewer’s limits. Priority does not raise the selected video preset’s frame-rate/resolution ceilings or the captured source frame rate. Bitrates are limits, not guaranteed rates or a volume control; browser congestion control and source quality still determine delivery.

Connection icons show **Your connection**, **Streamer’s upload**, and (while publishing) **Your upload**. Click or tap an icon for its explanation. Gray means insufficient measurements, green means no detected network pressure, amber means possible degradation, and red means a disconnected stream. Live packet loss, delay, jitter, encoding limitations, and frame drops inform the indicators. These are stream-path estimates, not speed tests or proof of which ISP is responsible. Multiple affected streamer paths suggest upload pressure; several troubled incoming streams with healthy delivery to other viewers suggest your download. Single-path trouble stays **cause unclear**. CPU encoding and playback strain are identified separately where measurements allow it. Telemetry older than ten seconds is discarded.

The player shows actual video dimensions and stream statistics. Your own preview is muted to prevent feedback. Only the selected stream is attached to the player, so other streams do not play audio. Attendees receive the captured audio and can adjust volume or fullscreen. If autoplay is blocked, **Play with sound** provides the required user gesture. No `getUserMedia`, microphone, or camera capture is used.

For reliable audio capture, use a tab in desktop Chrome/Edge and explicitly enable tab audio. [Browser capture support varies](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia); requesting audio cannot force a browser or OS to supply it. An audio track can also be silent if the source is not playing sound. Viewers may use other WebRTC-capable desktop or mobile browsers, subject to device testing.

## Advanced Diagnostics

At the bottom of a session, select **Advanced Diagnostics** for WebSocket/authentication state and every media connection’s WebRTC, ICE, and SDP signaling states. It shows local/remote candidate types and protocols, the selected pair when the browser exposes it, RTT, video bitrate, packet loss, jitter, FPS, resolution, dropped frames, ICE error codes, restart count, and time from media connection creation to first connection. Missing browser measurements display as unavailable. Failed media attempts remain visible until that publication or session is replaced.

**Copy diagnostics** exports an allowlisted JSON snapshot. IP addresses (including IPv6 and mDNS hostnames) are omitted/redacted at collection time; raw candidates, SDP, URLs, usernames, invitation IDs, passwords, keys, proofs, and MACs are never exported. Clipboard failure exposes the same sanitized JSON for manual copying. Diagnoses such as “STUN may be unreachable” and “this network may require TURN” are estimates, not definitive causes.

Each media link gets at most one automatic ICE restart, offered by its publisher; a receiver can request that same restart over authenticated WebSocket. There is still no TURN. A failed media link does not remove an authenticated attendee from the roster. A lost WebSocket session closes affected media/capture with a reconnect message, rather than resuming an ambiguous signed sequence. Abrupt remote tab loss is detected by signed heartbeats after about 30–35 seconds (background browser throttling can delay detection).

## Password protection

The host browser checks a fresh challenge-response before creating any media sender. Passwords and room keys remain in browser memory, never in URLs, storage, signaling metadata, or a database. PBKDF2-HMAC-SHA256 derives a room-specific key; HMAC authenticates the password proof and all subsequent SDP/ICE messages, including media fingerprints and sequence numbers. Authenticated participants receive a signed roster of usernames and publication IDs. The host routes signed SDP/ICE messages between admitted participants; media travels directly between publishers and attendees. Each publication has a fresh ID so stale messages cannot revive a stopped stream. Authentication, rosters, SDP, ICE candidates, quality/health controls, and signed presence heartbeats all use WebSocket, so joining and seeing the roster do not depend on direct ICE connectivity. Media peer connections are created only after authentication. Old data-channel clients must reload the updated app to join; the transport protocols are not interoperable.

Share a strong, unique password separately from the invitation. This is shared-password access, not individual identity: anyone with both can watch or forward them. It is not a PAKE; captured authentication transcripts permit offline password guessing, so a longer unpredictable phrase or the optional generator offers stronger protection; length and complexity are not enforced. Peers learn each other's connection addresses. Usernames are session display names, not verified identities, and duplicates are allowed. End the session and create a new one to replace access credentials.

## Source organization

The Next.js entry points and global styles live in `frontend/app/`. `components/StreamApp.tsx` owns the page shell and fragment navigation; `components/stream/` contains the session hook and focused setup, playback, sharing, participant, and diagnostics components. `lib/session/` separates host/viewer authentication, shared room lifecycle, signed transport, and WebRTC media links. Protocol validation, capture/quality policy, signaling, and diagnostic calculations remain in `lib/`.

Workspace, landing, diagnostics, and theme styles live in `app/styles/` and are imported in order by the root layout. Launcher scripts, deployment configuration, and test commands retain their existing entry points. See the [architecture source map](docs/ARCHITECTURE.md#source-map) for details. Optional public build-time settings are documented in `frontend/.env.example`; no environment file is required.

## Checks

```sh
cd frontend
npm run check
npm run format:check
npx playwright install chromium
npm run verify:browser
```

Alternatively, use an installed Chromium browser:

```sh
BROWSER_EXECUTABLE="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" npm run verify:browser
```

To check the production export with its default public signaling service, run `npm run build`, then `TEST_STATIC_EXPORT=1 npm run verify:browser` (optionally setting `BROWSER_EXECUTABLE` as above). This mode needs internet access and public-service availability; it starts only a local static file preview, not the test signaling fixture.

Browser tests normally use an isolated local **test-only** signaling fixture and synthetic 1920×1080 video plus an audio tone. They verify real WebRTC RTP delivery, password rejection, multiple viewers, simultaneous attendee publishing, stream selection, restart, reconnect, and cleanup. They do not certify real screen-capture permissions, public service availability, cross-network NAT behavior, or audible speaker output. Complete [manual QA](docs/deployment/QA.md) before relying on a remote session.
