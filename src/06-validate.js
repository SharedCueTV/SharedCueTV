// ---------------------------------------------------------------- Eingehende Daten prüfen
// Jeder im Raum kann beliebige Nachrichten schicken. Bevor eine fremde Op angewendet wird,
// prüfen wir Form, Typen und Längen und bremsen Spam. Ungültiges wird still verworfen.
const MEDIA_SRCS = new Set(["yt", "ytl", "tw", "twv", "tt", "ig", "file", "live"]);
const isStr = (v, max = 200) => typeof v === "string" && v.length <= max;
const isOptStr = (v, max = 200) => v == null || isStr(v, max);
const isNum = (v, lo = -1e9, hi = 1e9) => typeof v === "number" && isFinite(v) && v >= lo && v <= hi;
const isOptNum = (v, lo, hi) => v == null || isNum(v, lo, hi);
const isId = v => isStr(v, 64) && v.length > 0;
const isOptBool = v => v == null || typeof v === "boolean";
const validColor = c => c == null || (isStr(c, 40) && /^(#[0-9a-f]{3,8}|hsla?\([\d.,%\s]+\))$/i.test(c));

function validItem(it) {
  if (!it || typeof it !== "object") return false;
  if (!isStr(it.src, 8) || !MEDIA_SRCS.has(it.src)) return false;
  if (!isStr(it.ref, 2048) || !isOptStr(it.qid, 32) || !isOptStr(it.title, 300) || !isOptStr(it.author, 120)) return false;
  if (!isOptStr(it.by, 64) || !isOptStr(it.byName, 40) || !isOptStr(it.kind, 16) || !isOptNum(it.start, 0, 1e6) || !isOptNum(it.dur, 0, 1e7)) return false;
  if (it.thumb != null && !(it.thumb === "" || (isStr(it.thumb, 600) && /^https:\/\//.test(it.thumb)))) return false;
  if (it.votes != null && (typeof it.votes !== "object" || Array.isArray(it.votes) || Object.keys(it.votes).length > 200)) return false;
  if (it.p2p != null) {
    const f = it.p2p;
    if (typeof f !== "object" || !isId(f.fid) || !isId(f.owner) || !isNum(f.size, 0, 1e12) || !isOptStr(f.mime, 100)) return false;
    if (!/^[\w-]+$/.test(f.fid) || !/^[\w-]+$/.test(f.owner)) return false;
  }
  return true;
}

const OP_RULES = {
  load: op => (op.video == null || validItem(op.video)) && isOptNum(op.pos, -10, 1e7) && isOptBool(op.playing) && isOptStr(op.prev, 2100),
  play: op => isNum(op.pos, -10, 1e7),
  pause: op => isNum(op.pos, -10, 1e7),
  seek: op => isNum(op.pos, -10, 1e7),
  rate: op => isOptNum(op.pos, -10, 1e7) && isNum(op.rate, 0.25, 2),
  qadd: op => validItem(op.item),
  qaddMany: op => Array.isArray(op.items) && op.items.length <= 500 && op.items.every(validItem),
  qdel: op => isStr(op.qid, 32),
  qvote: op => isStr(op.qid, 32),
  qmove: op => isStr(op.qid, 32) && isOptNum(op.to, 0, 10000),
  qclear: () => true,
  upnext: op => isStr(op.prev, 2100) && (op.video == null || validItem(op.video)) && isOptNum(op.secs, 0, 60),
  upnextCancel: () => true,
  ad: op => isOptBool(op.on),
  adClear: () => true,
  chat: op => !!op.msg && typeof op.msg === "object" && isStr(op.msg.text, 1000) && isOptStr(op.msg.id, 32) && isOptStr(op.msg.name, 40) && validColor(op.msg.color),
  react: op => isStr(op.emoji, 16),
  poll: op => isStr(op.pid, 32) && Array.isArray(op.options) && op.options.length >= 2 && op.options.length <= 6 && op.options.every(validItem) && isOptNum(op.secs, 5, 600),
  pollVote: op => isStr(op.pid, 32) && isNum(op.idx, 0, 10),
  pollEnd: op => isOptStr(op.pid, 32),
  countdown: () => true,
  voice: op => isStr(op.t, 16) && isOptStr(op.to, 64),
  live: op => isStr(op.t, 16) && isOptStr(op.to, 64) && isOptStr(op.sid, 16),
  fx: op => isStr(op.t, 16) && isOptStr(op.to, 64) && isOptStr(op.sid, 16) && (op.r == null || op.r === "v" || op.r === "o"),
  buf: op => isStr(op.v, 2100) && isNum(op.end, 0, 1e7),
  title: op => isStr(op.title, 200),
  settings: op => !!op.settings && typeof op.settings === "object" && isOptBool(op.settings.voice) && isOptBool(op.settings.cam) && isOptStr(op.settings.fsCams, 16)
};

// Spam-Bremse je Absender: normale Ops 40 pro 5 s, Verbindungsaufbau (voice/live/fx) 400 pro 5 s
const opBuckets = new Map();
function rateOk(by, k) {
  const sig = k === "voice" || k === "live" || k === "fx";
  const key = by + (sig ? ":sig" : ""), limit = sig ? 400 : 40, t = now();
  let b = opBuckets.get(key);
  if (!b || t - b.start > 5000) { b = { start: t, n: 0, warned: false }; opBuckets.set(key, b); }
  b.n++;
  if (b.n > limit) { if (!b.warned) { b.warned = true; console.warn("SharedCue: zu viele Nachrichten von", by, "– werden kurz ignoriert"); } return false; }
  return true;
}

function validOp(op, from) {
  if (!op || typeof op !== "object" || Array.isArray(op)) return false;
  if (!isStr(op.k, 24) || !Object.prototype.hasOwnProperty.call(OP_RULES, op.k)) return false;
  if (!isId(op.by) || !isOptStr(op.name, 40)) return false;
  if (from && op.by !== from) return false;          // Absender darf sich nicht als jemand anderes ausgeben
  if (!rateOk(op.by, op.k)) return false;
  try { return OP_RULES[op.k](op) === true; } catch { return false; }
}

// Snapshot vom Leader (beim Beitreten): grob prüfen und unbrauchbare Teile entfernen
function cleanSnapshot(s) {
  if (!s || typeof s !== "object") return null;
  const out = { ...s };
  out.queue = Array.isArray(s.queue) ? s.queue.filter(validItem).slice(0, 1000) : [];
  out.chat = Array.isArray(s.chat) ? s.chat.filter(m => m && typeof m === "object" && isStr(m.text, 1000)).slice(-CHAT_MAX) : [];
  out.video = s.video && validItem(s.video) ? s.video : null;
  const pb = s.pb || {};
  out.pb = { playing: !!pb.playing, pos: isNum(pb.pos, 0, 1e7) ? pb.pos : 0, at: 0, rate: isNum(pb.rate, 0.25, 2) ? pb.rate : 1 };
  out.title = isStr(s.title, 200) ? s.title : "";
  if (!s.settings || typeof s.settings !== "object") out.settings = { voice: true, cam: true };
  if (!s.stats || typeof s.stats !== "object") out.stats = freshStats();
  if (!Array.isArray(s.adWait)) out.adWait = [];
  if (s.poll && (typeof s.poll !== "object" || !Array.isArray(s.poll.options) || !s.poll.options.every(validItem))) out.poll = null;
  return out;
}
