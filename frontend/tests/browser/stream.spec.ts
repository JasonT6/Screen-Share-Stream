import { test, expect, type Page } from "@playwright/test";

const password = "a";

// Only the screen picker is substituted. Media travels over real browser
// RTCPeerConnections; the receive tests inspect decoded frames and RTP bytes.
async function prepare(page: Page, withAudio = true) {
  await page.addInitScript(
    ({ withAudio }) => {
      const pcs: RTCPeerConnection[] = [];
      const NativePeerConnection = window.RTCPeerConnection;
      NativePeerConnection.prototype.createDataChannel = () => {
        throw new Error(
          "Authentication and signaling must not use RTC data channels"
        );
      };
      const sockets: WebSocket[] = [];
      window.WebSocket = new Proxy(window.WebSocket, {
        construct(target, args) {
          const socket = new target(...(args as [string]));
          sockets.push(socket);
          return socket;
        }
      });
      Object.assign(window, { testSockets: sockets });
      window.RTCPeerConnection = new Proxy(NativePeerConnection, {
        construct(target, args) {
          const pc = new target(...args);
          pcs.push(pc);
          return pc;
        }
      });
      Object.assign(window, { testPeers: pcs, testCapture: null });
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        writable: true,
        value: () => {
          throw new Error("Microphone/camera capture must never be requested");
        }
      });
      Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
        configurable: true,
        writable: true,
        value: async () => {
          const canvas = document.createElement("canvas");
          canvas.width = 1920;
          canvas.height = 1080;
          const ctx = canvas.getContext("2d")!;
          let frame = 0;
          const draw = () => {
            ctx.fillStyle = "#244726";
            ctx.fillRect(0, 0, 1920, 1080);
            ctx.fillStyle = "white";
            ctx.font = "64px sans-serif";
            ctx.fillText(`Private Stream ${frame++}`, 120, 160);
          };
          draw();
          const timer = setInterval(draw, 33);
          const stream = canvas.captureStream(30);
          if (withAudio) {
            const audio = new AudioContext();
            const tone = audio.createOscillator();
            const output = audio.createMediaStreamDestination();
            tone.frequency.value = 440;
            tone.connect(output);
            tone.start();
            await audio.resume();
            stream.addTrack(output.stream.getAudioTracks()[0]);
          }
          stream
            .getVideoTracks()[0]
            .addEventListener("ended", () => clearInterval(timer));
          Object.assign(window, { testCapture: stream });
          return stream;
        }
      });
    },
    { withAudio }
  );
}

