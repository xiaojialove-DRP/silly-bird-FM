// silly bird FM — player core
// Real audio: drag audio files onto the radio (or click the screen to pick) → the bird
// plays them via a real <audio> element, reading title / artist / cover from ID3 tags
// (jsmediatags). Demo channels remain as a placeholder "empty state" (visual only).
// One codebase → Tauri desktop later (frameless, always-on-top, draggable).
window.__SBFM = "import-audio";

const CHANNELS = [
  {
    freq: "88.2", name: "深夜胡思乱想", owner: "小佳",
    pieces: [
      { title: "写代码写到凌晨三点", kind: "声音故事",   dur: 192 },
      { title: "最近单曲循环，哼给你听", kind: "自己哼的歌", dur: 108 },
      { title: "楼下便利店的白噪音", kind: "环境音",     dur: 320 },
    ],
  },
  {
    freq: "92.7", name: "雨天限定", owner: "Wren",
    pieces: [
      { title: "阳台上的一整场雨", kind: "环境音",     dur: 484 },
      { title: "读了一段《海边的卡夫卡》", kind: "声音故事", dur: 390 },
    ],
  },
  {
    freq: "101.5", name: "厨房迪斯科", owner: "Pomelo",
    pieces: [
      { title: "边做饭边乱唱", kind: "自己哼的歌", dur: 170 },
      { title: "今天菜市场好热闹", kind: "环境音",   dur: 250 },
    ],
  },
];

// ---- state ----
let ci = 0, pi = 0, playing = false, cur = 0, raf = null, lastTs = 0;

const audio = new Audio();
audio.preload = "metadata";

const $ = (id) => document.getElementById(id);
const sbfm = $("sbfm"), player = $("player"), perch = $("perch"), minBtn = $("min"), dragHandle = $("drag");
const screenEl = document.querySelector(".screen"), filepick = $("filepick");
const elTitle = $("title"), elKind = $("artist"), elDj = $("dj"), elFreq = $("freq"), elSname = $("sname");
const elCur = $("cur"), elDur = $("dur"), elFill = $("fill"), elBar = $("bar"), elCover = $("cover");

const channel  = () => CHANNELS[ci];
const piece    = () => channel().pieces[pi];
const hasAudio = () => !!piece() && !!piece().src;
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const trackDur = () => (hasAudio() && isFinite(audio.duration) && audio.duration ? audio.duration : piece().dur);

function renderChannel() {
  const ch = channel();
  elFreq.textContent = ch.freq;
  elSname.textContent = ch.name;
  elDj.textContent = ch.owner;
  screenEl.classList.toggle("imported", !!ch.imported);
  renderPiece();
}
function renderPiece() {
  const p = piece();
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

function goPiece(n) { pi = (n + channel().pieces.length) % channel().pieces.length; renderPiece(); applyPlay(); }
function next() { goPiece(pi + 1); }
function prev() { if (cur > 3) return seek(0); goPiece(pi - 1); }
function seek(t) { cur = Math.max(0, Math.min(t, trackDur() || t)); if (hasAudio()) audio.currentTime = cur; updateProgress(); }
function tune(d) { ci = (ci + d + CHANNELS.length) % CHANNELS.length; pi = 0; renderChannel(); applyPlay(); }

// ---- import: drop files / pick files → an album that really plays ----
const AUDIO_RE = /\.(mp3|m4a|wav|flac|ogg|aac|opus)$/i;
function importFiles(list) {
  const files = [...list].filter((f) => (f.type && f.type.startsWith("audio/")) || AUDIO_RE.test(f.name));
  if (!files.length) return;
  const pieces = files.map((f) => ({
    title: f.name.replace(/\.[^.]+$/, ""), artist: "未知", dur: 0,
    src: URL.createObjectURL(f), cover: null,
  }));
  CHANNELS.unshift({ freq: "★", name: "我的唱片", owner: "你", imported: true, pieces });
  ci = 0; pi = 0;
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

// ---- import wiring: drop zone + click-to-pick ----
["dragenter", "dragover"].forEach((ev) => player.addEventListener(ev, (e) => {
  if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { e.preventDefault(); screenEl.classList.add("dragging"); }
}));
player.addEventListener("dragleave", (e) => { if (!player.contains(e.relatedTarget)) screenEl.classList.remove("dragging"); });
player.addEventListener("drop", (e) => { e.preventDefault(); screenEl.classList.remove("dragging"); if (e.dataTransfer) importFiles(e.dataTransfer.files); });
screenEl.addEventListener("click", () => filepick.click());
filepick.addEventListener("change", () => { importFiles(filepick.files); filepick.value = ""; });

// ---- collapse / expand ----
minBtn.addEventListener("mousedown", (e) => e.stopPropagation());
minBtn.addEventListener("click", (e) => { e.stopPropagation(); sbfm.classList.add("collapsed"); });

// ---- drag the widget anywhere (titlebar + perch) ----
let drag = null, moved = false;
function onDown(e) { const r = sbfm.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top }; moved = false; e.preventDefault(); }
window.addEventListener("mousemove", (e) => { if (!drag) return; moved = true; sbfm.style.left = (e.clientX - drag.dx) + "px"; sbfm.style.top = Math.max(0, e.clientY - drag.dy) + "px"; });
window.addEventListener("mouseup", () => { drag = null; });
dragHandle.addEventListener("mousedown", onDown);
perch.addEventListener("mousedown", onDown);
perch.addEventListener("click", () => { if (!moved) sbfm.classList.remove("collapsed"); });

renderChannel();
