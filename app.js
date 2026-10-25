/* SharedCue – synchrones Schauen für Freunde
 * Architektur:
 *  - Transport: Supabase Realtime (Broadcast + Presence) oder BroadcastChannel (Testmodus)
 *  - Kein Server, keine Datenbank: Der Raumzustand lebt in den Browsern der Teilnehmer.
 *    Neue Teilnehmer bekommen einen Snapshot vom "Leader" (wer am längsten drin ist).
 *  - Alle Aktionen sind Ops, die an alle gehen und lokal sofort angewendet werden.
 */
(() => {
"use strict";

// ---------------------------------------------------------------- Helpers
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const now = () => Date.now();
const uid = (n = 10) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => (b % 36).toString(36)).join("");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmt = s => {
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0");
};
const hhmm = ts => new Date(ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
const PALETTE = ["#3131c0", "#0e7490", "#7c3aed", "#be185d", "#b45309", "#047857", "#4338ca", "#a21caf"];
const colorFor = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };
const initials = n => (String(n || "?").trim().split(/\s+/).map(p => p[0]).join("").slice(0, 2) || "?").toUpperCase();
async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
}
const b64e = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64d = s => { try { return decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))); } catch { return ""; } };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  sget(k, d) { try { const v = sessionStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  sset(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} },
  sdel(k) { try { sessionStorage.removeItem(k); } catch {} }
};
function toast(msg, ms = 2600) {
  const el = document.createElement("div");
  el.className = "toast"; el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), ms);
}
const scripts = {};
function loadScript(src) {
  if (!scripts[src]) scripts[src] = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.async = true; s.onload = res; s.onerror = () => { delete scripts[src]; rej(new Error("load " + src)); };
    document.head.appendChild(s);
  });
  return scripts[src];
}

// ---------------------------------------------------------------- Media links
function parseMedia(raw) {
  let s = String(raw || "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u; try { u = new URL(s); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  const tParam = u.searchParams.get("t") || u.searchParams.get("start") || "";
  const parseT = t => { if (!t) return 0; if (/^\d+$/.test(t)) return +t; const m = t.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; };
  const ytId = id => /^[\w-]{11}$/.test(id || "") ? id : null;
  if (host === "youtu.be") { const id = ytId(u.pathname.slice(1).split("/")[0]); return id && { src: "yt", ref: id, start: parseT(tParam) }; }
  if (host.endsWith("youtube.com") || host === "youtube-nocookie.com") {
    let id = ytId(u.searchParams.get("v"));
    if (!id) { const m = u.pathname.match(/^\/(?:shorts|live|embed|v)\/([\w-]{11})/); id = m && m[1]; }
    return id ? { src: "yt", ref: id, start: parseT(tParam) } : null;
  }
  if (host === "twitch.tv" || host.endsWith(".twitch.tv")) {
    if (host === "clips.twitch.tv" || /\/clip\//.test(u.pathname)) return { src: "clip" };
    const vm = u.pathname.match(/^\/videos\/(\d+)/);
    if (vm) return { src: "twv", ref: vm[1], start: parseT(tParam) };
    const cm = u.pathname.match(/^\/([a-zA-Z0-9_]{3,25})\/?$/);
    const reserved = ["directory", "videos", "settings", "search", "downloads", "p", "jobs", "turbo"];
    if (cm && !reserved.includes(cm[1].toLowerCase())) return { src: "twl", ref: cm[1].toLowerCase(), start: 0 };
  }
  return null;
}
async function buildItem(media) {
  const item = { qid: uid(8), src: media.src, ref: media.ref, start: media.start || 0, by: me.id, byName: me.name, votes: {}, at: now(), title: "", thumb: "" };
  if (media.src === "yt") {
    item.thumb = `https://i.ytimg.com/vi/${media.ref}/mqdefault.jpg`;
    item.title = "YouTube-Video";
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 3000);
      const r = await fetch("https://noembed.com/embed?url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + media.ref), { signal: ctl.signal });
      clearTimeout(t);
      const j = await r.json();
      if (j && j.title) { item.title = j.title; item.author = j.author_name || ""; }
    } catch {}
  } else if (media.src === "twv") {
    item.title = "Twitch-Video " + media.ref;
  } else if (media.src === "twl") {
    item.title = media.ref + " – live auf Twitch";
    item.author = media.ref;
  }
  return item;
}
const srcLabel = s => s === "yt" ? "YouTube" : s === "twl" ? "Twitch Live" : "Twitch";
const isTw = s => s === "twv" || s === "twl";

// ---------------------------------------------------------------- Transports
class LocalTransport {
  constructor() { this.handlers = {}; this.peers = new Map(); this.kind = "local"; }
  on(ev, fn) { this.handlers[ev] = fn; }
  emit(ev, ...a) { this.handlers[ev] && this.handlers[ev](...a); }
  async connect(channel, meta) {
    this.meta = meta;
    this.bc = new BroadcastChannel("sharedcue:" + channel);
    this.bc.onmessage = e => {
      const m = e.data;
      if (!m || m.f === meta.id) return;
      if (m.t === "_pres") { this.peers.set(m.d.id, { meta: m.d, seen: now() }); this.prune(true); return; }
      if (m.t === "_bye") { this.peers.delete(m.f); this.prune(true); return; }
      this.emit("message", m.t, m.d, m.f);
    };
    const beat = () => this.bc && this.bc.postMessage({ t: "_pres", d: this.meta, f: meta.id });
    beat();
    this.hb = setInterval(() => { beat(); this.prune(false); }, 2000);
    this.lastKey = "";
    this.prune(true);
    this.emit("status", "online");
  }
  prune(force) {
    let changed = false;
    for (const [id, p] of this.peers) if (now() - p.seen > 6500) { this.peers.delete(id); changed = true; }
    const list = [this.meta, ...Array.from(this.peers.values(), p => p.meta)];
    const key = list.map(m => m.id).sort().join(",");
    if (changed || force || key !== this.lastKey) { this.lastKey = key; this.emit("presence", list); }
  }
  send(t, d) { this.bc && this.bc.postMessage({ t, d, f: this.meta.id }); }
  leave() { if (!this.bc) return; this.send("_bye", {}); clearInterval(this.hb); this.bc.close(); this.bc = null; }
}

class SupabaseTransport {
  constructor(cfg) { this.cfg = cfg; this.handlers = {}; this.kind = "supabase"; }
  on(ev, fn) { this.handlers[ev] = fn; }
  emit(ev, ...a) { this.handlers[ev] && this.handlers[ev](...a); }
  async connect(channel, meta) {
    await loadScript("vendor/supabase.min.js");
    this.client = this.client || window.supabase.createClient(this.cfg.supabaseUrl, this.cfg.supabaseKey, {
      auth: { persistSession: false },
      realtime: { params: { eventsPerSecond: 20 } }
    });
    this.meta = meta;
    const ch = this.ch = this.client.channel("sc:" + channel, { config: { broadcast: { self: false }, presence: { key: meta.id } } });
    ch.on("broadcast", { event: "m" }, ({ payload }) => { if (payload && payload.f !== meta.id) this.emit("message", payload.t, payload.d, payload.f); });
    ch.on("presence", { event: "sync" }, () => {
      const st = ch.presenceState();
      const list = Object.values(st).map(a => a[0]).filter(Boolean);
      if (!list.some(m => m.id === meta.id)) list.push(meta);
      this.emit("presence", list);
    });
    await new Promise((resolve, reject) => {
      let done = false;
      ch.subscribe(async status => {
        if (status === "SUBSCRIBED") {
          await ch.track(meta);
          this.emit("status", "online");
          if (!done) { done = true; resolve(); }
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          this.emit("status", "offline");
          if (!done) { done = true; reject(new Error(status)); }
        }
      });
    });
  }
  send(t, d) { this.ch && this.ch.send({ type: "broadcast", event: "m", payload: { t, d, f: this.meta.id } }); }
  leave() { if (this.ch) { this.ch.untrack(); this.client.removeChannel(this.ch); this.ch = null; } }
}

// ---------------------------------------------------------------- Players
const YT_API = "https://www.youtube.com/iframe_api";
let ytReady = null;
function loadYT() {
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (!ytReady) ytReady = new Promise(res => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev && prev(); res(); };
    loadScript(YT_API).catch(() => { ytReady = null; });
  });
  return ytReady;
}