async function hostStream(page: Page) {
  await prepare(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Create a room" }).click();
  await page.getByLabel("Username", { exact: true }).fill("Host");
  await page.getByLabel("Stream password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Share screen" }).click();
  await expect(page.getByLabel("Private invitation")).toBeVisible();
  const invitation = await page.getByLabel("Private invitation").inputValue();
  expect(new URL(invitation).origin).toBe(new URL(page.url()).origin);
  expect(new URL(invitation).hash).toMatch(/^#room=ps-[a-f0-9]{64}$/);
  return invitation;
}

async function connect(
  page: Page,
  invitation: string,
  pass = password,
  username = "Alice"
) {
  await prepare(page);
  await page.goto(invitation);
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(pass);
  await page.getByRole("button", { name: "Connect to stream" }).click();
}

async function receiveAudioVideo(page: Page, publishing = false) {
  await expect
    .poll(() =>
      page.locator("video").evaluate((video: HTMLVideoElement) => ({
        width: video.videoWidth,
        height: video.videoHeight,
        playing: video.currentTime > 0
      }))
    )
    .toEqual({ width: 1920, height: 1080, playing: true });
  await expect
    .poll(() =>
      page.evaluate(async (publishing) => {
        const { testPeers } = window as unknown as {
          testPeers: RTCPeerConnection[];
        };
        let audio = 0;
        let frames = 0;
        for (const pc of testPeers.filter(
          (pc) => pc.connectionState === "connected"
        )) {
          const selected = document.querySelector("video")
            ?.srcObject as MediaStream | null;
          for (const receiver of pc
            .getReceivers()
            .filter((receiver) =>
              selected?.getTracks().includes(receiver.track)
            )) {
            const reports = await receiver.getStats();
            reports.forEach((report) => {
              if (report.type === "inbound-rtp" && report.kind === "audio")
                audio += report.bytesReceived;
              if (report.type === "inbound-rtp" && report.kind === "video")
                frames += report.framesDecoded;
              if (
                report.type === "local-candidate" &&
                report.candidateType === "relay"
              )
                throw new Error("Unexpected media relay");
            });
            if (!publishing && pc.getSenders().some((sender) => sender.track))
              throw new Error("Viewer is publishing");
          }
          if (
            !publishing &&
            pc
              .getTransceivers()
              .some(
                (transceiver) =>
                  transceiver.currentDirection &&
                  transceiver.currentDirection !== "recvonly"
              )
          )
            throw new Error("Viewer media is not receive-only");
        }
        return audio > 100 && frames > 3;
      }, publishing)
    )
    .toBe(true);
}

test("password gates real native-resolution video and audio; multiple viewers, retry, leave, reload and end", async ({
  browser,
  page: host
}) => {
  const errors: string[] = [];
  host.on("pageerror", (error) => errors.push(error.message));
  const invitation = await hostStream(host);
  expect(invitation).toMatch(/#room=ps-[a-f0-9]{64}$/);
  expect(new URL(invitation).search).toBe("");
  expect([
    ...new URLSearchParams(new URL(invitation).hash.slice(1)).keys()
  ]).toEqual(["room"]);
  const viewer = await browser.newPage();
  await connect(viewer, invitation, "a wrong password");
  await expect(viewer.locator(".problem")).toContainText("Incorrect password");
  expect(
    await viewer
      .locator("video")
      .evaluate((video: HTMLVideoElement) => video.srcObject)
  ).toBeNull();
  expect(
    await host.evaluate(() =>
      (window as unknown as { testPeers: RTCPeerConnection[] }).testPeers.some(
        (pc) => pc.getSenders().some((sender) => sender.track)
      )
    )
  ).toBe(false);
  expect(
    await host.evaluate(
      () =>
        (window as unknown as { testPeers: RTCPeerConnection[] }).testPeers
          .length
    )
  ).toBe(0);
  expect(
    await viewer.evaluate(
      () =>
        (window as unknown as { testPeers: RTCPeerConnection[] }).testPeers
          .length
    )
  ).toBe(0);
  await viewer.getByLabel("Password", { exact: true }).fill(password);
  await viewer.getByRole("button", { name: "Try again" }).click();
  await receiveAudioVideo(viewer);
  const second = await browser.newPage();
  await connect(second, invitation, password, "Bob");
  await receiveAudioVideo(second);
  await expect(host.locator(".viewer-list li")).toHaveCount(3);
  await expect(
    viewer.getByRole("button", { name: "Share screen" })
  ).toHaveCount(1);
  await second.getByRole("button", { name: "Leave stream" }).click();
  await expect(host.locator(".viewer-list li")).toHaveCount(2);
  await viewer.reload();
  await expect(viewer.getByLabel("Password", { exact: true })).toHaveValue("");
  await viewer.getByLabel("Username", { exact: true }).fill("Alice");
  await viewer.getByLabel("Password", { exact: true }).fill(password);
  await viewer.getByRole("button", { name: "Connect to stream" }).click();
  await receiveAudioVideo(viewer);
  await host.getByRole("button", { name: "End stream" }).click();
  await expect(
    viewer.getByRole("heading", { name: "That’s a wrap." })
  ).toBeVisible();
  await expect
    .poll(() =>
      host.evaluate(() =>
        (window as unknown as { testCapture: MediaStream }).testCapture
          .getTracks()
          .every((track) => track.readyState === "ended")
      )
    )
    .toBe(true);
  await host.getByRole("button", { name: "Share screen" }).click();
  await expect(host.getByLabel("Private invitation")).toBeVisible();
  expect(await host.getByLabel("Private invitation").inputValue()).not.toBe(
    invitation
  );
  await host.getByRole("button", { name: "End stream" }).click();
  expect(errors).toEqual([]);
  await viewer.close();
  await second.close();
});

test("missing audio allows going live with a quiet notice", async ({
  page
}) => {
  await prepare(page, false);
  await page.goto("/");
  await page.getByRole("link", { name: "Create a room" }).click();
  await page.getByLabel("Username", { exact: true }).fill("Host");
  await page.getByLabel("Stream password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Share screen" }).click();
  await expect(page.getByTestId("audio-sharing-notice")).toContainText(
    "Audio isn’t being shared"
  );
  await expect(page.getByLabel("Private invitation")).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as unknown as { testCapture: MediaStream }).testCapture
        .getTracks()
        .every((track) => track.readyState === "live")
    )
  ).toBe(true);
  await page.getByRole("button", { name: "Stop sharing", exact: true }).click();
  await expect(page.getByTestId("audio-sharing-notice")).toHaveCount(0);
});

