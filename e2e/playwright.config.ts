import { defineConfig, devices } from "@playwright/test";

/**
 * E2E suite for retro. Runs against an already-running stack (docker compose):
 *   E2E_BASE_URL  base of the Caddy entrypoint (default http://localhost:8082)
 * The API lives under <base>/api, the MCP endpoint at <base>/mcp, the widget at
 * <base>/widget.js and public boards at <base>/b/<slug>.
 */
export const BASE_URL = process.env.E2E_BASE_URL?.replace(/\/$/, "") || "http://localhost:8082";

export default defineConfig({
  globalSetup: "./global-setup.ts",
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Files share nothing (each creates its own account), but several tests within
  // a file reuse one account/session, so keep each file sequential.
  fullyParallel: false,
  workers: process.env.CI ? 2 : undefined,
  forbidOnly: !!process.env.CI,
  retries: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  outputDir: "test-results",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // The widget specs load /widget.js into a page on another loopback origin.
        // Chrome's Private/Local Network Access checks block (or prompt for) such
        // loopback requests, which headless can only deny; real customer sites on
        // the public internet reaching retro.3m4.net are not affected.
        launchOptions: {
          args: [
            "--disable-features=PrivateNetworkAccessChecks,PrivateNetworkAccessPermissionPrompt,PrivateNetworkAccessSendPreflights,LocalNetworkAccessChecks,LocalNetworkAccessPermissionPrompt",
          ],
        },
      },
    },
  ],
});