class YTAdapter {
  constructor(host, cb) { this.host = host; this.cb = cb; this.kind = "yt"; this.live = false; }
  async load(ref, pos, playing) {
    await loadYT();
    this.ref = ref;
    if (this.p && this.ready) {
      if (playing) this.p.loadVideoById({ videoId: ref, startSeconds: pos });
      else this.p.cueVideoById({ videoId: ref, startSeconds: pos });
      return;
    }
    const el = document.createElement("div");
    el.id = "yt_" + uid(5);
    this.host.appendChild(el);
    await new Promise(resolve => {
      this.p = new YT.Player(el.id, {
        width: "100%", height: "100%", videoId: ref,
        playerVars: { autoplay: playing ? 1 : 0, controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0, start: Math.floor(pos), origin: location.origin && location.origin !== "null" ? location.origin : undefined },
        events: {
          onReady: () => { this.ready = true; this.cb.volume(this); if (pos) this.p.seekTo(pos, true); if (playing) this.p.playVideo(); resolve(); },
          onStateChange: e => { if (e.data === 0) this.cb.ended(); },
          onError: e => this.cb.error(e.data === 101 || e.data === 150 ? "Dieses Video erlaubt kein Einbetten." : e.data === 100 ? "Video nicht gefunden oder privat." : "YouTube-Fehler " + e.data)
        }
      });
    });
  }
  play() { this.ready && this.p.playVideo(); }
  pause() { this.ready && this.p.pauseVideo(); }
  seek(t) { this.ready && this.p.seekTo(t, true); }
  time() { return this.ready && this.p.getCurrentTime ? this.p.getCurrentTime() || 0 : 0; }
  duration() { return this.ready && this.p.getDuration ? this.p.getDuration() || 0 : 0; }
  isPlaying() { return this.ready && this.p.getPlayerState && this.p.getPlayerState() === 1; }
  isBuffering() { return this.ready && this.p.getPlayerState && this.p.getPlayerState() === 3; }
  setVolume(v, muted) { if (!this.ready) return; this.p.setVolume(v); muted ? this.p.mute() : this.p.unMute(); }
  destroy() { try { this.p && this.p.destroy(); } catch {} this.host.innerHTML = ""; }
}

