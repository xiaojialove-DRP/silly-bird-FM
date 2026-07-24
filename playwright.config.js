import { defineConfig } from "@playwright/test";

// This suite talks to the real Supabase backend (same as every manual check this
// project has ever relied on) — no mocking layer. It exercises the actual create →
// share → listen → revoke journey, and revoke is the cleanup: a passing run leaves
// no cloud data behind.
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5174",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5174",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
