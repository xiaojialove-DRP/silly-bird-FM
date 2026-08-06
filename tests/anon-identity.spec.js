import { test, expect } from "@playwright/test";

// A browser's anonymous identity is what proves it owns the stations it has shared.
// Lose it and those stations become permanently read-only: the link keeps playing,
// but no edit can ever be published to it again. These cover the ways it used to get
// thrown away, all of which surfaced only as a bare "HTTP 400" on sharing.

const readAuth = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("sbfm-auth") || "null"));

// Anonymous sign-ins are a rate-limited, project-wide resource, so spend them only
// where a test genuinely needs the server to honour the credentials. Everything that
// only needs "a session exists in storage" gets a fabricated one for free.
async function seedFakeIdentity(page, tag) {
  await page.goto("/");
  const session = {
    access_token: `fake-access-${tag}`,
    refresh_token: `fake-refresh-${tag}`,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  };
  await page.evaluate((s) => localStorage.setItem("sbfm-auth", JSON.stringify(s)), session);
  return session;
}

// Loading the app deliberately does not claim an identity (most visitors only ever
// listen), so tests that need a genuinely valid session make one themselves rather
// than waiting on boot to do it.
async function seedIdentity(page) {
  await page.goto("/");
  const cloud = await page.evaluate(() => window.SBFM_CLOUD);
  const r = await fetch(`${cloud.url}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: cloud.anonKey, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok) throw new Error(`could not seed an anonymous identity: HTTP ${r.status}`);
  const session = await r.json();
  await page.evaluate((s) => localStorage.setItem("sbfm-auth", JSON.stringify(s)), session);
  return session;
}

function tinyWavBuffer() {
  const rate = 8000, n = 2400;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 6000), 44 + i * 2);
  return buf;
}

// something worth uploading, so that sharing actually reaches the network
async function giveStationATrack(page, label) {
  // fresh boot with no station yet tunes away from the empty "mine" slot (see
  // boot() in main.js) - dialMid only opens winStation for that slot. Every
  // current caller goes straight from a fresh page.goto() to here, so this is
  // always undoing that same tune - not safe to call from a page already
  // tuned elsewhere.
  await page.locator("#tprev").click();
  await page.locator("#dialMid").click();
  await page.locator("#chNameInput").fill(`${label} ${Date.now() % 100000}`);
  await page.setInputFiles("#filepick", { name: "t.wav", mimeType: "audio/wav", buffer: tinyWavBuffer() });
  await expect(page.locator("#trackList .track-row")).toHaveCount(1);
  await page.locator("#stationSave").click();
}

// sharing is the moment an identity is actually needed
const share = (page) => page.locator("#openShareBtn").click();

async function expireStoredToken(page, extra = {}) {
  return page.evaluate((patch) => {
    const s = JSON.parse(localStorage.getItem("sbfm-auth"));
    s.expires_at = Math.floor(Date.now() / 1000) - 3600;
    Object.assign(s, patch);
    localStorage.setItem("sbfm-auth", JSON.stringify(s));
    return s.access_token;
  }, extra);
}

// A radio gets left open for hours, but an access token lasts about one. The session
// used to be resolved once and never revisited, so writes went out signed with a
// long-dead token — and because that result was memoized, the tab never recovered.
test("a token that expires while the tab is open is renewed before the next write", async ({ page }) => {
  await seedIdentity(page);
  await giveStationATrack(page, "Expiry");
  const stale = await expireStoredToken(page);

  let renewals = 0;
  await page.route("**/auth/v1/token**", (r) => { renewals++; return r.continue(); });

  await share(page);
  await expect(page.locator("#shareLinkBox")).toBeVisible({ timeout: 20_000 });

  expect(renewals, "an expired session must be renewed, not used as-is").toBeGreaterThan(0);
  const after = await readAuth(page);
  expect(after.access_token, "storage must hold the renewed token").not.toBe(stale);
  expect(after.expires_at * 1000, "and it must actually be valid again").toBeGreaterThan(Date.now());

  // no standalone "revoke now" button anymore - schedule the shortest
  // duration and stand in for that time passing directly in localStorage
  await page.locator("#shareTtlSelect").selectOption("1d");
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("sbfm-station"));
    saved.shareExpiresAt = Date.now() - 60_000;
    localStorage.setItem("sbfm-station", JSON.stringify(saved));
  });
  await page.reload();
  await expect(page.locator("#shareLinkBox")).toBeHidden({ timeout: 15_000 });
});

// Supabase rejects a refresh whenever the token has already been rotated, which is
// exactly what a second tab does. That rejection used to fall straight through to a
// fresh signup, discarding a perfectly healthy identity over a race.
test("a refresh rejected because another tab already rotated it keeps the identity", async ({ page }) => {
  const good = await seedFakeIdentity(page, "race");
  await giveStationATrack(page, "Race");
  await expireStoredToken(page, { access_token: "stale-copy-held-by-this-tab" });

  let signupAttempts = 0;
  await page.route("**/auth/v1/signup**", (r) => { signupAttempts++; return r.continue(); });
  // the other tab wins: it stores its fresh session, and this tab's in-flight
  // refresh comes back rejected because the token has moved on
  await page.route("**/auth/v1/token**", async (route) => {
    await page.evaluate((s) => {
      s.expires_at = Math.floor(Date.now() / 1000) + 3600;
      s.access_token = "fresh-token-written-by-the-other-tab";
      localStorage.setItem("sbfm-auth", JSON.stringify(s));
    }, good);
    await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "invalid_grant" }) });
  });

  await share(page);
  await expect.poll(async () => (await readAuth(page)).access_token, { timeout: 15_000 })
    .toBe("fresh-token-written-by-the-other-tab");

  expect(signupAttempts, "must not mint a new identity when a usable one is in storage").toBe(0);
  expect((await readAuth(page)).refresh_token, "the owning identity must survive").toBe(good.refresh_token);
});

test("an unreachable auth server never replaces the identity either", async ({ page }) => {
  const before = await seedFakeIdentity(page, "offline");
  await giveStationATrack(page, "Offline");
  await expireStoredToken(page);

  let signupAttempts = 0;
  await page.route("**/auth/v1/token**", (r) => r.abort("connectionfailed"));
  await page.route("**/auth/v1/signup**", (r) => { signupAttempts++; return r.continue(); });

  await share(page);
  await page.waitForTimeout(4000);

  expect(signupAttempts, "a network blip is not evidence the identity is dead").toBe(0);
  expect((await readAuth(page)).refresh_token, "identity preserved for a later retry").toBe(before.refresh_token);
});

test("a definitively dead refresh token recovers, and records what was lost", async ({ page }) => {
  const before = await seedFakeIdentity(page, "dead");
  await giveStationATrack(page, "Dead");
  await expireStoredToken(page, { refresh_token: "definitely-not-a-valid-refresh-token" });

  await share(page);
  await expect
    .poll(async () => (await readAuth(page)).refresh_token !== "definitely-not-a-valid-refresh-token", { timeout: 20_000 })
    .toBe(true);

  expect((await readAuth(page)).access_token, "must end up usable again").toBeTruthy();
  const lost = await page.evaluate(() => JSON.parse(localStorage.getItem("sbfm-auth-lost") || "null"));
  expect(lost, "the orphaned identity must leave a trace").not.toBeNull();
  expect(lost.session.access_token).toBe(before.access_token);

  // this one recovers far enough to really publish, so clean up after itself -
  // no standalone "revoke now" button anymore, so schedule the shortest
  // duration and stand in for that time passing directly in localStorage
  await expect(page.locator("#shareLinkBox")).toBeVisible({ timeout: 20_000 });
  await page.locator("#shareTtlSelect").selectOption("1d");
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("sbfm-station"));
    saved.shareExpiresAt = Date.now() - 60_000;
    localStorage.setItem("sbfm-station", JSON.stringify(saved));
  });
  await page.reload();
  await expect(page.locator("#shareLinkBox")).toBeHidden({ timeout: 15_000 });
});
