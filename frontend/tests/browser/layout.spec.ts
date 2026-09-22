import { test, expect } from "@playwright/test";

for (const theme of ["light", "dark"]) {
  for (const width of [1440, 390]) {
    test(`landing, host and invitation are usable at ${width}px in ${theme} mode`, async ({
      page
    }, testInfo) => {
      await page.setViewportSize({ width, height: 960 });
      await page.addInitScript((theme) => {
        localStorage.setItem("private-stream-theme", theme);
      }, theme);
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(
        page.getByRole("heading", { name: "A screen worth sharing." })
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath("landing.png"),
        fullPage: true
      });
      await page.getByRole("link", { name: "Create a room" }).click();
      await expect(page).toHaveURL(/#create$/);
      await page.goBack();
      await expect(
        page.getByRole("link", { name: "Create a room" })
      ).toBeVisible();
      await page.goForward();
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "Start a stream", exact: true })
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Share screen" })
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      ).toBe(true);
      await page.getByText("Advanced stream settings", { exact: true }).click();
      await expect(
        page.getByLabel("Video priority", { exact: true })
      ).toBeVisible();
      await expect(
        page.getByLabel("Audio quality", { exact: true })
      ).toHaveValue("high");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath("host.png"),
        fullPage: true
      });
      await page.goto(`/#room=ps-${"a".repeat(64)}`);
      await expect(
        page.getByRole("heading", { name: "Join the stream", exact: true })
      ).toBeVisible();
      await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath("invitation.png"),
        fullPage: true
      });
    });
  }
}

test("theme toggles with the keyboard, persists, and preserves room setup", async ({
  page
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#create");
  await page.getByLabel("Username", { exact: true }).fill("Taylor");
  await page.getByLabel("Stream password", { exact: true }).fill("room secret");
  const toggle = page.getByRole("button", { name: "Dark mode", exact: true });
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(0, 0, 0)"
  );
  await expect(page.getByLabel("Username", { exact: true })).toHaveValue(
    "Taylor"
  );
  await expect(page.getByLabel("Stream password", { exact: true })).toHaveValue(
    "room secret"
  );
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(0, 0, 0)"
  );
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(238, 234, 226)"
  );
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(errors).toEqual([]);
});

test("theme remains usable when browser storage is blocked", async ({
  page
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("Storage blocked");
      }
    });
  });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Dark mode", exact: true });
  await toggle.click();
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(0, 0, 0)"
  );
  await toggle.click();
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(238, 234, 226)"
  );
});
