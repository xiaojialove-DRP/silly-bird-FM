// silly bird FM — player core: transport, station editing, window chrome wiring.
// Four floating papercut windows (radio / my-station / look / share), each draggable.
// P0: imports persist in IndexedDB (survive reload); MediaSession (system media keys);
//     self-hosted fonts (see style.css).
// P1: share = upload your station to cloud storage → send friends a ?listen= link;
//     opening such a link tunes a read-only copy of that station in first position.
//     Cloud is config-gated: fill CLOUD below (see README «分享» section).
// Sharing/listen/restore/stamps live in share.js; window stacking/dragging live in
// windows.js — both call back in here for station state and rendering, so the
// imports between the three files run in both directions on purpose.
window.__SBFM = "p0p1";

import { CLOUD, ensureAnonSession, cloudPut, cloudList, cloudDelete, reportError, todayStr } from "./cloud.js";

import { I18N, lang, t, setLangValue } from "./i18n.js";

import {
  renderShareLinkBox, shareStation, copyShareLink, fetchGuestStation,
  updateRestoreBtn, restoreFromLink, markListened, updateStampButton, sendStamp, loadStamps,
  checkShareExpiry,
} from "./share.js";

import { toggleWin, closeWin, restackMobile, isNarrowViewport, makeDraggable } from "./windows.js";

const PLACEHOLDER = () => ({ title: t("noProgramsYet"), kind: t("tapAboveToCreate"), dur: 0, placeholder: true });

const CHANNELS = [
  { name: t("myStation"), owner: t("me"), intro: "", mine: true, pieces: [PLACEHOLDER()] },
  {
    demoKey: "demo1", freqKey: "深夜胡思乱想",
    name: "深夜胡思乱想", owner: "小佳", intro: "睡不着的夜里，说给你听",
    pieces: [
      { title: "写代码写到凌晨三点", kind: "声音故事",   src: "./assets/demo-audio/night-coding.wav" },
      { title: "最近单曲循环，哼给你听", kind: "自己哼的歌", src: "./assets/demo-audio/hum-lullaby.wav" },
      { title: "楼下便利店的白噪音", kind: "环境音",     src: "./assets/demo-audio/store-hum.wav" },
    ],
  },
  {
    demoKey: "demo2", freqKey: "雨天限定",
    name: "雨天限定", owner: "Wren", intro: "只在下雨天更新",
    pieces: [
      { title: "阳台上的一整场雨", kind: "环境音",     src: "./assets/demo-audio/rain.wav" },
      { title: "读了一段《海边的卡夫卡》", kind: "声音故事", src: "./assets/demo-audio/reading-room.wav" },
    ],
  },
  {
    demoKey: "demo3", freqKey: "厨房迪斯科",
    name: "厨房迪斯科", owner: "Pomelo", intro: "一边做饭一边跳舞",
    pieces: [
      { title: "边做饭边乱唱", kind: "自己哼的歌", src: "./assets/demo-audio/cooking-hum.wav" },
      { title: "今天菜市场好热闹", kind: "环境音",   src: "./assets/demo-audio/market.wav" },
    ],
  },
];
export const MY = CHANNELS[0];
function applyDemoLang() {
  CHANNELS.forEach((ch) => {
    if (!ch.demoKey) return;
    ch.name = t(`${ch.demoKey}Name`); ch.owner = t(`${ch.demoKey}Owner`); ch.intro = t(`${ch.demoKey}Intro`);
    ch.pieces.forEach((p, i) => { p.title = t(`${ch.demoKey}T${i + 1}`); });
  });
}
function applyStaticI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.i18nAria)); });
}
function paintLangBtn() {
  if (!langBtn) return;
  langBtn.textContent = lang === "zh" ? "EN" : "中";
  langBtn.title = lang === "zh" ? "Switch to English" : "切换到中文";
}
// re-renders everything that carries app copy — demo stations, static chrome, the
// current dial/track-list/share-box — without touching a real user's own station
// name/intro/track titles or a guest's shared content
function setLang(l) {
  setLangValue(l);   // owns the variable and its persistence — see i18n.js
  document.documentElement.lang = lang === "en" ? "en" : "zh";
  applyDemoLang();
  MY.pieces.forEach((p) => { if (p.placeholder) Object.assign(p, PLACEHOLDER()); });
  if (!MY.created) {
    MY.name = t("myStation"); MY.owner = t("me");
    // left empty (not pre-filled with the internal default) so the placeholder
    // example shows in its own muted style — a real-looking value here is
    // exactly what let testers mistake "My Station" for an already-chosen name
    if (!winStation.hidden) { chNameInput.value = ""; chIntroInput.value = MY.intro; }
  }
  applyStaticI18n();
  renderChannel();
  renderTrackList();
  renderShareLinkBox();
  paintLangBtn();
}

// ---- state ----
let ci = 0, pi = 0, playing = false, cur = 0, raf = null, lastTs = 0;

const audio = new Audio();
audio.preload = "metadata";
audio.volume = 0.72;

