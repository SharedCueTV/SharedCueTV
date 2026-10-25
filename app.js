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
    const list = u.searchParams.get("list");
    if (list && /^[\w-]{10,}$/.test(list) && (u.pathname === "/playlist" || !u.searchParams.get("v"))) return { src: "ytpl", ref: list };
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
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    const m = u.pathname.match(/\/(?:video|v2|v1|photo)\/(\d{8,})/) || u.pathname.match(/^\/(?:player\/v1|embed\/v2|embed)\/(\d{8,})/);
    if (m) return { src: "tt", ref: m[1], url: s };
    if (/^(vm|vt)\./.test(host) || /^\/t\//.test(u.pathname)) return { src: "tt", ref: "", url: s };
    return null;
  }
  if (host === "instagram.com" || host.endsWith(".instagram.com")) {
    const m = u.pathname.match(/^\/(?:[\w.]+\/)?(reels?|p|tv)\/([\w-]{5,})/);
    if (m) return { src: "ig", ref: m[2], kind: m[1] === "p" ? "p" : "reel", url: s };
  }
  return null;
}
async function fetchJSON(url, ms = 3500) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal }); return r.ok ? await r.json() : null; }
  catch { return null; } finally { clearTimeout(t); }
}
async function buildItem(media) {
  const item = { qid: uid(8), src: media.src, ref: media.ref, start: media.start || 0, by: me.id, byName: me.name, votes: {}, at: now(), title: "", thumb: "" };
  if (media.src === "tt") {
    // TikTok erlaubt keine Metadaten-Abfrage aus dem Browser (kein CORS) → Name aus dem Link
    if (!item.ref) return null; // Kurzlinks (vm.tiktok.com) lassen sich im Browser nicht auflösen
    const um = String(media.url).match(/\/@([\w.]+)/);
    item.author = um ? "@" + um[1] : "";
    item.title = um ? `TikTok von @${um[1]}` : "TikTok-Video";
    return item;
  }
  if (media.src === "ig") {
    item.kind = media.kind;
    item.title = media.kind === "p" ? "Instagram-Beitrag" : "Instagram Reel";
    return item;
  }
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
const srcLabel = s => ({ yt: "YouTube", twl: "Twitch Live", twv: "Twitch", tt: "TikTok", ig: "Instagram" })[s] || "Video";
const isTw = s => s === "twv" || s === "twl";
const family = s => isTw(s) ? "tw" : (s === "tt" || s === "ig") ? "clips" : "yt";
const SRC_ICON = { yt: "play_arrow", twv: "bolt", twl: "bolt", tt: "music_note", ig: "photo_camera" };
const SRC_CLASS = { yt: "yt", twv: "tw", twl: "tw", tt: "tt", ig: "ig" };

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
          if (this.ch !== ch) return; // bewusst verlassen
          this.emit("status", "offline");
          if (!done) { done = true; reject(new Error(status)); }
        }
      });
    });
  }
  send(t, d) { this.ch && this.ch.send({ type: "broadcast", event: "m", payload: { t, d, f: this.meta.id } }); }
  leave() {
    if (!this.ch) return;
    const ch = this.ch; this.ch = null; this.leaving = true;
    try { ch.untrack(); } catch {}
    this.client.removeChannel(ch).finally(() => { this.leaving = false; });
  }
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
    this.started = false;
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
        playerVars: { autoplay: playing ? 1 : 0, controls: 1, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0, start: Math.floor(pos), origin: location.origin && location.origin !== "null" ? location.origin : undefined },
        events: {
          onReady: () => { this.ready = true; this.cb.volume(this); if (pos) this.p.seekTo(pos, true); if (playing) this.p.playVideo(); resolve(); },
          onStateChange: e => { if (e.data === 1) this.started = true; if (e.data === 0) this.cb.ended(); },
          onPlaybackRateChange: e => { if (Math.abs(e.data - (this.setRateTo || 1)) > 0.01) this.cb.rate(e.data); },
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
  rate() { return this.ready && this.p.getPlaybackRate ? this.p.getPlaybackRate() || 1 : 1; }
  setRate(r) { if (!this.ready) return; this.setRateTo = r; this.p.setPlaybackRate(r); }
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
      this.p.addEventListener(Twitch.Player.PLAYING, () => { this.started = true; });
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
  qualities() { try { return (this.p.getQualities() || []).filter(q => q.group); } catch { return []; } }
  quality() { try { return this.p.getQuality(); } catch { return ""; } }
  setQuality(g) { try { this.p.setQuality(g); } catch {} }
  destroyInner() { this.host.innerHTML = ""; this.p = null; this.ready = false; this.started = false; }
  destroy() { this.destroyInner(); }
}