test("invalid invitations and offline hosts have actionable errors", async ({
  page
}) => {
  await page.goto("/#room=invalid");
  await expect(
    page.getByRole("heading", { name: "This invitation isn’t valid." })
  ).toBeVisible();
  await connect(page, "/#room=ps-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  await expect(page.locator(".problem")).toContainText("host is offline", {
    timeout: 30_000
  });
});

test("browser Stop sharing ends publication but keeps the session open", async ({
  browser,
  page: host
}) => {
  const invitation = await hostStream(host);
  const viewer = await browser.newPage();
  await connect(viewer, invitation);
  await receiveAudioVideo(viewer);
  await host.evaluate(() => {
    const track = (
      window as unknown as { testCapture: MediaStream }
    ).testCapture.getVideoTracks()[0];
    track.stop();
    track.dispatchEvent(new Event("ended"));
  });
  await expect(
    host.getByRole("button", { name: "Share screen" })
  ).toBeVisible();
  await expect(
    viewer.getByRole("button", { name: "Not sharing: Host", exact: true })
  ).toBeDisabled();
  await expect
    .poll(() =>
      viewer
        .locator("video")
        .evaluate((video: HTMLVideoElement) => video.srcObject === null)
    )
    .toBe(true);
  await expect(host.getByLabel("Private invitation")).toHaveValue(invitation);
  await host.getByRole("button", { name: "End stream" }).click();
  await viewer.close();
});

test("blocked autoplay has a working play-with-sound action", async ({
  browser,
  page: host
}) => {
  const invitation = await hostStream(host);
  const viewer = await browser.newPage();
  await viewer.addInitScript(() => {
    const original = HTMLMediaElement.prototype.play;
    let rejected = false;
    HTMLMediaElement.prototype.play = function () {
      if (this.srcObject && !this.muted && !rejected) {
        rejected = true;
        return Promise.reject(
          new DOMException("Autoplay blocked", "NotAllowedError")
        );
      }
      return original.call(this);
    };
  });
  await connect(viewer, invitation);
  await viewer.getByRole("button", { name: "Play with sound" }).click();
  await expect(
    viewer.getByRole("button", { name: "Play with sound" })
  ).toHaveCount(0);
  await receiveAudioVideo(viewer);
  expect(
    await viewer
      .locator("video")
      .evaluate((video: HTMLVideoElement) => video.muted)
  ).toBe(false);
  await host.getByRole("button", { name: "End stream" }).click();
  await viewer.close();
});

test("canceling capture startup releases a late source and never opens an invitation", async ({
  page
}) => {
  await prepare(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Create a room" }).click();
  await page.evaluate(() => {
    const capture = navigator.mediaDevices.getDisplayMedia;
    navigator.mediaDevices.getDisplayMedia = async (options) => {
      const stream = await capture.call(navigator.mediaDevices, options);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return stream;
    };
  });
  await page.getByLabel("Username", { exact: true }).fill("Host");
  await page.getByLabel("Stream password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Share screen" }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { testCapture: MediaStream | null }).testCapture
          ?.getTracks()
          .every((track) => track.readyState === "ended")
      )
    )
    .toBe(true);
  await expect(page.getByLabel("Private invitation")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Share screen" })
  ).toBeEnabled();
});