const $ = (id) => document.getElementById(id);
const sbfm = $("sbfm"), perch = $("perch"), filepick = $("filepick");
const winMain = $("winMain"), winStation = $("winStation"), winLook = $("winLook"), winShare = $("winShare"), winAbout = $("winAbout");
const player = $("player"), screenEl = document.querySelector(".screen");
const minBtn = $("min"), lookBtn = $("lookBtn"), langBtn = $("langBtn"), aboutBtn = $("aboutBtn"), stationClose = $("stationClose"), lookClose = $("lookClose"), shareClose = $("shareClose"), aboutClose = $("aboutClose");
const dialMid = $("dialMid"), elTagline = $("tagline");
const chNameInput = $("chNameInput"), chIntroInput = $("chIntroInput"), chUpload = $("chUpload"), stationSave = $("stationSave");
const recordBtn = $("recordBtn"), recordIdle = document.querySelector(".record-idle"), recordLive = document.querySelector(".record-live"), recordTime = document.querySelector(".record-time");
const recordOut = $("recordOut");
const trackList = $("trackList"), trackCountLabel = $("trackCountLabel");
const openShareBtn = $("openShareBtn"), shareBtn = $("shareBtn"), shareOut = $("shareOut");
const restoreBtn = $("restoreBtn"), restoreInput = $("restoreInput");
const copyLinkBtn = $("copyLinkBtn");
const stampBtn = $("stampBtn");
const swatches = [...document.querySelectorAll(".swatch")];
const elTitle = $("title"), elKind = $("artist"), elDj = $("dj"), elDjWrap = $("djWrap"), elFreq = $("freq"), elSname = $("sname");
const elNewDot = $("newDot");
const elCur = $("cur"), elDur = $("dur"), elFill = $("fill"), elBar = $("bar"), elCover = $("cover"), elVol = $("vol");

export const channel  = () => CHANNELS[ci];
const piece    = () => channel().pieces[pi];
const hasAudio = () => !!piece() && !!piece().src;
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const trackDur = () => (hasAudio() && isFinite(audio.duration) && audio.duration ? audio.duration : (piece() ? piece().dur : 0));

// ---- tiny IndexedDB layer: my tracks survive reloads ----
// This is where the station actually lives, so a write failing here is not a detail:
// the track is in the list and playing, and it will be gone on the next reload. Every
// path below therefore surfaces its failure rather than swallowing it.
const idb = {
  db: null,
  open: () => new Promise((res, rej) => {
    const r = indexedDB.open("sbfm", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("tracks", { keyPath: "id", autoIncrement: true });
    r.onsuccess = () => res((idb.db = r.result));
    // private browsing refuses outright, and some engines throw here rather than
    // rejecting — either way the app has to keep working without persistence
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error("IndexedDB blocked by another open tab"));
  }),
  put: (rec) => new Promise((res, rej) => {
    // open() may have failed; without this the caller gets an unhelpful
    // "cannot read properties of null" instead of the real reason
    if (!idb.db) return rej(Object.assign(new Error("no local storage available"), { noStorage: true }));
    let rq;
    try {
      rq = idb.db.transaction("tracks", "readwrite").objectStore("tracks").put(rec);
    } catch (e) { return rej(e); }   // quota can throw synchronously on some engines
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  }),
  all: () => new Promise((res, rej) => {
    if (!idb.db) return res([]);   // nothing stored is not an error, just an empty station
    const rq = idb.db.transaction("tracks").objectStore("tracks").getAll();
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  }),
  remove: (id) => new Promise((res, rej) => {
    if (!idb.db) return res();
    const rq = idb.db.transaction("tracks", "readwrite").objectStore("tracks").delete(id);
    rq.onsuccess = () => res();
    rq.onerror = () => rej(rq.error);
  }),
};

// Ask the browser to treat this data as worth keeping. Without it, storage is
// "best effort" and gets evicted under pressure — on iOS that can happen after about
// a week of not visiting, which for a station that lives locally means it simply
// disappears. Best effort itself: plenty of engines decline, and there is nothing
// useful to tell someone about a refusal they cannot act on. The real answer to
// eviction is being able to pull the station back from its own share link.
function askForDurableStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().then(
        (granted) => { if (!granted) console.info("storage is evictable; a shared link is the way back"); },
        () => {});
    }
  } catch {}
}

// A save that failed means the track is playing now and gone after a reload. Say so,
// and say which kind of gone it is, because "out of space" and "this browser will not
// store anything" have different ways out.
function noteSaveFailure(e) {
  const outOfSpace = e && (e.name === "QuotaExceededError" || /quota/i.test(e.message || ""));
  const noStorage = !!(e && e.noStorage);
  say(t(outOfSpace ? "saveFailedFull" : noStorage ? "saveFailedNoStorage" : "saveFailed"), recordOut);
  reportError("idbSave", e);
}

// ---- personal theme (the LISTENER's preference, not the channel's) ----
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem("sbfm-theme", t); } catch {}
  paintSwatches();
}
export function currentTheme() { return document.documentElement.getAttribute("data-theme") || "blue"; }
function paintSwatches() {
  const active = currentTheme();
  swatches.forEach((s) => s.classList.toggle("active", s.dataset.theme === active));
}

// ---- every station's "frequency" is derived from its own name, not assigned by us —
// same name always lands on the same number. This is a papercut fairy-tale object, not
// a broadcast-accurate tuner, so the only rule that matters is "looks like XX.X FM";
// real-world FCC channel spacing would be invisible pedantry nobody could ever notice.
// Free-range tenths across 88.0–107.9 (200 slots) also means fewer accidental frequency
// collisions between friends than a stricter real-world-only band would allow.
function stationFreq(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return (88.0 + (h % 200) * 0.1).toFixed(1);
}