// TikTok: offizieller Embed-Player mit postMessage-API (play, pause, seekTo, mute)
class TikTokAdapter {
  constructor(host, cb) {
    this.host = host; this.cb = cb; this.kind = "tt"; this.live = false;
    this.t = 0; this.tAt = now(); this.dur = 0; this.st = -1;
    this.onMsg = e => {
      if (!this.ifr || e.source !== this.ifr.contentWindow) return;
      let m = e.data; if (typeof m === "string") { try { m = JSON.parse(m); } catch { return; } }
      if (!m || !m.type) return;
      if (m.type === "onPlayerReady") { this.ready = true; this.cb.volume(this); this.readyFn && this.readyFn(); }
      else if (m.type === "onStateChange") {
        this.st = m.value; this.tAt = now();
        if (m.value === 1) this.started = true;
        if (m.value === 0) this.cb.ended();
      }
      else if (m.type === "onCurrentTime" && m.value) { this.t = +m.value.currentTime || 0; this.dur = +m.value.duration || this.dur; this.tAt = now(); }
      else if (m.type === "onPlayerError") this.cb.error("TikTok-Video kann nicht abgespielt werden.");
    };
    window.addEventListener("message", this.onMsg);
  }
  post(type, value) { this.ifr && this.ifr.contentWindow && this.ifr.contentWindow.postMessage(value === undefined ? { type, "x-tiktok-player": true } : { type, value, "x-tiktok-player": true }, "*"); }
  async load(item, pos, playing) {
    this.host.innerHTML = ""; this.ready = false; this.started = false; this.t = pos || 0; this.dur = 0; this.st = -1;
    const ifr = this.ifr = document.createElement("iframe");
    ifr.src = `https://www.tiktok.com/player/v1/${encodeURIComponent(item.ref)}?controls=0&autoplay=${playing ? 1 : 0}&loop=0&rel=0&music_info=1&description=1&closed_caption=0&native_context_menu=0`;
    ifr.allow = "autoplay; fullscreen; encrypted-media; picture-in-picture";
    ifr.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;background:#000";
    this.host.appendChild(ifr);
    await new Promise(resolve => { this.readyFn = resolve; setTimeout(resolve, 8000); });
    if (!this.ready) return;
    if (pos > 0.5) this.seek(pos);
    if (playing) this.play();
  }
  play() { this.post("play"); }
  pause() { this.post("pause"); }
  seek(t) { this.post("seekTo", Math.max(0, t)); this.t = t; this.tAt = now(); }
  time() { return this.st === 1 ? this.t + (now() - this.tAt) / 1000 : this.t; }
  duration() { return this.dur; }
  isPlaying() { return this.st === 1; }
  isBuffering() { return this.st === 3; }
  setVolume(v, muted) { this.post(muted || v === 0 ? "mute" : "unMute"); }
  destroy() { window.removeEventListener("message", this.onMsg); this.host.innerHTML = ""; this.ifr = null; this.ready = false; }
}

// Instagram bietet keine steuerbare Player-API: Alle sehen dasselbe Reel, Start per gemeinsamem Countdown
class InstaAdapter {
  constructor(host, cb) { this.host = host; this.cb = cb; this.kind = "ig"; this.manual = true; this.live = false; }
  async load(item) {
    this.host.innerHTML = "";
    const ifr = document.createElement("iframe");
    ifr.src = `https://www.instagram.com/${item.kind === "p" ? "p" : "reel"}/${encodeURIComponent(item.ref)}/embed/`;
    ifr.allow = "autoplay; fullscreen; encrypted-media; picture-in-picture";
    ifr.setAttribute("scrolling", "no");
    ifr.style.cssText = "position:absolute;top:0;bottom:0;left:50%;transform:translateX(-50%);height:100%;aspect-ratio:9/16;max-width:100%;border:0;background:#fff";
    this.host.appendChild(ifr);
    this.ready = true;
  }
  play() {} pause() {} seek() {}
  time() { return 0; } duration() { return 0; }
  isPlaying() { return false; } isBuffering() { return false; }
  setVolume() {}
  destroy() { this.host.innerHTML = ""; this.ready = false; }
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
let refreshWanted = false;  // frischen Stand anfordern (nach Verbindungsabbruch)
let offlineSince = 0, reconnectT = null, backoff = 0, hiddenAt = 0;
const fmtRate = r => String(+r.toFixed(2)).replace(".", ",") + "×";

function freshState() {
  return { title: "", video: null, pb: { playing: false, pos: 0, at: now(), rate: 1 }, queue: [], chat: [] };
}
const RATE = () => state.pb.rate || 1;
const expectedPos = () => state.pb.playing ? state.pb.pos + (now() - state.pb.at) / 1000 * RATE() : state.pb.pos;
const setPb = (playing, pos, rate = RATE()) => { state.pb = { playing, pos, at: now(), rate }; };
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
      setPb(op.playing !== false, op.pos || 0, 1);
      hideUpNext();
      if (op.video && op.video.qid) state.queue = state.queue.filter(q => q.qid !== op.video.qid);
      if (!local && op.video) actorToast(`${actor} startet: ${op.video.title}`);
      break;
    }
    case "play": setPb(true, op.pos); if (!local) actorToast(`${actor} hat abgespielt`); flash("play_arrow"); break;
    case "pause": setPb(false, op.pos); if (!local) actorToast(`${actor} hat pausiert`); flash("pause"); break;
    case "seek": setPb(state.pb.playing, op.pos); if (!local) actorToast(`${actor} spult zu ${fmt(op.pos)}`); break;
    case "qadd":
      if (!state.queue.some(q => q.qid === op.item.qid)) state.queue.push(op.item);
      if (!local) showNotice(`${actor} hat „${op.item.title}“ zur Warteschlange hinzugefügt`);
      break;
    case "qdel": state.queue = state.queue.filter(q => q.qid !== op.qid); break;
    case "qaddMany":
      for (const it of op.items || []) if (!state.queue.some(q => q.qid === it.qid)) state.queue.push(it);
      if (!local) showNotice(`${actor} hat eine Playlist mit ${(op.items || []).length} Videos hinzugefügt`);
      break;
    case "rate":
      setPb(state.pb.playing, op.pos, clamp(+op.rate || 1, 0.25, 2));
      if (!local) actorToast(`${actor}: Geschwindigkeit ${fmtRate(RATE())}`);
      break;
    case "upnext":
      if (vkey(state.video) !== op.prev) return;
      showUpNext(op.video, op.secs || 5, op.prev);
      return;
    case "upnextCancel": hideUpNext(); if (!local) actorToast(`${actor} hat das nächste Video abgebrochen`); return;
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
    case "countdown": runCountdown(local ? "Du" : op.name); return;
    case "voice": voiceSignal(op, local); return;
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
      snap.pb = { playing: state.pb.playing, pos: player && loadedKey === vkey(state.video) && isLeader() && !player.manual && !player.live ? player.time() : expectedPos(), at: 0, rate: RATE() };
      transport.send("snap", { to: from, state: snap });
    }
    if (voice.on) transport.send("op", { k: "voice", t: "here", by: me.id, name: me.name, muted: voice.muted });
    return;
  }
  if (t === "snap") {
    if (d.to !== me.id || (synced && !refreshWanted)) return;
    const wasRefresh = synced && refreshWanted;
    synced = true; refreshWanted = false;
    state = d.state;
    state.pb.at = now();
    if (wasRefresh) actorToast("Wieder verbunden – Stand aktualisiert");
    if (!state.title) state.title = "Raum " + room.code;
    renderAll(); syncPlayer(true);
    return;
  }
  if (t === "tick") {
    if (!synced || from === me.id) return;
    if (vkey(state.video) !== d.v) return;
    setPb(d.playing, d.pos, d.rate || RATE());
    return;
  }
}

