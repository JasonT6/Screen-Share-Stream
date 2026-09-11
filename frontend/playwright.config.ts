import { defineConfig } from "@playwright/test";

// This mode verifies the built artifact with its public signaling defaults.
const staticExport = process.env.TEST_STATIC_EXPORT === "1";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3100",
    browserName: "chromium",
    launchOptions: {
      ...(process.env.BROWSER_EXECUTABLE
        ? { executablePath: process.env.BROWSER_EXECUTABLE }
        : {}),
      args: ["--autoplay-policy=no-user-gesture-required"]
    },
    trace: "retain-on-failure"
  },
  webServer: staticExport
    ? [
        {
          command: "npm start",
          url: "http://localhost:3100",
          reuseExistingServer: false,
          env: { PORT: "3100" }
        }
      ]
    : [
        {
          command: "node tests/fixtures/signaling.mjs",
          url: "http://127.0.0.1:9001/",
          reuseExistingServer: false
        },
        {
          command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
          url: "http://localhost:3100",
          reuseExistingServer: false,
          timeout: 120_000,
          env: {
            NEXT_PUBLIC_PEER_HOST: "127.0.0.1",
            NEXT_PUBLIC_PEER_PORT: "9001",
            NEXT_PUBLIC_PEER_PATH: "/",
            NEXT_PUBLIC_PEER_SECURE: "false"
          }
        }
      ]
});
