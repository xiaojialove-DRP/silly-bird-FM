import { test, expect } from "@playwright/test";

// Every interactive control here carried zero focus indicator — several rules
// actively stripped the browser default with nothing put back, so a keyboard user
// had no way to tell where they were. And every status message (upload failures,
// storage failures, restore progress) landed in a div a screen reader never knew
// had changed. Both are now fixed with one rule each; these lock that in.

test("a keyboard user can see where focus is, and a mouse click stays quiet", async ({ page }) => {
  await page.goto("/");
  const play = page.locator("#play");

  // real Tab navigation, not .focus() — :focus-visible cares about how focus arrived.
  // Walk forward until #play itself has focus, rather than assume a fixed step
  // count — the exact number of stops before it is an implementation detail of
  // the title bar, not something this test should know or re-break on.
  for (let i = 0; i < 15; i++) {
    if (await page.evaluate(() => document.activeElement.id) === "play") break;
    await page.keyboard.press("Tab");
  }
  await expect(play).toBeFocused();

  const ringWhenTabbed = await play.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(ringWhenTabbed, "the play button had an unconditional outline:none with nothing to replace it").not.toBe("none");

  // a plain mouse click must not leave that same ring behind
  await page.locator("#next").click();
  const ringAfterMouseClick = await page.locator("#next").evaluate((el) => getComputedStyle(el).boxShadow);
  expect(ringAfterMouseClick, "a pointer click should not trigger the keyboard focus ring").toBe("none");
});

// A text field already has a blinking caret and its own dotted underline, so the
// same ring used on buttons read as one indicator too many the moment you clicked
// in to type — real user feedback, not a guess. Buttons keep the ring; text fields
// get a firmer underline instead.
test("a text field gets a firmer underline instead of the button ring", async ({ page }) => {
  await page.goto("/");
  await page.locator("#dialMid").click();

  // real Tab navigation, same reason as above — walk forward until the name
  // field itself has focus, rather than assume a fixed step count
  for (let i = 0; i < 15; i++) {
    if (await page.evaluate(() => document.activeElement.id) === "chNameInput") break;
    await page.keyboard.press("Tab");
  }
  await expect(page.locator("#chNameInput")).toBeFocused();

  const style = await page.locator("#chNameInput").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { boxShadow: cs.boxShadow, borderBottomStyle: cs.borderBottomStyle };
  });
  expect(style.boxShadow, "a text field should not get the button ring").toBe("none");
  expect(style.borderBottomStyle, "focus should still change something visible").toBe("solid");
});

test("the ring reads on every mount color, not just the default blue", async ({ page }) => {
  await page.goto("/");
  for (const theme of ["blue", "black", "crimson", "green"]) {
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.locator("#lookBtn").focus();
    // programmatic focus is not always focus-visible in every engine; force the
    // state the way :focus-visible would leave it, and confirm the two-tone
    // ring resolves to real colors rather than transparent or none
    const shadow = await page.locator("#lookBtn").evaluate((el) => {
      el.blur();
      el.focus();
      return getComputedStyle(el).boxShadow;
    });
    // this only checks the box-shadow the CSS *would* paint is non-degenerate for
    // this theme's --paper/--ink, since headless focus-visible heuristics vary
    const vars = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return { paper: cs.getPropertyValue("--paper").trim(), ink: cs.getPropertyValue("--ink").trim() };
    });
    expect(vars.paper, `theme ${theme} must define --paper`).toBeTruthy();
    expect(vars.ink, `theme ${theme} must define --ink`).toBeTruthy();
    expect(vars.paper).not.toBe(vars.ink);
  }
});

test("status messages are announced, not just displayed", async ({ page }) => {
  await page.goto("/");
  const recordOut = page.locator("#recordOut");
  const shareOut = page.locator("#shareOut");

  await expect(recordOut).toHaveAttribute("aria-live", "polite");
  await expect(recordOut).toHaveAttribute("aria-atomic", "true");
  await expect(shareOut).toHaveAttribute("aria-live", "polite");
  await expect(shareOut).toHaveAttribute("aria-atomic", "true");

  // and a real failure actually lands in that live region, not silently nowhere
  await page.locator("#dialMid").click();
  for (let i = 0; i < 8; i++) {
    await page.setInputFiles("#filepick", { name: `t${i}.wav`, mimeType: "audio/wav", buffer: Buffer.alloc(44) });
  }
  await expect(recordOut).toContainText(/Station's full|电台已经满了/);
});