// ---------------------------------------------------------------- Player sync
const host = () => $("#playerHost");
const playerCb = {
  ended() { if (isLeader()) playNext(vkey(state.video), true); },
  rate(r) {
    // Geschwindigkeit wurde im YouTube-Menü geändert → für alle übernehmen
    if (!state.video || Math.abs(r - RATE()) < 0.01) return;
    send({ k: "rate", rate: r, pos: curPos() });
  },
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
    const want = isTw(v.src) ? "tw" : v.src === "tt" ? "tt" : v.src === "ig" ? "ig" : "yt";
    if (player && player.kind !== want) { player.destroy(); player = null; }
    if (!player) {
      const A = { yt: YTAdapter, tw: TwitchAdapter, tt: TikTokAdapter, ig: InstaAdapter }[want];
      player = new A(host(), playerCb);
    }
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

// YouTube-Werbung erkennen: Status "nicht gestartet" (-1), aber die Zeit läuft weiter
function detectAd() {
  if (!player || player.kind !== "yt" || !player.ready || !player.p.getPlayerState) return false;
  const st = player.p.getPlayerState(), t = player.time();
  const advancing = player._lt != null && Math.abs(t - player._lt) > 0.3;
  player._lt = t;
  if (st === 1 || st === 2 || st === 0) player.inAd = false;
  else if (st === -1 && advancing) player.inAd = true;
  return !!player.inAd;
}
function enforce(fromOp) {
  if (!player || !player.ready || player.manual || !state.video || loadedKey !== vkey(state.video)) return;
  if (!fromOp && detectAd()) return;   // während Werbung nichts erzwingen – danach wird aufgeholt
  if (player.inAd) return;
  const want = state.pb.playing;
  if (want && !player.isPlaying() && !player.isBuffering() && !gestureNeeded) { player.play(); lastPlayCmd = now(); setTimeout(checkBlocked, 2000); }
  if (!want && player.isPlaying()) player.pause();
  if (player.setRate && Math.abs(player.rate() - RATE()) > 0.01) player.setRate(RATE());
  if (player.live) return;
  const diff = player.time() - expectedPos();
  // Die Referenz gleicht nur kleine Abweichungen per Tick aus; große (z. B. nach Werbung) holt auch sie auf
  const leaderSelf = isLeader() && people.length > 1 && !fromOp && Math.abs(diff) < 4;
  if (Math.abs(diff) > (fromOp ? 0.6 : DRIFT_MAX) && !leaderSelf && (fromOp || now() - lastCorrection > 2500)) {
    player.seek(expectedPos());
    lastCorrection = now();
  }
}

function checkBlocked() {
  if (!player || !player.ready || player.manual || player.inAd || !state.pb.playing) return;
  detectAd(); if (player.inAd) return;
  if (!player.isPlaying() && !player.isBuffering()) { gestureNeeded = true; $("#gesture").hidden = false; }
}

function playNext(prevKey, withCountdown) {
  const next = sortedQueue()[0];
  if (next && withCountdown) send({ k: "upnext", video: next, prev: prevKey, secs: 5 });
  else if (next) send({ k: "load", video: next, pos: next.start || 0, playing: true, prev: prevKey });
  else if (state.pb.playing) send({ k: "pause", pos: player ? player.time() : expectedPos() });
}

// Steuerung durch den Nutzer
// Aktuelle Position: echte Player-Zeit, außer sie hinkt dem Raumzustand hinterher (z. B. direkt nach dem Spulen)
function curPos() {
  const exp = expectedPos();
  if (!player || !player.ready || player.live || player.manual) return exp;
  const t = player.time();
  return Math.abs(t - exp) < 2 ? t : exp;
}
let lastCountdown = 0;
function userToggle() {
  if (!state.video) return;
  if (player && player.manual) {
    if (now() - lastCountdown < 5000) return;
    lastCountdown = now();
    send({ k: "countdown" });
    return;
  }
  const pos = curPos();
  if (gestureNeeded) { resumeGesture(); if (state.pb.playing) return; }
  send({ k: state.pb.playing ? "pause" : "play", pos });
}
function userSeek(t) {
  if (!state.video || (player && (player.live || player.manual))) return;
  const d = player ? player.duration() : 0;
  t = clamp(t, 0, d ? d - 0.5 : t);
  send({ k: "seek", pos: t });
}
function resumeGesture() {
  gestureNeeded = false; $("#gesture").hidden = true;
  if (player && player.ready && !player.manual) { playerCb.volume(player); player.seek(expectedPos()); player.play(); }
}

// Leader-Tick + Drift-Schleife
setInterval(() => {
  if (!room || !synced) return;
  enforce(false);
  updateDrift();
}, 1000);
setInterval(() => {
  if (!room || !synced || !transport || !isLeader() || people.length < 2) return;
  if (!state.video || !player || !player.ready || player.manual || loadedKey !== vkey(state.video)) return;
  if (player.isBuffering() || player.inAd) return;
  if (!player.live && Math.abs(player.time() - expectedPos()) > 3) return; // eigener Player hängt hinterher → nicht als Referenz senden
  const pos = player.live ? 0 : player.time();
  setPb(state.pb.playing, pos);
  transport.send("tick", { v: vkey(state.video), pos, playing: state.pb.playing, rate: RATE() });
}, TICK_MS);

// ---------------------------------------------------------------- Rendering
function renderAll() {
  renderHead(); renderPeople(); renderQueue(); renderChat(); renderNow(); renderSource();
}
function avatarHTML(p, cls = "") {
  return `<span class="avatar ${cls}" data-uid="${esc(p.id)}" style="background:${esc(p.color || colorFor(p.id))}" title="${esc(p.name)}">${esc(initials(p.name))}</span>`;
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
      <div class="st">${l && l.id === p.id ? "Sync-Referenz" : "verbunden"}</div></div>
      ${voice.members.has(p.id) ? `<span class="ms vmic ${voice.members.get(p.id).muted ? "off" : ""}" title="${voice.members.get(p.id).muted ? "stumm" : "im Sprachchat"}">${voice.members.get(p.id).muted ? "mic_off" : "mic"}</span>` : ""}</li>`).join("");
  renderVoice();
}
function renderSource() {
  const v = state.video, b = $("#srcBadge");
  if (!v) { b.hidden = true; $("#driftBadge").hidden = true; $("#seek").disabled = true; return; }
  b.hidden = false;
  b.className = "sbadge " + SRC_CLASS[v.src];
  b.innerHTML = `<span class="ms">${v.src === "yt" ? "smart_display" : SRC_ICON[v.src]}</span>${esc(srcLabel(v.src))}${v.src === "twl" ? " · LIVE" : ""}`;
  const noSeek = v.src === "twl" || v.src === "ig";
  $("#seek").disabled = noSeek;
  $("#back10").disabled = $("#fwd10").disabled = noSeek;
  $("#igHint").hidden = v.src !== "ig";
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
  const list = all.filter(q => filter === "all" || family(q.src) === filter);
  if (!list.length) {
    $("#qList").innerHTML = `<div class="q-empty"><span class="ms">queue_music</span><div>${all.length ? "Nichts in diesem Filter." : "Die Warteschlange ist leer.<br>Füge oben einen Link hinzu."}</div></div>`;
    return;
  }
  $("#qList").innerHTML = list.map(q => {
    const mine = (q.votes || {})[me.id] || 0, sc = score(q);
    const fillIcon = { twl: "live_tv", twv: "videocam", tt: "music_note", ig: "photo_camera" }[q.src] || "videocam";
    const thumb = q.thumb ? `<img src="${esc(q.thumb)}" alt="" loading="lazy">` : `<div class="tw-fill ${SRC_CLASS[q.src]}"><span class="ms">${fillIcon}</span></div>`;
    return `<div class="q-item" data-qid="${esc(q.qid)}">
      <div class="thumb">${thumb}<span class="src ${SRC_CLASS[q.src]}"><span class="ms">${SRC_ICON[q.src]}</span></span></div>
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
    : `<div class="chat-msg">${avatarHTML({ id: m.by, name: m.name, color: m.color })}<div class="bubble"><div><span class="nm">${esc(m.name)}</span><span class="ts">${hhmm(m.ts)}</span></div><div class="tx">${linkTimes(esc(m.text))}</div></div></div>`
  ).join("") : `<div class="q-empty"><span class="ms">forum</span><div>Noch keine Nachrichten.</div></div>`;
  if (atBottom) box.scrollTop = box.scrollHeight;
}
// "bei 2:31" im Chat → klickbarer Sprung für alle
function linkTimes(html) {
  if (!state.video || state.video.src === "twl" || state.video.src === "ig") return html;
  const dur = player && player.ready ? player.duration() : 0;
  return html.replace(/(^|[^\d:])(\d{1,2}):([0-5]\d)(?::([0-5]\d))?(?![\d:])/g, (m, pre, a, b, c) => {
    const secs = c !== undefined ? (+a) * 3600 + (+b) * 60 + (+c) : (+a) * 60 + (+b);
    if (dur && secs > dur + 1) return m;
    return `${pre}<button type="button" class="ts-link" data-t="${secs}" title="Für alle dorthin springen">${m.slice(pre.length)}</button>`;
  });
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
let cdTimer = null;
function runCountdown(who) {
  const el = $("#countdown");
  clearInterval(cdTimer);
  let n = 3;
  el.hidden = false;
  el.innerHTML = `<div class="cd-num">${n}</div><div class="cd-txt">${esc(who)} startet den Countdown</div>`;
  cdTimer = setInterval(() => {
    n--;
    if (n > 0) { el.querySelector(".cd-num").textContent = n; return; }
    clearInterval(cdTimer);
    el.innerHTML = `<div class="cd-num go">LOS!</div><div class="cd-txt">Jetzt auf Play drücken</div>`;
    setTimeout(() => { el.hidden = true; }, 1800);
  }, 1000);
}
function updateDrift() {
  const b = $("#driftBadge"), info = $("#syncInfo"), badge = $("#syncBadge");
  if (!state.video || !player || !player.ready) { b.hidden = true; info.textContent = state.video ? "Player lädt …" : "Warte auf Video …"; return; }
  b.hidden = false;
  if (player.inAd) { $("#driftTxt").textContent = "WERBUNG"; info.textContent = "YouTube zeigt dir gerade Werbung. Danach springst du automatisch zu den anderen."; badge.textContent = "WERBUNG"; badge.className = "pill badge-warn"; return; }
  if (player.manual) { $("#driftTxt").textContent = "COUNTDOWN"; info.textContent = "Instagram erlaubt keine Fernsteuerung. Drückt Play gemeinsam nach dem Countdown."; badge.textContent = "MANUELL"; badge.className = "pill badge-sync"; return; }
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
  const manual = !!(player && player.manual);
  $("#playIcon").textContent = manual ? "timer" : playing ? "pause" : "play_arrow";
  $("#rateBtn").textContent = fmtRate(RATE());
  $("#rateBtn").hidden = !(player && player.setRate);
  $("#playBtn").setAttribute("aria-label", manual ? "Countdown für alle starten" : playing ? "Pausieren" : "Abspielen");
  // Klick-Schutz erst aktiv, wenn der Player einmal lief: so bleiben Altersabfragen
  // ("Start Watching" bei Twitch) und Einwilligungen im Player anklickbar
  const shieldOn = !!(player && player.ready && player.started && !manual) && now() > shieldPauseUntil;
  $("#shield").style.pointerEvents = shieldOn ? "auto" : "none";
  $("#shield").classList.toggle("yt-hole", !!(player && player.kind === "yt"));
  if (!player || !player.ready || !state.video) { $("#timeTxt").textContent = "0:00 / 0:00"; setRange($("#seek"), 0); return; }
  if (manual) { $("#timeTxt").textContent = "Instagram · per Countdown"; setRange($("#seek"), 0); return; }
  if (player.live) { $("#timeTxt").textContent = "● LIVE"; setRange($("#seek"), 1000); return; }
  const d = player.duration(), t = player.time();
  if (!seeking) { setRange($("#seek"), d ? (t / d) * 1000 : 0); $("#timeTxt").textContent = `${fmt(t)} / ${fmt(d)}`; }
}, 250);
function setRange(el, v) { el.value = v; el.style.setProperty("--p", (v / el.max) * 100 + "%"); }


