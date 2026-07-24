import { test, expect } from "@playwright/test";

// The bug this guards: a REJECTED token refresh (not just an unreachable one) used
// to fall straight through to a fresh anonymous signup, overwriting the identity
// that owns everything this browser has already shared. Supabase rejects a refresh
// whenever the token has already been rotated — which is exactly what a second tab
// does — so a perfectly healthy identity could be thrown away for no reason.

const readAuth = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("sbfm-auth") || "null"));

test("a refresh rejected because another tab already rotated it keeps the identity", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => readAuth(page), { timeout: 15_000 }).not.toBeNull();
  const good = await readAuth(page);
  expect(good.refresh_token).toBeTruthy();

  // this load starts with a stale token, so it must refresh
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("sbfm-auth"));
    s.expires_at = Math.floor(Date.now() / 1000) - 3600;
    s.access_token = "stale-copy-held-by-this-tab";
    localStorage.setItem("sbfm-auth", JSON.stringify(s));
  });

  let signupAttempts = 0;
  await page.route("**/auth/v1/signup**", (r) => { signupAttempts++; return r.continue(); });
  // the other tab wins the race: it writes its fresh session to shared storage, and
  // this tab's in-flight refresh comes back rejected because the token moved on
  await page.route("**/auth/v1/token**", async (route) => {
    await page.evaluate((s) => {
      s.expires_at = Math.floor(Date.now() / 1000) + 3600;
      s.access_token = "fresh-token-written-by-the-other-tab";
      localStorage.setItem("sbfm-auth", JSON.stringify(s));
    }, good);
    await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "invalid_grant" }) });
  });

  await page.reload();
  await page.waitForTimeout(3000);

  const after = await readAuth(page);
  expect(signupAttempts, "must not mint a new identity when a usable one is in storage").toBe(0);
  expect(after.access_token, "must adopt the session the other tab just stored").toBe("fresh-token-written-by-the-other-tab");
  expect(after.refresh_token, "the owning identity must survive").toBe(good.refresh_token);
});

test("an unreachable auth server never replaces the identity either", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => readAuth(page), { timeout: 15_000 }).not.toBeNull();
  const before = await readAuth(page);

  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("sbfm-auth"));
    s.expires_at = Math.floor(Date.now() / 1000) - 3600;
    localStorage.setItem("sbfm-auth", JSON.stringify(s));
  });

  let signupAttempts = 0;
  await page.route("**/auth/v1/token**", (r) => r.abort("connectionfailed"));
  await page.route("**/auth/v1/signup**", (r) => { signupAttempts++; return r.continue(); });

  await page.reload();
  await page.waitForTimeout(3000);

  expect(signupAttempts, "a network blip is not evidence the identity is dead").toBe(0);
  expect((await readAuth(page)).refresh_token).toBe(before.refresh_token);
});

test("a definitively dead refresh token recovers, and records what was lost", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => readAuth(page), { timeout: 15_000 }).not.toBeNull();
  const before = await readAuth(page);

  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("sbfm-auth"));
    s.expires_at = Math.floor(Date.now() / 1000) - 3600;
    s.refresh_token = "definitely-not-a-valid-refresh-token";
    localStorage.setItem("sbfm-auth", JSON.stringify(s));
  });

  await page.reload();
  await expect
    .poll(async () => (await readAuth(page)).refresh_token !== "definitely-not-a-valid-refresh-token", { timeout: 15_000 })
    .toBe(true);

  expect((await readAuth(page)).access_token, "must end up usable again").toBeTruthy();
  const lost = await page.evaluate(() => JSON.parse(localStorage.getItem("sbfm-auth-lost") || "null"));
  expect(lost, "the orphaned identity must leave a trace").not.toBeNull();
  expect(lost.session.access_token).toBe(before.access_token);
});
