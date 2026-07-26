// silly bird FM — window chrome: open/close/stack/drag for the floating cards.
// Zero knowledge of stations, tracks, or sharing — purely "where do these
// rectangles sit and how do they move." Every call site that mixes placement
// with feature logic (opening Share also renders the link box, for example)
// stays in main.js; this file only ever answers "where."

const $ = (id) => document.getElementById(id);
const winMain = $("winMain"), winStation = $("winStation"), winLook = $("winLook"), winShare = $("winShare"), winAbout = $("winAbout");

// below this width, the four cards can't sit side by side without spilling off
// screen. Instead of free floating, they stack vertically below whatever is
// already showing, in a fixed order, sliding into their slot as they appear —
// Main never hides on a phone, it's the anchor the stack builds down from, and
// Look intentionally lands right under it so picking a color and seeing it land
// on the player happen in the same glance.
// Ask the same question the stylesheet asks, rather than measuring the window
// separately: window.innerWidth can be momentarily distorted by a card that is being
// revealed while still parked at its desktop coordinates, and a mismatch there sends
// the whole layout down the wrong branch. One breakpoint, one answer.
export const isNarrowViewport = () => window.matchMedia("(max-width: 600px)").matches;

const MOBILE_STACK_ORDER = [winMain, winAbout, winLook, winStation, winShare];
export function restackMobile() {
  if (!isNarrowViewport()) return;
  let bottom = 8;
  MOBILE_STACK_ORDER.forEach((win) => {
    if (win.hidden) { delete win.dataset.stacked; return; }
    const w = win.offsetWidth || 320;
    win.style.left = Math.max(8, (window.innerWidth - w) / 2) + "px";
    if (!win.dataset.stacked) {
      // first appearance in this stack — start a little higher and let the
      // top transition (see the mobile media query) slide it down into its
      // real slot, rather than just popping into place
      win.style.transition = "none";
      win.style.top = Math.max(8, bottom - 20) + "px";
      void win.offsetWidth;   // force layout so the browser commits the "from" position first
      win.style.transition = "";
      win.dataset.stacked = "1";
    }
    win.style.top = bottom + "px";
    bottom += win.offsetHeight + 14;
  });
}
// Share in particular is short when it first opens and grows once the link box
// (and, later, the stamps grid) appears — well after placeBeside already ran
// and locked in a position based on the smaller, pre-growth height. Every .win
// is position:fixed, so a card that grows past the bottom edge afterwards has
// no scroll path back into view; nothing else here notices when that happens.
// Watching every window for its own resize catches this regardless of *why* it
// grew, instead of trying to predict every future content change up front.
const keepInBoundsObserver = new ResizeObserver((entries) => {
  for (const { target: win } of entries) {
    if (win.hidden) continue;
    const r = win.getBoundingClientRect();
    const maxTop = window.innerHeight - r.height - 8;
    const maxLeft = window.innerWidth - r.width - 8;
    if (r.top > maxTop) win.style.top = Math.max(8, maxTop) + "px";
    if (r.left > maxLeft) win.style.left = Math.max(8, maxLeft) + "px";
  }
});
[winMain, winStation, winLook, winShare, winAbout].forEach((w) => keepInBoundsObserver.observe(w));

function placeBeside(win, topOf, refWin) {
  if (win.dataset.placed) return;
  const w = win.offsetWidth || 320, h = win.offsetHeight || 200;
  const r = (refWin || winMain).getBoundingClientRect();
  const fitsRight = r.right + 16 + w < window.innerWidth;
  const fitsBelow = r.bottom + 16 + h < window.innerHeight;
  let left, top;
  if (fitsRight) {
    left = r.right + 16;
    top = topOf ? topOf() : r.top;
  } else if (fitsBelow) {
    // Not enough width to sit beside it, but enough height to sit under it —
    // a fixed 36px nudge here used to just cascade the new card almost
    // directly on top of the reference window at exactly this width range
    // (desktop, but too narrow for two 300px cards side by side), burying
    // whatever it was covering. topOf doesn't apply once "beside" is off the
    // table, so it's ignored in this branch.
    left = r.left;
    top = r.bottom + 16;
  } else {
    // Neither beside nor below fits — this is the case the 36px cascade was
    // actually written for (e.g. Share opening beside an already-offset
    // Station, with no room in any direction at a standard viewport height).
    // Every .win is position:fixed, so unlike normal document flow, no
    // scroll can ever reach a card pushed past the bottom edge — cascading
    // near the reference window's own corner is what keeps it reachable.
    left = Math.max(8, r.left + 36);
    top = (topOf ? topOf() : r.top) + 36;
  }
  win.style.left = Math.max(8, Math.min(left, window.innerWidth - w - 8)) + "px";
  win.style.top = Math.max(8, Math.min(top, window.innerHeight - h - 8)) + "px";
  win.dataset.placed = "1";
}
export function toggleWin(win, topOf, refWin) {
  if (win.hidden) {
    win.hidden = false;
    if (isNarrowViewport()) {
      restackMobile();
      // the stack outgrows a phone screen quickly, so a card can slide into a slot
      // entirely below the fold and opening it looks like nothing happened. Scroll
      // by exactly the shortfall — enough to see the new card, without shoving the
      // rest of the stack off the top. Waits for the slide to settle first.
      setTimeout(() => {
        const shortfall = win.getBoundingClientRect().bottom - window.innerHeight;
        if (shortfall <= 0) return;
        const start = window.scrollY;
        const target = start + shortfall + 8;
        window.scrollTo({ top: target, behavior: "smooth" });
        // not every engine honours smooth scrolling, and some ignore the call
        // outright — leaving the card stranded below the fold. If nothing moved,
        // get there anyway; being reachable matters more than the glide.
        setTimeout(() => { if (window.scrollY === start) window.scrollTo(0, target); }, 400);
      }, 360);
    } else placeBeside(win, topOf, refWin);
  } else {
    closeWin(win);
  }
}
export function closeWin(win) {
  win.hidden = true;
  if (isNarrowViewport()) restackMobile();
}

// ---- dragging (mouse + touch, so cards and the perch drag on phones too) ----
export function makeDraggable(el, handle, onTap) {
  let start = null, moved = false;
  const begin = (x, y) => {
    const r = el.getBoundingClientRect();
    start = { dx: x - r.left, dy: y - r.top };
    moved = false;
  };
  const move = (x, y) => {
    moved = true;
    const maxLeft = Math.max(0, window.innerWidth - el.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - el.offsetHeight);
    el.style.left = Math.min(maxLeft, Math.max(0, x - start.dx)) + "px";
    el.style.top = Math.min(maxTop, Math.max(0, y - start.dy)) + "px";
  };
  handle.addEventListener("mousedown", (e) => {
    if (e.target.closest("button") && !onTap) return;
    e.preventDefault();
    begin(e.clientX, e.clientY);
    const onMove = (ev) => move(ev.clientX, ev.clientY);
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      start = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
  handle.addEventListener("touchstart", (e) => {
    if (e.target.closest("button") && !onTap) return;
    const t = e.touches[0];
    begin(t.clientX, t.clientY);
    const onMove = (ev) => { move(ev.touches[0].clientX, ev.touches[0].clientY); ev.preventDefault(); };
    const onEnd = () => {
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
      start = null;
    };
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
  }, { passive: true });
  if (onTap) handle.addEventListener("click", () => { if (!moved) onTap(); moved = false; });
}
