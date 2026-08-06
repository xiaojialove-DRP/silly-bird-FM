// silly bird FM — sharing: publish to cloud, resolve a friend's link, restore your
// own station from its own link, and the once-a-day postmark a listener can send
// back. This is "the station talking to the cloud"; main.js still owns the player
// transport and every render function these call back into — so the imports
// between the two files run in both directions on purpose (see main.js's header).

import { CLOUD, cloudPut, cloudList, cloudDelete, reportError, todayStr } from "./cloud.js";
import { t } from "./i18n.js";
import {
  MY, channel, say, esc, currentTheme, isExpired, TTL_MS,
  renderChannel, renderTrackList, importFiles, persistPiece, persistStationMeta,
} from "./main.js";

const $ = (id) => document.getElementById(id);
const shareLinkBox = $("shareLinkBox"), shareLinkText = $("shareLinkText"), shareBtn = $("shareBtn"), copyLinkBtn = $("copyLinkBtn");
const revokeShareBtn = $("revokeShareBtn");
const shareTtlSelect = $("shareTtlSelect");
const restoreBtn = $("restoreBtn"), restoreInput = $("restoreInput"), recordOut = $("recordOut");
const chNameInput = $("chNameInput"), chIntroInput = $("chIntroInput");
const stampBtn = $("stampBtn"), stampsBox = $("stampsBox"), stampsGrid = $("stampsGrid");