// ---- render ----
export function renderChannel() {
  const ch = channel();
  const isCta = !!ch.mine && !MY.created;   // fresh users see an invitation, not a name
  elFreq.textContent = isCta ? "★" : stationFreq(ch.freqKey || ch.name);
  elSname.textContent = isCta ? t("inviteMakeYourOwn") : ch.name;
  elNewDot.hidden = !ch.hasNew;
  dialMid.classList.toggle("cta", isCta);
  elDj.textContent = ch.owner || ch.name;
  // on the empty CTA slot, the tagline line doubles as a legend for the ◁▷ tune
  // buttons flanking it above — otherwise they read as acting on the CTA text itself
  const text = isCta ? t("tuneListenFriend") : (ch.intro || "");
  elTagline.textContent = text;
  elTagline.hidden = !text;
  renderPiece();
  updateStampButton();
}
function renderPiece() {
  const p = piece();
  if (!p) return;
  elTitle.textContent = p.title;
  elKind.textContent = p.artist || kindText(p.kind) || channel().name || "";
  elDjWrap.hidden = !!p.placeholder;   // the "· owner" byline doesn't belong on an empty-state hint
  if (p.cover) { elCover.style.backgroundImage = `url("${p.cover}")`; elCover.classList.add("show"); }
  else { elCover.style.backgroundImage = ""; elCover.classList.remove("show"); }
  cur = 0;
  if (hasAudio()) audio.src = p.src;
  updateProgress();
  syncMediaSession();
}
function updateProgress() {
  const d = trackDur();
  elFill.style.width = (d ? (cur / d) * 100 : 0) + "%";
  elCur.textContent = fmt(cur);
  elDur.textContent = fmt(d);
}

// ---- system media keys / now-playing (MediaSession) ----
function syncMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const p = piece();
  if (!p) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: p.title || "",
      artist: p.artist || kindText(p.kind) || "",
      album: `${channel().name} · silly bird FM`,
      artwork: p.cover ? [{ src: p.cover, sizes: "512x512" }] : [],
    });
  } catch {}
}
function wireMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const on = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch {} };
  on("play", play); on("pause", pause); on("previoustrack", prev); on("nexttrack", next);
}

// real audio drives progress for imported tracks
audio.addEventListener("timeupdate", () => { if (hasAudio()) { cur = audio.currentTime; updateProgress(); } });
audio.addEventListener("loadedmetadata", () => { if (hasAudio()) updateProgress(); });
audio.addEventListener("ended", () => { markListened(pi); next(); });

// demo tracks (no src) use a fake timer so the placeholder still animates
function tick(ts) {
  if (!playing || hasAudio()) return;
  if (!piece() || !(piece().dur > 0)) { pause(); return; }
  if (!lastTs) lastTs = ts;
  cur += (ts - lastTs) / 1000; lastTs = ts;
  if (cur >= piece().dur) { next(); return; }
  updateProgress();
  raf = requestAnimationFrame(tick);
}
function stopTimer() { if (raf) { cancelAnimationFrame(raf); raf = null; } }

function applyPlay() {
  if (playing && hasAudio())      { stopTimer(); audio.play().catch(() => {}); }
  else if (playing)               { audio.pause(); lastTs = 0; stopTimer(); raf = requestAnimationFrame(tick); }
  else                            { audio.pause(); stopTimer(); }
  player.classList.toggle("playing", playing);
  if ("mediaSession" in navigator) { try { navigator.mediaSession.playbackState = playing ? "playing" : "paused"; } catch {} }
}
function play()  { playing = true;  applyPlay(); }
function pause() { playing = false; applyPlay(); }
const toggle = () => (playing ? pause() : play());

function goPiece(n) { const len = channel().pieces.length; pi = ((n % len) + len) % len; renderPiece(); applyPlay(); }
function next() { goPiece(pi + 1); }
function prev() { if (cur > 3) return seek(0); goPiece(pi - 1); }
function seek(t) { cur = Math.max(0, Math.min(t, trackDur() || t)); if (hasAudio()) audio.currentTime = cur; updateProgress(); }
function tune(d) { ci = (ci + d + CHANNELS.length) % CHANNELS.length; pi = 0; renderChannel(); applyPlay(); }

// One quiet nudge, once, toward whichever arrow is actually the short way to your
// own empty slot — never a standing hint, since a repeating one would be exactly
// the kind of noise this project has otherwise refused to add. Direction is worked
// out fresh rather than assumed, because a guest link changes which side is closer.
function nudgeTowardMyStation() {
  const myIdx = CHANNELS.indexOf(MY);
  if (myIdx === ci) return;
  const len = CHANNELS.length;
  const viaNext = (myIdx - ci + len) % len;
  const viaPrev = (ci - myIdx + len) % len;
  const el = viaNext <= viaPrev ? $("tnext") : $("tprev");
  setTimeout(() => {
    el.classList.add("tune-hint");
    setTimeout(() => el.classList.remove("tune-hint"), 1700);
  }, 700);   // let the landing screen settle before drawing an eye to the dial
}