class TwitchAdapter {
  constructor(host, cb) { this.host = host; this.cb = cb; this.kind = "tw"; }
  async load(item, pos, playing) {
    await loadScript("https://player.twitch.tv/js/embed/v1.js");
    this.live = item.src === "twl";
    this.ref = item.ref;
    this.destroyInner();
    const el = document.createElement("div");
    el.id = "tw_" + uid(5);
    el.style.cssText = "position:absolute;inset:0";
    this.host.appendChild(el);
    const parent = location.hostname || "localhost";
    const opts = { width: "100%", height: "100%", parent: [parent], autoplay: !!playing, muted: false };
    if (this.live) opts.channel = item.ref; else { opts.video = "v" + item.ref; if (pos > 0) opts.time = Math.floor(pos / 3600) + "h" + Math.floor((pos % 3600) / 60) + "m" + Math.floor(pos % 60) + "s"; }
    this.p = new Twitch.Player(el.id, opts);
    await new Promise(resolve => {
      this.p.addEventListener(Twitch.Player.READY, () => { this.ready = true; this.cb.volume(this); resolve(); });
      this.p.addEventListener(Twitch.Player.ENDED, () => this.cb.ended());
      this.p.addEventListener(Twitch.Player.OFFLINE, () => this.live && this.cb.error("Der Kanal ist gerade offline."));
      setTimeout(resolve, 8000);
    });
  }
  play() { this.ready && this.p.play(); }
  pause() { this.ready && this.p.pause(); }
  seek(t) { if (this.ready && !this.live) this.p.seek(t); }
  time() { return this.ready ? this.p.getCurrentTime() || 0 : 0; }
  duration() { return this.ready && !this.live ? this.p.getDuration() || 0 : 0; }
  isPlaying() { return this.ready && !this.p.isPaused(); }
  isBuffering() { return false; }
  setVolume(v, muted) { if (!this.ready) return; this.p.setVolume(v / 100); this.p.setMuted(!!muted); }
  destroyInner() { this.host.innerHTML = ""; this.p = null; this.ready = false; }
  destroy() { this.destroyInner(); }
}

// ---------------------------------------------------------------- State
const CFG = window.SHAREDCUE_CONFIG || {};
const HAS_SUPA = !!(CFG.supabaseUrl && CFG.supabaseKey);
const DRIFT_MAX = 1.5;         // Sekunden Abweichung bis Auto-Resync
const TICK_MS = 4000;          // Leader-Abgleich
const CHAT_MAX = 80;
const EMOJIS = ["🔥", "😂", "😱", "💜", "👏", "🎉", "👀", "💀"];

let me = null;            // {id,name,color,joinedAt}
let room = null;          // {code, pw, channel}
let transport = null;
let people = [];          // presence list
let synced = false;       // Snapshot erhalten (oder erster im Raum)
let state = freshState();
let sysMsgs = [];
let player = null;        // aktueller Adapter
let loadedKey = "";       // src:ref im Player
let filter = "all";
let seeking = false;
let lastCorrection = 0;
let lastPlayCmd = 0;
let gestureNeeded = false;
let chatActive = false;

function freshState() {
  return { title: "", video: null, pb: { playing: false, pos: 0, at: now() }, queue: [], chat: [] };
}
const expectedPos = () => state.pb.playing ? state.pb.pos + (now() - state.pb.at) / 1000 : state.pb.pos;
const leader = () => [...people].sort((a, b) => (a.joinedAt - b.joinedAt) || (a.id < b.id ? -1 : 1))[0];
const isLeader = () => { const l = leader(); return !l || l.id === me.id; };
const nameOf = id => (people.find(p => p.id === id) || {}).name;
const vkey = v => v ? v.src + ":" + v.ref : "";
const score = it => Object.values(it.votes || {}).reduce((a, b) => a + b, 0);
const sortedQueue = () => [...state.queue].sort((a, b) => (score(b) - score(a)) || (a.at - b.at));

// ---------------------------------------------------------------- Ops
function send(op) {
  op.by = me.id; op.name = me.name;
  applyOp(op, true);
  transport && transport.send("op", op);
}
function applyOp(op, local) {
  const actor = local ? "Du" : (op.name || "Jemand");
  switch (op.k) {
    case "load": {
      if (op.prev && vkey(state.video) !== op.prev) return; // jemand war schneller
      state.video = op.video;
      state.pb = { playing: op.playing !== false, pos: op.pos || 0, at: now() };
      if (op.video && op.video.qid) state.queue = state.queue.filter(q => q.qid !== op.video.qid);
      if (!local && op.video) actorToast(`${actor} startet: ${op.video.title}`);
      break;
    }
    case "play": state.pb = { playing: true, pos: op.pos, at: now() }; if (!local) actorToast(`${actor} hat abgespielt`); flash("play_arrow"); break;
    case "pause": state.pb = { playing: false, pos: op.pos, at: now() }; if (!local) actorToast(`${actor} hat pausiert`); flash("pause"); break;
    case "seek": state.pb = { playing: state.pb.playing, pos: op.pos, at: now() }; if (!local) actorToast(`${actor} spult zu ${fmt(op.pos)}`); break;
    case "qadd":
      if (!state.queue.some(q => q.qid === op.item.qid)) state.queue.push(op.item);
      if (!local) showNotice(`${actor} hat „${op.item.title}“ zur Warteschlange hinzugefügt`);
      break;
    case "qdel": state.queue = state.queue.filter(q => q.qid !== op.qid); break;
    case "qvote": {
      const it = state.queue.find(q => q.qid === op.qid);
      if (it) { it.votes = it.votes || {}; if (op.v) it.votes[op.by] = op.v; else delete it.votes[op.by]; }
      break;
    }
    case "chat":
      state.chat.push(op.msg);
      if (state.chat.length > CHAT_MAX) state.chat.splice(0, state.chat.length - CHAT_MAX);
      if (!local && !chatActive) $("#unread").hidden = false;
      break;
    case "react": spawnEmoji(op.emoji, local ? "" : op.name); return;
    case "title": state.title = op.title; break;
  }
  renderAll();
  syncPlayer(true);
}

