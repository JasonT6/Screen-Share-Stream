# QA checklist

## Automated checks

```sh
cd frontend
npm run check
npm run format:check
npx playwright install chromium
npm run verify:browser
```

Use `BROWSER_EXECUTABLE` to point to an installed Chromium browser instead of installing one. The browser suite starts its own static-app development process on port 3100 and a **test-only** PeerJS signaling fixture on 9001. Production uses the public service; neither test process is part of deployment.

To verify the built artifact with the default public signaling service, run `npm run build`, then `TEST_STATIC_EXPORT=1 npm run verify:browser`. Set `BROWSER_EXECUTABLE` if needed. This mode requires internet access, uses `out/`, and starts only the local static preview process on port 3100. It still uses synthetic capture and does not replace a test between two physical devices on different networks.

Unit tests verify room/password validation, challenge binding, wrong-password failures, signed SDP integrity, replay/reflection rejection, capture audio requirements, and STUN-only configuration. Browser tests replace only the screen picker with synthetic 1920×1080 frames and a tone, then check real WebRTC media transport, decoded resolution, audio RTP, and send/receive direction. They do not prove that a real OS capture picker supplies audio or that a speaker plays it.

## Regular-use launcher and private picker

- Run `./run.command --help`; confirm it works before dependencies are installed.
- Run `./run.command`: dependencies/build are prepared, a verified public address is printed, and no browser opens. Paste the printed link into an existing browser.
- Repeat with unchanged files: dependencies/build are reused. Change capture/UI source: a fresh build must be produced on the next run.
- Keep another app on port 3000: the launcher must choose its own free port and never expose the unrelated app.
- Press Ctrl+C: the launcher's tunnel, file server, and keep-awake helper stop; browser windows remain open.
- Close the host browser: its stream ends, but the terminal and public page stay available. Reopen the same address to create a new stream.
- Simulate a public route failure: sustained failures warn in the terminal, recovery is reported, and no replacement URL is silently issued.
- Restart the launcher: open the new host address and copy a fresh invitation; stopped-session links must not be reused.
- Run `--local`: no tunnel is started. `--no-open` must not launch any browser.
- On macOS 15+, use a normally launched browser with no special arguments or experimental settings, and select Window/Screen: confirm Apple's private picker appears. Do not treat a synthetic media test as proof of the real OS UI.
- If a browser asks to bypass the private picker, cancel it; do not approve broader screen access as the workaround.
- Cancel the picker: no alternate capture call or automatic retry should occur.
- Confirm the direct "share this tab instead" shortcut is absent where the browser honors `surfaceSwitching: "exclude"`; choose new sources by ending and restarting the stream.
- Verify separate source-audio permissions, actual source audio, and privacy indicators on the host Mac.

## Host capture on a real device

- Open the published HTTPS site in desktop Chrome/Edge.
- Enter a short password: starting should be blocked. Generate a password or enter a long phrase.
- Cancel the screen picker: a helpful error appears and no stream remains active.
- Share a browser tab with audio enabled: live preview appears, is muted, and shows source dimensions.
- Select a source without an audio track: sharing stops and the app explains how to enable audio.
- Test window/full-screen audio on each supported OS/browser; unsupported combinations must not claim success.
- Test both 30 and 60 fps selections with source content in motion. Inspect delivered stats rather than assuming the requested frame rate.
- Test a 1440p/4K source: verify actual received dimensions, readability, and motion at available bandwidth.
- Use the browser's Stop sharing button and verify the session ends. Ended audio capture should end the stream too.

## Invitation and password

- Invitation uses the deployed HTTPS origin, contains a random room ID in its fragment, and contains no password.
- Open in a separate browser/profile: only a password is required. No account, name form, lobby, or approval.
- Incorrect password shows an error and receives no media; correct password automatically starts connecting.
- Check generated passwords can be shown/hidden and copied manually; the invitation copy button copies only the URL.
- Reload the invitation: prompt for the password again. No password or key should be in browser storage.
- Invalid/truncated links and offline hosts show actionable errors.

## Playback and lifecycle

- Verify actual moving video and audible source audio on another device.
- Confirm host preview does not echo through the host speakers.
- If autoplay is blocked, use Play with sound; playback should start with audio.
- Confirm volume/fullscreen work on desktop and mobile viewers.
- Confirm neither host nor viewer requests microphone or camera access.
- Join with two attendees; both receive media independently.
- Leave/rejoin, reload a viewer, and briefly interrupt the network; verify appropriate status/retry behavior.
- End the stream: all tracks stop, viewers lose playback, and the graceful ended state appears when signaling is available.
- Close/crash the host tab: attendees eventually see disconnection; stale invitations cannot join the next stream.
- Cancel during startup: no late capture or peer connection should remain.

## Static and real-network validation

- `npm run build` produces `out/index.html` and browser assets without server API routes.
- `npm start` serves the export locally; test a direct fragment invitation and refresh.
- Publish `out/` over HTTPS with public default signaling settings and test a real remote attendee.
- Test different Wi-Fi and mobile data separately. If direct ICE fails, the app should time out with network guidance.
- Use browser WebRTC diagnostics to verify selected candidates are never TURN relay candidates.
- Simulate public signaling unavailability: new sessions fail clearly; already connected media should remain usable.
- Check layout on narrow screens, keyboard focus, readable errors, and sound-play affordances.

Record the browser, OS, source size, audio-source choice, and network for manual results. Do not mark these real-device/network checks passed from synthetic local tests.
