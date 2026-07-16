// silly bird FM — player core
// Three floating papercut windows, Poolsuite-style, each draggable by its titlebar:
//   1. winMain    — the radio: tune (◁ ▷), what's playing, progress, transport.
//   2. winStation — 我的电台: name it, one-line intro, upload programs. Opened from the dial.
//   3. winLook    — 外观: YOUR ui color (personal preference, localStorage) + volume.
//      Opened from the ❋ button in the main titlebar.
// The perched bird collapses/reopens the whole flock; each window remembers being open.
// Real audio via <audio>; ID3 title/artist/cover via jsmediatags. Tracks are objectURLs
// (not persisted across reloads — cloud storage is the next phase).
window.__SBFM = "three-windows";

const PLACEHOLDER = { title: "还没有节目", kind: "拖入音频，或点上面创建电台", dur: 0, placeholder: true };

const CHANNELS = [
  { freq: "★", name: "我的电台", owner: "我", intro: "", mine: true, pieces: [{ ...PLACEHOLDER }] },
  {
    freq: "88.2", name: "深夜胡思乱想", owner: "小佳", intro: "睡不着的夜里，说给你听",
    pieces: [
      { title: "写代码写到凌晨三点", kind: "声音故事",   dur: 192 },
      { title: "最近单曲循环，哼给你听", kind: "自己哼的歌", dur: 108 },
      { title: "楼下便利店的白噪音", kind: "环境音",     dur: 320 },
    ],
  },
  {
    freq: "92.7", name: "雨天限定", owner: "Wren", intro: "只在下雨天更新",
    pieces: [
      { title: "阳台上的一整场雨", kind: "环境音",     dur: 484 },
      { title: "读了一段《海边的卡夫卡》", kind: "声音故事", dur: 390 },
    ],
  },
  {
    freq: "101.5", name: "厨房迪斯科", owner: "Pomelo", intro: "一边做饭一边跳舞",
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
const winMain = $("winMain"), winStation = $("winStation"), winLook = $("winLook");
const player = $("player"), screenEl = document.querySelector(".screen");
const minBtn = $("min"), lookBtn = $("lookBtn"), stationClose = $("stationClose"), lookClose = $("lookClose");
const dialMid = $("dialMid"), elTagline = $("tagline");
const chNameInput = $("chNameInput"), chIntroInput = $("chIntroInput"), chUpload = $("chUpload"), stationSave = $("stationSave");
const swatches = [...document.querySelectorAll(".swatch")];
const elTitle = $("title"), elKind = $("artist"), elDj = $("dj"), elFreq = $("freq"), elSname = $("sname");
const elCur = $("cur"), elDur = $("dur"), elFill = $("fill"), elBar = $("bar"), elCover = $("cover"), elVol = $("vol");

const channel  = () => CHANNELS[ci];
const piece    = () => channel().pieces[pi];
const hasAudio = () => !!piece() && !!piece().src;
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const trackDur = () => (hasAudio() && isFinite(audio.duration) && audio.duration ? audio.duration : (piece() ? piece().dur : 0));

// ---- personal theme (UI color is the LISTENER's preference, not the channel's) ----
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

// ---- render ----
function renderChannel() {
  const ch = channel();
  const isCta = !!ch.mine && !MY.created;   // fresh users see an invitation, not a name
  elFreq.textContent = ch.freq;
  elSname.textContent = isCta ? "点击创建我的电台" : ch.name;
  dialMid.classList.toggle("cta", isCta);
  elDj.textContent = ch.owner;
  elTagline.textContent = ch.intro || "";
  elTagline.hidden = !ch.intro;
  renderPiece();
}
function renderPiece() {
  const p = piece();
  if (!p) return;
  elTitle.textContent = p.title;
  elKind.textContent = p.artist || p.kind || "";
  if (p.cover) { elCover.style.backgroundImage = `url("${p.cover}")`; elCover.classList.add("show"); }
  else { elCover.style.backgroundImage = ""; elCover.classList.remove("show"); }
  cur = 0;
  if (hasAudio()) audio.src = p.src;
  updateProgress();
}
function updateProgress() {
  const d = trackDur();
  elFill.style.width = (d ? (cur / d) * 100 : 0) + "%";
  elCur.textContent = fmt(cur);
  elDur.textContent = fmt(d);
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
}
function play()  { playing = true;  applyPlay(); }
function pause() { playing = false; applyPlay(); }
const toggle = () => (playing ? pause() : play());

function goPiece(n) { const len = channel().pieces.length; pi = ((n % len) + len) % len; renderPiece(); applyPlay(); }
function next() { goPiece(pi + 1); }
function prev() { if (cur > 3) return seek(0); goPiece(pi - 1); }
function seek(t) { cur = Math.max(0, Math.min(t, trackDur() || t)); if (hasAudio()) audio.currentTime = cur; updateProgress(); }
function tune(d) { ci = (ci + d + CHANNELS.length) % CHANNELS.length; pi = 0; renderChannel(); applyPlay(); }

// ---- import: files land in MY station (drag-drop on the radio, or upload from the panel) ----
const AUDIO_RE = /\.(mp3|m4a|wav|flac|ogg|aac|opus)$/i;
function importFiles(list) {
  const files = [...list].filter((f) => (f.type && f.type.startsWith("audio/")) || AUDIO_RE.test(f.name));
  if (!files.length) return;
  if (MY.pieces[0] && MY.pieces[0].placeholder) MY.pieces.length = 0;
  const start = MY.pieces.length;
  const pieces = files.map((f) => ({
    title: f.name.replace(/\.[^.]+$/, ""), artist: "未知", dur: 0,
    src: URL.createObjectURL(f), cover: null,
  }));
  MY.pieces.push(...pieces);
  MY.created = true;
  ci = 0; pi = start;
  renderChannel();
  play();
  files.forEach((f, i) => readTags(f, pieces[i]));
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
      if (piece() === p) renderPiece();
    },
    onError: () => {},
  });
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