function onMessage(t, d, from) {
  if (t === "op") { if (synced) applyOp(d, false); return; }
  if (t === "hello") {
    // Der Leader (ohne den Neuen) schickt den Raumzustand
    const others = people.filter(p => p.id !== from);
    const l = [...others].sort((a, b) => (a.joinedAt - b.joinedAt) || (a.id < b.id ? -1 : 1))[0];
    if (synced && (!l || l.id === me.id)) {
      const snap = JSON.parse(JSON.stringify(state));
      snap.pb = { playing: state.pb.playing, pos: player && loadedKey === vkey(state.video) && isLeader() ? player.time() : expectedPos(), at: 0 };
      transport.send("snap", { to: from, state: snap });
    }
    return;
  }
  if (t === "snap") {
    if (d.to !== me.id || synced) return;
    synced = true;
    state = d.state;
    state.pb.at = now();
    if (!state.title) state.title = "Raum " + room.code;
    renderAll(); syncPlayer(true);
    return;
  }
  if (t === "tick") {
    if (!synced || from === me.id) return;
    if (vkey(state.video) !== d.v) return;
    state.pb = { playing: d.playing, pos: d.pos, at: now() };
    return;
  }
}

// ---------------------------------------------------------------- Player sync
const host = () => $("#playerHost");
const playerCb = {
  ended() { if (isLeader()) playNext(vkey(state.video)); },
  error(msg) {
    toast(msg, 4000);
    if (isLeader() && state.video) { const k = vkey(state.video); setTimeout(() => playNext(k), 3000); }
  },
  volume(p) { const v = store.get("sc_vol", 80), m = store.get("sc_mute", false); p.setVolume(v, m); }
};

async function syncPlayer(force) {
  const v = state.video;
  $("#emptyStage").hidden = !!v;
  if (!v) {
    if (player) { player.destroy(); player = null; loadedKey = ""; }
    renderSource();
    return;
  }
  const key = vkey(v);
  if (key !== loadedKey) {
    loadedKey = key;
    const want = isTw(v.src) ? "tw" : "yt";
    if (player && player.kind !== want) { player.destroy(); player = null; }
    if (!player) player = want === "yt" ? new YTAdapter(host(), playerCb) : new TwitchAdapter(host(), playerCb);
    renderSource();
    try {
      await player.load(want === "yt" ? v.ref : v, expectedPos(), state.pb.playing);
    } catch (e) { toast("Player konnte nicht geladen werden."); return; }
    if (loadedKey !== key) return;
    lastPlayCmd = now();
    setTimeout(checkBlocked, 2500);
    return;
  }
  if (!player || !player.ready) return;
  if (force) enforce(true);
}

function enforce(fromOp) {
  if (!player || !player.ready || !state.video || loadedKey !== vkey(state.video)) return;
  const want = state.pb.playing;
  if (want && !player.isPlaying() && !player.isBuffering() && !gestureNeeded) { player.play(); lastPlayCmd = now(); setTimeout(checkBlocked, 2000); }
  if (!want && player.isPlaying()) player.pause();
  if (player.live) return;
  const diff = player.time() - expectedPos();
  const leaderSelf = isLeader() && people.length > 1 && !fromOp;
  if (Math.abs(diff) > (fromOp ? 0.6 : DRIFT_MAX) && !leaderSelf && (fromOp || now() - lastCorrection > 2500)) {
    player.seek(expectedPos());
    lastCorrection = now();
  }
}

function checkBlocked() {
  if (!player || !player.ready || !state.pb.playing) return;
  if (!player.isPlaying() && !player.isBuffering()) { gestureNeeded = true; $("#gesture").hidden = false; }
}

function playNext(prevKey) {
  const next = sortedQueue()[0];
  if (next) send({ k: "load", video: next, pos: next.start || 0, playing: true, prev: prevKey });
  else if (state.pb.playing) send({ k: "pause", pos: player ? player.time() : expectedPos() });
}

// Steuerung durch den Nutzer
// Aktuelle Position: echte Player-Zeit, außer sie hinkt dem Raumzustand hinterher (z. B. direkt nach dem Spulen)
function curPos() {
  const exp = expectedPos();
  if (!player || !player.ready || player.live) return exp;
  const t = player.time();
  return Math.abs(t - exp) < 2 ? t : exp;
}
function userToggle() {
  if (!state.video) return;
  const pos = curPos();
  if (gestureNeeded) { resumeGesture(); if (state.pb.playing) return; }
  send({ k: state.pb.playing ? "pause" : "play", pos });
}
function userSeek(t) {
  if (!state.video || (player && player.live)) return;
  const d = player ? player.duration() : 0;
  t = clamp(t, 0, d ? d - 0.5 : t);
  send({ k: "seek", pos: t });
}
function resumeGesture() {
  gestureNeeded = false; $("#gesture").hidden = true;
  if (player && player.ready) { if (player.kind === "yt") { player.p.unMute(); } player.seek(expectedPos()); player.play(); }
}

// Leader-Tick + Drift-Schleife
setInterval(() => {
  if (!room || !synced) return;
  enforce(false);
  updateDrift();
}, 1000);
setInterval(() => {
  if (!room || !synced || !transport || !isLeader() || people.length < 2) return;
  if (!state.video || !player || !player.ready || loadedKey !== vkey(state.video)) return;
  if (player.isBuffering()) return;
  const pos = player.live ? 0 : player.time();
  state.pb = { playing: state.pb.playing, pos, at: now() };
  transport.send("tick", { v: vkey(state.video), pos, playing: state.pb.playing });
}, TICK_MS);

