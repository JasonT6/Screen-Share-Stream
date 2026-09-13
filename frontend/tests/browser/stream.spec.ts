import { test, expect, type Page } from "@playwright/test";

const password = "a";

// Only the screen picker is substituted. Media travels over real browser
// RTCPeerConnections; the receive tests inspect decoded frames and RTP bytes.
async function prepare(page: Page, withAudio = true) {
  await page.addInitScript(
    ({ withAudio }) => {
      const pcs: RTCPeerConnection[] = [];
      const NativePeerConnection = window.RTCPeerConnection;
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
  await page.getByLabel("Username", { exact: true }).fill("Host");
  await page.getByLabel("Stream password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Share screen & audio" }).click();
  await expect(page.getByLabel("Private invitation")).toBeVisible();
  return page.getByLabel("Private invitation").inputValue();
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
  expect(invitation).toMatch(/#room=ps-[a-f0-9]{32}$/);
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
  await viewer.getByLabel("Password", { exact: true }).fill(password);
  await viewer.getByRole("button", { name: "Try again" }).click();
  await receiveAudioVideo(viewer);
  const second = await browser.newPage();
  await connect(second, invitation, password, "Bob");
  await receiveAudioVideo(second);
  await expect(host.locator(".viewer-list li")).toHaveCount(3);
  await expect(
    viewer.getByRole("button", { name: "Share screen & audio" })
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
  await host.getByRole("button", { name: "Share screen & audio" }).click();
  await expect(host.getByLabel("Private invitation")).toBeVisible();
  expect(await host.getByLabel("Private invitation").inputValue()).not.toBe(
    invitation
  );
  await host.getByRole("button", { name: "End stream" }).click();
  expect(errors).toEqual([]);
  await viewer.close();
  await second.close();
});

test("missing audio releases the screen and prevents going live", async ({
  page
}) => {
  await prepare(page, false);
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("Host");
  await page.getByLabel("Stream password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Share screen & audio" }).click();
  await expect(page.locator(".problem")).toContainText(
    "No shared audio was captured"
  );
  await expect(page.getByLabel("Private invitation")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (window as unknown as { testCapture: MediaStream }).testCapture
        .getTracks()
        .every((track) => track.readyState === "ended")
    )
  ).toBe(true);
});

test("invalid invitations and offline hosts have actionable errors", async ({
  page
}) => {
  await page.goto("/#room=invalid");
  await expect(
    page.getByRole("heading", { name: "This invitation isn’t valid." })
  ).toBeVisible();
  await connect(page, "/#room=ps-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  await expect(page.locator(".problem")).toContainText("host is offline");
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
    host.getByRole("button", { name: "Share screen & audio" })
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
  await page.getByRole("button", { name: "Share screen & audio" }).click();
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
    page.getByRole("button", { name: "Share screen & audio" })
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
  await alice.getByRole("button", { name: "Share screen & audio" }).click();
  await bob.getByRole("button", { name: "Share screen & audio" }).click();
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
  await alice.getByRole("button", { name: "Share screen & audio" }).click();
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

test("attendee capture failure and canceled startup preserve watching and release late tracks", async ({
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
  await viewer.getByRole("button", { name: "Share screen & audio" }).click();
  await expect(viewer.locator(".problem")).toContainText(
    "No shared audio was captured"
  );
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
  await viewer.getByRole("button", { name: "Share screen & audio" }).click();
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
