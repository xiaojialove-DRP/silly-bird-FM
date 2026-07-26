import { test, expect } from "@playwright/test";

// The cheapest guard there is, and the one that would have caught the worst near
// miss so far: a stray brace left main.js dead while the page still looked perfect,
// because the markup is static. Nothing here touches the network, so it fails in
// seconds and can never be confused with a flaky backend or a rate limit.

test("the app boots, with no console errors", async ({ page }) => {
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("/");
  await expect(page.locator("#winMain")).toBeVisible();

  // scripted behaviour, not just markup: if the module threw on load, no listener
  // was ever attached and this click does nothing
  await page.locator("#dialMid").click();
  await expect(page.locator("#winStation")).toBeVisible();
  await page.locator("#lookBtn").click();
  await expect(page.locator("#winLook")).toBeVisible();

  expect(errors, `console errors on boot:\n${errors.join("\n")}`).toEqual([]);
});

test("switching language rewrites the interface", async ({ page }) => {
  await page.goto("/");
  // a demo station, since a real one's own name is never translated
  await page.locator("#tnext").click();
  const before = await page.locator("#sname").textContent();

  await page.locator("#langBtn").click();
  await expect(page.locator("#sname")).not.toHaveText(before);
  await expect(page.locator('[data-i18n="look"]')).toHaveText(/Look|外观/);

  await page.locator("#langBtn").click();
  await expect(page.locator("#sname")).toHaveText(before);
});

test("the stack stays reachable on a phone-sized screen", async ({ page }) => {
  // 375x667 is a small-but-real iPhone. Two cards are already taller than that, so
  // this is where "the bottom of the card cannot be touched" shows up.
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/");
  await page.locator("#dialMid").click();
  await expect(page.locator("#winStation")).toBeVisible();

  // the desktop cascade must not have been used
  await expect(page.locator("#winStation")).toHaveAttribute("data-stacked", "1");

  const reachable = async (sel) => {
    const box = await page.locator(sel).boundingBox();
    const scrollable = await page.evaluate(() =>
      document.documentElement.scrollHeight > window.innerHeight);
    return { box, scrollable };
  };
  const { scrollable } = await reachable("#stationSave");
  expect(scrollable, "a stack taller than the screen has to scroll").toBe(true);

  // and scrolling really does bring the far end of the card into view
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const done = await page.locator("#stationSave").boundingBox();
  const h = page.viewportSize().height;
  expect(done.y >= 0 && done.y + done.height <= h, "Done must be on screen after scrolling").toBe(true);
});

// Real user feedback: people kept the internal fallback name "My Station" because,
// pre-filled into the input, it rendered in the same ink as real content and read
// as already chosen rather than as an example. The intro field never had this
// problem, since it starts genuinely empty. The name field needed to behave the
// same way until there is a real station to show.
test("the station name reads as an example until a station actually exists", async ({ page }) => {
  await page.goto("/");
  await page.locator("#dialMid").click();

  const nameInput = page.locator("#chNameInput");
  await expect(nameInput).toHaveValue("");
  await expect(nameInput).toHaveAttribute("placeholder", /./);   // a real example, not blank

  // leaving it untouched must still produce a sensible saved name — this changes
  // what is shown, not the fallback behaviour underneath it
  await page.setInputFiles("#filepick", { name: "t.wav", mimeType: "audio/wav", buffer: Buffer.alloc(44) });
  await page.locator("#stationSave").click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("sbfm-station")).name);
  expect(saved, "an untouched name field must still fall back to something usable").toBeTruthy();

  // and now that a station genuinely exists, reopening shows that real value —
  // this is no longer a placeholder situation
  await page.locator("#stationClose").click();
  await page.locator("#dialMid").click();
  await expect(nameInput).toHaveValue(saved);
});