// Klick ins YouTube-Menü (Zahnrad): Fokus wandert ins iframe → Klick-Schutz kurz aussetzen,
// damit das Menü (Qualität, Geschwindigkeit, Untertitel) überall bedienbar ist
let shieldPauseUntil = 0;
window.addEventListener("blur", () => setTimeout(() => {
  const a = document.activeElement;
  if (a && a.tagName === "IFRAME" && $("#playerHost").contains(a)) shieldPauseUntil = now() + 20000;
}, 0));
window.addEventListener("focus", () => { shieldPauseUntil = 0; });
$(".stage").addEventListener("mouseleave", () => { shieldPauseUntil = 0; });

// Qualität: Twitch über die Player-API, YouTube über das eigene Zahnrad im Video
// (YouTube hat das Setzen der Qualität per API abgeschafft)
function openQuality() {
  const menu = $("#qualMenu");
  if (!menu.hidden && menu.dataset.kind === "qual") { menu.hidden = true; return; }
  if (!player || !player.ready) { toast("Erst ein Video starten."); return; }
  if (player.kind === "yt") {
    const st = $(".stage"); st.classList.add("show-gear");
    shieldPauseUntil = now() + 20000;
    setTimeout(() => st.classList.remove("show-gear"), 4000);
    toast("Qualität: oben rechts im Video aufs Zahnrad klicken → Qualität", 4500);
    return;
  }
  if (player.kind === "tw" && player.qualities) {
    const qs = player.qualities(), cur = player.quality();
    if (!qs.length) { toast("Twitch liefert gerade keine Qualitätsstufen."); return; }
    menu.dataset.kind = "qual";
    menu.innerHTML = `<div class="label-sm muted" style="padding:4px 8px">Qualität (nur bei dir)</div>` +
      qs.map(q => `<button type="button" data-q="${esc(q.group)}" aria-pressed="${q.group === cur}">${esc(q.name)}${q.group === cur ? " ✓" : ""}</button>`).join("");
    menu.hidden = false;
    return;
  }
  toast("Bei TikTok und Instagram wählt der Player die Qualität automatisch.");
}
$("#qualBtn").onclick = e => { e.stopPropagation(); openQuality(); };
$("#qualMenu").addEventListener("click", e => {
  const b = e.target.closest("button[data-q]"); if (!b || !player || !player.setQuality) return;
  player.setQuality(b.dataset.q); $("#qualMenu").hidden = true; toast("Qualität: " + b.textContent.replace(" ✓", ""));
});
document.addEventListener("click", e => { if (!e.target.closest("#qualMenu")) $("#qualMenu").hidden = true; });


