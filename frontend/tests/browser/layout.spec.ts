import { test, expect } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`host and invitation are usable at ${width}px`, async ({
    page
  }, testInfo) => {
    await page.setViewportSize({ width, height: 960 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Start a stream", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Share screen & audio" })
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
    await expect(page.getByLabel("Audio quality", { exact: true })).toHaveValue(
      "high"
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("host.png"),
      fullPage: true
    });
    await page.goto("/#room=ps-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
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
