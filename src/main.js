// silly bird FM — player core
// Three floating papercut windows (radio / my-station / look), draggable, Poolsuite-style.
// P0: imports persist in IndexedDB (survive reload); MediaSession (system media keys);
//     self-hosted fonts (see style.css).
// P1: share = upload your station to cloud storage → send friends a ?listen= link;
//     opening such a link tunes a read-only copy of that station in first position.
//     Cloud is config-gated: fill CLOUD below (see README «分享» section).
window.__SBFM = "p0p1";

// ---- cloud config lives in src/cloud-config.js (gitignored; copy cloud-config.example.js) ----
const CLOUD = window.SBFM_CLOUD || { url: "", anonKey: "", bucket: "stations" };

const PLACEHOLDER = { title: "还没有节目", kind: "点上面创建电台", dur: 0, placeholder: true };

const CHANNELS = [
  { name: "我的电台", owner: "我", intro: "", mine: true, pieces: [{ ...PLACEHOLDER }] },
  {
    name: "深夜胡思乱想", owner: "小佳", intro: "睡不着的夜里，说给你听",
    pieces: [
      { title: "写代码写到凌晨三点", kind: "声音故事",   dur: 192 },
      { title: "最近单曲循环，哼给你听", kind: "自己哼的歌", dur: 108 },
      { title: "楼下便利店的白噪音", kind: "环境音",     dur: 320 },
    ],
  },
  {
    name: "雨天限定", owner: "Wren", intro: "只在下雨天更新",
    pieces: [
      { title: "阳台上的一整场雨", kind: "环境音",     dur: 484 },
      { title: "读了一段《海边的卡夫卡》", kind: "声音故事", dur: 390 },
    ],
  },
  {
    name: "厨房迪斯科", owner: "Pomelo", intro: "一边做饭一边跳舞",
    pieces: [
      { title: "边做饭边乱唱", kind: "自己哼的歌", dur: 170 },
      { title: "今天菜市场好热闹", kind: "环境音",   dur: 250 },
    ],
  },
];
const MY = CHANNELS[0];

// ---- state ----
let ci = 0, pi = 0, playing = false, cur = 0, raf = null, lastTs = 0;

const audio = new Audio();
audio.preload = "metadata";
audio.volume = 0.72;

const $ = (id) => document.getElementById(id);
const sbfm = $("sbfm"), perch = $("perch"), filepick = $("filepick");
const winMain = $("winMain"), winStation = $("winStation"), winLook = $("winLook"), winShare = $("winShare");
const player = $("player"), screenEl = document.querySelector(".screen");
const minBtn = $("min"), lookBtn = $("lookBtn"), stationClose = $("stationClose"), lookClose = $("lookClose"), shareClose = $("shareClose");
const dialMid = $("dialMid"), elTagline = $("tagline");
const chNameInput = $("chNameInput"), chIntroInput = $("chIntroInput"), chUpload = $("chUpload"), stationSave = $("stationSave");
const recordBtn = $("recordBtn"), recordIdle = document.querySelector(".record-idle"), recordLive = document.querySelector(".record-live"), recordTime = document.querySelector(".record-time");
const recordOut = $("recordOut");
const trackList = $("trackList"), trackCountLabel = $("trackCountLabel");
const openShareBtn = $("openShareBtn"), shareBtn = $("shareBtn"), shareOut = $("shareOut");
const shareLinkBox = $("shareLinkBox"), shareLinkText = $("shareLinkText"), copyLinkBtn = $("copyLinkBtn");
const swatches = [...document.querySelectorAll(".swatch")];
const elTitle = $("title"), elKind = $("artist"), elDj = $("dj"), elDjWrap = $("djWrap"), elFreq = $("freq"), elSname = $("sname");
const elCur = $("cur"), elDur = $("dur"), elFill = $("fill"), elBar = $("bar"), elCover = $("cover"), elVol = $("vol");

const channel  = () => CHANNELS[ci];
const piece    = () => channel().pieces[pi];
const hasAudio = () => !!piece() && !!piece().src;
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const trackDur = () => (hasAudio() && isFinite(audio.duration) && audio.duration ? audio.duration : (piece() ? piece().dur : 0));