// ---------------------------------------------------------------- Rendering
function renderAll() {
  renderHead(); renderPeople(); renderQueue(); renderChat(); renderNow(); renderSource();
}
function avatarHTML(p, cls = "") {
  return `<span class="avatar ${cls}" style="background:${esc(p.color || colorFor(p.id))}" title="${esc(p.name)}">${esc(initials(p.name))}</span>`;
}
function renderHead() {
  $("#roomTitle").textContent = state.title || "Raum";
  document.title = (state.title ? state.title + " · " : "") + "SharedCue";
  const n = people.length;
  $("#roomSub").textContent = `${n} ${n === 1 ? "Person" : "Personen"} im Raum · Code ${room.code}` + (room.pw ? " · mit Passwort" : "");
  $("#liveTxt").textContent = `${n} ${n === 1 ? "Person" : "Freunde"} synchron`;
  $("#codeLabel").textContent = room.code;
  const url = inviteUrl(true);
  $("#shareUrl").textContent = url.replace(/^https?:\/\//, "");
  const hp = people.slice(0, 6).map(p => avatarHTML(p, p.id === me.id ? "me" : "")).join("");
  $("#headPeople").innerHTML = hp + (people.length > 6 ? `<span class="avatar" style="background:var(--c-highest)">+${people.length - 6}</span>` : "");
}
function renderPeople() {
  const l = leader();
  $("#peopleCount").textContent = `Teilnehmer (${people.length})`;
  $("#peopleList").innerHTML = people.map(p => `
    <li class="person">${avatarHTML(p, p.id === me.id ? "me" : "")}
      <div class="who"><div class="nm">${esc(p.name)}${p.id === me.id ? " (du)" : ""}</div>
      <div class="st">${l && l.id === p.id ? "Sync-Referenz" : "verbunden"}</div></div></li>`).join("");
}
function renderSource() {
  const v = state.video, b = $("#srcBadge");
  if (!v) { b.hidden = true; $("#driftBadge").hidden = true; $("#seek").disabled = true; return; }
  b.hidden = false;
  b.className = "sbadge " + (isTw(v.src) ? "tw" : "yt");
  b.innerHTML = `<span class="ms">${v.src === "twl" ? "bolt" : "smart_display"}</span>${esc(srcLabel(v.src))}${v.src === "twl" ? " · LIVE" : ""}`;
  $("#seek").disabled = v.src === "twl";
  $("#back10").disabled = $("#fwd10").disabled = v.src === "twl";
}
function renderNow() {
  const v = state.video;
  $("#nowCard").hidden = !v;
  if (!v) return;
  $("#nowTitle").textContent = v.title || "Video";
  const chips = [`<span class="chip">${esc(srcLabel(v.src))}</span>`];
  if (v.author) chips.push(`<span class="chip c2">${esc(v.author)}</span>`);
  if (v.byName) chips.push(`<span class="chip c2">eingereicht von ${esc(v.byName)}</span>`);
  $("#nowChips").innerHTML = chips.join("");
}
function renderQueue() {
  const all = sortedQueue();
  $("#qCount").textContent = all.length;
  const list = all.filter(q => filter === "all" || (filter === "yt" ? q.src === "yt" : isTw(q.src)));
  if (!list.length) {
    $("#qList").innerHTML = `<div class="q-empty"><span class="ms">queue_music</span><div>${all.length ? "Nichts in diesem Filter." : "Die Warteschlange ist leer.<br>Füge oben einen Link hinzu."}</div></div>`;
    return;
  }
  $("#qList").innerHTML = list.map(q => {
    const mine = (q.votes || {})[me.id] || 0, sc = score(q);
    const thumb = q.thumb ? `<img src="${esc(q.thumb)}" alt="" loading="lazy">` : `<div class="tw-fill"><span class="ms">${q.src === "twl" ? "live_tv" : "videocam"}</span></div>`;
    return `<div class="q-item" data-qid="${esc(q.qid)}">
      <div class="thumb">${thumb}<span class="src ${isTw(q.src) ? "tw" : "yt"}"><span class="ms">${isTw(q.src) ? "bolt" : "play_arrow"}</span></span></div>
      <div class="q-body">
        <div class="q-title">${esc(q.title)}</div>
        <div class="q-meta">${esc(srcLabel(q.src))} · von <b>${esc(q.byName || "?")}</b></div>
        <div class="q-actions">
          <button data-act="play" type="button"><span class="ms">play_arrow</span>Jetzt</button>
          <button data-act="del" type="button" aria-label="Entfernen"><span class="ms">delete</span></button>
        </div>
      </div>
      <div class="votes">
        <button type="button" data-act="up" class="${mine === 1 ? "on" : ""}" aria-label="Hochvoten" aria-pressed="${mine === 1}"><span class="ms ${mine === 1 ? "fill" : ""}">arrow_upward</span></button>
        <span class="score">${sc}</span>
        <button type="button" data-act="down" class="${mine === -1 ? "on down" : ""}" aria-label="Runtervoten" aria-pressed="${mine === -1}"><span class="ms ${mine === -1 ? "fill" : ""}">arrow_downward</span></button>
      </div></div>`;
  }).join("");
}
function renderChat() {
  const box = $("#chatList");
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  const all = [...state.chat.map(m => ({ ...m, kind: "msg" })), ...sysMsgs.map(m => ({ ...m, kind: "sys" }))].sort((a, b) => a.ts - b.ts);
  box.innerHTML = all.length ? all.map(m => m.kind === "sys"
    ? `<div class="chat-sys">${esc(m.text)}</div>`
    : `<div class="chat-msg">${avatarHTML({ id: m.by, name: m.name, color: m.color })}<div class="bubble"><div><span class="nm">${esc(m.name)}</span><span class="ts">${hhmm(m.ts)}</span></div><div class="tx">${esc(m.text)}</div></div></div>`
  ).join("") : `<div class="q-empty"><span class="ms">forum</span><div>Noch keine Nachrichten.</div></div>`;
  if (atBottom) box.scrollTop = box.scrollHeight;
}
function sys(text) { sysMsgs.push({ text, ts: now() }); if (sysMsgs.length > 40) sysMsgs.shift(); renderChat(); }

let noticeT;
function showNotice(text) {
  $("#qNoticeTxt").textContent = text; $("#qNotice").hidden = false;
  clearTimeout(noticeT); noticeT = setTimeout(() => $("#qNotice").hidden = true, 5000);
}
let actorT;
function actorToast(text) {
  const el = $("#actorToast"); el.textContent = text; el.classList.add("show");
  clearTimeout(actorT); actorT = setTimeout(() => el.classList.remove("show"), 2200);
}
let flashT;
function flash(icon) {
  $("#centerIcon").textContent = icon; $("#centerFlash").classList.add("show");
  clearTimeout(flashT); flashT = setTimeout(() => $("#centerFlash").classList.remove("show"), 600);
}
function spawnEmoji(emoji, name) {
  if (!EMOJIS.includes(emoji)) return;
  const el = document.createElement("span");
  el.className = "float-emoji";
  el.style.left = (55 + Math.random() * 38) + "%";
  el.innerHTML = esc(emoji) + (name ? `<small>${esc(name)}</small>` : "");
  $("#reactLayer").appendChild(el);
  setTimeout(() => el.remove(), 2700);
}
function updateDrift() {
  const b = $("#driftBadge"), info = $("#syncInfo"), badge = $("#syncBadge");
  if (!state.video || !player || !player.ready) { b.hidden = true; info.textContent = state.video ? "Player lädt …" : "Warte auf Video …"; return; }
  b.hidden = false;
  if (player.live) { $("#driftTxt").textContent = "LIVE"; info.textContent = "Livestream: Play und Pause werden geteilt. Spulen ist bei Live nicht möglich."; badge.textContent = "SYNCHRON"; badge.className = "pill badge-sync"; return; }
  const d = Math.abs(player.time() - expectedPos());
  const leaderSelf = isLeader() && people.length > 1;
  if (leaderSelf) { $("#driftTxt").textContent = "REFERENZ"; info.textContent = "Dein Player ist die Referenz, die anderen gleichen sich an dich an."; }
  else { $("#driftTxt").textContent = `SYNC ${d.toFixed(1)}s`; info.textContent = d < 0.5 ? "Perfekt synchron." : d < DRIFT_MAX ? `Abweichung ${d.toFixed(1)} s – im grünen Bereich.` : `Abweichung ${d.toFixed(1)} s – hole auf …`; }
  const ok = leaderSelf || d < DRIFT_MAX;
  badge.textContent = ok ? "SYNCHRON" : "HOLT AUF";
  badge.className = "pill " + (ok ? "badge-sync" : "badge-warn");
}

// Controls-Anzeige
setInterval(() => {
  if (!room) return;
  const playing = state.pb.playing;
  $("#playIcon").textContent = playing ? "pause" : "play_arrow";
  $("#playBtn").setAttribute("aria-label", playing ? "Pausieren" : "Abspielen");
  if (!player || !player.ready || !state.video) { $("#timeTxt").textContent = "0:00 / 0:00"; setRange($("#seek"), 0); return; }
  if (player.live) { $("#timeTxt").textContent = "● LIVE"; setRange($("#seek"), 1000); return; }
  const d = player.duration(), t = player.time();
  if (!seeking) { setRange($("#seek"), d ? (t / d) * 1000 : 0); $("#timeTxt").textContent = `${fmt(t)} / ${fmt(d)}`; }
}, 250);
function setRange(el, v) { el.value = v; el.style.setProperty("--p", (v / el.max) * 100 + "%"); }

// ---------------------------------------------------------------- Room lifecycle
function genCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const r = crypto.getRandomValues(new Uint8Array(6));
  const s = Array.from(r, b => A[b % A.length]).join("");
  return s.slice(0, 3) + "-" + s.slice(3);
}
const normCode = c => { const s = String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); return s.length === 6 ? s.slice(0, 3) + "-" + s.slice(3) : s; };
function inviteUrl(withPw) {
  const base = location.href.split("#")[0];
  return base + "#/r/" + room.code + (withPw && room.pw ? "?k=" + b64e(room.pw) : "");
}