test("attendees publish simultaneously; everyone selects streams; stop, restart and leave clean up", async ({
  browser,
  page: host
}, testInfo) => {
  const errors: string[] = [];
  const invitation = await hostStream(host);
  const alice = await browser.newPage();
  const bob = await browser.newPage();
  for (const page of [host, alice, bob])
    page.on("pageerror", (error) => errors.push(error.message));
  await connect(alice, invitation, password, "Alice");
  await receiveAudioVideo(alice);
  await connect(bob, invitation, password, "Bob");
  await receiveAudioVideo(bob);
  await alice.getByRole("button", { name: "Share screen" }).click();
  await bob.getByRole("button", { name: "Share screen" }).click();
  for (const page of [host, alice, bob]) {
    await expect(page.locator(".viewer-list li")).toHaveCount(3);
    await expect(
      page.getByRole("button", { name: "Watch Alice", exact: true })
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Watch Bob", exact: true })
    ).toBeEnabled();
  }
  await host.getByRole("button", { name: "Watch Alice", exact: true }).click();
  await bob.getByRole("button", { name: "Watch Alice", exact: true }).click();
  await alice.getByRole("button", { name: "Watch Bob", exact: true }).click();
  for (const page of [host, alice, bob]) await receiveAudioVideo(page, true);
  // Verify the selected player's exact track is receiving frames, not another mesh stream.
  for (const page of [host, alice, bob]) {
    await expect
      .poll(() =>
        page
          .locator("video")
          .evaluate((video: HTMLVideoElement) => video.currentTime)
      )
      .toBeGreaterThan(0);
    expect(
      await page
        .locator("video")
        .evaluate((video: HTMLVideoElement) => video.muted)
    ).toBe(false);
  }
  await host.getByRole("button", { name: "Watch Host", exact: true }).click();
  expect(
    await host
      .locator("video")
      .evaluate((video: HTMLVideoElement) => video.muted)
  ).toBe(true);
  await host.getByRole("button", { name: "Watch Bob", exact: true }).click();
  await receiveAudioVideo(host, true);
  await host.screenshot({
    path: testInfo.outputPath("active-desktop.png"),
    fullPage: true
  });
  await bob.setViewportSize({ width: 390, height: 960 });
  expect(
    await bob.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
  ).toBe(true);
  await bob.screenshot({
    path: testInfo.outputPath("active-mobile.png"),
    fullPage: true
  });
  await alice
    .getByRole("button", { name: "Stop sharing", exact: true })
    .click();
  await expect(
    bob.getByRole("button", { name: "Not sharing: Alice", exact: true })
  ).toBeDisabled();
  await expect
    .poll(() =>
      alice.evaluate(() =>
        (window as unknown as { testCapture: MediaStream }).testCapture
          .getTracks()
          .every((track) => track.readyState === "ended")
      )
    )
    .toBe(true);
  await receiveAudioVideo(bob, true); // Falls back to the host.
  await alice.getByRole("button", { name: "Share screen" }).click();
  await host.getByRole("button", { name: "Watch Alice", exact: true }).click();
  await receiveAudioVideo(host, true);
  await alice
    .getByRole("button", { name: "Leave stream", exact: true })
    .click();
  await expect(host.locator(".viewer-list li")).toHaveCount(2);
  await expect(bob.locator(".viewer-list li")).toHaveCount(2);
  await expect
    .poll(() =>
      alice.evaluate(() =>
        (window as unknown as { testCapture: MediaStream }).testCapture
          .getTracks()
          .every((track) => track.readyState === "ended")
      )
    )
    .toBe(true);
  await host.getByRole("button", { name: "End stream" }).click();
  await expect(
    bob.getByRole("heading", { name: "That’s a wrap." })
  ).toBeVisible();
  await expect
    .poll(() =>
      bob.evaluate(() =>
        (window as unknown as { testCapture: MediaStream }).testCapture
          .getTracks()
          .every((track) => track.readyState === "ended")
      )
    )
    .toBe(true);
  expect(errors).toEqual([]);
  await alice.close();
  await bob.close();
});

test("attendee video-only sharing and canceled startup preserve watching and release late tracks", async ({
  browser,
  page: host
}) => {
  const invitation = await hostStream(host);
  const viewer = await browser.newPage();
  await prepare(viewer, false);
  await viewer.goto(invitation);
  await viewer.getByLabel("Username", { exact: true }).fill("Guest");
  await viewer.getByLabel("Password", { exact: true }).fill(password);
  await viewer.getByRole("button", { name: "Connect to stream" }).click();
  await receiveAudioVideo(viewer);
  await viewer.getByRole("button", { name: "Share screen" }).click();
  await expect(viewer.getByTestId("audio-sharing-notice")).toBeVisible();
  await expect(
    host.getByRole("button", { name: "Watch Guest", exact: true })
  ).toBeVisible();
  await host.getByRole("button", { name: "Watch Guest", exact: true }).click();
  await expect
    .poll(() =>
      host.locator("video").evaluate((video: HTMLVideoElement) => ({
        width: video.videoWidth,
        playing: video.currentTime > 0,
        audioTracks: (video.srcObject as MediaStream).getAudioTracks().length
      }))
    )
    .toEqual({ width: 1920, playing: true, audioTracks: 0 });
  await viewer
    .getByRole("button", { name: "Stop sharing", exact: true })
    .click();
  await expect(viewer.getByTestId("audio-sharing-notice")).toHaveCount(0);
  await receiveAudioVideo(viewer);
  await expect(
    host.getByRole("button", { name: "Not sharing: Guest", exact: true })
  ).toBeDisabled();
  await viewer.getByRole("button", { name: "Leave stream" }).click();
  await connect(viewer, invitation, password, "Guest");
  await receiveAudioVideo(viewer);
  await viewer.evaluate(() => {
    const capture = navigator.mediaDevices.getDisplayMedia;
    navigator.mediaDevices.getDisplayMedia = async (options) => {
      const stream = await capture.call(navigator.mediaDevices, options);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return stream;
    };
  });
  await viewer.getByRole("button", { name: "Share screen" }).click();
  await viewer
    .getByRole("button", { name: "Cancel sharing", exact: true })
    .click();
  await expect
    .poll(() =>
      viewer.evaluate(() =>
        (window as unknown as { testCapture: MediaStream }).testCapture
          .getTracks()
          .every((track) => track.readyState === "ended")
      )
    )
    .toBe(true);
  await receiveAudioVideo(viewer);
  await expect(
    host.getByRole("button", { name: "Not sharing: Guest", exact: true })
  ).toBeDisabled();
  await host.getByRole("button", { name: "End stream" }).click();
  await viewer.close();
});