// ---- import: files land in MY station and persist in IndexedDB ----
// one station = one album, on purpose — a curated handful, not a dumping ground.
// recording and uploading both funnel through here, so the cap covers both at once.
const AUDIO_RE = /\.(mp3|m4a|wav|flac|ogg|aac|opus)$/i;
const MAX_TRACKS = 7;
export function importFiles(list) {
  const files = [...list].filter((f) => (f.type && f.type.startsWith("audio/")) || AUDIO_RE.test(f.name));
  if (!files.length) return;
  if (MY.pieces[0] && MY.pieces[0].placeholder) MY.pieces.length = 0;
  const room = MAX_TRACKS - MY.pieces.length;
  if (room <= 0) { say(t("stationFull", MAX_TRACKS), recordOut); return; }
  const over = files.length > room;
  const use = over ? files.slice(0, room) : files;
  if (over) say(t("stationFullTrim", MAX_TRACKS, use.length), recordOut);
  const start = MY.pieces.length;
  const pieces = use.map((f) => ({
    title: f.name.replace(/\.[^.]+$/, ""), artist: "", dur: 0,
    src: URL.createObjectURL(f), cover: null, blob: f,
  }));
  MY.pieces.push(...pieces);
  MY.created = true;
  ci = CHANNELS.indexOf(MY); pi = start;
  renderChannel();
  renderTrackList();
  play();
  pieces.forEach((p) => {
    idb.put({ title: p.title, artist: p.artist, kind: "", cover: null, blob: p.blob, t: Date.now() })
      .then((id) => {
        p.dbId = id;
        // an edit (rename, tag, ID3 read) made while this put() was still in flight
        // would otherwise be silently dropped — persistPiece() no-ops without a dbId,
        // and this put() already wrote whatever p looked like before it resolved
        persistPiece(p);
      })
      // the track is in the list and playing either way — but if this failed it is
      // only in memory, and a reload loses it. That has to be said out loud.
      .catch(noteSaveFailure);
  });
  use.forEach((f, i) => readTags(f, pieces[i]));
  return pieces;   // so a caller that knows more than the filename can fill the rest in
}
function readTags(file, p) {
  if (!window.jsmediatags) return;
  window.jsmediatags.read(file, {
    onSuccess: ({ tags }) => {
      if (tags.title)  p.title  = tags.title;
      if (tags.artist) p.artist = tags.artist;
      if (tags.picture) {
        const { data, format } = tags.picture;
        let s = "";
        for (let i = 0; i < data.length; i++) s += String.fromCharCode(data[i]);
        p.cover = `data:${format};base64,${btoa(s)}`;
      }
      if (p.dbId) persistPiece(p);
      if (piece() === p) renderPiece();
      renderTrackList();
    },
    onError: () => {},
  });
}

// ---- track list inside "我的电台": the missing "did it actually work" feedback ----
// optional flavor tag per track, picked from a real <select> — no hidden cycling to
// discover, no hover-only tooltip that touch devices can never see
// TRACK_KINDS stays the canonical Chinese key set — it's what's actually stored in
// IndexedDB / a shared station.json, so switching display language can never change
// what's persisted. kindText()/kindLabel() are display-only translations of a key.
const TRACK_KINDS = ["", "声音故事", "自己哼的歌", "环境音", "最近循环播放的歌"];
const KIND_DISPLAY = {
  "声音故事":         { zh: "声音故事",         en: "voice story" },
  "自己哼的歌":       { zh: "自己哼的歌",       en: "hummed tune" },
  "环境音":           { zh: "环境音",           en: "ambient" },
  "最近循环播放的歌": { zh: "最近循环播放的歌", en: "on repeat lately" },
};
const kindText  = (k) => (k && KIND_DISPLAY[k]) ? KIND_DISPLAY[k][lang] : (k || "");
const kindLabel = (k) => (k ? kindText(k) : t("addTag"));