async function enterRoom({ name, code, pw, title, creating }) {
  name = name.trim().slice(0, 24) || "Gast";
  store.set("sc_name", name);
  const id = store.sget("sc_id", null) || uid(12);
  store.sset("sc_id", id);
  me = { id, name, color: colorFor(id + name), joinedAt: now() };
  const channel = (await sha256(code + "\u0000" + (pw || ""))).slice(0, 32);
  room = { code, pw: pw || "", channel };
  state = freshState();
  if (creating) state.title = (title || "").trim() || `${name}s Raum`;
  synced = !!creating;
  people = [me]; sysMsgs = [];
  store.sset("sc_session", { code, pw: room.pw, name });
  history.replaceState(null, "", "#/r/" + code);

  $("#lobby").hidden = true; $("#room").hidden = false;
  buildReactBar();
  renderAll(); syncPlayer(true);
  setLive(false, "verbinde …");

  transport = HAS_SUPA ? new SupabaseTransport(CFG) : new LocalTransport();
  transport.on("message", onMessage);
  transport.on("status", s => setLive(s === "online"));
  transport.on("presence", list => {
    const before = new Set(people.map(p => p.id));
    people = list;
    const after = new Set(list.map(p => p.id));
    for (const p of list) if (!before.has(p.id) && p.id !== me.id) sys(`${p.name} ist beigetreten`);
    for (const id of before) if (!after.has(id) && id !== me.id) sys(`${(prevPeople.get(id) || {}).name || "Jemand"} hat den Raum verlassen`);
    prevPeople = new Map(list.map(p => [p.id, p]));
    renderHead(); renderPeople();
  });
  try {
    await transport.connect(channel, me);
  } catch (e) {
    toast("Verbindung fehlgeschlagen. Prüfe deine Internetverbindung.", 5000);
    setLive(false, "offline");
    return;
  }
  if (!synced) requestSnapshot(0);
}
let prevPeople = new Map();
function requestSnapshot(n) {
  if (synced || !transport) return;
  transport.send("hello", {});
  setTimeout(() => {
    if (synced) return;
    if (people.length > 1 && n < 4) return requestSnapshot(n + 1);
    if (n < 2) return requestSnapshot(n + 1);
    // Niemand antwortet → wir sind allein
    synced = true;
    state.title = state.title || "Raum " + room.code;
    renderAll();
    toast(room.pw ? "Noch niemand hier. Sind deine Freunde schon drin? Dann prüfe das Passwort." : "Du bist als Erste(r) im Raum.", 5000);
  }, 1200);
}
function setLive(on, txt) {
  $("#liveDot").classList.toggle("off", !on);
  if (txt) $("#liveTxt").textContent = txt; else renderHead();
}
function leaveRoom() {
  transport && transport.leave(); transport = null;
  if (player) { player.destroy(); player = null; } loadedKey = "";
  room = null; synced = false; people = [];
  store.sdel("sc_session");
  history.replaceState(null, "", location.pathname + location.search);
  $("#room").hidden = true; $("#lobby").hidden = false;
  document.title = "SharedCue – Gemeinsam schauen";
}
window.addEventListener("pagehide", () => { transport && transport.leave(); });

