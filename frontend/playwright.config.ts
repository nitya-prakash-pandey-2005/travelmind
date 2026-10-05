import { defineConfig, devices } from "@playwright/test";

// Local overrides (unset in CI): PLAYWRIGHT_BASE_URL points the tests at another dev server, e.g. a second
// Vite on :5174 proxying to a dedicated API; PLAYWRIGHT_CHANNEL=chrome uses the installed Chrome instead of
// the bundled Chromium.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";
const channel = process.env.PLAYWRIGHT_CHANNEL;
// CI runners have no GPU, so WebGL falls back to software rendering, where the 3D globe (polygon countries, flying
// planes and a render loop every frame) is slow enough to time the e2e job out. With the 3D APIs off, the app's
// WebGL check fails and every map renders as its flat-map fallback, which is what CI then exercises.
const ciArgs = process.env.CI ? ["--disable-3d-apis"] : [];

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  // Two workers locally as in CI: at the default (about 6 parallel browsers) this machine's Docker Postgres and
  // Redis get starved and tests time out.
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], ...(channel ? { channel } : {}), launchOptions: { args: ciArgs } },
    },
  ],
  // The API must already be running on TM_API_TARGET (default http://localhost:8010).
  webServer: {
    command: `npm run dev -- --port ${new URL(baseURL).port || "5173"}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
