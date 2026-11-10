// Browser tests of the built site (dist/) in the three engines: Chromium, Firefox and WebKit.
// The engine-independent checks (links, metadata) run once, in Chromium.
import { defineConfig, devices } from "@playwright/test";

const PORT = 8123;
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: ".",
  outputDir: "../test-results",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0, // a retried pass still shows as "flaky" in the report
  reporter: CI ? [["github"], ["list"], ["html", { open: "never", outputFolder: "../playwright-report" }]] : "list",
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  webServer: {
    command: `node scripts/serve.mjs --port ${PORT}`,
    cwd: "..",
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !CI,
  },
  projects: [
    { name: "chromium", testMatch: "site.spec.mjs", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", testMatch: "site.spec.mjs", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", testMatch: "site.spec.mjs", use: { ...devices["Desktop Safari"] } },
    { name: "static", testMatch: "static.spec.mjs", use: { ...devices["Desktop Chrome"] } },
  ],
});