// ---------------------------------------------------------------- Als Nächstes (Countdown)
let upNext = null, upNextT = null;
function showUpNext(video, secs, prev) {
  hideUpNext();
  upNext = { video, prev, left: secs };
  const el = $("#upNext");
  const thumb = video.thumb ? `<img src="${esc(video.thumb)}" alt="">` : `<div class="tw-fill ${SRC_CLASS[video.src]}"><span class="ms">${SRC_ICON[video.src]}</span></div>`;
  el.innerHTML = `<div class="thumb">${thumb}</div>
    <div class="un-body"><div class="label-sm" style="color:var(--primary)">Als Nächstes in <span id="unLeft">${secs}</span> s</div>
    <div class="un-title">${esc(video.title)}</div>
    <div class="un-actions"><button class="btn btn-primary" type="button" data-un="now"><span class="ms">skip_next</span>Jetzt</button>
    <button class="btn btn-ghost" type="button" data-un="cancel"><span class="ms">close</span>Abbrechen</button></div></div>`;
  el.hidden = false;
  upNextT = setInterval(() => {
    if (!upNext) return;
    upNext.left--;
    const l = $("#unLeft"); if (l) l.textContent = Math.max(0, upNext.left);
    if (upNext.left <= 0) {
      const u = upNext; hideUpNext();
      if (isLeader()) send({ k: "load", video: u.video, pos: u.video.start || 0, playing: true, prev: u.prev });
    }
  }, 1000);
}
function hideUpNext() { clearInterval(upNextT); upNextT = null; upNext = null; const el = $("#upNext"); if (el) el.hidden = true; }
$("#upNext").addEventListener("click", e => {
  const b = e.target.closest("button[data-un]"); if (!b || !upNext) return;
  if (b.dataset.un === "now") { const u = upNext; send({ k: "load", video: u.video, pos: u.video.start || 0, playing: true, prev: u.prev }); }
  else send({ k: "upnextCancel" });
});