// ---------------------------------------------------------------- Actions
async function addLink(raw, inputEl) {
  const media = parseMedia(raw);
  if (!media) { toast("Das ist kein YouTube- oder Twitch-Link."); return; }
  if (media.src === "clip") { toast("Twitch-Clips lassen sich nicht synchron steuern. Nimm das ganze Video (twitch.tv/videos/…)."); return; }
  if (inputEl) { inputEl.value = ""; inputEl.disabled = true; }
  const item = await buildItem(media);
  if (inputEl) { inputEl.disabled = false; inputEl.focus(); }
  if (!state.video) send({ k: "load", video: item, pos: item.start || 0, playing: true });
  else { send({ k: "qadd", item }); toast("Zur Warteschlange hinzugefügt"); }
}
function sendChat(text) {
  text = text.trim().slice(0, 500);
  if (!text) return;
  send({ k: "chat", msg: { id: uid(8), by: me.id, name: me.name, color: me.color, text, ts: now() } });
}
let lastReact = 0;
function react(emoji) {
  if (now() - lastReact < 350) return;
  lastReact = now();
  send({ k: "react", emoji });
}
function buildReactBar() {
  $("#reactBar").innerHTML = EMOJIS.map(e => `<button type="button" data-e="${e}" aria-label="Reaktion ${e}">${e}</button>`).join("");
}

// ---------------------------------------------------------------- Wiring
function selectLobbyTab(join) {
  $("#tabCreate").setAttribute("aria-selected", String(!join));
  $("#tabJoin").setAttribute("aria-selected", String(join));
  $("#formCreate").hidden = join; $("#formJoin").hidden = !join;
}
$("#tabCreate").onclick = () => selectLobbyTab(false);
$("#tabJoin").onclick = () => selectLobbyTab(true);

$("#formCreate").addEventListener("submit", e => {
  e.preventDefault();
  enterRoom({ name: $("#cName").value, code: genCode(), pw: $("#cPass").value, title: $("#cTitle").value, creating: true });
});
$("#formJoin").addEventListener("submit", e => {
  e.preventDefault();
  const code = normCode($("#jCode").value);
  if (!/^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(code)) { toast("Der Code hat 6 Zeichen, z. B. K7Q-4MX."); return; }
  enterRoom({ name: $("#jName").value, code, pw: $("#jPass").value, creating: false });
});

$("#topAdd").addEventListener("submit", e => { e.preventDefault(); addLink($("#topAddInput").value, $("#topAddInput")); });
$("#qAdd").addEventListener("submit", e => { e.preventDefault(); addLink($("#qAddInput").value, $("#qAddInput")); });
$("#chatForm").addEventListener("submit", e => { e.preventDefault(); sendChat($("#chatInput").value); $("#chatInput").value = ""; });

$("#qList").addEventListener("click", e => {
  const btn = e.target.closest("button[data-act]"); if (!btn) return;
  const qid = btn.closest(".q-item").dataset.qid;
  const it = state.queue.find(q => q.qid === qid); if (!it) return;
  const act = btn.dataset.act, mine = (it.votes || {})[me.id] || 0;
  if (act === "play") send({ k: "load", video: it, pos: it.start || 0, playing: true });
  if (act === "del") send({ k: "qdel", qid });
  if (act === "up") send({ k: "qvote", qid, v: mine === 1 ? 0 : 1 });
  if (act === "down") send({ k: "qvote", qid, v: mine === -1 ? 0 : -1 });
});
$$(".fchip").forEach(b => b.onclick = () => {
  filter = b.dataset.f;
  $$(".fchip").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  renderQueue();
});
function selectRTab(chat) {
  chatActive = chat;
  $("#rtQueue").setAttribute("aria-selected", String(!chat));
  $("#rtChat").setAttribute("aria-selected", String(chat));
  $("#paneQueue").hidden = chat; $("#paneChat").hidden = !chat;
  if (chat) { $("#unread").hidden = true; const b = $("#chatList"); b.scrollTop = b.scrollHeight; }
}
$("#rtQueue").onclick = () => selectRTab(false);
$("#rtChat").onclick = () => selectRTab(true);

