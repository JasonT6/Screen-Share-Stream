# Publish the static web app

The user does not run a streaming server. Publish static website assets, then the host and attendees stream directly between their browsers.

## Start a session without setting up hosting

On the Mac, run `./run.command` from the project root (or double-click it in Finder). The launcher handles build, a local static file server, a temporary public HTTPS tunnel, and a verified host link printed for copying into your browser. It does not open or configure browsers. Use `Ctrl+C` to stop it. Keep the terminal and host window open for the session. Each launch produces a new public address; share invitations copied from that address, not an old localhost or tunnel link.

Requires Node.js 22+; use desktop Chrome/Edge for host capture. The first launch needs internet access to install dependencies and, unless already present, download the official pinned Cloudflare helper into `frontend/.runtime/bin/`. The launcher uses its own free local port and only exposes `out/`. It does not open an application API, database, source directory, or media relay. `--local` skips the public tunnel, and `--no-open` remains a compatibility alias for the default behavior. The terminal monitors public-page availability; see the README for error 1033 recovery and fresh-invitation instructions. See the root README for macOS picker limitations and browser behavior.

For a stable website URL independent of the running Mac, publish the static files as below.

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

By default, the frontend connects securely to `0.peerjs.com:443` for PeerJS signaling and uses `stun.l.google.com:19302` / `stun1.l.google.com:19302` for address discovery. PeerJS only brokers the initial direct data connection. Authenticated SDP/ICE messages for the separate media connection travel on that data channel. Video/audio never use a media server or TURN relay.

Availability of these public services is outside the app's control. Their operators can see service requests and network metadata. Peers also discover each other's reachable network addresses. The web host serves assets and must be trusted to serve unmodified code.

No TURN is configured. Some corporate networks, VPNs, mobile networks, or NAT pairs cannot establish direct connections. A failure is expected in those cases, with an actionable timeout message. Guaranteeing connectivity would require changing the no-relay constraint; do not advertise universal connectivity.

## Optional public build configuration

No environment file is needed. `frontend/.env.example` documents the only supported variables:

- `NEXT_PUBLIC_PEER_HOST`: defaults to `0.peerjs.com`.
- `NEXT_PUBLIC_PEER_PORT`: defaults to `443`.
- `NEXT_PUBLIC_PEER_PATH`: defaults to `/`.
- `NEXT_PUBLIC_PEER_SECURE`: defaults to `true`.

These are public build-time values, not secrets. The defaults use public signaling; changing them is only useful when you deliberately choose another compatible signaling service. Use TLS for public deployment. Rebuild after any change. The browser test config overrides these values for its localhost test fixture; never publish a build made with those test overrides.

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