test("quality changes affect real video per viewer and publisher; connection indicators update", async ({
  browser,
  page: host
}, testInfo) => {
  const invitation = await hostStream(host);
  const alice = await browser.newPage();
  const bob = await browser.newPage();
  await connect(alice, invitation, password, "Alice");
  await connect(bob, invitation, password, "Bob");
  await receiveAudioVideo(alice);
  await receiveAudioVideo(bob);
  await expect(
    host.locator(".network-status").filter({ hasText: "Your upload" })
  ).not.toContainText("Waiting for viewers");
  await expect(
    alice.locator(".network-status").filter({ hasText: "Streamer’s upload" })
  ).not.toContainText("Awaiting streamer stats");
  await expect(
    host.locator(".network-status").filter({ hasText: "Your upload" })
  ).not.toContainText("Measuring");
  await expect(
    alice.locator(".network-status").filter({ hasText: "Your connection" })
  ).not.toContainText("Measuring");
  await expect(
    alice.locator(".network-status").filter({ hasText: "Streamer’s upload" })
  ).not.toContainText("Measuring");
  await alice
    .getByLabel("Playback quality", { exact: true })
    .selectOption("480p");
  const height = (page: Page) =>
    page
      .locator("video")
      .evaluate((video: HTMLVideoElement) => video.videoHeight);
  await expect.poll(() => height(alice)).toBe(480);
  await expect.poll(() => height(bob)).toBe(1080);
  await host.getByLabel("Stream quality", { exact: true }).selectOption("720p");
  await expect.poll(() => height(bob)).toBe(720);
  await expect.poll(() => height(alice)).toBe(480);
  await alice
    .getByLabel("Playback quality", { exact: true })
    .selectOption("source");
  await expect.poll(() => height(alice)).toBe(720);
  await host
    .getByLabel("Stream quality", { exact: true })
    .selectOption("source");
  await receiveAudioVideo(alice);
  await receiveAudioVideo(bob);
  await alice.getByRole("button", { name: "Share screen" }).click();
  await alice
    .getByLabel("Stream quality", { exact: true })
    .selectOption("480p");
  await host.getByRole("button", { name: "Watch Alice", exact: true }).click();
  await expect.poll(() => height(host)).toBe(480);
  await host.screenshot({
    path: testInfo.outputPath("quality-desktop.png"),
    fullPage: true
  });
  await bob.setViewportSize({ width: 390, height: 960 });
  await bob.locator(".network-status summary").first().click();
  expect(
    await bob.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
  ).toBe(true);
  await bob.screenshot({
    path: testInfo.outputPath("quality-mobile.png"),
    fullPage: true
  });
  await host.getByRole("button", { name: "End stream" }).click();
  await alice.close();
  await bob.close();
});

