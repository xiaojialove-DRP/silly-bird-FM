import { test, expect } from "@playwright/test";

// Local storage is not forever — phones evict it, people clear it, devices get
// replaced. A station that has been shared already lives in the cloud though, and its
// owner already has the link, so the link is the way back. This is that path, done
// the way it would really happen: share from one browser, recover in another that has
// never seen the station.

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

test("a lost station comes back from its own link", async ({ page, browser }) => {
  const stationName = `Recover ${Date.now() % 100000}`;

  // the original device: make a station and share it
  await page.goto("/");
  await page.locator("#dialMid").click();
  await page.locator("#chNameInput").fill(stationName);
  await page.locator("#chIntroInput").fill("late night radio");
  await page.setInputFiles("#filepick", { name: "one.wav", mimeType: "audio/wav", buffer: tinyWavBuffer(440) });
  await expect(page.locator("#trackList .track-row")).toHaveCount(1);
  await page.locator("#stationSave").click();
  await page.locator("#openShareBtn").click();
  await expect(page.locator("#shareLinkBox")).toBeVisible({ timeout: 20_000 });
  const link = (await page.locator("#shareLinkText").textContent()).trim();

  // a new device: never seen this station, nothing stored
  const fresh = await browser.newContext();
  const revived = await fresh.newPage();
  await revived.goto(link);
  await expect(revived.locator("#sname")).toHaveText(stationName, { timeout: 20_000 });

  await revived.locator("#dialMid").click();
  const restore = revived.locator("#restoreBtn");
  await expect(restore, "an empty device viewing a shared link is offered the way back").toBeVisible();
  await restore.click();

  await expect(revived.locator("#recordOut")).toContainText(/取回来了|Got it back/, { timeout: 30_000 });
  await expect(revived.locator("#trackList .track-row")).toHaveCount(1);
  await expect(revived.locator("#chNameInput")).toHaveValue(stationName);

  // and it is genuinely local now: still there with the link stripped off
  await revived.goto("/");
  await revived.locator("#dialMid").click();
  await expect(revived.locator("#trackList .track-row")).toHaveCount(1);
  await expect(revived.locator("#chNameInput")).toHaveValue(stationName);

  // the offer is gone, because this device now has a station worth protecting
  await expect(revived.locator("#restoreBtn")).toBeHidden();
  await fresh.close();

  // clean up the cloud copy
  page.once("dialog", (d) => d.accept());
  await page.locator("#revokeShareBtn").click();
  await expect(page.locator("#shareOut")).toContainText(/Revoked|已撤回/, { timeout: 20_000 });
});

test("someone who already has a station is never offered a restore over it", async ({ page }) => {
  await page.goto("/");
  await page.locator("#dialMid").click();
  await page.setInputFiles("#filepick", { name: "mine.wav", mimeType: "audio/wav", buffer: tinyWavBuffer(660) });
  await expect(page.locator("#trackList .track-row")).toHaveCount(1);

  // now visit a shared link while holding a station of your own
  await page.goto("/?listen=https%3A%2F%2Fexample.invalid%2Fnope");
  await page.locator("#dialMid").click();
  await expect(page.locator("#restoreBtn")).toBeHidden();
});