// Real feedback: friends have used their station as a drift bottle, a tree-hollow
// confession, a mood left for a partner - none of that fits a station meant to be
// curated and kept. First cut of this put the choice on every track (a 7-track
// upload meant answering the same question 7 times) - moved to a single setting
// on the share itself instead: one choice, at share time, for the one link that
// actually goes out. Still opt-in, still defaults to permanent, still the same
// value as revoke share - the person sharing decides, never an automatic timer
// applied to everyone regardless of what they're using this for.
// the four choices themselves are static HTML (index.html, translated via the
// usual data-i18n scan), so this only has to carry what each one means in ms
export const TTL_MS = { "1d": 864e5, "7d": 6048e5, "30d": 2592e6 };
// exported: share.js checks the same clock against MY (this browser's own
// station) and against a guest's freshly-fetched manifest - one deadline for
// the whole share, not per track, so either shape works with the same check
export const isExpired = (o) => !!(o.shareExpiresAt && o.shareExpiresAt <= Date.now());
export function esc(s) { return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c])); }
export function renderTrackList() {
  const real = MY.pieces.filter((p) => !p.placeholder);
  trackCountLabel.textContent = real.length ? t("programsCount", real.length, MAX_TRACKS) : t("programs");
  trackList.hidden = !real.length;
  trackList.innerHTML = real.map((p, i) => `
    <div class="track-row" data-i="${i}">
      <input class="track-name" data-i="${i}" value="${esc(p.title)}" aria-label="${esc(t("trackName"))}" />
      <select class="track-tag" data-i="${i}" aria-label="${esc(t("trackTag"))}">
        ${TRACK_KINDS.map((k) => `<option value="${esc(k)}"${(p.kind || "") === k ? " selected" : ""}>${esc(kindLabel(k))}</option>`).join("")}
      </select>
      <button class="track-remove" data-i="${i}" aria-label="${esc(t("remove"))}" title="${esc(t("remove"))}">×</button>
    </div>`).join("");
  // whether there is anything here is exactly what decides the recovery offer, so
  // settle it wherever that changes rather than only when the panel opens
  updateRestoreBtn();
}
export function persistPiece(p) {
  if (!p.dbId) return;
  idb.put({ id: p.dbId, title: p.title, artist: p.artist, kind: p.kind || "", cover: p.cover, blob: p.blob, t: Date.now() }).catch(noteSaveFailure);
}
trackList.addEventListener("change", (e) => {
  const sel = e.target.closest(".track-tag");
  const nameInput = e.target.closest(".track-name");
  if (!sel && !nameInput) return;
  const real = MY.pieces.filter((p) => !p.placeholder);
  const field = sel || nameInput;
  const p = real[+field.dataset.i];
  if (!p) return;
  if (sel) {
    p.kind = sel.value;
  } else {
    // uploaded files often carry ugly auto-generated names (WeChat-saved audio
    // in particular) — this is the fix for that, not just a nicety
    const next = nameInput.value.trim();
    if (!next) { nameInput.value = p.title; return; }   // don't allow blanking the title out
    p.title = next;
  }
  persistPiece(p);
  if (channel() === MY && piece() === p) renderPiece();
});
trackList.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.closest(".track-name")) e.target.blur();
});
trackList.addEventListener("click", (e) => {
  const btn = e.target.closest(".track-remove");
  if (!btn) return;
  const real = MY.pieces.filter((p) => !p.placeholder);
  const p = real[+btn.dataset.i];
  if (!p) return;
  const idx = MY.pieces.indexOf(p);
  if (idx > -1) MY.pieces.splice(idx, 1);
  if (p.dbId) idb.remove(p.dbId).catch(() => {});
  if (p.src && p.src.startsWith("blob:")) URL.revokeObjectURL(p.src);
  if (!MY.pieces.length) MY.pieces.push({ ...PLACEHOLDER() });
  if (channel() === MY) { if (pi >= MY.pieces.length) pi = 0; renderChannel(); }
  renderTrackList();
});

export function say(msg, target = shareOut) { target.hidden = false; target.textContent = msg; }

// ---- transport wiring ----
$("play").addEventListener("click", toggle);
$("next").addEventListener("click", next);
$("prev").addEventListener("click", prev);
$("tnext").addEventListener("click", () => tune(1));
$("tprev").addEventListener("click", () => tune(-1));
elBar.addEventListener("click", (e) => { const r = elBar.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * trackDur()); });
elVol.addEventListener("input", () => {
  const v = elVol.value;
  audio.volume = v / 100;
  elVol.style.background = `linear-gradient(90deg, var(--ink) 0 ${v}%, var(--paper) ${v}% 100%)`;
});
// native range inputs only move when you drag the thumb precisely — mobile browsers
// (iOS Safari notably) don't jump the value on a plain tap elsewhere on the track. The
// progress bar above already solves this with its own click-to-seek; do the same here.
elVol.addEventListener("click", (e) => {
  const r = elVol.getBoundingClientRect();
  elVol.value = Math.round(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)));
  elVol.dispatchEvent(new Event("input", { bubbles: true }));
});

// ---- import wiring: drop zone + panel upload + share ----
["dragenter", "dragover"].forEach((ev) => player.addEventListener(ev, (e) => {
  if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { e.preventDefault(); screenEl.classList.add("dragging"); }
}));
player.addEventListener("dragleave", (e) => { if (!player.contains(e.relatedTarget)) screenEl.classList.remove("dragging"); });
player.addEventListener("drop", (e) => { e.preventDefault(); screenEl.classList.remove("dragging"); if (e.dataTransfer) importFiles(e.dataTransfer.files); });
filepick.addEventListener("change", () => { importFiles(filepick.files); filepick.value = ""; });
chUpload.addEventListener("click", () => filepick.click());
shareBtn.addEventListener("click", shareStation);

// ---- press-and-hold recording: a second door into the exact same pipeline as
// uploading a file — a held moment (street noise, a passing thought) is just as
// valid a program as a carefully-picked one, so both land in the same track list ----
let recStream = null, recRecorder = null, recChunks = [], recStartedAt = 0, recRaf = null;
const canRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
if (!canRecord) recordBtn.hidden = true;