// ---- P1 · share my station: upload to cloud, hand friends a ?listen= link ----
export function shareLinkFor(token) {
  const base = `${CLOUD.url}/storage/v1/object/public/${CLOUD.bucket}/${token}`;
  return location.origin + location.pathname + "?listen=" + encodeURIComponent(base);
}
export function renderShareLinkBox() {
  // shareBtn's label is fixed (static markup, see index.html) — it always means
  // "publish", whether this is the first time or the tenth. Each button has
  // exactly one job: this function only ever decides whether the link box itself,
  // and the copy button living inside it, are there to show.
  if (!MY.shareToken) { shareLinkBox.hidden = true; return; }
  shareLinkText.textContent = shareLinkFor(MY.shareToken);
  shareTtlSelect.value = MY.shareTtl || "";
  shareLinkBox.hidden = false;
}
shareTtlSelect.addEventListener("change", () => {
  MY.shareTtl = shareTtlSelect.value;
  MY.shareExpiresAt = MY.shareTtl ? Date.now() + TTL_MS[MY.shareTtl] : null;
  persistStationMeta();
  // Already out in the world - push the new deadline live right now rather than
  // waiting for some future edit to carry it out. Re-publishing through the
  // normal path (not a smaller manifest-only patch) is the only way this stays
  // correct if tracks were added or removed locally since the last real share.
  if (MY.shareToken) shareStation();
});
export async function copyShareLink() {
  const link = shareLinkText.textContent;
  try {
    await navigator.clipboard.writeText(`${MY.name} ${t("waitingForYou")}\n${link}`);
    // feedback lives on the button itself, right where the eye already is —
    // this is the button whose only job is copying, so it owns this feedback
    const original = copyLinkBtn.textContent;
    copyLinkBtn.textContent = t("copied");
    copyLinkBtn.disabled = true;
    setTimeout(() => { copyLinkBtn.textContent = original; copyLinkBtn.disabled = false; }, 1100);
  } catch { say(t("copyFailedSelect")); }
}
// Fetch the freshly-published station.json back over the *public* URL — the exact
// path a friend's browser takes — and confirm it says what we just uploaded. Storage
// is read-after-write consistent but sits behind a CDN, so a stale copy is the one
// plausible false alarm; a single retry absorbs that without hiding a real problem.
// Returns true only when a friend opening the link right now would get this station.
async function verifyPublished(token, manifest) {
  const base = `${CLOUD.url}/storage/v1/object/public/${CLOUD.bucket}/${token}`;
  const matches = async () => {
    const r = await fetch(`${base}/station.json?v=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const live = await r.json();
    const sameShape =
      live.name === manifest.name &&
      (live.intro || "") === (manifest.intro || "") &&
      (live.pieces || []).length === manifest.pieces.length &&
      manifest.pieces.every((p, i) => (live.pieces[i] || {}).file === p.file && (live.pieces[i] || {}).title === p.title);
    return sameShape;
  };
  try {
    if (await matches()) return true;
    await new Promise((r) => setTimeout(r, 900));
    return await matches();
  } catch (e) {
    reportError("verifyPublished", e);
    return false;
  }
}
export async function shareStation() {
  const tracks = MY.pieces.filter((p) => p.blob);
  if (!tracks.length) return say(t("dropOrUploadFirst"));
  if (!CLOUD.url || !CLOUD.anonKey) return say(t("cloudNotConfigured"));
  // same station → same token every time, so a link already sent to a friend keeps
  // working and just shows whatever you've most recently shared — editing a station
  // updates it in place instead of minting a new, disconnected link
  const isUpdate = !!MY.shareToken;
  shareBtn.disabled = true;
  copyLinkBtn.disabled = true;
  try {
    const token = MY.shareToken || crypto.randomUUID();
    MY.shareToken = token;
    persistStationMeta();
    // One clock for the whole share, not per track - chosen on the share panel
    // itself, not here. Re-publishing (editing content, or nothing at all)
    // carries whatever is currently set forward unchanged; only picking a new
    // duration on the share panel resets it (see setShareTtl below).
    const manifest = {
      v: 1, name: MY.name, owner: MY.name, intro: MY.intro, updatedAt: Date.now(),
      shareTtl: MY.shareTtl || "", shareExpiresAt: MY.shareExpiresAt || null, pieces: [],
    };
    for (let i = 0; i < tracks.length; i++) {
      say(t("uploading", i + 1, tracks.length));
      const p = tracks[i];
      const ext = ((p.blob.type.split("/")[1] || "bin").replace("mpeg", "mp3")).replace(/[^a-z0-9]/gi, "");
      const fname = `track-${i + 1}.${ext || "bin"}`;
      await cloudPut(`${token}/${fname}`, p.blob);
      manifest.pieces.push({ title: p.title, artist: p.artist, kind: p.kind || "", cover: p.cover, file: fname });
    }
    await cloudPut(`${token}/station.json`, new Blob([JSON.stringify(manifest)], { type: "application/json" }));
    const link = shareLinkFor(token);
    renderShareLinkBox();
    // A 200 on the upload is not proof a friend can actually hear this. Read the
    // link back the way they will and check it really says what we just sent —
    // this is the check that would have caught days of edits silently not landing.
    const live = await verifyPublished(token, manifest);
    const gift = `${MY.name} ${t("waitingForYou")}\n${link}`;
    const successMsg = isUpdate ? t("shareUpdated") : t("shareCopied");
    if (!live) {
      // the upload itself did succeed, so do not call this a failed share — but do
      // not let it pass for a good one either
      say(t("publishedButUnverified"));
      try { await navigator.clipboard.writeText(gift); } catch {}
    } else {
      try { await navigator.clipboard.writeText(gift); say(successMsg); }
      catch { say(t("copyFailedLinkBelow")); }
    }
  } catch (e) {
    // fetch() only rejects with a TypeError when the request never got a response at
    // all (DNS/connection/CORS-level failure) — Safari says "Load failed", Chrome says
    // "Failed to fetch". An HTTP error status (403/500/…) resolves normally instead and
    // is thrown separately below as a plain Error, so this check reliably tells apart
    // "can't reach the server" from "server responded but rejected it".
    const unreachable = e instanceof TypeError;
    if (unreachable) say(t("uploadFailedNetwork"));
    // never let "we could not sign you in" masquerade as an ownership problem
    else if (e.noSession) say(t("cannotSignIn"));
    // "not yours" is a dead end, not a retry — saying "try again" here would send
    // someone in circles forever, so name the cause and point at the one way out
    else if (e.blocked) say(t("shareNotYours"));
    // never imply an update landed when it did not: the link still works, but it
    // is serving the previous content, and only saying "unaffected" reads as success
    else say(isUpdate ? t("uploadFailedKeepOld") : t("uploadFailed"));
    reportError("shareStation", e);
  }
  shareBtn.disabled = false;
  copyLinkBtn.disabled = false;
}
export async function revokeShare() {
  if (!MY.shareToken) return;
  if (!confirm(t("confirmRevoke"))) return;
  revokeShareBtn.disabled = true;
  try {
    const files = await cloudList(MY.shareToken);
    if (files.length) await cloudDelete(files.map((f) => `${MY.shareToken}/${f.name}`));
    // cloudList() only lists one folder level, so any stamps/ subfolder needs its
    // own separate list+delete pass — otherwise "revoke deletes everything" would
    // quietly leave stamp files behind
    const stamps = await cloudList(`${MY.shareToken}/stamps`);
    if (stamps.length) await cloudDelete(stamps.map((f) => `${MY.shareToken}/stamps/${f.name}`));
    MY.shareToken = null;
    persistStationMeta();
    renderShareLinkBox();
    say(t("revoked"));
  } catch (e) {
    const unreachable = e instanceof TypeError;
    const notYours = !unreachable && !e.noSession && (e.blocked || e.httpStatus === 403);
    if (unreachable) {
      say(t("revokeFailedNetwork"));
    } else if (e.noSession) {
      // no identity this time around says nothing about whether the link is still
      // revocable — keep the token so a later attempt can still take it back
      say(t("cannotSignIn"));
    } else if (notYours) {
      // this link isn't deletable by this browser anymore (most likely: it predates
      // an ownership rule change) — retrying will never succeed, and there's nothing
      // left to protect by keeping it "active" locally, so clear it here too. A fresh
      // click on generate-share-link then mints a brand new, fully-working link
      // instead of forever retrying a delete that can't go through.
      MY.shareToken = null;
      persistStationMeta();
      renderShareLinkBox();
      say(t("revokeFailedButCleared"));
    } else {
      say(t("revokeFailed", e && e.message ? e.message : e));
      reportError("revokeShare", e);
    }
  }
  revokeShareBtn.disabled = false;
}
// Scheduled, not clicked - the owner picked a duration on the share panel and
// isn't sitting there watching for the moment it arrives, so this happens the
// way "不提示" (no prompt) demands: exactly what revokeShare() above does to
// the cloud copy, minus everything in that flow meant for someone who's
// present - no confirm(), no say(), no button to disable.
export async function checkShareExpiry() {
  if (!MY.shareToken || !isExpired(MY)) return;
  try {
    const files = await cloudList(MY.shareToken);
    if (files.length) await cloudDelete(files.map((f) => `${MY.shareToken}/${f.name}`));
    const stamps = await cloudList(`${MY.shareToken}/stamps`);
    if (stamps.length) await cloudDelete(stamps.map((f) => `${MY.shareToken}/stamps/${f.name}`));
  } catch (e) {
    // could not sign in, network hiccup, whatever it was - leave the token and
    // its deadline as they are and let a later visit try again, the same way a
    // failed manual revoke keeps its token rather than forgetting it was ever due
    reportError("checkShareExpiry", e);
    return;
  }
  MY.shareToken = null; MY.shareTtl = ""; MY.shareExpiresAt = null;
  persistStationMeta();
  renderShareLinkBox();
}

// this browser's own record of when it last opened each guest station — same
// naming convention as the stamp throttle key just above, same "quietly do
// nothing if storage is unavailable" shrug
const lastHeardKey = (token) => `sbfm-heard-${token}`;
function getLastHeard(token) {
  try { return Number(localStorage.getItem(lastHeardKey(token))) || 0; } catch { return 0; }
}
function setLastHeard(token) {
  try { localStorage.setItem(lastHeardKey(token), String(Date.now())); } catch {}
}

// ---- P1 · listen mode: ?listen=<public folder URL> resolves a friend's station ----
// Split on purpose from how the player reacts to it: this only fetches and
// validates, returning a channel-shaped object (or null). Unshifting it into
// CHANNELS, resetting the dial, and rendering are the player's business, not the
// network's, so that part stays in main.js's boot().
//
// Returning plain null used to mean two very different things at once: "there
// was never a link to resolve" (silent, correct — most visits) and "there was
// a link and it failed" (which then landed on an unrelated demo channel with
// no explanation — indistinguishable from the app just being broken). A friend
// reported exactly this as "can't open it, do I need a VPN?" — right guess,
// wrong silence. failed:true (with network:true/false, same TypeError check
// shareStation() already uses) lets the caller say so instead of guessing.
export async function fetchGuestStation() {
  const raw = new URLSearchParams(location.search).get("listen");
  if (!raw) return null;
  let base;
  try { base = new URL(raw).toString().replace(/\/+$/, ""); } catch { return { failed: true }; }
  if (!/^https?:/.test(base)) return { failed: true };
  try {
    // Every guest visit goes through here, including a friend re-opening the
    // exact same link later to check for something new — the one path this
    // matters most for. verifyPublished() and restoreFromLink() already guard
    // against a stale cached copy this same way; this one had been missing it.
    const st = await (await fetch(`${base}/station.json?v=${Date.now()}`, { cache: "no-store" })).json();
    // A guest's own clock decides this, independently of whatever the owner's
    // browser has or hasn't gotten around to revoking yet - the cloud copy can
    // still physically exist, but nobody hears any of it past the share's own
    // deadline, from either side. One check for the whole station, not per
    // track - a "gone already" link says so before it even looks at pieces.
    if (isExpired(st)) return { expired: true };
    const pieces = (st.pieces || []).map((p) => ({
      title: p.title || t("untitled"), artist: p.artist || "", kind: p.kind || "", dur: 0, cover: p.cover || null,
      src: /^(data|https?):/.test(p.file) ? p.file : `${base}/${p.file}`,
    }));
    if (!pieces.length) return { failed: true };
    // the last path segment of the public read URL is the same folder token
    // cloudPut() writes under — reused below to file a listen stamp
    const stampToken = base.split("/").pop();
    // Same re-sent link, checked again later, has no way to say "I already heard
    // this" from "the owner added something since" — updatedAt (absent on
    // stations shared before this existed, so never a false "new") compared
    // against this browser's own last visit answers exactly that. previouslyHeard
    // must be a real past visit, not just falsy-but-defined zero — everything is
    // trivially "new" the very first time anyone opens a link at all, which is not
    // a signal worth showing. Read once, now, before the visit itself updates the
    // stored timestamp below — this is the one render this visit gets to show it.
    const previouslyHeard = getLastHeard(stampToken);
    const hasNew = !!(st.updatedAt && previouslyHeard && st.updatedAt > previouslyHeard);
    setLastHeard(stampToken);
    return {
      name: st.name || t("friendsStation"), owner: st.owner || st.name || t("friend"), intro: st.intro || "",
      guest: true, pieces, stampToken, hasNew,
    };
  } catch (e) {
    reportError("loadGuestStation", e);
    return { failed: true, network: e instanceof TypeError };
  }
}

// ---- getting a station back from its own link ----
// Local storage is not forever: phones evict it, people clear it, and devices get
// replaced. But a station that has been shared already exists in the cloud, and its
// owner already has the link — they sent it to someone. So the way back is the link
// itself, which costs no accounts, no sync and no new format.
//
// Never offered while someone is listening to a shared link. A friend opening your
// link for the first time also has an empty station, so anything shown there lands
// squarely in the path that matters most, asking a question they have no way to
// understand. Recovery is a rare, deliberate act by the one person who knows the
// link is theirs, so it asks for that link instead of guessing — and it lives only
// on the bare site, where a friend arriving from a link never is.
//
// Also never offered when this device already holds a station, so it cannot quietly
// overwrite one.
//
// The restored station deliberately does NOT adopt the old share token. Writes are
// scoped to whoever created the files, and this browser is not that identity, so
// keeping the token would only produce a confusing refusal the next time they
// published. A fresh link gets minted instead, and the copy says so.
const hasGuestLink = () => !!new URLSearchParams(location.search).get("listen");
export function updateRestoreBtn() {
  const canRestore = !hasGuestLink() && !MY.pieces.some((p) => !p.placeholder);
  restoreBtn.hidden = !canRestore;
  if (!canRestore) { restoreInput.hidden = true; restoreBtn.dataset.armed = ""; }
}
// pasted text may be a whole share link or just the folder URL inside it
function baseFromPastedLink(text) {
  const raw = (text || "").trim();
  if (!raw) return null;
  let candidate = raw;
  try {
    const inner = new URL(raw).searchParams.get("listen");
    if (inner) candidate = inner;
  } catch { /* not a full URL — maybe they pasted the folder URL itself */ }
  try {
    const u = new URL(candidate);
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.toString().replace(/\/+$/, "");
  } catch { return null; }
}
export async function restoreFromLink() {
  if (restoreBtn.disabled) return;
  // first press just asks for the link; nothing happens until there is one
  if (!restoreBtn.dataset.armed) {
    restoreInput.hidden = false;
    restoreBtn.dataset.armed = "1";
    restoreBtn.textContent = t("restoreDo");
    restoreInput.focus();
    return;
  }
  const base = baseFromPastedLink(restoreInput.value);
  if (!base) { say(t("restoreBadLink"), recordOut); return; }

  restoreBtn.disabled = true;
  try {
    const st = await (await fetch(`${base}/station.json?v=${Date.now()}`, { cache: "no-store" })).json();
    const pieces = st.pieces || [];
    if (!pieces.length) throw new Error("no pieces in manifest");
    const files = [];
    for (let i = 0; i < pieces.length; i++) {
      say(t("restoring", i + 1, pieces.length), recordOut);
      const p = pieces[i];
      const url = /^(data|https?):/.test(p.file) ? p.file : `${base}/${p.file}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const blob = await r.blob();
      const ext = ((blob.type.split("/")[1] || "bin").replace("mpeg", "mp3")).replace(/[^a-z0-9]/gi, "");
      files.push(new File([blob], `${p.title || "track"}.${ext || "bin"}`, { type: blob.type }));
    }
    MY.name = st.name || MY.name; MY.owner = MY.name; MY.intro = st.intro || "";
    const added = importFiles(files) || [];
    // filenames carry the titles, but the tags are only in the manifest
    added.forEach((p, i) => { if (pieces[i]) { p.kind = pieces[i].kind || ""; persistPiece(p); } });
    persistStationMeta();
    chNameInput.value = MY.name; chIntroInput.value = MY.intro;
    renderChannel(); renderTrackList(); updateRestoreBtn();
    say(t("restoredNeedsNewLink"), recordOut);
  } catch (e) {
    say(t("restoreFailed"), recordOut);
    reportError("restoreFromLink", e);
  }
  restoreBtn.disabled = false;
}

