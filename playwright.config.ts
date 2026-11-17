import { defineConfig } from "@playwright/test";

/**
 * Browser integration tests (test/browser): the editor in a real browser,
 * served by Vite. `npm run test:browser`. In CI the bundled Chromium is
 * used (npx playwright install chromium); locally, PW_CHANNEL=chrome or
 * msedge uses an installed browser instead.
 */
export default defineConfig({
  testDir: "test/browser",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "list" : "line",
  use: {
    baseURL: "http://127.0.0.1:4179/",
    channel: process.env.PW_CHANNEL || undefined,
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
    acceptDownloads: true,
  },
  webServer: {
    command: "npx vite --port 4179 --strictPort --host 127.0.0.1",
    url: "http://127.0.0.1:4179/",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
