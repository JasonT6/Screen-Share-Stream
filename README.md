# Private Stream

A browser app for private, multi-participant screen sharing with shared audio. The host starts a stream and sends attendees an invitation link and a password. Everyone chooses a username; attendees open the link, enter the password, and connect automatically. Any participant can share their screen and source audio, and everyone can click an active stream in the participant list to watch it. No accounts, installation, voice chat, or approval lobby.

## Run regularly on your Mac

From the project folder, run:

```sh
./run.command
```

You can also double-click `run.command` in Finder. Requires Node.js 22+. For hosting a stream, use a desktop browser that supports screen sharing with source audio, such as Microsoft Edge or Google Chrome.

The launcher installs project dependencies on first use or when the dependency lock changes, builds when app/configuration changes, downloads a pinned official Cloudflare helper once if needed, starts its own static file server on a free local port, verifies a temporary public HTTPS address, and prints a host link for you to copy into your existing browser. It never opens, closes, or configures a browser. Repeat the same command for your next session; the public address changes each time.

Open the newly printed host link, choose a username and password, click **Share screen & audio**, select your source and enable its audio, then send attendees the **invitation copied inside the app** and the password. Leave the terminal running and the host tab open. **Ctrl+C** stops the tunnel and static file server without touching your browser. Closing the host tab ends its stream but does not stop the launcher. While running on macOS, the launcher prevents idle sleep. It checks the public page every 15 seconds and reports sustained failures and recovery in the terminal.

The [Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) serves only the static webpage; audio and video remain peer to peer. This is a convenient temporary address, not permanent website hosting or guaranteed availability.

Useful alternatives:

```sh
./run.command --local       # Local use, no public tunnel
./run.command --rebuild     # Force a fresh build before sharing
./run.command --no-open     # Compatibility alias; no browser opens by default
./run.command --help
```

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

If macOS asks to bypass the private picker, cancel. A browser-owned source chooser alone does not prove that bypass access was granted. Shared audio can require separate permission and must be present before streaming starts. Actual picker behavior and source audio must be checked interactively; synthetic media tests cannot verify them.

## Development / local preview

Use Node.js 22 or newer.

```sh
cd frontend
npm ci
npm run dev
```

Open `http://localhost:3000` in desktop Chrome or Edge. Choose a username and any nonblank password (short passwords are accepted), then **Share screen & audio**. In the browser picker, select a tab and enable **Share tab audio**. Screen/window audio depends on browser and operating-system support. Capture is rejected if no audio track is present.

After the connection service is ready, copy the invitation and share the password separately. Test with another browser window. Keep the host tab open and the computer awake. **Stop sharing** (including the browser’s button) stops only your publication and keeps the session open. You can share again using the same invitation. **End stream** or closing the host tab ends the session for everyone. A new session creates a new invitation; old invitations do not follow the new session.

A localhost link only works on the same computer. For attendees elsewhere, use `./run.command` or publish the static build on an HTTPS host as described below.

## Publish the web app

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
- [PeerJS Cloud](https://peerjs.com/client/getting-started) provides public rendezvous/signaling. Google STUN provides network discovery. You do not operate either service. They are external dependencies, so this is not an offline or literally infrastructure-free application.
- There is deliberately **no TURN relay**. Networks that cannot establish direct WebRTC connections will fail with an explanation; trying a different network may help. Universal NAT/firewall connectivity would require allowing a relay.
- Every active publisher sends a separate stream to every other participant, even when its stream is not selected. Upload and encoding costs grow with both publishers and participants. This app targets small private groups, not scale.

## Video and audio

Capture requests the source's available resolution without a 720p/1080p cap, with a choice of 60 or 30 fps. Senders request no resolution downscaling, favor maintaining resolution, and allow up to 40 Mbps per video connection. These are browser hints: bandwidth, hardware, browser implementation, and the selected source determine delivered resolution and frame rate. This is compressed live video, not lossless or guaranteed 4K/60 delivery.

The player shows actual video dimensions and stream statistics. Your own preview is muted to prevent feedback. Only the selected stream is attached to the player, so other streams do not play audio. Attendees receive the captured audio and can adjust volume or fullscreen. If autoplay is blocked, **Play with sound** provides the required user gesture. No `getUserMedia`, microphone, or camera capture is used.

For reliable audio capture, use a tab in desktop Chrome/Edge and explicitly enable tab audio. [Browser capture support varies](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia); requesting audio cannot force a browser or OS to supply it. An audio track can also be silent if the source is not playing sound. Viewers may use other WebRTC-capable desktop or mobile browsers, subject to device testing.

## Password protection

The host browser checks a fresh challenge-response before creating any media sender. Passwords and room keys remain in browser memory, never in URLs, storage, signaling metadata, or a database. PBKDF2-HMAC-SHA256 derives a room-specific key; HMAC authenticates the password proof and all subsequent SDP/ICE messages, including media fingerprints and sequence numbers. Authenticated participants receive a signed roster of usernames and publication IDs. The host routes signed SDP/ICE messages between admitted participants; media travels directly between publishers and attendees. Each publication has a fresh ID so stale messages cannot revive a stopped stream. Unsolicited PeerJS media calls are rejected.

Share a strong, unique password separately from the invitation. This is shared-password access, not individual identity: anyone with both can watch or forward them. It is not a PAKE; captured authentication transcripts permit offline password guessing, so a longer unpredictable phrase or the optional generator offers stronger protection; length and complexity are not enforced. Peers learn each other's connection addresses. Usernames are session display names, not verified identities, and duplicates are allowed. End the session and create a new one to replace access credentials.

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