// ---- P1.5 · listen stamps: an opt-in, once-a-day postcard a listener can send after
// hearing every track in a friend's station — never auto-reported, never counted on
// screen anywhere, just a little collection the owner finds when they open Share.
// One stamp = one near-empty file whose NAME carries the date + the listener's own
// theme color, so reading the collection back is a single list() call, no per-file
// fetch needed. ----
const stampThrottleKey = (token) => `sbfm-stamp-${token}`;
function alreadyStampedToday(token) {
  try { return localStorage.getItem(stampThrottleKey(token)) === todayStr(); } catch { return false; }
}
// pi is the transport's, not the station's — passed in rather than imported, since
// the one caller (the "ended" handler in main.js) already has it right there
export function markListened(pi) {
  const ch = channel();
  if (!ch.guest) return;
  if (!ch.listenedSet) ch.listenedSet = new Set();
  ch.listenedSet.add(pi);
  updateStampButton();
}
export function updateStampButton() {
  const ch = channel();
  // classList.toggle(cls, force) treats an explicit `undefined` as "no force
  // argument" (WebIDL optional-boolean rule) and does a real toggle instead of a
  // set — these have to land on an actual true/false, not a short-circuited undefined
  const heardAll = !!(ch.guest && ch.listenedSet && ch.listenedSet.size >= ch.pieces.length);
  const show = !!(heardAll && ch.stampToken && !alreadyStampedToday(ch.stampToken));
  stampBtn.hidden = false;   // toggling [hidden] would cut off the fade-out transition
  stampBtn.classList.toggle("show", show);
  if (!show) setTimeout(() => { if (!stampBtn.classList.contains("show")) stampBtn.hidden = true; }, 320);
}
export function sendStamp() {
  const ch = channel();
  const token = ch.stampToken;
  if (!token || stampBtn.disabled) return;
  stampBtn.disabled = true;
  stampBtn.classList.add("stamping");   // the press-and-ink motion — no text state needed, the stamp IS the confirmation
  const color = currentTheme();
  // the moment goes in the NAME too, in the listener's own local time — a postmark
  // records when it was struck, and reading it back still costs one list() call and
  // no per-file fetch. Stamps sent before this carry a date only, and still render.
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const fname = `${todayStr()}T${hhmm}_${color}_${Math.random().toString(36).slice(2, 8)}.json`;
  cloudPut(`${token}/stamps/${fname}`, new Blob(["{}"], { type: "application/json" }))
    .then(() => { try { localStorage.setItem(stampThrottleKey(token), todayStr()); } catch {} })
    .catch((e) => reportError("sendStamp", e));   // opt-in and low-stakes — fail quietly, no error UI, just a signal
  setTimeout(() => {
    stampBtn.classList.remove("stamping");
    stampBtn.classList.remove("show");   // stamped and sent off — scales back out of the corner
    setTimeout(() => { stampBtn.hidden = true; stampBtn.disabled = false; }, 380);
  }, 500);
}
// A real postmark: one round ink strike, the date curved along the top of the ring,
// the hour struck straight underneath. Same circle, same bird as the button a friend
// pressed to send it — the thing they clicked is the thing that arrives.
// Dates stay numeric in both languages: it is the one format that reads the same to
// everyone, and a curved line this small has no room for a spelled-out month.
function stampChipHtml(color, date, time, idx) {
  const hex = document.querySelector(`.swatch[data-theme="${color}"]`)?.style.getPropertyValue("--sw") || "var(--ink)";
  const arc = `stamp-arc-${idx}`;   // textPath needs its own id per stamp on the page
  return `
    <div class="stamp-chip" style="--sw:${esc(hex)}" title="${esc(date)}${time ? " " + esc(time) : ""}">
      <svg class="stamp-mark" viewBox="0 0 100 100" role="img" aria-label="${esc(date)}${time ? " " + esc(time) : ""}">
        <defs>
          <!-- glyphs sit on top of this arc, so it has to clear the r=43 ring by a
               whole line's ascent or the date cuts straight through the ink border -->
          <path id="${arc}" d="M 21 50 A 29 29 0 0 1 79 50" />
        </defs>
        <circle class="stamp-ink" cx="50" cy="50" r="48" />
        <circle class="stamp-ring" cx="50" cy="50" r="43" />
        <text class="stamp-arc-text">
          <textPath href="#${arc}" startOffset="50%" text-anchor="middle">${esc(date)}</textPath>
        </text>
        <g class="stamp-bird" transform="translate(21.65,25) scale(0.27)">
          <path class="silh2" d="M64 96 L22 82 L38 100 L18 108 L40 116 L24 134 L66 120 Z" />
          <ellipse class="silh2" cx="94" cy="104" rx="44" ry="40" />
          <circle class="silh2" cx="126" cy="64" r="26" />
          <path class="silh2" d="M148 62 L170 67 L148 75 Z" />
          <path class="chirp" d="M174 61 Q181 68 174 75 M182 56 Q192 68 182 80" />
          <path class="cut" d="M90 96 C85 87 72 90 75 101 C77 111 90 120 90 120 C90 120 103 111 105 101 C108 90 95 87 90 96 Z" />
          <path class="legs2" d="M85 142 L81 169 M103 142 L108 169" />
        </g>
        ${time ? `<text class="stamp-time" x="50" y="83" text-anchor="middle">${esc(time)}</text>` : ""}
      </svg>
    </div>`;
}
export async function loadStamps() {
  if (!MY.shareToken) { stampsBox.hidden = true; return; }
  try {
    const files = await cloudList(`${MY.shareToken}/stamps`);
    if (!files.length) { stampsBox.hidden = true; return; }
    const stamps = files
      .map((f) => {
        const [when, color] = f.name.split("_");
        const [date, hhmm] = when.split("T");
        // stamps predating the time-in-the-name change simply have no hhmm part
        return { date, time: hhmm ? `${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}` : "", color: color || "blue", sort: when };
      })
      .sort((a, b) => (a.sort < b.sort ? 1 : -1));   // newest first
    stampsGrid.innerHTML = stamps.map((s, i) => stampChipHtml(s.color, s.date, s.time, i)).join("");
    stampsBox.hidden = false;
  } catch (e) {
    reportError("loadStamps", e);
    stampsBox.hidden = true;
  }
}