// ---- import wiring: drop zone + panel upload ----
["dragenter", "dragover"].forEach((ev) => player.addEventListener(ev, (e) => {
  if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { e.preventDefault(); screenEl.classList.add("dragging"); }
}));
player.addEventListener("dragleave", (e) => { if (!player.contains(e.relatedTarget)) screenEl.classList.remove("dragging"); });
player.addEventListener("drop", (e) => { e.preventDefault(); screenEl.classList.remove("dragging"); if (e.dataTransfer) importFiles(e.dataTransfer.files); });
filepick.addEventListener("change", () => { importFiles(filepick.files); filepick.value = ""; });
chUpload.addEventListener("click", () => filepick.click());

// ---- windows: open / close / first-open placement beside the main radio ----
function placeBeside(win, dy) {
  if (win.dataset.placed) return;
  const r = winMain.getBoundingClientRect();
  const fitsRight = r.right + 16 + 276 < window.innerWidth;
  win.style.left = (fitsRight ? r.right + 16 : Math.max(8, r.left + 36)) + "px";
  win.style.top = Math.max(8, r.top + dy + (fitsRight ? 0 : 36)) + "px";
  win.dataset.placed = "1";
}
function toggleWin(win, dy) {
  if (win.hidden) { placeBeside(win, dy); win.hidden = false; }
  else win.hidden = true;
}
dialMid.addEventListener("click", () => {
  if (winStation.hidden) { chNameInput.value = MY.name; chIntroInput.value = MY.intro; }
  toggleWin(winStation, 0);
});
lookBtn.addEventListener("mousedown", (e) => e.stopPropagation());
lookBtn.addEventListener("click", () => { paintSwatches(); toggleWin(winLook, 292); });
stationClose.addEventListener("click", () => (winStation.hidden = true));
lookClose.addEventListener("click", () => (winLook.hidden = true));

swatches.forEach((s) => s.addEventListener("click", () => applyTheme(s.dataset.theme)));

function saveStation() {
  const name = chNameInput.value.trim();
  if (name) MY.name = name;
  MY.intro = chIntroInput.value.trim();
  MY.created = true;
  try { localStorage.setItem("sbfm-station", JSON.stringify({ name: MY.name, intro: MY.intro })); } catch {}
  renderChannel();
  winStation.hidden = true;
}
stationSave.addEventListener("click", saveStation);
[chNameInput, chIntroInput].forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter") saveStation(); }));

// ---- collapse / expand: the perch hides the whole flock; hidden state per-window survives ----
minBtn.addEventListener("mousedown", (e) => e.stopPropagation());
minBtn.addEventListener("click", (e) => { e.stopPropagation(); sbfm.classList.add("collapsed"); });

// ---- dragging: any titlebar moves its own window; the perch drags itself ----
function makeDraggable(el, handle, onTap) {
  let start = null, moved = false;
  handle.addEventListener("mousedown", (e) => {
    if (e.target.closest("button") && !onTap) return;   // window buttons stay clickable
    const r = el.getBoundingClientRect();
    start = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    moved = false;
    e.preventDefault();
    const move = (ev) => {
      moved = true;
      el.style.left = (ev.clientX - start.dx) + "px";
      el.style.top = Math.max(0, ev.clientY - start.dy) + "px";
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      start = null;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  });
  if (onTap) handle.addEventListener("click", () => { if (!moved) onTap(); moved = false; });
}
makeDraggable(winMain, $("dragMain"));
makeDraggable(winStation, $("dragStation"));
makeDraggable(winLook, $("dragLook"));
makeDraggable(perch, perch, () => sbfm.classList.remove("collapsed"));

// ---- boot: restore personal theme + my station info ----
(function boot() {
  let theme = "blue";
  try { theme = localStorage.getItem("sbfm-theme") || "blue"; } catch {}
  document.documentElement.setAttribute("data-theme", theme);
  try {
    const saved = JSON.parse(localStorage.getItem("sbfm-station") || "null");
    if (saved) { if (saved.name) MY.name = saved.name; MY.intro = saved.intro || ""; MY.created = true; }
  } catch {}
  paintSwatches();
  renderChannel();
})();
