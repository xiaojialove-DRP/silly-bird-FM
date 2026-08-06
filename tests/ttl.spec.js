import { test, expect } from "@playwright/test";

// Real feedback: friends have used their station as a drift bottle, a
// tree-hollow confession, a mood left for a partner — none of which fit a
// station meant to be curated and kept. First cut put the choice on every
// track (a 7-track upload meant answering the same question 7 times) — this
// is the one-choice-per-share version that replaced it: a single duration,
// set on the share panel, for the one link that actually goes out.

function tinyWavBuffer() {
  const rate = 8000, seconds = 0.3, n = Math.floor(rate * seconds);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.sin((2 * Math.PI * 440 * i) / rate) * 6000;
    buf.writeInt16LE(Math.round(v), 44 + i * 2);
  }
  return buf;
}

async function createAndShare(page, name) {
  await page.goto("/");
  await page.locator("#tprev").click();
  await page.locator("#dialMid").click();
  await page.locator("#chNameInput").fill(name);
  await page.setInputFiles("#filepick", { name: "t.wav", mimeType: "audio/wav", buffer: tinyWavBuffer() });
  await expect(page.locator("#trackList .track-row")).toHaveCount(1);
  await page.locator("#stationSave").click();
  await page.locator("#openShareBtn").click();
  await expect(page.locator("#shareLinkBox")).toBeVisible({ timeout: 15_000 });
  return (await page.locator("#shareLinkText").textContent()).trim();
}

test("picking a duration on the share panel publishes it and survives a reload", async ({ page }) => {
  const name = `PW TTL ${Date.now() % 100000}`;
  const link = await createAndShare(page, name);

  // permanent by default — an existing shared station is unaffected until
  // someone actively reaches for this
  await expect(page.locator("#shareTtlSelect")).toHaveValue("");

  const base = link.split("?listen=")[1] && decodeURIComponent(link.split("?listen=")[1]);
  await page.locator("#shareTtlSelect").selectOption("7d");
  // the select pushes the new deadline live immediately (re-shares), not on
  // some later edit — read the manifest back the same way a friend's browser
  // would, to prove it actually landed. Not asserting on #shareOut's success
  // text here: that branch also tries to copy the link to the clipboard, which
  // headless browsers routinely refuse, and a refusal there is not this test's
  // concern — the manifest is the real, decisive proof either way.
  await expect(async () => {
    const manifest = await (await page.request.get(`${base}/station.json?v=${Date.now()}`)).json();
    expect(manifest.shareTtl).toBe("7d");
    expect(manifest.shareExpiresAt).toBeGreaterThan(Date.now());
  }).toPass({ timeout: 20_000 });

  await page.reload();
  // MY.created is already true from earlier in this same test, so boot() lands
  // straight on the "mine" slot this time (see boot()'s `if (!MY.created) ci
  // = 1`) — tprev first would tune *away* from it, unlike the fresh-boot dance
  // createAndShare() above needs
  await page.locator("#dialMid").click();
  await page.locator("#openShareBtn").click();
  await expect(page.locator("#shareTtlSelect")).toHaveValue("7d");

  // cleanup: already set to "7d" above, just back-date it the same way the
  // dedicated expiry test below does, rather than waiting a week for real
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("sbfm-station"));
    saved.shareExpiresAt = Date.now() - 60_000;
    localStorage.setItem("sbfm-station", JSON.stringify(saved));
  });
  await page.reload();
  await expect(page.locator("#shareLinkBox")).toBeHidden({ timeout: 15_000 });
});

test("a share past its own deadline is revoked for real, quietly, on the next boot", async ({ page }) => {
  const name = `PW Expire ${Date.now() % 100000}`;
  const link = await createAndShare(page, name);
  const base = link.split("?listen=")[1] && decodeURIComponent(link.split("?listen=")[1]);

  // stand in for time actually passing by back-dating the same field
  // persistStationMeta() itself writes, directly in localStorage
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("sbfm-station"));
    saved.shareTtl = "1d";
    saved.shareExpiresAt = Date.now() - 60_000;
    localStorage.setItem("sbfm-station", JSON.stringify(saved));
  });

  await page.reload();
  // no prompt, no dialog to accept — this happens without anyone watching for it
  await expect(page.locator("#shareLinkBox")).toBeHidden({ timeout: 15_000 });

  // the real, decisive check: the cloud copy is actually gone, not just hidden
  // in this one browser's own UI. Supabase's object API wraps every error —
  // not-found included — under a flat HTTP 400, with the real reason inside
  // the JSON body ({"statusCode":"404",...}); the raw HTTP status alone can't
  // tell "deleted" apart from anything else that can go wrong here.
  await expect(async () => {
    const r = await page.request.get(`${base}/station.json?v=${Date.now()}`);
    expect(r.status()).toBe(400);
    expect(await r.text()).toContain("NoSuchKey");
  }).toPass({ timeout: 15_000 });
});

test("a guest opening a link where the whole share has already expired is told so, not shown a generic failure", async ({ page }) => {
  await page.route("**/fake-expired-share/station.json**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        v: 1, name: "Gone Already", owner: "Friend", intro: "",
        shareExpiresAt: Date.now() - 60_000,
        pieces: [{ title: "bottle", kind: "", file: "data:audio/wav;base64,UklGRgA=" }],
      }),
    }));
  await page.goto("/?listen=" + encodeURIComponent("https://example.invalid/fake-expired-share"));
  // never the generic "can't reach / link doesn't work" copy — this is a
  // different, honest state: it worked, and it is genuinely gone
  await expect(page.locator("#sname")).toHaveText(/已经消失了|already disappeared/);
  await expect(page.locator("#tagline")).toContainText(/到时间了|time's already passed/);
});

test("a guest link with no expiry set behaves exactly as before", async ({ page }) => {
  await page.route("**/fake-permanent-share/station.json**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        v: 1, name: "Still Here", owner: "Friend", intro: "", shareExpiresAt: null,
        pieces: [{ title: "hello", kind: "", file: "data:audio/wav;base64,UklGRgA=" }],
      }),
    }));
  await page.goto("/?listen=" + encodeURIComponent("https://example.invalid/fake-permanent-share"));
  await expect(page.locator("#sname")).toHaveText("Still Here");
});
