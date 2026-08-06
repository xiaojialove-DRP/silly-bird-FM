import { test, expect } from "@playwright/test";

// Covers the one journey that matters most: create a station, share it, have a
// friend actually listen, then revoke it. Runs against the real dev server and the
// real Supabase backend — same as every manual verification this project has ever
// relied on. Revoke is the cleanup step: a passing run leaves no cloud data behind.

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

test("create, share, a friend listens, then revoke", async ({ page, browser }) => {
  // chNameInput has maxlength="24" (by design, real product constraint) — keep
  // this comfortably under that rather than truncating and asserting on the
  // truncated value
  const stationName = `PW Test ${Date.now() % 100000}`;

  await page.goto("/");

  // create: name the station and upload a track
  // fresh boot with no station yet tunes away from the empty "mine" slot (see
  // boot() in main.js) - dialMid only opens winStation for that slot
  await page.locator("#tprev").click();
  await page.locator("#dialMid").click();
  await page.locator("#chNameInput").fill(stationName);
  await page.setInputFiles("#filepick", {
    name: "test-track.wav",
    mimeType: "audio/wav",
    buffer: tinyWavBuffer(),
  });
  await expect(page.locator("#trackList .track-row")).toHaveCount(1);
  await page.locator("#stationSave").click();

  // share: opening the panel for the first time generates the link directly,
  // no separate confirm click needed
  await page.locator("#openShareBtn").click();
  await expect(page.locator("#shareLinkBox")).toBeVisible({ timeout: 15_000 });
  const linkText = await page.locator("#shareLinkText").textContent();
  expect(linkText).toContain("?listen=");

  // a friend opens the link in a browser that has never seen this station before
  const friendCtx = await browser.newContext();
  const friendPage = await friendCtx.newPage();
  await friendPage.goto(linkText.trim());
  await expect(friendPage.locator("#sname")).toHaveText(stationName, { timeout: 15_000 });
  await friendCtx.close();

  // revoke: there's no standalone "revoke now" button anymore (merged into
  // the share panel's duration picker) - schedule the shortest duration, then
  // stand in for that time actually passing the same way ttl.spec.js does,
  // directly in localStorage, and let the next boot carry the revoke out for real
  await page.locator("#shareTtlSelect").selectOption("1d");
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("sbfm-station"));
    saved.shareExpiresAt = Date.now() - 60_000;
    localStorage.setItem("sbfm-station", JSON.stringify(saved));
  });
  await page.reload();
  await expect(page.locator("#shareLinkBox")).toBeHidden({ timeout: 15_000 });

  // a new visitor using the same old link no longer finds this station
  const laterCtx = await browser.newContext();
  const laterPage = await laterCtx.newPage();
  await laterPage.goto(linkText.trim());
  await expect(laterPage.locator("#sname")).not.toHaveText(stationName, { timeout: 15_000 });
  await laterCtx.close();
});

// Every upload here can answer 200 while the link a friend opens still serves
// something else — that is exactly how days of edits went missing without a word.
// Sharing reads its own link back afterwards, and this proves it actually looks.
test("sharing says so when the published link does not match what was sent", async ({ page }) => {
  await page.goto("/");
  // fresh boot with no station yet tunes away from the empty "mine" slot (see
  // boot() in main.js) - dialMid only opens winStation for that slot
  await page.locator("#tprev").click();
  await page.locator("#dialMid").click();
  await page.locator("#chNameInput").fill(`Verify ${Date.now() % 100000}`);
  await page.setInputFiles("#filepick", {
    name: "test-track.wav",
    mimeType: "audio/wav",
    buffer: tinyWavBuffer(),
  });
  await expect(page.locator("#trackList .track-row")).toHaveCount(1);
  await page.locator("#stationSave").click();

  // the upload still really happens; only the public read-back is doctored, standing
  // in for a stale CDN copy or a write that never actually landed
  await page.route("**/object/public/**/station.json*", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ v: 1, name: "something else entirely", intro: "", pieces: [] }),
    }));

  await page.locator("#openShareBtn").click();
  await expect(page.locator("#shareOut")).toContainText(/回读检查没通过|reading the link back did not match/, { timeout: 25_000 });

  // the upload succeeded, so there is real data to clean up - no standalone
  // "revoke now" button anymore, so schedule the shortest duration and stand
  // in for that time passing directly in localStorage (see ttl.spec.js)
  await page.unroute("**/object/public/**/station.json*");
  await page.locator("#shareTtlSelect").selectOption("1d");
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("sbfm-station"));
    saved.shareExpiresAt = Date.now() - 60_000;
    localStorage.setItem("sbfm-station", JSON.stringify(saved));
  });
  await page.reload();
  await expect(page.locator("#shareLinkBox")).toBeHidden({ timeout: 15_000 });
});