// ---- tiny IndexedDB layer: my tracks survive reloads ----
const idb = {
  db: null,
  open: () => new Promise((res, rej) => {
    const r = indexedDB.open("sbfm", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("tracks", { keyPath: "id", autoIncrement: true });
    r.onsuccess = () => res((idb.db = r.result));
    r.onerror = () => rej(r.error);
  }),
  put: (rec) => new Promise((res, rej) => {
    const rq = idb.db.transaction("tracks", "readwrite").objectStore("tracks").put(rec);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  }),
  all: () => new Promise((res, rej) => {
    const rq = idb.db.transaction("tracks").objectStore("tracks").getAll();
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  }),
  remove: (id) => new Promise((res, rej) => {
    const rq = idb.db.transaction("tracks", "readwrite").objectStore("tracks").delete(id);
    rq.onsuccess = () => res();
    rq.onerror = () => rej(rq.error);
  }),
};

// ---- personal theme (the LISTENER's preference, not the channel's) ----
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem("sbfm-theme", t); } catch {}
  paintSwatches();
}
function currentTheme() { return document.documentElement.getAttribute("data-theme") || "blue"; }
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
function renderChannel() {
  const ch = channel();
  const isCta = !!ch.mine && !MY.created;   // fresh users see an invitation, not a name
  elFreq.textContent = isCta ? "★" : stationFreq(ch.name);
  elSname.textContent = isCta ? "＋ 邀请你也做一个自己的电台" : ch.name;
  dialMid.classList.toggle("cta", isCta);
  elDj.textContent = ch.owner || ch.name;
  // on the empty CTA slot, the tagline line doubles as a legend for the ◁▷ tune
  // buttons flanking it above — otherwise they read as acting on the CTA text itself
  const text = isCta ? "◁ ▷ 先听听朋友的电台" : (ch.intro || "");
  elTagline.textContent = text;
  elTagline.hidden = !text;
  renderPiece();
}
function renderPiece() {
  const p = piece();
  if (!p) return;
  elTitle.textContent = p.title;
  elKind.textContent = p.artist || p.kind || channel().name || "";
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
      artist: p.artist || p.kind || "",
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
audio.addEventListener("ended", () => next());

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

// ---- import: files land in MY station and persist in IndexedDB ----
// one station = one album, on purpose — a curated handful, not a dumping ground.
// recording and uploading both funnel through here, so the cap covers both at once.
const AUDIO_RE = /\.(mp3|m4a|wav|flac|ogg|aac|opus)$/i;
const MAX_TRACKS = 7;
function importFiles(list) {
  const files = [...list].filter((f) => (f.type && f.type.startsWith("audio/")) || AUDIO_RE.test(f.name));
  if (!files.length) return;
  if (MY.pieces[0] && MY.pieces[0].placeholder) MY.pieces.length = 0;
  const room = MAX_TRACKS - MY.pieces.length;
  if (room <= 0) { say(`电台已经满了（最多 ${MAX_TRACKS} 首）· 删掉一首再加新的`, recordOut); return; }
  const over = files.length > room;
  const use = over ? files.slice(0, room) : files;
  if (over) say(`电台最多 ${MAX_TRACKS} 首 · 这次加了前 ${use.length} 首，其余没加`, recordOut);
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
      .then((id) => { p.dbId = id; })
      .catch(() => {});
  });
  use.forEach((f, i) => readTags(f, pieces[i]));
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
const TRACK_KINDS = ["", "声音故事", "自己哼的歌", "环境音", "最近循环播放的歌"];
const kindLabel = (k) => k || "＋ 标签";
function esc(s) { return s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])); }
function renderTrackList() {
  const real = MY.pieces.filter((p) => !p.placeholder);
  trackCountLabel.textContent = real.length ? `节目 · ${real.length}/${MAX_TRACKS}` : "节目";
  trackList.hidden = !real.length;
  trackList.innerHTML = real.map((p, i) => `
    <div class="track-row" data-i="${i}">
      <span class="track-name">${esc(p.title)}</span>
      <select class="track-tag" data-i="${i}" aria-label="节目标签（可选）">
        ${TRACK_KINDS.map((k) => `<option value="${esc(k)}"${(p.kind || "") === k ? " selected" : ""}>${esc(kindLabel(k))}</option>`).join("")}
      </select>
      <button class="track-remove" data-i="${i}" aria-label="移除" title="移除">×</button>
    </div>`).join("");
}
function persistPiece(p) {
  if (!p.dbId) return;
  idb.put({ id: p.dbId, title: p.title, artist: p.artist, kind: p.kind || "", cover: p.cover, blob: p.blob, t: Date.now() }).catch(() => {});
}
trackList.addEventListener("change", (e) => {
  const sel = e.target.closest(".track-tag");
  if (!sel) return;
  const real = MY.pieces.filter((p) => !p.placeholder);
  const p = real[+sel.dataset.i];
  if (!p) return;
  p.kind = sel.value;
  persistPiece(p);
  if (channel() === MY && piece() === p) renderPiece();
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
  if (!MY.pieces.length) MY.pieces.push({ ...PLACEHOLDER });
  if (channel() === MY) { if (pi >= MY.pieces.length) pi = 0; renderChannel(); }
  renderTrackList();
});

