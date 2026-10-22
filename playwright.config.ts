import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173/naksaeng/bunfirvil/";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  // GitHub's software WebGL runner needs more time than a local GPU for four
  // full structure rebuilds, 83 lazy palette previews and both 3D drag paths.
  // Hosted runners can reach the final review actions only after 16 minutes,
  // while local GPU runs finish in about six, so keep separate bounded gates.
  timeout: process.env.CI ? 1_800_000 : 600_000,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    trace: "retain-on-failure",
    launchOptions: {
      args: ["--use-gl=swiftshader", "--enable-webgl"],
    },
  },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1 --port 4173",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
