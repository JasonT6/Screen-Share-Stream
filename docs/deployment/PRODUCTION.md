# Publish the static web app

The user does not run a streaming server. Publish static website assets, then the host and attendees stream directly between their browsers.

## Vercel deployment (recommended)

1. Import the repository in Vercel. Set **Root Directory** to `frontend`, where `package.json` and `vercel.json` live.
2. Select the **Other** framework preset and Node.js **22.x** or newer. The checked-in configuration uses `npm ci` to install, `npm run build` to build, and `out` as the output directory. It deliberately publishes the static export, with no application server or serverless API.
3. Deploy with the default public signaling settings; no environment variables or secrets are needed.
4. Open the production HTTPS domain and click **Create a room**. Choose a username and password, share a screen with audio, and copy the generated invitation. Share the password separately.

Vercel’s [project configuration reference](https://vercel.com/docs/project-configuration/vercel-json) documents these settings and response headers. Use the production URL or a custom domain accessible to attendees; a deployment protected by a Vercel login cannot be used by guests without that access. Preview URLs may have different access settings.

The landing page is `/`, host setup is `/#create`, and invitations are `/#room=ps-<64 random hex characters>`. All three use the same exported HTML page, so no dynamic routes or rewrite rules are needed. New IDs use 32 bytes from Web Crypto (256 bits); older 128-bit invitations are still accepted by the current client while their host remains online. Passwords are never put in URLs.

Hosts and attendees open the deployed site directly. They do not install dependencies, run `./run.command`, or keep a terminal/tunnel running. The host must still keep the browser tab open and computer awake because that browser owns the active room. Reloading or closing it ends the session. Vercel only serves the website; media stays peer to peer.

`frontend/vercel.json` applies the same security headers as `public/_headers`, which Vercel does not use as header configuration. Screen capture remains allowed; microphone and camera capture are disabled.

## Optional temporary local hosting

The existing `./run.command` / `npm run share` launcher remains available for local use and temporary Cloudflare HTTPS tunnels. Open its printed link and click **Create a room**. This alternative requires Node.js 22+, a running terminal, and a fresh address on each launch. It is not needed for the Vercel deployment. See the README for launcher options and tunnel troubleshooting.

## Build and publish

```sh
cd frontend
npm ci
npm run build
```

Upload the contents of `frontend/out/` to your HTTPS static website hosting. Set the build command to `npm run build`, project/root directory to `frontend`, and output directory to `out` if your static host builds from source. Serve the app at the domain root. Do not select a Node/Next.js server deployment, and do not run `next start` in production.

No database migrations, Docker services, user accounts, API keys, or application secrets are required. No custom ports for a streaming server need to be opened. The former Compose/LiveKit/coturn/Caddy configurations were removed.

The app uses the existing HTTPS origin when generating an invitation. The `#room=…` fragment stays on the client, so the static host only needs the root page. A public host origin makes the generated invitation usable by attendees outside your computer. `localhost` is strictly a local preview and must not be sent to remote attendees.

If hosting supports a `_headers` file, the included `frontend/public/_headers` disables camera/microphone access, disables referrer transmission, and sets content type sniffing protection. Configure equivalent HTTP headers on hosts that ignore this file. Do not disable `display-capture`; the host needs it. Do not embed this app in a restricted iframe.

## External services

By default, the frontend connects securely to `0.peerjs.com:443` for native secure WebSocket signaling through PeerServer and uses `stun.l.google.com:19302` / `stun1.l.google.com:19302` for address discovery. Authentication, rosters, signed SDP/ICE, presence and control messages travel over that WebSocket. PeerServer forwards opaque application payloads; the frontend no longer includes the PeerJS client or creates WebRTC data channels. The `peer` development dependency is only the local test fixture. Video/audio never use a media server or TURN relay.

Availability of these public services is outside the app's control. Their operators can see service requests and network metadata. Peers also discover each other's reachable network addresses. The web host serves assets and must be trusted to serve unmodified code.

No TURN is configured. Some corporate networks, VPNs, mobile networks, or NAT pairs cannot establish direct connections. A failure is expected in those cases, with an actionable timeout message. Guaranteeing connectivity would require changing the no-relay constraint; do not advertise universal connectivity.

## Optional public build configuration

No environment file is needed. `frontend/.env.example` documents the only supported variables:

- `NEXT_PUBLIC_PEER_HOST`: defaults to `0.peerjs.com`.
- `NEXT_PUBLIC_PEER_PORT`: defaults to `443`.
- `NEXT_PUBLIC_PEER_PATH`: defaults to `/`.
- `NEXT_PUBLIC_PEER_SECURE`: defaults to `true`.

These are public build-time values, not secrets. The defaults use public signaling; changing them is only useful when you deliberately choose another compatible signaling service. Use TLS for public deployment; plaintext `ws:` is rejected except for loopback test hosts. The existing variable names are retained for compatible PeerServer routing, not a PeerJS client. Old app clients must reload after this transport upgrade. Rebuild after any change. The browser test config overrides these values for its localhost test fixture; never publish a build made with those test overrides.

Old `DATABASE_URL`, `LIVEKIT_*`, `TURN_*`, and account/session configuration is unused. Existing private `.env` files may contain obsolete settings; they are not copied into the static export or required by this app.

## Before sharing with attendees

- Publish over HTTPS and open the deployed page in desktop Chrome/Edge.
- Choose a tab, enable its audio, and confirm live audio capture and source dimensions.
- Send the generated deployed-origin invitation and password separately.
- Test an attendee on a different internet connection, including playback audio.
- Check mobile viewer behavior, autoplay, volume, and fullscreen on target devices.
- Verify wrong passwords cannot receive media and ending stops all viewers.
- Confirm the computer stays awake and has adequate upload bandwidth per attendee.

See [QA.md](QA.md) for the full checklist. Publishing assets and successful local tests do not establish cross-network readiness.