test("advanced stream settings apply live per viewer, respect audio ceilings, and survive restart", async ({
  browser,
  page: host
}, testInfo) => {
  const invitation = await hostStream(host);
  await host.getByText("Advanced stream settings", { exact: true }).click();
  await host.locator("#publish-quality-priority").selectOption("motion");
  await host.locator("#publish-quality-audio").selectOption("standard");
  const alice = await browser.newPage();
  const bob = await browser.newPage();
  await connect(alice, invitation, password, "Alice");
  await receiveAudioVideo(alice);
  await connect(bob, invitation, password, "Bob");
  await receiveAudioVideo(bob);
  const settings = (page: Page) =>
    page.evaluate(() => {
      const { testPeers } = window as unknown as {
        testPeers: RTCPeerConnection[];
      };
      return testPeers
        .filter((pc) => pc.connectionState === "connected")
        .flatMap((pc) => {
          const senders = pc.getSenders();
          const video = senders.find(
            (sender) => sender.track?.kind === "video"
          );
          const audio = senders.find(
            (sender) => sender.track?.kind === "audio"
          );
          return video && audio
            ? [
                {
                  priority: video.getParameters().degradationPreference,
                  audio: audio.getParameters().encodings[0].maxBitrate
                }
              ]
            : [];
        })
        .sort((a, b) => (a.audio ?? 0) - (b.audio ?? 0));
    });
  await expect
    .poll(() => settings(host))
    .toEqual([
      { priority: "maintain-framerate", audio: 128000 },
      { priority: "maintain-framerate", audio: 128000 }
    ]);
  await alice.getByText("Advanced playback settings", { exact: true }).click();
  await alice.locator("#playback-quality-priority").selectOption("detail");
  await alice.locator("#playback-quality-audio").selectOption("low");
  await expect
    .poll(() => settings(host))
    .toEqual([
      { priority: "maintain-resolution", audio: 64000 },
      { priority: "maintain-framerate", audio: 128000 }
    ]);
  await host.locator("#publish-quality-priority").selectOption("balanced");
  await host.locator("#publish-quality-audio").selectOption("low");
  await expect
    .poll(async () =>
      (await settings(host)).sort((a, b) =>
        String(a.priority).localeCompare(String(b.priority))
      )
    )
    .toEqual([
      { priority: "balanced", audio: 64000 },
      { priority: "maintain-resolution", audio: 64000 }
    ]);
  await host.locator("#publish-quality-audio").selectOption("high");
  await expect
    .poll(() => settings(host))
    .toEqual([
      { priority: "maintain-resolution", audio: 64000 },
      { priority: "balanced", audio: 192000 }
    ]);
  await alice.locator("#playback-quality-priority").selectOption("streamer");
  await host.getByRole("button", { name: "Stop sharing", exact: true }).click();
  await expect(
    alice.getByRole("button", { name: "Not sharing: Host", exact: true })
  ).toBeDisabled();
  await host.getByRole("button", { name: "Share screen", exact: true }).click();
  await receiveAudioVideo(alice);
  await receiveAudioVideo(bob);
  await expect
    .poll(() => settings(host))
    .toEqual([
      { priority: "balanced", audio: 64000 },
      { priority: "balanced", audio: 192000 }
    ]);
  // An attendee can independently configure their own outgoing stream.
  await alice.getByText("Advanced stream settings", { exact: true }).click();
  await alice.locator("#publish-quality-priority").selectOption("motion");
  await alice.locator("#publish-quality-audio").selectOption("standard");
  await alice
    .getByRole("button", { name: "Share screen", exact: true })
    .click();
  await host.getByRole("button", { name: "Watch Alice", exact: true }).click();
  await receiveAudioVideo(host, true);
  await expect
    .poll(() => settings(alice))
    .toEqual([
      { priority: "maintain-framerate", audio: 128000 },
      { priority: "maintain-framerate", audio: 128000 }
    ]);
  await host.getByText("Advanced playback settings", { exact: true }).click();
  await host.locator("#playback-quality-priority").selectOption("detail");
  await host.locator("#playback-quality-audio").selectOption("low");
  await expect
    .poll(() => settings(alice))
    .toEqual([
      { priority: "maintain-resolution", audio: 64000 },
      { priority: "maintain-framerate", audio: 128000 }
    ]);
  await host.screenshot({
    path: testInfo.outputPath("advanced-desktop.png"),
    fullPage: true
  });
  await alice.setViewportSize({ width: 390, height: 960 });
  const playback = alice
    .locator(".advanced-settings")
    .filter({ hasText: "Advanced playback settings" });
  if ((await playback.getAttribute("open")) === null)
    await playback.locator("summary").click();
  expect(
    await alice.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await alice.screenshot({
    path: testInfo.outputPath("advanced-mobile.png"),
    fullPage: true
  });
  await host.getByRole("button", { name: "End stream", exact: true }).click();
  await alice.close();
  await bob.close();
});

test("returning to the landing page ends the room and releases capture", async ({
  browser,
  page: host
}) => {
  const invitation = await hostStream(host);
  const viewer = await browser.newPage();
  await connect(viewer, invitation);
  await receiveAudioVideo(viewer);
  await host.evaluate(() => {
    window.location.hash = "";
  });
  await expect(host.getByRole("link", { name: "Create a room" })).toBeVisible();
  await expect(
    viewer.getByRole("heading", { name: "That’s a wrap." })
  ).toBeVisible();
  expect(
    await host.evaluate(() =>
      (window as unknown as { testCapture: MediaStream }).testCapture
        .getTracks()
        .every((track) => track.readyState === "ended")
    )
  ).toBe(true);
  await viewer.close();
});

test("WebSocket auth and roster work without ICE; one automatic restart and sanitized failure diagnostics", async ({
  browser,
  page: host
}, testInfo) => {
  const blockIce = async (page: Page) =>
    page.addInitScript(() => {
      const proto = RTCPeerConnection.prototype;
      proto.addIceCandidate = async () => {};
      const setRemote = proto.setRemoteDescription as (
        this: RTCPeerConnection,
        description: RTCSessionDescriptionInit
      ) => Promise<void>;
      proto.setRemoteDescription = function (description) {
        return setRemote.call(this, {
          ...description,
          sdp: description.sdp?.replace(/^a=candidate:.*\r?\n/gm, "")
        });
      };
      const createOffer = proto.createOffer as (
        this: RTCPeerConnection,
        options?: RTCOfferOptions
      ) => Promise<RTCSessionDescriptionInit>;
      Object.assign(window, { testRestarts: 0 });
      proto.createOffer = function (
        this: RTCPeerConnection,
        options?: RTCOfferOptions
      ) {
        if (options?.iceRestart)
          (window as unknown as { testRestarts: number }).testRestarts++;
        return createOffer.call(this, options);
      } as typeof proto.createOffer;
    });
  await blockIce(host);
  const invitation = await hostStream(host);
  const viewer = await browser.newPage();
  await blockIce(viewer);
  await connect(viewer, invitation);
  await expect(
    viewer.getByText("Joined as Alice", { exact: true })
  ).toBeVisible();
  await expect(viewer.locator(".viewer-list li")).toHaveCount(2);
  await expect(host.locator(".viewer-list li")).toHaveCount(2);
  expect(
    await viewer
      .locator("video")
      .evaluate((video: HTMLVideoElement) => video.videoWidth)
  ).toBe(0);
  await host
    .getByRole("tab", { name: "Advanced Diagnostics", exact: true })
    .click();
  await expect(host.getByRole("tabpanel")).toContainText(
    /open · (local test WS|secure WSS)/
  );
  await host.evaluate(() => {
    const pc = (window as unknown as { testPeers: RTCPeerConnection[] })
      .testPeers[0];
    pc.dispatchEvent(
      Object.assign(new Event("icecandidateerror"), {
        errorCode: 701,
        address: "192.0.2.222",
        errorText: "secret-proof-token",
        url: "stun:2001:db8::123"
      })
    );
    Object.defineProperty(pc, "iceConnectionState", {
      configurable: true,
      get: () => "failed"
    });
    pc.dispatchEvent(new Event("iceconnectionstatechange"));
    pc.dispatchEvent(new Event("iceconnectionstatechange"));
  });
  await expect
    .poll(() =>
      host.evaluate(
        () => (window as unknown as { testRestarts: number }).testRestarts
      )
    )
    .toBe(1);
  await expect(host.getByRole("tabpanel")).toContainText("may require TURN");
  await expect(host.getByRole("tabpanel")).toContainText("1 / 1");
  await host.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: async (text: string) =>
        Object.assign(window, { copiedDiagnostics: text })
    });
  });
  await host.getByRole("button", { name: "Copy diagnostics" }).click();
  const json = await host.evaluate(
    () => (window as unknown as { copiedDiagnostics: string }).copiedDiagnostics
  );
  expect(JSON.parse(json).connections[0].iceErrors).toContain(701);
  expect(JSON.parse(json).connections[0].iceRestartCount).toBe(1);
  for (const forbidden of [
    "192.0.2.222",
    "2001:db8",
    "secret-proof-token",
    "a=ice-ufrag",
    '"mac"',
    '"proof"',
    '"password"',
    invitation
  ])
    expect(json).not.toContain(forbidden);
  // The retry deadline closes only this media link; auth and roster survive.
  await expect
    .poll(
      () =>
        host.evaluate(
          () =>
            (window as unknown as { testPeers: RTCPeerConnection[] })
              .testPeers[0].signalingState
        ),
      { timeout: 30_000 }
    )
    .toBe("closed");
  await expect(host.getByRole("tabpanel")).toContainText("failed attempt");
  await expect(host.locator(".viewer-list li")).toHaveCount(2);
  expect(
    await host.evaluate(
      () => (window as unknown as { testRestarts: number }).testRestarts
    )
  ).toBe(1);
  await host.setViewportSize({ width: 390, height: 960 });
  expect(
    await host.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await host.screenshot({
    path: testInfo.outputPath("diagnostics-failure-mobile.png"),
    fullPage: true
  });
  await host.getByRole("button", { name: "End stream" }).click();
  await viewer.close();
});

