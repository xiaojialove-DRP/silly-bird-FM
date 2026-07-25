import { defineConfig } from "@playwright/test";

// This suite talks to the real Supabase backend (same as every manual check this
// project has ever relied on) — no mocking layer. It exercises the actual create →
// share → listen → revoke journey, and revoke is the cleanup: a passing run leaves
// no cloud data behind.
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  fullyParallel: false,
  // one at a time on purpose: anonymous sign-ins are rate limited per project, and
  // parallel workers burst enough of them to start getting 429s — which shows up as
  // unrelated-looking failures in whichever test happened to need an identity
  workers: 1,
  // anonymous sign-ins also have a short-window burst limit, and a run that trips it
  // fails with a truthful "could not reach the sign-in service" that says nothing
  // about the code. One retry rides that out without hiding a real regression, which
  // would fail again on the second attempt.
  retries: 1,
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
