import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;

/**
 * E2E runs against a production build with the mock inference layer, with
 * random failures disabled (scenarios are forced per test via `?mock=`) and
 * step latency sped up 4x so the suite stays fast.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  // Generations default to 50 steps and batches scale with image count, so give results room to arrive.
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "desktop-webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: {
      MOCK_COLD_START_RATE: "0",
      MOCK_ERROR_RATE: "0",
      MOCK_SPEED: "4",
      INFERENCE_API_URL: "",
    },
  },
});