$("#reactBar").addEventListener("click", e => { const b = e.target.closest("button[data-e]"); if (b) react(b.dataset.e); });
$("#playBtn").onclick = userToggle;
let shieldT;
$("#shield").addEventListener("click", () => { clearTimeout(shieldT); shieldT = setTimeout(userToggle, 220); });
$("#shield").addEventListener("dblclick", () => { clearTimeout(shieldT); toggleFs(); });
$("#back10").onclick = () => userSeek(curPos() - 10);
$("#fwd10").onclick = () => userSeek(curPos() + 10);
$("#skipBtn").onclick = () => { if (!state.queue.length) { toast("Die Warteschlange ist leer."); return; } const n = sortedQueue()[0]; send({ k: "load", video: n, pos: n.start || 0, playing: true }); };
$("#resyncBtn").onclick = () => {
  if (!player || !player.ready) return;
  if (gestureNeeded) resumeGesture();
  if (!player.live) player.seek(expectedPos());
  lastCorrection = now();
  transport && transport.send("hello", {}); // frischen Stand holen
  synced = true;
  toast("Neu synchronisiert");
};
const seekEl = $("#seek");
seekEl.addEventListener("pointerdown", () => seeking = true);
seekEl.addEventListener("input", () => {
  seeking = true;
  const d = player ? player.duration() : 0;
  setRange(seekEl, +seekEl.value);
  $("#timeTxt").textContent = `${fmt((seekEl.value / 1000) * d)} / ${fmt(d)}`;
});
seekEl.addEventListener("change", () => {
  const d = player ? player.duration() : 0;
  if (d) userSeek((seekEl.value / 1000) * d);
  seeking = false;
});
seekEl.addEventListener("pointerup", () => setTimeout(() => seeking = false, 50));

const volEl = $("#vol");
function applyVol() {
  const v = store.get("sc_vol", 80), m = store.get("sc_mute", false);
  setRange(volEl, m ? 0 : v);
  $("#volIcon").textContent = m || v === 0 ? "volume_off" : v < 50 ? "volume_down" : "volume_up";
  player && player.ready && player.setVolume(v, m);
}
volEl.max = 100;
volEl.addEventListener("input", () => { store.set("sc_vol", +volEl.value); store.set("sc_mute", +volEl.value === 0); applyVol(); });
$("#muteBtn").onclick = () => { store.set("sc_mute", !store.get("sc_mute", false)); if (!store.get("sc_mute") && store.get("sc_vol", 80) === 0) store.set("sc_vol", 60); applyVol(); };
applyVol();

function toggleFs() {
  const st = $(".stage");
  if (document.fullscreenElement) document.exitFullscreen();
  else (st.requestFullscreen || st.webkitRequestFullscreen || (() => {})).call(st);
}
$("#fsBtn").onclick = toggleFs;
$("#gestureBtn").onclick = resumeGesture;

$("#copyBtn").onclick = () => copy(inviteUrl(true), $("#copyBtn"));
$("#inviteBtn").onclick = () => {
  $("#pwSwitchWrap").hidden = !room.pw;
  $("#inviteCode").textContent = room.code;
  $("#inviteLink").value = inviteUrl($("#pwInLink").checked);
  $("#inviteModal").hidden = false;
  $("#inviteCopy").focus();
};
$("#pwInLink").onchange = () => $("#inviteLink").value = inviteUrl($("#pwInLink").checked);
$("#inviteCopy").onclick = () => copy($("#inviteLink").value, $("#inviteCopy"));
$("#inviteClose").onclick = () => $("#inviteModal").hidden = true;
$("#inviteModal").addEventListener("click", e => { if (e.target.id === "inviteModal") $("#inviteModal").hidden = true; });
$("#leaveBtn").onclick = leaveRoom;

async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); }
  const old = btn.textContent; btn.textContent = "Kopiert!"; setTimeout(() => btn.textContent = old, 1500);
}

document.addEventListener("keydown", e => {
  if (!room) { return; }
  if (e.key === "Escape") { $("#inviteModal").hidden = true; return; }
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || e.target.isContentEditable) return;
  if (e.key === " " || e.key === "k") { e.preventDefault(); userToggle(); }
  else if (e.key === "ArrowLeft" || e.key === "j") { e.preventDefault(); $("#back10").click(); }
  else if (e.key === "ArrowRight" || e.key === "l") { e.preventDefault(); $("#fwd10").click(); }
  else if (e.key === "f") toggleFs();
});

// ---------------------------------------------------------------- Boot
function boot() {
  $("#modeNote").hidden = HAS_SUPA;
  const name = store.get("sc_name", "");
  $("#cName").value = name; $("#jName").value = name;
  const m = location.hash.match(/^#\/r\/([A-Za-z0-9-]+)(?:\?k=([\w-]+))?/);
  if (m) {
    const code = normCode(m[1]);
    const pw = m[2] ? b64d(m[2]) : "";
    selectLobbyTab(true);
    $("#jCode").value = code; $("#jPass").value = pw;
    const sess = store.sget("sc_session", null);
    if (sess && sess.code === code && name) { enterRoom({ name, code, pw: sess.pw, creating: false }); return; }
    // Passwort aus dem Link nicht in der Adresszeile stehen lassen
    if (pw) history.replaceState(null, "", "#/r/" + code);
    (name ? $("#formJoin .btn") : $("#jName")).focus();
  }
}
boot();
})();