function recTick() {
  const s = Math.floor((Date.now() - recStartedAt) / 1000);
  recordTime.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  recRaf = requestAnimationFrame(recTick);
}
async function startRecording() {
  if (recRecorder) return;
  const realCount = MY.pieces.filter((p) => !p.placeholder).length;
  if (realCount >= MAX_TRACKS) { say(t("stationFullRecord", MAX_TRACKS), recordOut); return; }
  try {
    recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    say(t("micDenied"), recordOut);
    return;
  }
  recChunks = [];
  const mime = ["audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
  recRecorder = new MediaRecorder(recStream, mime ? { mimeType: mime } : undefined);
  recRecorder.ondataavailable = (e) => { if (e.data.size > 0) recChunks.push(e.data); };
  recRecorder.start();
  recStartedAt = Date.now();
  recordBtn.classList.add("recording");
  recordIdle.hidden = true; recordLive.hidden = false;
  recTick();
}
function stopRecording() {
  if (!recRecorder) return;
  cancelAnimationFrame(recRaf);
  recordBtn.classList.remove("recording");
  recordIdle.hidden = false; recordLive.hidden = true;
  const heldMs = Date.now() - recStartedAt;
  const mr = recRecorder;
  recRecorder = null;
  mr.addEventListener("stop", () => {
    recStream.getTracks().forEach((t) => t.stop());
    recStream = null;
    if (heldMs < 500 || !recChunks.length) return;   // too brief to be intentional — discard, like a mis-tap
    const mime = mr.mimeType || "audio/webm";
    const ext = mime.split("/")[1]?.split(";")[0] || "webm";
    const now = new Date();
    const title = t("recordingTitle", now.getMonth() + 1, now.getDate(), String(now.getHours()).padStart(2, "0"), String(now.getMinutes()).padStart(2, "0"));
    importFiles([new File([new Blob(recChunks, { type: mime })], `${title}.${ext}`, { type: mime })]);
  }, { once: true });
  mr.stop();
}
recordBtn.addEventListener("mousedown", (e) => { if (e.button === 0) startRecording(); });
recordBtn.addEventListener("touchstart", (e) => { e.preventDefault(); startRecording(); }, { passive: false });
window.addEventListener("mouseup", stopRecording);
window.addEventListener("touchend", stopRecording);
window.addEventListener("touchcancel", stopRecording);
recordBtn.addEventListener("contextmenu", (e) => e.preventDefault());

// ---- windows: open / close / first-open placement beside the main radio ----
// (stacking/dragging mechanics live in windows.js — this is just the per-window wiring)
dialMid.addEventListener("click", () => {
  // Real friend feedback: clicking a demo channel's own name/frequency here
  // used to open "My Station" too, since this never checked which channel was
  // actually tuned in - confusing on any channel that is not yours. Gated on
  // ch.mine (set only on CHANNELS[0]/MY), not on the CTA-only isCta check in
  // renderChannel(), so someone who already created their station can still
  // open it here to edit once they have tuned back to their own slot - only
  // demo/guest channels are excluded.
  if (!channel().mine) return;
  // before a station is actually created, MY.name is only an internal fallback —
  // showing it as the input's value renders it in the same ink as real content,
  // which is exactly what let testers read "My Station" as already chosen rather
  // than as an example. Leave it empty so the placeholder does that job instead.
  if (winStation.hidden) { chNameInput.value = MY.created ? MY.name : ""; chIntroInput.value = MY.intro; renderTrackList(); updateRestoreBtn(); }
  toggleWin(winStation);
});
lookBtn.addEventListener("mousedown", (e) => e.stopPropagation());
lookBtn.addEventListener("click", () => {
  paintSwatches();
  // Directly under the radio, not beside it - real feedback was that "the
  // thing controlling how the radio looks" reads better sitting right under
  // the radio itself. placeBeside's own collision-avoidance still nudges it
  // clear if Station (or anything else) is already sitting there.
  toggleWin(winLook, null, winMain, true);
});
langBtn.addEventListener("mousedown", (e) => e.stopPropagation());
langBtn.addEventListener("click", () => setLang(lang === "zh" ? "en" : "zh"));
aboutBtn.addEventListener("mousedown", (e) => e.stopPropagation());
aboutBtn.addEventListener("click", () => toggleWin(winAbout));
aboutClose.addEventListener("click", () => closeWin(winAbout));
openShareBtn.addEventListener("click", () => {
  const opening = winShare.hidden;
  renderShareLinkBox();
  loadStamps();
  toggleWin(winShare, () => winStation.getBoundingClientRect().top, winStation);
  // this button already promises "generate" by name — fulfill that on the first
  // click instead of opening a card that then asks for a second one
  if (opening && !MY.shareToken) shareStation();
});
stationClose.addEventListener("click", () => { stopRecording(); closeWin(winStation); });
lookClose.addEventListener("click", () => closeWin(winLook));
shareClose.addEventListener("click", () => closeWin(winShare));
// a keyboard user reaching a close button meant tabbing all the way to it —
// Escape is the standard way out of a panel and had no handler at all.
// Triggers the same close buttons above rather than duplicating their logic,
// so stationClose's stopRecording() still runs and nothing can drift out of
// sync between the two paths.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!winStation.hidden) stationClose.click();
  if (!winLook.hidden) lookClose.click();
  if (!winShare.hidden) shareClose.click();
  if (!winAbout.hidden) aboutClose.click();
});
copyLinkBtn.addEventListener("click", copyShareLink);
stampBtn.addEventListener("click", sendStamp);

swatches.forEach((s) => s.addEventListener("click", () => applyTheme(s.dataset.theme)));