// ---- P1 · share my station: upload to cloud, hand friends a ?listen= link ----
function say(msg, target = shareOut) { target.hidden = false; target.textContent = msg; }
function cloudPut(path, blob) {
  return fetch(`${CLOUD.url}/storage/v1/object/${CLOUD.bucket}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CLOUD.anonKey}`, apikey: CLOUD.anonKey,
      "x-upsert": "true",   // re-sharing reuses the same path on purpose — must overwrite, not conflict
      "Content-Type": blob.type || "application/octet-stream",
    },
    body: blob,
  }).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); });
}
function shareLinkFor(token) {
  const base = `${CLOUD.url}/storage/v1/object/public/${CLOUD.bucket}/${token}`;
  return location.origin + location.pathname + "?listen=" + encodeURIComponent(base);
}
function renderShareLinkBox() {
  if (!MY.shareToken) { shareLinkBox.hidden = true; return; }
  shareLinkText.textContent = shareLinkFor(MY.shareToken);
  shareLinkBox.hidden = false;
}
async function shareStation() {
  const tracks = MY.pieces.filter((p) => p.blob);
  if (!tracks.length) return say("先拖入或上传至少一段声音");
  if (!CLOUD.url || !CLOUD.anonKey) return say("还没配置云端 · 打开 src/main.js 顶部 CLOUD，照 README「分享」两分钟填好");
  shareBtn.disabled = true;
  try {
    // same station → same token every time, so a link already sent to a friend keeps
    // working and just shows whatever you've most recently shared — editing a station
    // updates it in place instead of minting a new, disconnected link
    const isUpdate = !!MY.shareToken;
    const token = MY.shareToken || crypto.randomUUID();
    MY.shareToken = token;
    persistStationMeta();
    const manifest = { v: 1, name: MY.name, owner: MY.name, intro: MY.intro, pieces: [] };
    for (let i = 0; i < tracks.length; i++) {
      say(`上传中 ${i + 1} / ${tracks.length} …`);
      const p = tracks[i];
      const ext = ((p.blob.type.split("/")[1] || "bin").replace("mpeg", "mp3")).replace(/[^a-z0-9]/gi, "");
      const fname = `track-${i + 1}.${ext || "bin"}`;
      await cloudPut(`${token}/${fname}`, p.blob);
      manifest.pieces.push({ title: p.title, artist: p.artist, kind: p.kind || "", cover: p.cover, file: fname });
    }
    await cloudPut(`${token}/station.json`, new Blob([JSON.stringify(manifest)], { type: "application/json" }));
    const link = shareLinkFor(token);
    renderShareLinkBox();
    const gift = `${MY.name} 在等你收听\n${link}`;
    const successMsg = isUpdate ? "已更新 · 之前发过的链接会自动显示最新内容" : "已复制 · 粘贴发给朋友就是一张分享卡";
    try { await navigator.clipboard.writeText(gift); say(successMsg); }
    catch { say("复制失败，链接在这里，手动发给朋友：\n" + link); }
  } catch (e) {
    // fetch() only rejects with a TypeError when the request never got a response at
    // all (DNS/connection/CORS-level failure) — Safari says "Load failed", Chrome says
    // "Failed to fetch". An HTTP error status (403/500/…) resolves normally instead and
    // is thrown separately below as a plain Error, so this check reliably tells apart
    // "can't reach the server" from "server responded but rejected it".
    const unreachable = e instanceof TypeError;
    say(unreachable
      ? "上传失败：连不上云端服务器。Supabase 是海外服务，国内网络偶尔连不稳——挂个 VPN 再点一次「生成分享链接」试试；已经开着 VPN 的话，换个节点再试一次。"
      : "上传失败：" + (e && e.message ? e.message : e));
  }
  shareBtn.disabled = false;
}

