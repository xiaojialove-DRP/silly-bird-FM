import { test, expect } from "@playwright/test";

// Nobody arrives already knowing that turning the dial finds their own empty
// slot — a friend reported exactly this. The nudge is a single quiet pulse on
// whichever arrow is actually the short way there, once, and never again once a
// station exists. Direction flips depending on how you arrived (a guest link
// unshifts a channel to the front, which moves everyone else over by one), so
// this checks both directions rather than assuming one.

async function hintState(page) {
  return page.evaluate(() => ({
    prev: document.getElementById("tprev").classList.contains("tune-hint"),
    next: document.getElementById("tnext").classList.contains("tune-hint"),
  }));
}

test("a fresh visitor with no link is nudged left, toward their own slot", async ({ page }) => {
  await page.goto("/");
  // no station yet, and no ?listen= link: MY sits one step behind the landing
  // channel, which is the tprev/◁ direction
  await page.waitForTimeout(900);   // inside the 700-2400ms window
  const mid = await hintState(page);
  expect(mid.prev, "the short way to MY should be tprev here").toBe(true);
  expect(mid.next).toBe(false);

  await page.waitForTimeout(1700);   // 900 + 1700 = 2600ms total — past the 2400ms cleanup
  const after = await hintState(page);
  expect(after.prev, "a one-time nudge must not linger").toBe(false);
});

test("arriving via a shared link nudges the other way", async ({ page }) => {
  // stand in for a real shared folder without spending a real upload: only
  // station.json is ever fetched for a guest channel
  await page.route("**/fake-guest-station/station.json", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ v: 1, name: "A Friend's Station", owner: "Friend", intro: "", pieces: [
        { title: "hello", kind: "", file: "data:audio/wav;base64,UklGRgA=" },
      ] }),
    }));

  await page.goto("/?listen=" + encodeURIComponent("https://example.invalid/fake-guest-station"));
  await expect(page.locator("#sname")).toHaveText("A Friend's Station");

  // the guest channel just got unshifted to the front, pushing MY one step
  // further away in the OTHER direction — tnext/▶ is now the short way
  await page.waitForTimeout(900);
  const mid = await hintState(page);
  expect(mid.next, "a guest link flips which arrow is the short way to MY").toBe(true);
  expect(mid.prev).toBe(false);
});

test("someone who already has a station is never nudged", async ({ page }) => {
  await page.goto("/");
  await page.locator("#dialMid").click();
  await page.setInputFiles("#filepick", { name: "t.wav", mimeType: "audio/wav", buffer: Buffer.alloc(44) });
  await expect(page.locator("#trackList .track-row")).toHaveCount(1);
  await page.locator("#stationSave").click();

  await page.reload();
  await page.waitForTimeout(900);
  const state = await hintState(page);
  expect(state.prev || state.next, "a station that already exists needs no nudge").toBe(false);
});