export function persistStationMeta() {
  try {
    localStorage.setItem("sbfm-station", JSON.stringify({
      name: MY.name, intro: MY.intro, shareToken: MY.shareToken || null,
      shareTtl: MY.shareTtl || "", shareExpiresAt: MY.shareExpiresAt || null,
    }));
  } catch {}
}
function saveStation() {
  const name = chNameInput.value.trim();
  if (name) MY.name = name;
  MY.owner = MY.name;   // one identity, not two questions — your station name IS your byline
  MY.intro = chIntroInput.value.trim();
  MY.created = true;
  persistStationMeta();
  renderChannel();
  // stay open — the natural next click is 生成分享链接, right below this button
  const original = stationSave.textContent;
  stationSave.textContent = t("saved");
  stationSave.disabled = true;
  setTimeout(() => { stationSave.textContent = original; stationSave.disabled = false; }, 1100);
}
stationSave.addEventListener("click", saveStation);
restoreBtn.addEventListener("click", restoreFromLink);
restoreInput.addEventListener("keydown", (e) => { if (e.key === "Enter") restoreFromLink(); });
[chNameInput, chIntroInput].forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter") saveStation(); }));

// ---- collapse / expand ----
minBtn.addEventListener("mousedown", (e) => e.stopPropagation());
minBtn.addEventListener("click", (e) => { e.stopPropagation(); sbfm.classList.add("collapsed"); });

// in the Tauri shell #dragMain is a native OS drag region (see index.html) —
// wiring our own web-level drag on top of it fights the native one. The
// window needs real decorations (macOS titleBarStyle: Overlay, not fully
// undecorated) for native dragging to work at all — see project memory.
// On a phone the four cards auto-stack (see restackMobile) instead of floating
// freely, so dragging them would just fight the stack on the very next open or
// close — skip wiring it there.
if (!document.documentElement.classList.contains("in-tauri") && !isNarrowViewport()) {
  makeDraggable(winMain, $("dragMain"));
  // Real feedback: the titlebar strip alone was too easy to miss as a drag
  // handle. The bird artwork is the obvious, big target, so it can start the
  // same drag too - a second independent handle on the same card, not a
  // replacement (makeDraggable() tracks its own start/moved state per
  // handle, so two handles driving one element don't fight each other).
  makeDraggable(winMain, screenEl);
}
if (!isNarrowViewport()) {
  makeDraggable(winStation, $("dragStation"));
  makeDraggable(winLook, $("dragLook"));
  makeDraggable(winShare, $("dragShare"));
  makeDraggable(winAbout, $("dragAbout"));
}
// The collapsed perch is meant to sit anywhere on the real desktop, not just
// wherever it happens to load — in a browser tab that already works, since
// makeDraggable()'s CSS positioning is bounded by the tab's own viewport,
// which is however big the user made it. In the Tauri shell that viewport
// IS the OS window, and the window is a small fixed 380x500 - so the same
// code silently confines the bird to a small corner of the screen instead of
// letting it roam. #perch carries data-tauri-drag-region (see index.html) so
// a drag there moves the window itself instead; makeDraggable's CSS
// positioning would just fight that, so it's skipped here the same way
// #dragMain is. Tapping (rather than dragging) still needs to expand the
// player, which is the one part makeDraggable was also doing for this
// element - a plain click listener replaces it.
if (document.documentElement.classList.contains("in-tauri")) {
  perch.addEventListener("click", () => sbfm.classList.remove("collapsed"));
} else {
  makeDraggable(perch, perch, () => sbfm.classList.remove("collapsed"));
}