// ---- P1 · listen mode: ?listen=<public folder URL> tunes a friend's station ----
async function loadGuestStation() {
  const raw = new URLSearchParams(location.search).get("listen");
  if (!raw) return;
  let base;
  try { base = new URL(raw).toString().replace(/\/+$/, ""); } catch { return; }
  if (!/^https?:/.test(base)) return;
  try {
    const st = await (await fetch(`${base}/station.json`)).json();
    const pieces = (st.pieces || []).map((p) => ({
      title: p.title || "未命名", artist: p.artist || "", kind: p.kind || "", dur: 0, cover: p.cover || null,
      src: /^(data|https?):/.test(p.file) ? p.file : `${base}/${p.file}`,
    }));
    if (!pieces.length) return;
    const ch = { name: st.name || "朋友的电台", owner: st.owner || st.name || "朋友", intro: st.intro || "", guest: true, pieces };
    CHANNELS.unshift(ch);
    ci = 0; pi = 0;
    renderChannel();
  } catch (e) { console.warn("listen link failed:", e); }
}

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
  if (realCount >= MAX_TRACKS) { say(`电台已经满了（最多 ${MAX_TRACKS} 首）· 删掉一首再录新的`, recordOut); return; }
  try {
    recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    say("没能打开麦克风 · 请检查浏览器/系统的麦克风权限", recordOut);
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
    const title = `录音 ${now.getMonth() + 1}-${now.getDate()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
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
function placeBeside(win, topOf, refWin) {
  if (win.dataset.placed) return;
  const r = (refWin || winMain).getBoundingClientRect();
  const w = win.offsetWidth || 320, h = win.offsetHeight || 200;
  const fitsRight = r.right + 16 + w < window.innerWidth;
  const left = fitsRight ? r.right + 16 : Math.max(8, r.left + 36);
  const top = (topOf ? topOf() : r.top) + (fitsRight ? 0 : 36);
  win.style.left = Math.max(8, Math.min(left, window.innerWidth - w - 8)) + "px";
  win.style.top = Math.max(8, Math.min(top, window.innerHeight - h - 8)) + "px";
  win.dataset.placed = "1";
}
function toggleWin(win, topOf, refWin) {
  if (win.hidden) { win.hidden = false; placeBeside(win, topOf, refWin); }
  else win.hidden = true;
}
dialMid.addEventListener("click", () => {
  if (winStation.hidden) { chNameInput.value = MY.name; chIntroInput.value = MY.intro; renderTrackList(); }
  toggleWin(winStation);
});
lookBtn.addEventListener("mousedown", (e) => e.stopPropagation());
lookBtn.addEventListener("click", () => {
  paintSwatches();
  toggleWin(winLook, () => (winStation.hidden ? winMain.getBoundingClientRect().top
                                              : winStation.getBoundingClientRect().bottom + 26));
});
openShareBtn.addEventListener("click", () => {
  renderShareLinkBox();
  toggleWin(winShare, () => winStation.getBoundingClientRect().top, winStation);
});
stationClose.addEventListener("click", () => { stopRecording(); winStation.hidden = true; });
lookClose.addEventListener("click", () => (winLook.hidden = true));
shareClose.addEventListener("click", () => (winShare.hidden = true));
copyLinkBtn.addEventListener("click", async () => {
  const link = shareLinkText.textContent;
  try { await navigator.clipboard.writeText(`${MY.name} 在等你收听\n${link}`); say("已复制"); }
  catch { say("复制失败，请手动选中上面的链接"); }
});

swatches.forEach((s) => s.addEventListener("click", () => applyTheme(s.dataset.theme)));

function persistStationMeta() {
  try { localStorage.setItem("sbfm-station", JSON.stringify({ name: MY.name, intro: MY.intro, shareToken: MY.shareToken || null })); } catch {}
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
  stationSave.textContent = "✓ 已保存";
  stationSave.disabled = true;
  setTimeout(() => { stationSave.textContent = original; stationSave.disabled = false; }, 1100);
}
stationSave.addEventListener("click", saveStation);
[chNameInput, chIntroInput].forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter") saveStation(); }));

// ---- collapse / expand ----
minBtn.addEventListener("mousedown", (e) => e.stopPropagation());
minBtn.addEventListener("click", (e) => { e.stopPropagation(); sbfm.classList.add("collapsed"); });

// ---- dragging (mouse + touch, so cards and the perch drag on phones too) ----
function makeDraggable(el, handle, onTap) {
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
// in the Tauri shell, dragging #dragMain moves the actual OS window via a
// custom Rust command (declarative data-tauri-drag-region tracked the mouse
// but stayed confined to the window's own small bounds) — everywhere else
// (a normal browser tab) keeps the original web-level card dragging.
if (document.documentElement.classList.contains("in-tauri")) {
  const diag = `in-tauri class: true, window.__TAURI__: ${typeof window.__TAURI__}, window.__TAURI__.core: ${typeof window.__TAURI__?.core}, dragMain found: ${!!$("dragMain")}`;
  if (window.__TAURI__?.core?.invoke) window.__TAURI__.core.invoke("debug_log", { msg: diag });
  $("dragMain").addEventListener("mousedown", (e) => {
    window.__TAURI__?.core?.invoke("debug_log", { msg: "mousedown on dragMain, target: " + e.target.tagName + "." + e.target.className });
    if (e.target.closest("button")) return;
    window.__TAURI__.core.invoke("start_drag");
  });
} else {
  makeDraggable(winMain, $("dragMain"));
}
makeDraggable(winStation, $("dragStation"));
makeDraggable(winLook, $("dragLook"));
makeDraggable(winShare, $("dragShare"));
makeDraggable(perch, perch, () => sbfm.classList.remove("collapsed"));

// ---- boot ----
(async function boot() {
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
    }
  } catch {}
  paintSwatches();
  wireMediaSession();

  // restore my persisted tracks (before the first render, so the landing-channel
  // decision below sees the final MY.created state)
  try {
    await idb.open();
    const rows = await idb.all();
    if (rows.length) {
      if (MY.pieces[0] && MY.pieces[0].placeholder) MY.pieces.length = 0;
      MY.pieces.push(...rows.map((r) => ({
        title: r.title, artist: r.artist || "", kind: r.kind || "", dur: 0, cover: r.cover || null,
        src: URL.createObjectURL(r.blob), blob: r.blob, dbId: r.id,
      })));
      MY.created = true;
    }
  } catch (e) { console.warn("idb restore failed:", e); }

  // turning the radio on should land you on a station that's already playing —
  // like a real radio, not a blank "make your own broadcast" screen. First-time
  // visitors land on a friend's channel; once you've made your own, you come back
  // to it. (A ?listen= link below still wins over both.)
  if (!MY.created) ci = 1;
  renderChannel();

  // a friend's link?
  await loadGuestStation();

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
  if (shot === "station") { chNameInput.value = MY.name; chIntroInput.value = MY.intro; renderTrackList(); }
})();