test("connected diagnostics contain selected pair and metrics; signaling loss closes media", async ({
  browser,
  page: host
}, testInfo) => {
  const invitation = await hostStream(host);
  const viewer = await browser.newPage();
  await connect(viewer, invitation);
  await receiveAudioVideo(viewer);
  await viewer
    .getByRole("tab", { name: "Advanced Diagnostics", exact: true })
    .click();
  const panel = viewer.getByRole("tabpanel");
  await expect(panel).toContainText("Direct P2P connected.");
  await expect
    .poll(() => panel.locator("dd").allTextContents())
    .toContain("1920 × 1080");
  await expect(
    panel
      .locator("div")
      .filter({
        has: viewer.locator("dt", { hasText: "Selected ICE candidate pair" })
      })
      .last()
  ).toContainText("udp");
  await expect(
    panel
      .locator("div")
      .filter({ has: viewer.locator("dt", { hasText: "Video bitrate" }) })
      .last()
  ).toContainText("Mbps");
  await viewer.screenshot({
    path: testInfo.outputPath("diagnostics-connected-desktop.png"),
    fullPage: true
  });
  await viewer.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: async () => {
        throw new Error("Permission denied");
      }
    });
  });
  await viewer.getByRole("button", { name: "Copy diagnostics" }).click();
  const exported = JSON.parse(
    await viewer.getByLabel("Sanitized diagnostics JSON").inputValue()
  );
  expect(exported.connections[0].selectedPair.local.address).toBe("[redacted]");
  expect(exported.connections[0].metrics.videoBitrateMbps).toBeGreaterThan(0);
  await viewer.evaluate(() =>
    (window as unknown as { testSockets: WebSocket[] }).testSockets
      .find((socket) => socket.url.includes("/peerjs?"))!
      .close()
  );
  await expect(viewer.locator(".problem")).toContainText(
    "WebSocket signaling disconnected"
  );
  expect(
    await viewer.evaluate(() =>
      (window as unknown as { testPeers: RTCPeerConnection[] }).testPeers.every(
        (pc) => pc.connectionState === "closed"
      )
    )
  ).toBe(true);
  await expect(panel).toContainText("failed");
  await host.getByRole("button", { name: "End stream" }).click();
  await viewer.close();
});