// ---- boot ----
(async function boot() {
  // static chrome translates synchronously, before any async work below, so a
  // default-English visitor never sees a flash of the Chinese fallback text
  // authored in index.html
  applyStaticI18n();
  document.documentElement.lang = lang === "en" ? "en" : "zh";
  // deliberately NOT claiming an identity here. Anonymous sign-ins are rate limited
  // for the whole project, and most visitors only ever listen — signing up every one
  // of them spends that budget on people who will never write, so a link doing the
  // rounds in a group chat can lock out the friends who actually want to make a
  // station. cloudPut/cloudDelete claim one on demand instead; the extra round trip
  // lands inside an upload that already takes seconds.
  // a friend's link takes a real network round-trip to resolve — show that
  // something is happening immediately instead of flashing the default channel
  // first and then swapping to the real one a moment later
  const hasGuestLink = !!new URLSearchParams(location.search).get("listen");
  if (hasGuestLink) {
    elFreq.textContent = "···";
    elSname.textContent = t("tuningIn");
    elTagline.hidden = true;
    elTitle.textContent = "";
    elKind.textContent = "";
    elDjWrap.hidden = true;
  }
  // screenshot helper first (synchronous): ?shot=main|station|look isolates one window at 20,20
  const shot = new URLSearchParams(location.search).get("shot");
  if (shot) {
    winMain.hidden = shot !== "main";
    const tgt = { main: winMain, station: winStation, look: winLook, share: winShare }[shot];
    if (tgt) { tgt.hidden = false; tgt.style.left = "20px"; tgt.style.top = "20px"; tgt.dataset.placed = "1"; }
  }
  let theme = "blue";
  try { theme = localStorage.getItem("sbfm-theme") || "blue"; } catch {}
  document.documentElement.setAttribute("data-theme", theme);
  try {
    const saved = JSON.parse(localStorage.getItem("sbfm-station") || "null");
    if (saved) {
      if (saved.name) MY.name = saved.name;
      MY.owner = MY.name; MY.intro = saved.intro || ""; MY.created = true;
      if (saved.shareToken) MY.shareToken = saved.shareToken;
      MY.shareTtl = saved.shareTtl || ""; MY.shareExpiresAt = saved.shareExpiresAt || null;
    }
  } catch {}
  paintSwatches();
  wireMediaSession();

  // restore my persisted tracks (before the first render, so the landing-channel
  // decision below sees the final MY.created state)
  try {
    await idb.open();
    askForDurableStorage();
    const rows = await idb.all();
    if (rows.length) {
      if (MY.pieces[0] && MY.pieces[0].placeholder) MY.pieces.length = 0;
      MY.pieces.push(...rows.map((r) => ({
        title: r.title, artist: r.artist || "", kind: r.kind || "", dur: 0, cover: r.cover || null,
        src: URL.createObjectURL(r.blob), blob: r.blob, dbId: r.id,
      })));
      MY.created = true;
    }
  } catch (e) {
    // no local storage at all (private browsing is the usual reason). Listening and
    // sharing still work, so do not block anything — but the moment someone adds a
    // track they are owed the warning, and noteSaveFailure will give it to them.
    reportError("idbRestore", e);
  }
  // No prompt, no countdown - the duration was chosen once, at share time, and
  // the rest is silence. Not awaited: this only ever does anything for the rare
  // visit where this browser's own share has actually come due, and revoking it
  // late by a few seconds costs nothing - blocking the radio on a cloud round
  // trip nobody asked to watch for would be a worse trade.
  checkShareExpiry();

  // turning the radio on should land you on a station that's already playing —
  // like a real radio, not a blank "make your own broadcast" screen. First-time
  // visitors land on a friend's channel; once you've made your own, you come back
  // to it. (A ?listen= link below still wins over both.)
  if (!MY.created) ci = 1;
  // resolve a friend's link (a no-op right away if there isn't one) before the
  // first real render, so setLang()'s renderChannel() paints the guest station
  // directly instead of showing the default channel first and swapping a moment
  // later once the fetch comes back. fetchGuestStation() only fetches+validates;
  // splicing it into the dial is the player's job, done here.
  const guestCh = await fetchGuestStation();
  if (guestCh && !guestCh.failed && !guestCh.expired) { CHANNELS.unshift(guestCh); ci = 0; pi = 0; }
  setLang(lang);   // applies the restored language to static chrome + demo content + dial
  // A link that fails to resolve used to fall through in silence, landing on
  // whatever demo channel setLang() just painted — indistinguishable from the
  // app simply being broken. Say so instead: this overwrites setLang()'s own
  // render, on purpose, only in this one case.
  if (hasGuestLink && (!guestCh || guestCh.failed || guestCh.expired)) {
    elSname.textContent = t(guestCh && guestCh.expired ? "guestExpiredTitle" : "guestLoadFailedTitle");
    elTagline.textContent = t(
      guestCh && guestCh.expired ? "guestExpired" : guestCh && guestCh.network ? "guestLoadFailedNetwork" : "guestLoadFailed"
    );
    elTagline.hidden = false;
  }

  // Nobody arrives already knowing that turning the dial finds their own empty slot
  // — the invite CTA only ever appears once you tune to it, and nothing before that
  // moment points there. A friend who followed a link and MY.pieces[0] never
  // recorded anything reported exactly this. A guest channel above may have just
  // unshifted to the front, which flips which physical arrow is closer to MY — so
  // this asks the current layout rather than assuming a side.
  if (!MY.created) nudgeTowardMyStation();

  // dev helper: ?seed=1 imports a synthetic tone (used to e2e-test IDB persistence and
  // to populate demo content for README screenshots). Idempotent — a second load with
  // the same flag (e.g. capturing several ?shot= screenshots in one warm profile) won't
  // duplicate the track.
  if (new URLSearchParams(location.search).has("seed") && !MY.pieces.some((p) => !p.placeholder)) {
    const rate = 8000, n = rate;
    const buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
    const wr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    wr(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); wr(8, "WAVE"); wr(12, "fmt ");
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    wr(36, "data"); dv.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 659 * i / rate) * 8000, true);
    MY.name = "小佳的深夜电台"; MY.owner = MY.name; MY.intro = "睡不着的夜里，说给你听"; MY.created = true;
    importFiles([new File([new Blob([buf], { type: "audio/wav" })], "写代码写到凌晨三点.wav", { type: "audio/wav" })]);
    setTimeout(() => { const p = MY.pieces[0]; if (p) { p.kind = "声音故事"; renderTrackList(); renderPiece(); } }, 50);
  }
  // the ?shot=station debug path bypasses the normal dialMid-click open flow, which is
  // what usually syncs these inputs from MY — sync them here too so the screenshot isn't
  // stuck showing placeholder text
  if (shot === "station") { chNameInput.value = MY.created ? MY.name : ""; chIntroInput.value = MY.intro; renderTrackList(); }

  // restacking only ever ran when a card opened or closed, so on a phone the very
  // first screen kept the parked default of left:8px and sat visibly off-centre.
  // Do it once now that the card has its real width, and again if the phone turns.
  if (isNarrowViewport()) restackMobile();
  window.addEventListener("resize", () => { if (isNarrowViewport()) restackMobile(); });
})();
