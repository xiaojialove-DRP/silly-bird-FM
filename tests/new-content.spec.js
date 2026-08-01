import { test, expect } from "@playwright/test";

// The desktop shell sits there with nothing to say unless a listener already knows
// to go re-check a friend's link. This closes that gap: a small dot next to the
// station name on the dial, but only for a real *return* visit where the owner
// published something after the last time this browser listened — never on the
// very first visit (everything would trivially be "new"), and never for a station
// shared before updatedAt existed (no baseline to compare against at all).

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

test("a new-content dot only appears on a return visit after the owner republishes", async ({ page, browser, context }) => {
  const stationName = `NewDot ${Date.now() % 100000}`;
  // headless Chromium has no clipboard permission by default, unlike a real
  // browser — shareStation()'s success message only says "updated" after a
  // clipboard write that succeeds, so without this the re-share below would
  // silently take its (also real, not a bug) "copy failed" branch instead
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  // owner: make a station and share it
  await page.goto("/");
  // fresh boot with no station yet tunes away from the empty "mine" slot (see
  // boot() in main.js) - dialMid only opens winStation for that slot
  await page.locator("#tprev").click();
  await page.locator("#dialMid").click();
  await page.locator("#chNameInput").fill(stationName);
  await page.setInputFiles("#filepick", { name: "one.wav", mimeType: "audio/wav", buffer: tinyWavBuffer(440) });
  await expect(page.locator("#trackList .track-row")).toHaveCount(1);
  await page.locator("#stationSave").click();
  await page.locator("#openShareBtn").click();
  await expect(page.locator("#shareLinkBox")).toBeVisible({ timeout: 20_000 });
  const link = (await page.locator("#shareLinkText").textContent()).trim();

  // a friend, opening it for the very first time — nothing to compare against yet
  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();
  await guest.goto(link);
  await expect(guest.locator("#sname")).toHaveText(stationName);
  await expect(guest.locator("#newDot"), "first-ever visit is not a return visit").toBeHidden();

  // reloading right away, nothing changed on the owner's side since. #newDot
  // starts `hidden` in the static markup too, so asserting that alone would
  // pass trivially before boot()'s own async fetchGuestStation() has actually
  // run — wait for #sname to read back the real name first, the same signal
  // used above, so this reload's own setLastHeard() call is guaranteed to
  // have already happened before the owner republishes next.
  await guest.reload();
  await expect(guest.locator("#sname")).toHaveText(stationName);
  await expect(guest.locator("#newDot"), "nothing published since the last visit").toBeHidden();

  // owner adds a second track and republishes — openShareBtn only auto-shares on
  // the very first open (see main.js), so a second publish needs the share panel's
  // own shareBtn, already open from the first round above
  await page.setInputFiles("#filepick", { name: "two.wav", mimeType: "audio/wav", buffer: tinyWavBuffer(660) });
  await expect(page.locator("#trackList .track-row")).toHaveCount(2);
  await page.locator("#shareBtn").click();
  await expect(page.locator("#shareOut")).toContainText(/已更新|updated/i, { timeout: 20_000 });

  // same friend, same link, coming back — this is the return visit that should
  // light up. shareBtn's own "updated" message already means the *owner's*
  // read-back saw the new content, over the same CDN-backed public URL the
  // guest is about to hit from a separate browser context — not a guarantee
  // every edge has it yet, so retry the navigation itself rather than trusting
  // one fetch (fetchGuestStation() runs once per goto(), not polled).
  await expect(async () => {
    await guest.goto(link);
    await expect(guest.locator("#newDot")).toBeVisible({ timeout: 2_000 });
  }, "the owner published after this browser's last visit").toPass({ timeout: 20_000 });

  // and it clears itself on the very next visit, without the owner doing anything more
  await guest.reload();
  await expect(guest.locator("#sname")).toHaveText(stationName);
  await expect(guest.locator("#newDot"), "this visit itself counts as having seen it").toBeHidden();

  await guestCtx.close();

  // clean up the cloud copy
  page.once("dialog", (d) => d.accept());
  await page.locator("#revokeShareBtn").click();
  await expect(page.locator("#shareOut")).toContainText(/Revoked|已撤回/, { timeout: 20_000 });
});

test("a station shared before updatedAt existed never falsely claims to be new", async ({ page }) => {
  // simulates an old station.json with no updatedAt field at all, served locally —
  // no real backend needed to prove the absent-field case degrades safely
  await page.route("**/no-updated-at/station.json**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ name: "Old Station", pieces: [{ title: "one", file: "data:audio/wav;base64,AAAA" }] }),
    })
  );
  await page.goto("/?listen=" + encodeURIComponent("https://example.invalid/no-updated-at"));
  await expect(page.locator("#sname")).toHaveText("Old Station");
  await expect(page.locator("#newDot")).toBeHidden();
});