// ---------------------------------------------------------------- Geschwindigkeit (für alle)
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
$("#rateBtn").onclick = e => {
  e.stopPropagation();
  const menu = $("#qualMenu");
  if (!menu.hidden && menu.dataset.kind === "rate") { menu.hidden = true; return; }
  if (!player || !player.ready || !player.setRate) { toast("Geschwindigkeit geht bei YouTube-Videos."); return; }
  menu.dataset.kind = "rate";
  menu.innerHTML = `<div class="label-sm muted" style="padding:4px 8px">Geschwindigkeit (für alle)</div>` +
    RATES.map(r => `<button type="button" data-rate="${r}" aria-pressed="${Math.abs(r - RATE()) < 0.01}">${r === 1 ? "Normal" : fmtRate(r)}${Math.abs(r - RATE()) < 0.01 ? " ✓" : ""}</button>`).join("");
  menu.hidden = false;
};
$("#qualMenu").addEventListener("click", e => {
  const b = e.target.closest("button[data-rate]"); if (!b) return;
  send({ k: "rate", rate: +b.dataset.rate, pos: curPos() });
  $("#qualMenu").hidden = true;
});

// ---------------------------------------------------------------- Sprachchat (WebRTC, Signalisierung über den Raum)
const ICE = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun.cloudflare.com:3478" }];
const voice = { on: false, muted: false, stream: null, peers: new Map(), members: new Map(), ctx: null, meters: new Map(), speaking: new Set() };
function vsend(t, extra = {}) { send({ k: "voice", t, muted: voice.muted, ...extra }); }
async function voiceJoin() {
  if (voice.on) return;
  if (!navigator.mediaDevices || !window.RTCPeerConnection) { toast("Dein Browser unterstützt keinen Sprachchat."); return; }
  try {
    voice.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch { toast("Kein Zugriff aufs Mikrofon. Bitte im Browser erlauben.", 4000); return; }
  voice.on = true; voice.muted = false;
  try { voice.ctx = voice.ctx || new (window.AudioContext || window.webkitAudioContext)(); voice.ctx.resume(); } catch {}
  addMeter(me.id, voice.stream);
  voice.members.set(me.id, { name: me.name, muted: false });
  vsend("join");
  renderPeople();
  toast("Im Sprachchat – Kopfhörer verhindern Echo vom Video.", 3500);
}
function voiceLeave(silent) {
  if (!voice.on) return;
  if (!silent) vsend("leave");
  for (const id of [...voice.peers.keys()]) closePeer(id);
  voice.stream && voice.stream.getTracks().forEach(t => t.stop());
  voice.stream = null; voice.on = false;
  voice.members.delete(me.id); dropMeter(me.id);
  renderPeople();
}
function voiceToggleMute() {
  if (!voice.on) return;
  voice.muted = !voice.muted;
  voice.stream.getAudioTracks().forEach(t => t.enabled = !voice.muted);
  voice.members.set(me.id, { name: me.name, muted: voice.muted });
  vsend("state");
  renderPeople();
}
function getPeer(id) {
  let p = voice.peers.get(id);
  if (p) return p;
  const pc = new RTCPeerConnection({ iceServers: ICE });
  p = { pc, cands: [], audio: null };
  voice.peers.set(id, p);
  voice.stream.getTracks().forEach(t => pc.addTrack(t, voice.stream));
  pc.onicecandidate = e => { if (e.candidate) vsend("sig", { to: id, cand: e.candidate.toJSON() }); };
  pc.ontrack = e => {
    const st = e.streams[0] || new MediaStream([e.track]);
    if (!p.audio) { p.audio = document.createElement("audio"); p.audio.autoplay = true; p.audio.playsInline = true; document.body.appendChild(p.audio); }
    p.audio.srcObject = st;
    p.audio.play().catch(() => {});
    addMeter(id, st);
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed") { closePeer(id); if (voice.on && me.id < id) setTimeout(() => voice.on && makeOffer(id), 1500); }
  };
  return p;
}
async function makeOffer(id) {
  const { pc } = getPeer(id);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  vsend("sig", { to: id, desc: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
}
async function handleSig(from, op) {
  const p = getPeer(from), pc = p.pc;
  try {
    if (op.desc) {
      await pc.setRemoteDescription(op.desc);
      for (const c of p.cands.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      if (op.desc.type === "offer") {
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        vsend("sig", { to: from, desc: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
      }
    } else if (op.cand) {
      if (pc.remoteDescription) await pc.addIceCandidate(op.cand).catch(() => {});
      else p.cands.push(op.cand);
    }
  } catch (e) { console.warn("voice sig", e); }
}
function closePeer(id) {
  const p = voice.peers.get(id); if (!p) return;
  try { p.pc.close(); } catch {}
  if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
  voice.peers.delete(id); dropMeter(id);
}
function voiceSignal(op, local) {
  if (local) return;
  const from = op.by;
  if (op.t === "join" || op.t === "here") {
    voice.members.set(from, { name: op.name, muted: !!op.muted });
    if (voice.on && op.t === "join") vsend("here", { to: from });
    // Nur die kleinere ID baut die Verbindung auf → keine doppelten Angebote
    if (voice.on && me.id < from && (op.t === "join" || op.to === me.id) && !voice.peers.has(from)) makeOffer(from);
    if (op.t === "join") sys(`${op.name} ist dem Sprachchat beigetreten`);
  } else if (op.t === "leave") {
    voice.members.delete(from); closePeer(from);
  } else if (op.t === "state") {
    const m = voice.members.get(from); if (m) m.muted = !!op.muted;
  } else if (op.t === "sig") {
    if (op.to !== me.id || !voice.on) return;
    handleSig(from, op);
    return;
  }
  renderPeople();
}
function addMeter(id, stream) {
  if (!voice.ctx) return;
  try {
    dropMeter(id);
    const src = voice.ctx.createMediaStreamSource(stream);
    const an = voice.ctx.createAnalyser(); an.fftSize = 512;
    src.connect(an);
    voice.meters.set(id, { an, src, buf: new Uint8Array(an.fftSize) });
  } catch {}
}
function dropMeter(id) { const m = voice.meters.get(id); if (m) { try { m.src.disconnect(); } catch {} voice.meters.delete(id); } voice.speaking.delete(id); }
setInterval(() => {
  if (!voice.meters.size) return;
  for (const [id, m] of voice.meters) {
    m.an.getByteTimeDomainData(m.buf);
    let sum = 0; for (const v of m.buf) { const x = (v - 128) / 128; sum += x * x; }
    const loud = Math.sqrt(sum / m.buf.length) > 0.035 && !(id === me.id && voice.muted);
    if (loud) voice.speaking.add(id); else voice.speaking.delete(id);
  }
  $$(".avatar[data-uid]").forEach(a => a.classList.toggle("speaking", voice.speaking.has(a.dataset.uid)));
}, 200);
function renderVoice() {
  const box = $("#voiceCtl"); if (!box) return;
  const n = voice.members.size;
  if (!voice.on) {
    box.innerHTML = `<button class="btn btn-ghost" type="button" data-v="join"><span class="ms">mic</span>Sprachchat${n ? ` · ${n}` : ""}</button>`;
  } else {
    box.innerHTML = `<button class="icon-btn ${voice.muted ? "danger" : "live"}" type="button" data-v="mute" aria-label="${voice.muted ? "Mikrofon an" : "Stumm schalten"}" title="${voice.muted ? "Mikrofon an" : "Stumm schalten"}"><span class="ms">${voice.muted ? "mic_off" : "mic"}</span></button>
      <span class="label-sm" style="color:var(--primary)">${n} im Voice</span>
      <button class="icon-btn danger" type="button" data-v="leave" aria-label="Sprachchat verlassen" title="Sprachchat verlassen"><span class="ms">call_end</span></button>`;
  }
}
$("#voiceCtl").addEventListener("click", e => {
  const b = e.target.closest("button[data-v]"); if (!b) return;
  if (b.dataset.v === "join") voiceJoin();
  else if (b.dataset.v === "mute") voiceToggleMute();
  else voiceLeave();
});

// ---------------------------------------------------------------- Verbindung halten
function requestRefresh() {
  if (!transport || !room || people.length < 2) return;
  refreshWanted = true;
  transport.send("hello", {});
  setTimeout(() => { refreshWanted = false; }, 4000);
}
function onStatus(s) {
  if (!room) return;
  if (s === "online") {
    setLive(true);
    clearTimeout(reconnectT);
    if (offlineSince) { offlineSince = 0; backoff = 0; setTimeout(requestRefresh, 800); }
  } else {
    setLive(false, "getrennt – verbinde neu …");
    if (!offlineSince) offlineSince = now();
    scheduleReconnect();
  }
}
function scheduleReconnect(delay) {
  clearTimeout(reconnectT);
  reconnectT = setTimeout(async () => {
    if (!room || !offlineSince || !transport) return;
    try { transport.leave(); await transport.connect(room.channel, me); }
    catch { backoff = Math.min(backoff + 1, 5); scheduleReconnect(); }
  }, delay ?? 6000 * (1 + backoff));
}
document.addEventListener("visibilitychange", () => {
  if (!room) return;
  if (document.hidden) { hiddenAt = now(); return; }
  if (offlineSince) scheduleReconnect(0);
  else if (hiddenAt && now() - hiddenAt > 20000) requestRefresh();
  hiddenAt = 0;
});
window.addEventListener("online", () => { if (room && offlineSince) scheduleReconnect(0); });
window.addEventListener("offline", () => { if (room) { setLive(false, "offline"); if (!offlineSince) offlineSince = now(); } });

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
  transport.on("status", onStatus);
  offlineSince = 0; backoff = 0;
  transport.on("presence", list => {
    const before = new Set(people.map(p => p.id));
    people = list;
    const after = new Set(list.map(p => p.id));
    for (const p of list) if (!before.has(p.id) && p.id !== me.id) sys(`${p.name} ist beigetreten`);
    for (const id of before) if (!after.has(id) && id !== me.id) { sys(`${(prevPeople.get(id) || {}).name || "Jemand"} hat den Raum verlassen`); voice.members.delete(id); closePeer(id); }
    prevPeople = new Map(list.map(p => [p.id, p]));
    renderHead(); renderPeople();
  });
  try {
    await transport.connect(channel, me);
  } catch (e) {
    toast("Verbindung fehlgeschlagen – ich versuche es weiter.", 5000);
    onStatus("offline");
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
  voiceLeave(); hideUpNext(); clearTimeout(reconnectT); offlineSince = 0;
  voice.members.clear();
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
  if (!media) { toast("Unterstützt: YouTube, Twitch, TikTok und Instagram-Reels.", 3500); return; }
  if (media.src === "clip") { toast("Twitch-Clips lassen sich nicht synchron steuern. Nimm das ganze Video (twitch.tv/videos/…)."); return; }
  if (media.src === "ytpl") return addPlaylist(media.ref, inputEl);
  if (inputEl) { inputEl.disabled = true; }
  const item = await buildItem(media);
  if (inputEl) { inputEl.disabled = false; inputEl.focus(); }
  if (!item) { toast("TikTok-Kurzlink nicht lesbar. Öffne ihn einmal und kopiere die volle Adresse (tiktok.com/@…/video/…).", 5000); return; }
  if (inputEl) inputEl.value = "";
  if (!state.video) send({ k: "load", video: item, pos: item.start || 0, playing: true });
  else { send({ k: "qadd", item }); toast("Zur Warteschlange hinzugefügt"); }
}
// YouTube-Playlist: Video-IDs über einen unsichtbaren YouTube-Player holen (kein API-Schlüssel nötig)
async function resolvePlaylist(list) {
  await loadYT();
  return new Promise(res => {
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:fixed;left:-10000px;top:0;width:320px;height:180px;pointer-events:none";
    const el = document.createElement("div"); wrap.appendChild(el); document.body.appendChild(wrap);
    let done = false, p;
    const finish = ids => { if (done) return; done = true; try { p && p.destroy(); } catch {} wrap.remove(); res(ids || []); };
    p = new YT.Player(el, {
      width: 320, height: 180,
      playerVars: { listType: "playlist", list, autoplay: 0, mute: 1, controls: 0 },
      events: {
        onReady: () => {
          const poll = n => { const ids = p.getPlaylist && p.getPlaylist(); if (ids && ids.length) return finish(ids.slice(0, 100)); if (n > 30) return finish([]); setTimeout(() => poll(n + 1), 300); };
          poll(0);
        },
        onError: () => finish([])
      }
    });
    setTimeout(() => finish([]), 15000);
  });
}
async function addPlaylist(list, inputEl) {
  if (inputEl) inputEl.disabled = true;
  toast("Lade Playlist …");
  const ids = await resolvePlaylist(list);
  if (!ids.length) { if (inputEl) inputEl.disabled = false; toast("Playlist nicht lesbar (privat oder ein YouTube-Mix?).", 4000); return; }
  const items = new Array(ids.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(6, ids.length) }, async () => {
    while (i < ids.length) { const k = i++; items[k] = await buildItem({ src: "yt", ref: ids[k], start: 0 }); items[k].at = now() + k; }
  }));
  if (inputEl) { inputEl.disabled = false; inputEl.value = ""; inputEl.focus(); }
  let rest = items;
  if (!state.video) { send({ k: "load", video: items[0], pos: 0, playing: true }); rest = items.slice(1); }
  if (rest.length) send({ k: "qaddMany", items: rest });
  toast(`Playlist: ${items.length} Videos hinzugefügt`, 3000);
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
$("#chatList").addEventListener("click", e => {
  const b = e.target.closest(".ts-link"); if (!b) return;
  userSeek(+b.dataset.t);
  actorToast(`Springe zu ${b.textContent}`);
});
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

// Diagnose in der Browser-Konsole: __sharedcue()
window.__sharedcue = () => ({ synced, leader: (leader() || {}).name, isLeader: isLeader(), people: people.map(p => p.name), video: vkey(state.video), loadedKey, pb: { ...state.pb }, expected: +expectedPos().toFixed(2), playerTime: player && player.ready ? +player.time().toFixed(2) : null, playing: player && player.ready ? player.isPlaying() : null, buffering: player && player.ready ? player.isBuffering() : null, ytState: player && player.p && player.p.getPlayerState ? player.p.getPlayerState() : null, gestureNeeded, lastCorrection: now() - lastCorrection, rate: RATE() });

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