test("a receiver requests one publisher ICE restart and real media recovers", async ({
  browser,
  page: host
}) => {
  const invitation = await hostStream(host);
  const viewer = await browser.newPage();
  await connect(viewer, invitation);
  await receiveAudioVideo(viewer);
  await host.evaluate(() => {
    const pc = (window as unknown as { testPeers: RTCPeerConnection[] })
      .testPeers[0];
    const offer = pc.createOffer.bind(pc);
    Object.assign(window, { testRestarts: 0 });
    pc.createOffer = ((options?: RTCOfferOptions) => {
      if (options?.iceRestart)
        (window as unknown as { testRestarts: number }).testRestarts++;
      return offer(options);
    }) as typeof pc.createOffer;
  });
  const failReceiver = () =>
    viewer.evaluate(() => {
      const pc = (window as unknown as { testPeers: RTCPeerConnection[] })
        .testPeers[0];
      Object.defineProperty(pc, "iceConnectionState", {
        configurable: true,
        value: "failed"
      });
      pc.dispatchEvent(new Event("iceconnectionstatechange"));
      Reflect.deleteProperty(pc, "iceConnectionState");
    });
  await failReceiver();
  await expect
    .poll(() =>
      host.evaluate(
        () => (window as unknown as { testRestarts: number }).testRestarts
      )
    )
    .toBe(1);
  await viewer.getByRole("tab", { name: "Advanced Diagnostics" }).click();
  await expect(viewer.getByRole("tabpanel")).toContainText("1 / 1");
  await expect(viewer.getByRole("tabpanel")).toContainText(
    "Direct P2P connected."
  );
  await receiveAudioVideo(viewer);
  await failReceiver();
  await viewer.waitForTimeout(300);
  expect(
    await host.evaluate(
      () => (window as unknown as { testRestarts: number }).testRestarts
    )
  ).toBe(1);
  await host.getByRole("button", { name: "End stream" }).click();
  await viewer.close();
});
