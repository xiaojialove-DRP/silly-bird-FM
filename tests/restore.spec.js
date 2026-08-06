import { test, expect } from "@playwright/test";

// Local storage is not forever — phones evict it, people clear it, devices get
// replaced. A station that has been shared already lives in the cloud though, and its
// owner already has the link, so the link is the way back.
//
// The constraint that shapes this: a friend opening your link for the first time also
// has an empty station, and must never be shown a question that is not theirs to
// answer. So recovery lives only on the bare site, and asks for the link.

function tinyWavBuffer(freq = 440) {
  const rate = 8000, n = 2400;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 6000), 44 + i * 2);
  return buf;
}

test("a friend listening to a shared link is never shown the recovery offer", async ({ page }) => {
  // the path that matters most: someone else's link, no station of their own yet
  await page.goto("/?listen=https%3A%2F%2Fexample.invalid%2Fnope");
  await page.locator("#dialMid").click();
  await expect(page.locator("#restoreBtn")).toBeHidden();
  await expect(page.locator("#restoreInput")).toBeHidden();
});

test("someone who already has a station is never offered a restore over it", async ({ page }) => {
  await page.goto("/");
  // fresh boot with no station yet tunes away from the empty "mine" slot (see
  // boot() in main.js) - dialMid only opens winStation for that slot
  await page.locator("#tprev").click();
  await page.locator("#dialMid").click();
  await page.setInputFiles("#filepick", { name: "mine.wav", mimeType: "audio/wav", buffer: tinyWavBuffer(660) });
  await expect(page.locator("#trackList .track-row")).toHaveCount(1);
  await expect(page.locator("#restoreBtn")).toBeHidden();
});

test("a lost station comes back from its own link", async ({ page, browser }) => {
  const stationName = `Recover ${Date.now() % 100000}`;

  // the original device: make a station and share it
  await page.goto("/");
  // fresh boot with no station yet tunes away from the empty "mine" slot (see
  // boot() in main.js) - dialMid only opens winStation for that slot
  await page.locator("#tprev").click();
  await page.locator("#dialMid").click();
  await page.locator("#chNameInput").fill(stationName);
  await page.locator("#chIntroInput").fill("late night radio");
  await page.setInputFiles("#filepick", { name: "one.wav", mimeType: "audio/wav", buffer: tinyWavBuffer(440) });
  await expect(page.locator("#trackList .track-row")).toHaveCount(1);
  await page.locator("#stationSave").click();
  await page.locator("#openShareBtn").click();
  await expect(page.locator("#shareLinkBox")).toBeVisible({ timeout: 20_000 });
  const link = (await page.locator("#shareLinkText").textContent()).trim();

  // a new device: bare site, nothing stored, holding the link they once sent
  const fresh = await browser.newContext();
  const revived = await fresh.newPage();
  await revived.goto("/");
  // fresh boot with no station yet tunes away from the empty "mine" slot (see
  // boot() in main.js) - dialMid only opens winStation for that slot
  await revived.locator("#tprev").click();
  await revived.locator("#dialMid").click();

  const restore = revived.locator("#restoreBtn");
  await expect(restore, "an empty device on the bare site is offered the way back").toBeVisible();

  // first press only asks for the link
  await restore.click();
  await expect(revived.locator("#restoreInput")).toBeVisible();
  await revived.locator("#restoreInput").fill(link);
  await restore.click();

  await expect(revived.locator("#recordOut")).toContainText(/取回来了|Got it back/, { timeout: 30_000 });
  await expect(revived.locator("#trackList .track-row")).toHaveCount(1);
  await expect(revived.locator("#chNameInput")).toHaveValue(stationName);

  // genuinely local now: still there on a plain reload
  await revived.reload();
  await revived.locator("#dialMid").click();
  await expect(revived.locator("#trackList .track-row")).toHaveCount(1);
  await expect(revived.locator("#chNameInput")).toHaveValue(stationName);
  // and the offer is gone, because this device now has something worth protecting
  await expect(revived.locator("#restoreBtn")).toBeHidden();
  await fresh.close();

  // clean up the cloud copy - no standalone "revoke now" button anymore, so
  // schedule the shortest duration and stand in for that time passing
  // directly in localStorage (see ttl.spec.js)
  await page.locator("#shareTtlSelect").selectOption("1d");
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("sbfm-station"));
    saved.shareExpiresAt = Date.now() - 60_000;
    localStorage.setItem("sbfm-station", JSON.stringify(saved));
  });
  await page.reload();
  await expect(page.locator("#shareLinkBox")).toBeHidden({ timeout: 15_000 });
});

test("pasting something that is not a share link says so instead of failing oddly", async ({ page }) => {
  await page.goto("/");
  // fresh boot with no station yet tunes away from the empty "mine" slot (see
  // boot() in main.js) - dialMid only opens winStation for that slot
  await page.locator("#tprev").click();
  await page.locator("#dialMid").click();
  await page.locator("#restoreBtn").click();
  await page.locator("#restoreInput").fill("just some words");
  await page.locator("#restoreBtn").click();
  await expect(page.locator("#recordOut")).toContainText(/不像是一条分享链接|does not look like a share link/);
});
