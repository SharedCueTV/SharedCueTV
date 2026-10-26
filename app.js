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
  const ext = (u.pathname.match(/\.(mp4|m4v|webm|mov|ogv|mp3|m4a|aac|ogg|oga|wav|flac|opus)$/i) || [])[1];
  if (ext) return { src: "file", ref: u.href, kind: /^(mp3|m4a|aac|ogg|oga|wav|flac|opus)$/i.test(ext) ? "audio" : "video", url: u.href };
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
  if (media.src === "file") {
    item.kind = media.kind;
    let fn = decodeURIComponent((new URL(media.url).pathname.split("/").pop() || "Datei")).replace(/\.[^.]+$/, "").replace(/[_+]+/g, " ");
    item.title = fn.slice(0, 120) || (media.kind === "audio" ? "Audiodatei" : "Videodatei");
    if (location.protocol === "https:" && /^http:/i.test(media.url)) item.warn = "http";
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
const srcLabel = s => ({ yt: "YouTube", twl: "Twitch Live", twv: "Twitch", tt: "TikTok", ig: "Instagram", file: "Datei", live: "Live geteilt" })[s] || "Video";
const isTw = s => s === "twv" || s === "twl";
const family = s => isTw(s) ? "tw" : (s === "tt" || s === "ig") ? "clips" : s === "file" || s === "live" ? "files" : "yt";
const SRC_ICON = { yt: "play_arrow", twv: "bolt", twl: "bolt", tt: "music_note", ig: "photo_camera", file: "movie", live: "screen_share" };
const SRC_CLASS = { yt: "yt", twv: "tw", twl: "tw", tt: "tt", ig: "ig", file: "fl", live: "lv" };

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
          onError: e => this.cb.error(e.data === 101 || e.data === 150 ? "Dieses Video läuft nur direkt auf YouTube (Einbetten gesperrt oder Altersbeschränkung)." : e.data === 100 ? "Video nicht gefunden oder privat." : "YouTube-Fehler " + e.data)
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
      this.p.addEventListener(Twitch.Player.PLAYING, () => { this.started = true; this.blocked = false; this.pendingAt = 0; });
      if (Twitch.Player.PLAYBACK_BLOCKED) this.p.addEventListener(Twitch.Player.PLAYBACK_BLOCKED, () => { this.blocked = true; this.cb.blocked && this.cb.blocked(); });
      this.p.addEventListener(Twitch.Player.OFFLINE, () => this.live && this.cb.error("Der Kanal ist gerade offline."));
      setTimeout(resolve, 8000);
    });
  }
  play() { if (!this.ready) return; this.pendingAt = now(); this.p.play(); }
  pause() { if (!this.ready) return; this.pendingAt = 0; this.p.pause(); }
  seek(t) { if (this.ready && !this.live) this.p.seek(t); }
  time() { return this.ready ? this.p.getCurrentTime() || 0 : 0; }
  duration() { return this.ready && !this.live ? this.p.getDuration() || 0 : 0; }
  isPlaying() { return this.ready && !this.p.isPaused(); }
  // Nach play() braucht Twitch (v. a. live) einige Sekunden, bis der Stream wieder läuft
  isBuffering() { return this.ready && !!this.pendingAt && this.p.isPaused() && now() - this.pendingAt < 10000; }
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
    ifr.style.cssText = "position:absolute;top:0;left:50%;transform:translateX(-50%);height:100%;max-width:100%;border:0;background:#000";
    this.ifr = ifr;
    this.host.appendChild(ifr);
    // Instagram-Einbettung = Kopfzeile + Video (9:16) + Fußzeile → Breite so wählen, dass das Video die Höhe füllt
    this.fit = () => { const h = this.host.clientHeight || 600, w = this.host.clientWidth || 400; ifr.style.width = Math.round(clamp((h - 205) * 9 / 16, 240, w)) + "px"; };
    this.fit();
    window.addEventListener("resize", this.fit);
    this.ready = true;
  }
  play() {} pause() {} seek() {}
  time() { return 0; } duration() { return 0; }
  isPlaying() { return false; } isBuffering() { return false; }
  setVolume() {}
  destroy() { window.removeEventListener("resize", this.fit); this.host.innerHTML = ""; this.ready = false; }
}

// Direkte Mediendateien (MP4, WebM, MP3 …) per Link – normales <video>-Element
class FileAdapter {
  constructor(host, cb) { this.host = host; this.cb = cb; this.kind = "file"; this.live = false; }
  async load(item, pos, playing) {
    this.host.innerHTML = ""; this.ready = false; this.started = false;
    const wrap = document.createElement("div");
    wrap.className = "media-wrap" + (item.kind === "audio" ? " audio" : "");
    wrap.innerHTML = item.kind === "audio" ? `<div class="audio-art"><span class="ms">music_note</span><b>${esc(item.title)}</b><div class="eq"><i></i><i></i><i></i><i></i><i></i></div></div>` : "";
    const el = this.el = document.createElement("video");
    el.playsInline = true; el.preload = "auto"; el.src = item.ref;
    wrap.appendChild(el); this.host.appendChild(wrap);
    el.addEventListener("ended", () => this.cb.ended());
    el.addEventListener("playing", () => { this.started = true; wrap.classList.add("playing"); });
    el.addEventListener("pause", () => wrap.classList.remove("playing"));
    el.addEventListener("error", () => this.cb.error(item.warn === "http" ? "Unsichere http-Links blockiert der Browser – nimm einen https-Link." : "Die Datei lässt sich nicht abspielen (Link prüfen)."));
    await new Promise(r => { el.addEventListener("loadedmetadata", r, { once: true }); setTimeout(r, 10000); });
    this.ready = true; this.cb.volume(this);
    if (pos > 0.5) el.currentTime = pos;
    if (playing) el.play().catch(() => {});
  }
  play() { this.el && this.el.play().catch(() => {}); }
  pause() { this.el && this.el.pause(); }
  seek(t) { if (this.el) this.el.currentTime = Math.max(0, t); }
  time() { return this.el ? this.el.currentTime || 0 : 0; }
  duration() { return this.el && isFinite(this.el.duration) ? this.el.duration : 0; }
  isPlaying() { return !!this.el && !this.el.paused && !this.el.ended; }
  isBuffering() { return !!this.el && !this.el.paused && this.el.readyState < 3; }
  setVolume(v, muted) { if (!this.el) return; this.el.volume = clamp(v / 100, 0, 1); this.el.muted = !!muted; }
  rate() { return this.el ? this.el.playbackRate : 1; }
  setRate(r) { if (this.el) this.el.playbackRate = r; }
  destroy() { if (this.el) { this.el.pause(); this.el.removeAttribute("src"); this.el.load(); } this.host.innerHTML = ""; this.ready = false; }
}

// Live geteilt (Bildschirm oder eigene Datei): Der Teilende schickt per WebRTC an alle
class LiveAdapter {
  constructor(host, cb) { this.host = host; this.cb = cb; this.kind = "live"; }
  async load(item) {
    this.item = item; this.host.innerHTML = ""; this.started = true;
    this.isFile = item.kind === "file";
    this.live = !this.isFile;            // Bildschirm: kein Spulen
    const mine = item.ref === me.id;
    if (mine && bc.el) {
      // Teilender: eigenes Dateielement sichtbar im Player
      const wrap = document.createElement("div"); wrap.className = "media-wrap" + (bc.audioOnly ? " audio" : "");
      if (bc.audioOnly) wrap.innerHTML = `<div class="audio-art"><span class="ms">music_note</span><b>${esc(item.title)}</b><div class="eq"><i></i><i></i><i></i><i></i><i></i></div></div>`;
      wrap.appendChild(bc.el); this.host.appendChild(wrap); this.el = bc.el; this.local = true;
    } else {
      const wrap = document.createElement("div"); wrap.className = "media-wrap live-wait";
      wrap.innerHTML = `<div class="live-note"><span class="dot" aria-hidden="true"></span><span>${mine ? "Du teilst deinen Bildschirm" : `Verbinde mit dem Stream von ${esc(item.byName || "?")} …`}</span></div>`;
      const v = this.el = document.createElement("video");
      v.playsInline = true; v.autoplay = true; if (mine) v.muted = true;
      wrap.appendChild(v); this.host.appendChild(wrap); this.wrap = wrap;
      if (mine && bc.stream) { v.srcObject = bc.stream; wrap.classList.remove("live-wait"); }
      else if (!mine) liveWant(item.ref);
    }
    this.ready = true; this.cb.volume(this);
  }
  attach(stream) {
    if (!this.el || this.local) return;
    if (this.el.srcObject !== stream) this.el.srcObject = stream;
    this.wrap && this.wrap.classList.remove("live-wait");
    if (this.wrap) {
      const audioOnly = !stream.getVideoTracks().length;
      this.wrap.classList.toggle("audio", audioOnly); this.wrap.classList.toggle("playing", audioOnly);
      const art = this.wrap.querySelector(".audio-art");
      if (audioOnly && !art) this.wrap.insertAdjacentHTML("afterbegin", `<div class="audio-art"><span class="ms">music_note</span><b>${esc(this.item.title)}</b><div class="eq"><i></i><i></i><i></i><i></i><i></i></div></div>`);
      if (!audioOnly && art) art.remove();
    }
    this.cb.volume(this);
    this.el.play().catch(e => { if (e && e.name === "NotAllowedError" && this.cb.blocked) this.cb.blocked(); });
  }
  play() { if (this.local) this.el.play().catch(() => {}); else this.el && this.el.play().catch(() => {}); }
  pause() { if (this.local) this.el.pause(); }
  seek(t) { if (this.local) this.el.currentTime = Math.max(0, t); }
  time() { return this.local ? this.el.currentTime || 0 : (this.isFile ? expectedPos() : 0); }
  duration() { return this.local ? (isFinite(this.el.duration) ? this.el.duration : 0) : (this.item.dur || 0); }
  isPlaying() { return this.local ? !this.el.paused : (this.isFile ? state.pb.playing : true); }
  isBuffering() { return false; }
  setVolume(v, muted) { if (!this.el || (this.item.ref === me.id && !this.local)) return; this.el.volume = clamp(v / 100, 0, 1); this.el.muted = !!muted; }
  destroy() { if (!this.local && this.el) this.el.srcObject = null; if (this.local && this.el) this.el.pause(); this.host.innerHTML = ""; this.ready = false; if (this.item && this.item.ref !== me.id) liveClose(this.item.ref); }
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

function freshStats() { return { added: {}, upv: {}, react: {}, sec: 0, videos: 0 }; }
const ST = () => (state.stats = state.stats || freshStats());
const bump = (map, name, n = 1) => { if (!name) return; const m = ST()[map]; m[name] = Math.max(0, (m[name] || 0) + n); };
function freshState() {
  return { title: "", video: null, pb: { playing: false, pos: 0, at: now(), rate: 1 }, queue: [], chat: [], settings: { voice: true, cam: true }, poll: null, stats: freshStats() };
}
const RATE = () => state.pb.rate || 1;
const expectedPos = () => state.pb.playing ? state.pb.pos + (now() - state.pb.at) / 1000 * RATE() : state.pb.pos;
const setPb = (playing, pos, rate = RATE()) => { state.pb = { playing, pos, at: now(), rate }; };
const leader = () => [...people].sort((a, b) => (a.joinedAt - b.joinedAt) || (a.id < b.id ? -1 : 1))[0];
const isLeader = () => { const l = leader(); return !l || l.id === me.id; };
const nameOf = id => (people.find(p => p.id === id) || {}).name;
const vkey = v => v ? v.src + ":" + (v.src === "live" ? v.qid : v.ref) : "";
const score = it => Object.values(it.votes || {}).reduce((a, b) => a + b, 0);
const sortedQueue = () => [...state.queue];
const resortByVotes = () => { state.queue = [...state.queue].sort((a, b) => score(b) - score(a)); };

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
      if (op.video) {
        ST().videos++;
        if (op.video.qid && !state.queue.some(q => q.qid === op.video.qid) && !op.prev && op.video.by === op.by) bump("added", op.video.byName);
      }
      if (bc.active && !(op.video && op.video.src === "live" && op.video.ref === me.id)) stopBroadcast(true);
      state.video = op.video;
      setPb(op.playing !== false, op.pos || 0, 1);
      state.adWait = []; state.adHeld = false;
      gestureNeeded = false; { const g = $("#gesture"); if (g) g.hidden = true; }
      if (player) { player.inAd = false; player.inAdSent = false; player._lt = null; player._adHits = 0; player.loadAt = now(); }
      hideUpNext();
      if (op.video && op.video.qid) state.queue = state.queue.filter(q => q.qid !== op.video.qid);
      if (!local && op.video) actorToast(`${actor} startet: ${op.video.title}`);
      break;
    }
    case "play": state.adHeld = false; setPb(true, op.pos); if (!local) actorToast(`${actor} hat abgespielt`); flash("play_arrow"); break;
    case "pause": setPb(false, op.pos); if (!local) actorToast(`${actor} hat pausiert`); flash("pause"); break;
    case "seek": setPb(state.pb.playing, op.pos); if (!local) actorToast(`${actor} spult zu ${fmt(op.pos)}`); break;
    case "qadd":
      if (!state.queue.some(q => q.qid === op.item.qid)) { state.queue.push(op.item); bump("added", op.item.byName); }
      if (!local) showNotice(`${actor} hat „${op.item.title}“ zur Warteschlange hinzugefügt`);
      break;
    case "qdel": state.queue = state.queue.filter(q => q.qid !== op.qid); break;
    case "qaddMany":
      for (const it of op.items || []) if (!state.queue.some(q => q.qid === it.qid)) { state.queue.push(it); bump("added", it.byName); }
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
      if (it) {
        it.votes = it.votes || {};
        const before = it.votes[op.by] || 0;
        if (op.v) it.votes[op.by] = op.v; else delete it.votes[op.by];
        if (before !== 1 && op.v === 1) bump("upv", it.byName, 1);
        if (before === 1 && op.v !== 1) bump("upv", it.byName, -1);
        resortByVotes();
      }
      break;
    }
    case "qmove": {
      const from = state.queue.findIndex(q => q.qid === op.qid);
      if (from < 0) break;
      const [it] = state.queue.splice(from, 1);
      state.queue.splice(clamp(op.to | 0, 0, state.queue.length), 0, it);
      break;
    }
    case "ad": {
      // Jemand hat Werbung → Raum wartet an der aktuellen Stelle, bis alle durch sind
      state.adWait = (state.adWait || []).filter(x => x.id !== op.by);
      if (op.on) {
        state.adWait.push({ id: op.by, name: op.name });
        if (state.pb.playing && !state.adHeld) { setPb(false, op.pos); state.adHeld = true; adHeldSince = now(); }
      } else releaseAdHold();
      break;
    }
    case "adClear": state.adWait = []; releaseAdHold(true); break;
    case "chat":
      state.chat.push(op.msg);
      if (state.chat.length > CHAT_MAX) state.chat.splice(0, state.chat.length - CHAT_MAX);
      if (!local && !chatActive) $("#unread").hidden = false;
      break;
    case "react": spawnEmoji(op.emoji, local ? "" : op.name); bump("react", op.name); if (statsActive) renderStats(); return;
    case "poll":
      state.poll = { pid: op.pid, options: op.options, votes: {}, by: op.by, name: op.name, endsAt: now() + (op.secs || 30) * 1000 };
      if (!local) actorToast(`${actor} startet eine Abstimmung`);
      renderPoll(); return;
    case "pollVote":
      if (!state.poll || state.poll.pid !== op.pid) return;
      state.poll.votes[op.by] = op.idx | 0;
      renderPoll(); return;
    case "pollEnd": {
      if (!state.poll || state.poll.pid !== op.pid) return;
      const po = state.poll; state.poll = null; renderPoll();
      if (op.cancel) { toast("Abstimmung abgebrochen"); return; }
      const w = po.options[op.winner]; if (!w) return;
      toast(`Gewonnen: ${w.title}`, 3500);
      if (local) send({ k: "load", video: w, pos: w.start || 0, playing: true });
      return;
    }
    case "countdown": runCountdown(local ? "Du" : op.name); return;
    case "voice": voiceSignal(op, local); return;
    case "live": liveSignal(op, local); return;
    case "title": state.title = String(op.title || "").slice(0, 48) || state.title; break;
    case "settings": state.settings = { voice: op.settings.voice !== false, cam: op.settings.voice !== false && op.settings.cam !== false, fsCams: FS_MODES[op.settings.fsCams] ? op.settings.fsCams : fsMode() }; renderFsCams(); if (!local) actorToast(`${actor} hat die Raum-Einstellungen geändert`); if (!roomAllows("cam") && voice.cam) camToggle(); break;
    case "qclear": state.queue = []; if (!local) actorToast(`${actor} hat die Warteschlange geleert`); break;
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
      if (snap.poll) snap.poll.leftMs = Math.max(0, state.poll.endsAt - now());
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
    if (state.poll) state.poll.endsAt = now() + (state.poll.leftMs || 0);
    mergeSavedStats();
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
  blocked() { if (state.pb.playing) showGesture(); },
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
    const want = isTw(v.src) ? "tw" : v.src === "tt" ? "tt" : v.src === "ig" ? "ig" : v.src === "file" ? "file" : v.src === "live" ? "live" : "yt";
    if (player && (player.kind !== want || want === "live" || want === "file")) { player.destroy(); player = null; }
    if (!player) {
      const A = { yt: YTAdapter, tw: TwitchAdapter, tt: TikTokAdapter, ig: InstaAdapter, file: FileAdapter, live: LiveAdapter }[want];
      player = new A(host(), playerCb);
    }
    $(".screen").classList.toggle("portrait", want === "tt" || want === "ig");
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
  const st = player.p.getPlayerState(), t = player.time(), tNow = now();
  const dt = player._lat ? (tNow - player._lat) / 1000 : 0;
  // Zeit läuft ungefähr in Echtzeit weiter (kein Sprung durch eigenes Spulen)
  const advancing = player._lt != null && dt > 0 && t - player._lt > 0.4 * dt && t - player._lt < 2.5 * dt + 0.3;
  player._lt = t; player._lat = tNow;
  const recentSeek = tNow - lastCorrection < 2500 || tNow - (player.loadAt || 0) < 1500;
  if (st === 1 || st === 2 || st === 0 || st === 3) { player.inAd = false; player._adHits = 0; }
  else if (st === -1 && advancing && !recentSeek) { player._adHits = (player._adHits || 0) + 1; if (player._adHits >= 2) player.inAd = true; }
  else if (st === -1 && !advancing) player._adHits = 0;
  return !!player.inAd;
}
let adHeldSince = 0;
function releaseAdHold(force) {
  if (!state.adHeld) return;
  if (!force && (state.adWait || []).length) return;
  state.adHeld = false;
  setPb(true, state.pb.pos);
}
function reportAd() {
  if (!player || !state.video) return;
  detectAd();
  const on = !!player.inAd;
  if (on !== !!player.inAdSent) { player.inAdSent = on; send({ k: "ad", on, pos: expectedPos() }); }
}
function renderAdHold() {
  const el = $("#adHold"); if (!el) return;
  const w = (state.adWait || []).filter(x => x.id !== me.id);
  const show = !!state.adHeld && w.length > 0 && !(player && player.inAd);
  el.hidden = !show;
  if (show) $("#adHoldTxt").textContent = `Warte auf ${w.map(x => x.name).join(", ")} – Werbung läuft …`;
}
function enforce(fromOp) {
  if (!player || !player.ready || player.manual || !state.video || loadedKey !== vkey(state.video)) return;
  if (player.inAd) return;   // während Werbung nichts erzwingen – danach wird aufgeholt
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
  if (player.kind === "tw" && !player.blocked && player.isBuffering()) return;
  if (!player.isPlaying() && !player.isBuffering()) showGesture();
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
function showGesture() {
  gestureNeeded = true;
  const v = state.video;
  $("#gestureYt").hidden = !(v && v.src === "yt");
  if (v && v.src === "yt") $("#gestureYt").href = `https://www.youtube.com/watch?v=${encodeURIComponent(v.ref)}&t=${Math.floor(expectedPos())}s`;
  $("#gesture").hidden = false;
}
function resumeGesture() {
  gestureNeeded = false; $("#gesture").hidden = true;
  if (player && player.ready && !player.manual) { playerCb.volume(player); player.seek(expectedPos()); player.play(); }
}

// Leader-Tick + Drift-Schleife
setInterval(() => {
  if (!room || !synced) return;
  reportAd();
  enforce(false);
  updateDrift();
  renderAdHold();
  // Sicherung: nach 90 s Werbung geht es ohne den Wartenden weiter
  if (state.adHeld && isLeader() && now() - adHeldSince > 90000) send({ k: "adClear" });
  if (state.video && state.pb.playing && !state.adHeld) ST().sec++;
  if (state.poll) { updatePollTimer(); if (now() >= state.poll.endsAt && isLeader()) endPoll(false); }
  if (now() - lastStatsSave > 10000) saveStats();
  if (statsActive && now() % 5000 < 1000) renderStats();
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
  renderHead(); renderPeople(); renderQueue(); renderChat(); renderNow(); renderSource(); renderAdHold(); renderPoll(); renderPollBar(); renderStageTitle();
}
function avatarHTML(p, cls = "") {
  return `<span class="avatar ${cls}" data-uid="${esc(p.id)}" style="background:${esc(p.color || colorFor(p.id))}" title="${esc(p.name)}">${esc(initials(p.name))}</span>`;
}
function renderHead() {
  $("#roomTitle").textContent = state.title || "Raum";
  document.title = (state.title ? state.title + " · " : "") + "SharedCueTV";
  const n = people.length;
  $("#roomSub").textContent = `${n} ${n === 1 ? "Person" : "Personen"} im Raum · Code ${room.code}` + (room.pw ? " · mit Passwort" : "") + (!roomAllows("voice") ? " · ohne Sprachchat" : !roomAllows("cam") ? " · ohne Webcams" : "");
  $("#liveTxt").textContent = `${n} ${n === 1 ? "Person" : "Freunde"} synchron`;
  $("#codeLabel").textContent = room.code;
  $("#roomName").textContent = state.title || "Raum";
  const ma = $("#meAvatar"); ma.textContent = initials(me.name); ma.style.background = me.color;
  $("#meName").textContent = me.name;
  const url = inviteUrl(true);
  $("#codeChip").title = "Klicken: Einladungslink kopieren · " + url.replace(/^https?:\/\//, "");
  const hp = people.slice(0, 6).map(p => avatarHTML(p, p.id === me.id ? "me" : "")).join("");
  $("#headPeople").innerHTML = hp + (people.length > 6 ? `<span class="avatar" style="background:var(--c-highest)">+${people.length - 6}</span>` : "");
}
function renderPeople() {
  const l = leader();
  $("#peopleCount").textContent = people.length;
  const camIds = new Set($$(".cam-tile", $("#camStrip")).map(t => t.dataset.uid));
  $("#peopleList").innerHTML = people.filter(p => !camIds.has(p.id)).map(p => {
    const vm = voice.members.get(p.id);
    const mic = vm ? `<span class="rmic ${vm.muted ? "off" : ""}"><span class="ms">${vm.muted ? "mic_off" : "mic"}</span></span>` : "";
    const st = p.id === me.id ? "Du" : vm ? (vm.muted ? "Stumm" : "Im Sprachchat") : l && l.id === p.id ? "Sync-Referenz" : "Online";
    return `<li><button class="rchip" type="button" data-uid="${esc(p.id)}" title="${esc(p.name)} · ${esc(st)}${vm && p.id !== me.id ? " – Klick: Lautstärke" : ""}">
      ${avatarHTML(p, p.id === me.id ? "me" : "")}${mic}<span class="rname">${esc(p.id === me.id ? "Du" : p.name)}</span></button></li>`;
  }).join("");
  // Namen/Mikro auf den Kamera-Kacheln aktuell halten
  $$(".cam-tile", $("#camStrip")).forEach(t => {
    const vm = voice.members.get(t.dataset.uid), b = t.querySelector(".tmic");
    if (b) { b.className = "tmic" + (vm && vm.muted ? " off" : ""); b.innerHTML = `<span class="ms">${vm && vm.muted ? "mic_off" : "mic"}</span>`; }
  });
  renderVoice();
}
function renderSource() {
  const v = state.video, b = $("#srcBadge");
  if (!v) { b.hidden = true; $("#driftBadge").hidden = true; $("#seek").disabled = true; return; }
  b.hidden = false;
  b.className = "sbadge " + SRC_CLASS[v.src];
  b.innerHTML = `<span class="ms">${v.src === "yt" ? "smart_display" : SRC_ICON[v.src]}</span>${esc(v.src === "live" ? (v.kind === "file" ? "Datei geteilt" : "Bildschirm · LIVE") : srcLabel(v.src))}${v.src === "twl" ? " · LIVE" : ""}`;
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
  $("#qCount").textContent = all.length; $("#qCount2").textContent = all.length;
  $("#qClear").hidden = !all.length;
  const list = all.filter(q => filter === "all" || family(q.src) === filter);
  if (!list.length) {
    $("#qList").innerHTML = `<div class="q-empty"><span class="ms">queue_music</span><div>${all.length ? "Nichts in diesem Filter." : "Die Warteschlange ist leer.<br>Füge oben einen Link hinzu."}</div></div>`;
    return;
  }
  $("#qList").innerHTML = list.map(q => {
    const mine = (q.votes || {})[me.id] || 0, sc = score(q);
    const picked = pollSel && pollSel.has(q.qid);
    const fillIcon = { twl: "live_tv", twv: "videocam", tt: "music_note", ig: "photo_camera" }[q.src] || "videocam";
    const thumb = q.thumb ? `<img src="${esc(q.thumb)}" alt="" loading="lazy">` : `<div class="tw-fill ${SRC_CLASS[q.src]}"><span class="ms">${fillIcon}</span></div>`;
    return `<div class="q-item" data-qid="${esc(q.qid)}">
      ${pollSel ? `<button class="pick ${picked ? "on" : ""}" type="button" data-act="pick" aria-pressed="${!!picked}" aria-label="Für Abstimmung auswählen"><span class="ms">${picked ? "check_box" : "check_box_outline_blank"}</span></button>`
        : filter === "all" ? `<button class="drag" type="button" aria-label="Verschieben (ziehen)" title="Ziehen zum Verschieben"><span class="ms">drag_indicator</span></button>` : ""}
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
  $("#chatCount").textContent = state.chat.length;
  renderMiniChat();
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
  const sharingScreen = bc.active && bc.stream && !bc.el;
  { const sb = $("#screenBtn"), want = sharingScreen ? "stop_screen_share" : "screen_share";
    if (sb.dataset.st !== want) { sb.dataset.st = want; sb.innerHTML = `<span class="ms">${want}</span>`; sb.title = sharingScreen ? "Teilen beenden" : "Bildschirm teilen"; sb.setAttribute("aria-label", sb.title); } }
  $("#screenBtn").classList.toggle("danger-btn", !!sharingScreen);
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
function vsend(t, extra = {}) { send({ k: "voice", t, muted: voice.muted, cam: !!voice.cam, ...extra }); }
async function voiceJoin() {
  if (voice.on) return;
  if (!roomAllows("voice")) { toast("Sprachchat ist in diesem Raum ausgeschaltet."); return; }
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
  if (voice.cam) { voice.cam.stop(); voice.cam = null; }
  removeCamTile(me.id);
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
  // "Perfect negotiation": die größere ID gibt bei gleichzeitigen Angeboten nach
  p = { id, pc, cands: [], audio: null, polite: me.id > id, makingOffer: false, ignoreOffer: false, videoSender: null };
  voice.peers.set(id, p);
  voice.stream.getAudioTracks().forEach(t => pc.addTrack(t, voice.stream));
  if (voice.cam) p.videoSender = pc.addTrack(voice.cam, voice.stream);
  pc.onnegotiationneeded = async () => {
    try {
      p.makingOffer = true;
      await pc.setLocalDescription();
      vsend("sig", { to: id, desc: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
    } catch (e) { console.warn("voice negotiation", e); } finally { p.makingOffer = false; }
  };
  pc.onicecandidate = e => { if (e.candidate) vsend("sig", { to: id, cand: e.candidate.toJSON() }); };
  pc.ontrack = e => {
    const tr = e.track;
    if (tr.kind === "audio") {
      const st = new MediaStream([tr]);
      if (!p.audio) { p.audio = document.createElement("audio"); p.audio.autoplay = true; p.audio.playsInline = true; document.body.appendChild(p.audio); }
      p.audio.srcObject = st;
      p.audio.volume = clamp(peerVol(id) * voiceMaster(), 0, 1);
      p.audio.play().catch(() => {});
      addMeter(id, st);
    } else if (tr.kind === "video") {
      p.videoTrack = tr;
      const m = voice.members.get(id);
      if (!m || m.cam !== false) showCamTile(id, tr);
      tr.onmute = () => removeCamTile(id);
      tr.onunmute = () => { const mm = voice.members.get(id); if (!mm || mm.cam) showCamTile(id, tr); };
    }
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed") { closePeer(id); if (voice.on) setTimeout(() => voice.on && voice.members.has(id) && getPeer(id), 1500); }
  };
  return p;
}
async function handleSig(from, op) {
  const p = getPeer(from), pc = p.pc;
  try {
    if (op.desc) {
      const collision = op.desc.type === "offer" && (p.makingOffer || pc.signalingState !== "stable");
      p.ignoreOffer = !p.polite && collision;
      if (p.ignoreOffer) return;
      await pc.setRemoteDescription(op.desc);
      for (const c of p.cands.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      if (op.desc.type === "offer") {
        await pc.setLocalDescription();
        vsend("sig", { to: from, desc: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
      }
    } else if (op.cand) {
      if (pc.remoteDescription) await pc.addIceCandidate(op.cand).catch(e => { if (!p.ignoreOffer) console.warn("ice", e); });
      else p.cands.push(op.cand);
    }
  } catch (e) { console.warn("voice sig", e); }
}
function closePeer(id) {
  const p = voice.peers.get(id); if (!p) return;
  try { p.pc.close(); } catch {}
  if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
  voice.peers.delete(id); dropMeter(id); removeCamTile(id);
}
function voiceSignal(op, local) {
  if (local) return;
  const from = op.by;
  if (op.t === "join" || op.t === "here") {
    voice.members.set(from, { name: op.name, muted: !!op.muted, cam: !!op.cam });
    if (voice.on && op.t === "join") { vsend("here", { to: from }); getPeer(from); }
    if (op.t === "join") sys(`${op.name} ist dem Sprachchat beigetreten`);
  } else if (op.t === "leave") {
    voice.members.delete(from); closePeer(from);
  } else if (op.t === "state") {
    const m = voice.members.get(from);
    if (m) { m.muted = !!op.muted; m.cam = !!op.cam; }
    const pr = voice.peers.get(from);
    if (op.cam && pr && pr.videoTrack && !pr.videoTrack.muted) showCamTile(from, pr.videoTrack);
    if (!op.cam) removeCamTile(from);
  } else if (op.t === "sig") {
    if (op.to !== me.id || !voice.on) return;
    handleSig(from, op);
    return;
  }
  renderPeople();
}
// ---------------------------------------------------------------- Webcams
async function camToggle() {
  if (!voice.on) return;
  if (!voice.cam && !roomAllows("cam")) return;
  if (voice.cam) {
    voice.cam.stop(); voice.cam = null;
    for (const p of voice.peers.values()) if (p.videoSender) p.videoSender.replaceTrack(null).catch(() => {});
    removeCamTile(me.id);
  } else {
    let s;
    try { s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } } }); }
    catch { toast("Kein Zugriff auf die Kamera. Bitte im Browser erlauben.", 4000); return; }
    voice.cam = s.getVideoTracks()[0];
    for (const p of voice.peers.values()) {
      if (p.videoSender) await p.videoSender.replaceTrack(voice.cam).catch(() => {});
      else p.videoSender = p.pc.addTrack(voice.cam, voice.stream);
    }
    showCamTile(me.id, voice.cam, true);
  }
  vsend("state");
  renderVoice();
}
function showCamTile(id, track, self) {
  const strip = $("#camStrip");
  let tile = strip.querySelector(`.cam-tile[data-uid="${CSS.escape(id)}"]`);
  if (!tile) {
    tile = document.createElement("div");
    tile.className = "cam-tile" + (self ? " self" : "");
    tile.dataset.uid = id;
    const name = self ? "Du" : ((voice.members.get(id) || {}).name || "?");
    tile.innerHTML = `<video autoplay playsinline muted></video><span class="tshade"></span><span class="tmic"><span class="ms">mic</span></span><span class="nm">${esc(name)}</span>`;
    strip.appendChild(tile);
    renderPeople();
  }
  const v = tile.querySelector("video");
  if (!v.srcObject || v.srcObject.getVideoTracks()[0] !== track) v.srcObject = new MediaStream([track]);
  v.play().catch(() => {});
  strip.hidden = false;
  document.body.classList.add("has-cams");
  renderFsCams();
}
function removeCamTile(id) {
  const strip = $("#camStrip"); if (!strip) return;
  const t = strip.querySelector(`.cam-tile[data-uid="${CSS.escape(id)}"]`);
  if (t) { const v = t.querySelector("video"); if (v) v.srcObject = null; t.remove(); }
  strip.hidden = !strip.children.length;
  document.body.classList.toggle("has-cams", !!strip.children.length);
  if (t) { renderPeople(); renderFsCams(); }
}
const roomAllows = k => !state.settings || state.settings[k] !== false;
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
  $$(".cam-tile").forEach(t => t.classList.toggle("speaking", voice.speaking.has(t.dataset.uid)));
  for (const id of voice.speaking) lastSpoke.set(id, now());
  if (fsActive()) updateFsSpeaking();
}, 200);
function renderVoice() {
  const box = $("#voiceCtl"); if (!box) return;
  const n = voice.members.size;
  if (!roomAllows("voice")) { box.innerHTML = `<p class="muted" style="margin:0;font-size:13px">Sprachchat ist in diesem Raum ausgeschaltet.</p>`; if (voice.on) voiceLeave(); return; }
  if (!voice.on) {
    box.innerHTML = `<button class="vbig join" type="button" data-v="join"><span class="ms">mic</span>Sprachchat beitreten${n ? ` · ${n} drin` : ""}</button>`;
    return;
  }
  const master = Math.round(voiceMaster() * 100);
  box.innerHTML = `<div class="vgrid">
    <button class="vbig ${voice.muted ? "off" : "on"}" type="button" data-v="mute"><span class="ms">${voice.muted ? "mic_off" : "mic"}</span>Mikro: ${voice.muted ? "Aus" : "An"}</button>
    <button class="vbig" type="button" data-v="out"><span class="ms">volume_up</span>Ausgabe ${master}%</button>
    ${roomAllows("cam") ? `<button class="vbig ${voice.cam ? "on" : ""}" type="button" data-v="cam"><span class="ms">${voice.cam ? "videocam" : "videocam_off"}</span>Kamera: ${voice.cam ? "An" : "Aus"}</button>` : ""}
    <button class="vbig leave" type="button" data-v="leave"><span class="ms">call_end</span>Verlassen</button>
  </div>`;
}
function voiceMaster() { return clamp(+store.get("sc_voice_master", 100) / 100, 0, 1); }
function applyPeerVolumes() { for (const [id, p] of voice.peers) if (p.audio) p.audio.volume = clamp(peerVol(id) * voiceMaster(), 0, 1); }
function openVoicePop(anchor, html) {
  const menu = $("#voiceMenu");
  menu.innerHTML = html;
  const card = anchor.closest(".sidebar") || document.body;
  const r = anchor.getBoundingClientRect(), c = card.getBoundingClientRect();
  menu.style.left = Math.max(0, Math.min(r.left - c.left, c.width - 260)) + "px";
  menu.style.top = (r.bottom - c.top + 6) + "px";
  menu.hidden = false;
}
function personPop(id, anchor) {
  const p = people.find(x => x.id === id) || { id, name: (voice.members.get(id) || {}).name || "?" };
  const vm = voice.members.get(id);
  let body;
  if (id === me.id) body = `<div class="muted" style="font-size:13px">Das bist du${voice.on ? (voice.muted ? " – Mikro aus" : " – im Sprachchat") : ""}.</div>`;
  else if (!vm) body = `<div class="muted" style="font-size:13px">Nicht im Sprachchat.</div>`;
  else { const v = Math.round(peerVol(id) * 100); body = `<label class="vrow"><span class="nm">Lautstärke</span><input type="range" min="0" max="100" value="${v}" data-pv="${esc(id)}" style="--p:${v}%" aria-label="Lautstärke ${esc(p.name)}"></label>${voice.on ? "" : `<div class="muted" style="font-size:12px">Tritt dem Sprachchat bei, um ${esc(p.name)} zu hören.</div>`}`; }
  openVoicePop(anchor, `<div class="vp-head">${avatarHTML(p)}<b>${esc(p.name)}</b></div>${body}`);
}
$("#peopleList").addEventListener("click", e => { const b = e.target.closest(".rchip"); if (!b) return; e.stopPropagation(); personPop(b.dataset.uid, b); });
$("#camStrip").addEventListener("click", e => { const t = e.target.closest(".cam-tile"); if (!t) return; e.stopPropagation(); personPop(t.dataset.uid, t); });
$("#voiceCtl").addEventListener("click", e => {
  const b = e.target.closest("button[data-v]"); if (!b) return;
  if (b.dataset.v === "join") voiceJoin();
  else if (b.dataset.v === "mute") voiceToggleMute();
  else if (b.dataset.v === "cam") camToggle();
  else if (b.dataset.v === "vol") { e.stopPropagation(); toggleVoiceMenu(); }
  else if (b.dataset.v === "out") {
    e.stopPropagation();
    const v = Math.round(voiceMaster() * 100);
    openVoicePop(b, `<label class="vrow"><span class="nm">Sprachchat gesamt (nur bei dir)</span><input type="range" min="0" max="100" value="${v}" data-master="1" style="--p:${v}%" aria-label="Lautstärke Sprachchat gesamt"></label>`);
  }
  else { $("#voiceMenu").hidden = true; voiceLeave(); }
});
function peerKey(id) { const m = voice.members.get(id); return "sc_pv_" + ((m && m.name) || id).toLowerCase(); }
function peerVol(id) { return clamp(+store.get(peerKey(id), 100) / 100, 0, 1); }
function toggleVoiceMenu() {
  const menu = $("#voiceMenu");
  if (!menu.hidden) { menu.hidden = true; return; }
  const others = [...voice.members.entries()].filter(([id]) => id !== me.id);
  menu.innerHTML = `<div class="label-sm muted">Lautstärke pro Person (nur bei dir)</div>` + (others.length
    ? others.map(([id, m]) => { const v = Math.round(peerVol(id) * 100); return `<label class="vrow"><span class="nm">${esc(m.name)}${voice.peers.has(id) ? "" : " · verbindet …"}</span><input type="range" min="0" max="100" value="${v}" data-pv="${esc(id)}" style="--p:${v}%" aria-label="Lautstärke ${esc(m.name)}"></label>`; }).join("")
    : `<div class="muted" style="font-size:13px">Noch niemand außer dir im Sprachchat.</div>`);
  menu.hidden = false;
}
$("#voiceMenu").addEventListener("input", e => {
  const m = e.target.closest("input[data-master]");
  if (m) { store.set("sc_voice_master", +m.value); m.style.setProperty("--p", m.value + "%"); applyPeerVolumes(); renderVoice(); return; }
  const r = e.target.closest("input[data-pv]"); if (!r) return;
  const id = r.dataset.pv;
  store.set(peerKey(id), +r.value);
  r.style.setProperty("--p", r.value + "%");
  applyPeerVolumes();
});
$("#voiceMenu").addEventListener("click", e => e.stopPropagation());
document.addEventListener("click", () => { const m = $("#voiceMenu"); if (m) m.hidden = true; });

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


// ---------------------------------------------------------------- Abstimmung
let pollSel = null; // Set der ausgewählten qids im Auswahlmodus
function pollWinner(po) {
  const c = po.options.map(() => 0);
  for (const i of Object.values(po.votes)) if (c[i] !== undefined) c[i]++;
  let best = 0; c.forEach((v, i) => { if (v > c[best]) best = i; });
  return { counts: c, best };
}
function endPoll(cancel) {
  const po = state.poll; if (!po) return;
  send({ k: "pollEnd", pid: po.pid, winner: pollWinner(po).best, cancel: !!cancel });
}
function updatePollTimer() {
  const el = $("#pollLeft"); if (!el || !state.poll) return;
  el.textContent = Math.max(0, Math.ceil((state.poll.endsAt - now()) / 1000));
}
function renderPoll() {
  const card = $("#pollCard"), po = state.poll;
  card.hidden = !po;
  if (!po) return;
  const { counts } = pollWinner(po), total = counts.reduce((a, b) => a + b, 0), mine = po.votes[me.id];
  card.innerHTML = `<div class="poll-head"><span class="ms">how_to_vote</span><b>Was schauen wir?</b><span class="muted">noch <span id="pollLeft">${Math.max(0, Math.ceil((po.endsAt - now()) / 1000))}</span> s · ${total} ${total === 1 ? "Stimme" : "Stimmen"}</span>
    ${po.by === me.id ? `<button class="btn btn-ghost" type="button" data-poll="end">Jetzt auswerten</button><button class="icon-btn" type="button" data-poll="cancel" aria-label="Abstimmung abbrechen"><span class="ms">close</span></button>` : ""}</div>
    <div class="poll-opts">${po.options.map((o, i) => {
      const pct = total ? Math.round(counts[i] / total * 100) : 0;
      const th = o.thumb ? `<img src="${esc(o.thumb)}" alt="">` : `<div class="tw-fill ${SRC_CLASS[o.src]}"><span class="ms">${SRC_ICON[o.src]}</span></div>`;
      return `<button type="button" class="poll-opt ${mine === i ? "mine" : ""}" data-idx="${i}" aria-pressed="${mine === i}">
        <span class="thumb">${th}</span><span class="po-body"><span class="po-title">${esc(o.title)}</span>
        <span class="po-bar"><span style="width:${pct}%"></span></span><span class="po-n">${counts[i]} · ${pct} %</span></span></button>`;
    }).join("")}</div>`;
}
$("#pollCard").addEventListener("click", e => {
  const b = e.target.closest("[data-poll]");
  if (b) { endPoll(b.dataset.poll === "cancel"); return; }
  const o = e.target.closest(".poll-opt"); if (!o || !state.poll) return;
  send({ k: "pollVote", pid: state.poll.pid, idx: +o.dataset.idx });
});
function renderPollBar() {
  const bar = $("#pollBar");
  if (!pollSel) { bar.innerHTML = `<button class="btn btn-ghost" type="button" id="pollStart"><span class="ms">how_to_vote</span>Abstimmen lassen</button>`; return; }
  const n = pollSel.size;
  bar.innerHTML = `<span class="label-sm" style="color:var(--primary)">${n} von 2–4 gewählt</span>
    <button class="btn btn-primary" type="button" id="pollGo" ${n < 2 ? "disabled" : ""}><span class="ms">how_to_vote</span>Starten (30 s)</button>
    <button class="btn btn-ghost" type="button" id="pollStop">Abbrechen</button>`;
}
$("#pollBar").addEventListener("click", e => {
  const id = (e.target.closest("button") || {}).id;
  if (id === "pollStart") {
    if (state.poll) { toast("Es läuft schon eine Abstimmung."); return; }
    if (state.queue.length < 2) { toast("Dafür braucht die Warteschlange mindestens 2 Videos."); return; }
    pollSel = new Set(); filter = "all"; $$(".fchip").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.f === "all")));
  } else if (id === "pollStop") pollSel = null;
  else if (id === "pollGo" && pollSel && pollSel.size >= 2) {
    const options = state.queue.filter(q => pollSel.has(q.qid)).slice(0, 4);
    pollSel = null;
    send({ k: "poll", pid: uid(8), options, secs: 30 });
  }
  renderPollBar(); renderQueue();
});

// ---------------------------------------------------------------- Statistik
let statsActive = false, lastStatsSave = 0;
function saveStats() {
  lastStatsSave = now();
  if (room && state.stats) store.set("sc_stats_" + room.code, state.stats);
}
function mergeSavedStats() {
  // Wenn der Raum leer war, bleibt die Statistik trotzdem erhalten (lokal im Browser gespeichert)
  const saved = room && store.get("sc_stats_" + room.code, null);
  if (!saved) return;
  const cur = ST();
  if ((saved.sec || 0) > (cur.sec || 0)) state.stats = { ...freshStats(), ...saved };
}
function topList(map, unit) {
  const rows = Object.entries(map || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!rows.length) return `<div class="muted" style="font-size:13px">Noch nichts.</div>`;
  const max = rows[0][1];
  return rows.map(([n, v], i) => `<div class="st-row"><span class="st-rank">${i === 0 ? "👑" : i + 1}</span><span class="st-name">${esc(n)}</span>
    <span class="st-bar"><span style="width:${Math.round(v / max * 100)}%"></span></span><span class="st-val">${v}${unit}</span></div>`).join("");
}
function renderStats() {
  const s = ST(), h = Math.floor(s.sec / 3600), m = Math.floor((s.sec % 3600) / 60);
  $("#statsBody").innerHTML = `
    <div class="st-big"><div><b>${h ? h + " h " : ""}${m} min</b><span>zusammen geschaut</span></div><div><b>${s.videos}</b><span>Videos gestartet</span></div></div>
    <h4>Meiste Videos eingereicht</h4>${topList(s.added, "")}
    <h4>Meiste Upvotes bekommen</h4>${topList(s.upv, " ▲")}
    <h4>Reaktions-Könige</h4>${topList(s.react, "")}
    <p class="muted" style="font-size:12px;margin:8px 0 0">Die Statistik gilt für diesen Raum (Code ${esc(room.code)}) und bleibt in euren Browsern gespeichert.</p>`;
}

// ---------------------------------------------------------------- Live teilen (Bildschirm / eigene Datei)
const bc = { active: false, stream: null, el: null, url: null, audioOnly: false, peers: new Map() };  // als Teilender
const viewerPeers = new Map();  // als Zuschauer: sharerId → pc
function liveSend(t, extra) { send({ k: "live", t, ...extra }); }
async function startScreen() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) { toast("Bildschirm teilen geht nur am PC (Chrome, Edge, Firefox)."); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true }); }
  catch { return; }
  beginBroadcast(stream, { kind: "screen", title: `Bildschirm von ${me.name}` });
  stream.getVideoTracks()[0].addEventListener("ended", () => endBroadcast());
}
async function startFile(file) {
  if (!file) return;
  const isAudio = /^audio\//.test(file.type) || /\.(mp3|m4a|aac|ogg|wav|flac|opus)$/i.test(file.name);
  const el = document.createElement("video");
  el.playsInline = true; el.preload = "auto";
  const url = URL.createObjectURL(file);
  el.src = url;
  try { await new Promise((res, rej) => { el.onloadedmetadata = res; el.onerror = rej; setTimeout(rej, 15000); }); }
  catch { URL.revokeObjectURL(url); toast("Diese Datei kann dein Browser nicht abspielen (MP4/WebM/MP3 gehen am besten)."); return; }
  const cap = el.captureStream || el.mozCaptureStream;
  if (!cap) { URL.revokeObjectURL(url); toast("Dein Browser kann Dateien nicht teilen – nimm Chrome oder Edge."); return; }
  const stream = cap.call(el);
  bc.el = el; bc.url = url; bc.audioOnly = isAudio;
  el.addEventListener("ended", () => { if (state.video && state.video.src === "live" && state.video.ref === me.id) playNext(vkey(state.video), true); });
  // neue Spuren (z. B. nach dem ersten Abspielen) an alle Zuschauer nachreichen
  stream.addEventListener("addtrack", e => { for (const pc of bc.peers.values()) try { pc.addTrack(e.track, stream); } catch {} });
  beginBroadcast(stream, { kind: "file", title: file.name.replace(/\.[^.]+$/, ""), dur: isFinite(el.duration) ? el.duration : 0 });
}
function beginBroadcast(stream, info) {
  if (bc.active) stopBroadcast(true);
  bc.active = true; bc.stream = stream;
  const item = { qid: uid(8), src: "live", ref: me.id, kind: info.kind, title: info.title, dur: info.dur || 0, by: me.id, byName: me.name, votes: {}, at: now(), thumb: "" };
  send({ k: "load", video: item, pos: 0, playing: true });
  toast(info.kind === "screen" ? "Du teilst jetzt deinen Bildschirm" : "Du spielst die Datei für alle ab", 3000);
}
function endBroadcast() {
  if (!bc.active) return;
  const mine = state.video && state.video.src === "live" && state.video.ref === me.id;
  stopBroadcast(true);
  if (mine) { const n = sortedQueue()[0]; send({ k: "load", video: n || null, pos: n ? n.start || 0 : 0, playing: !!n }); }
}
function stopBroadcast(silent) {
  bc.active = false;
  for (const pc of bc.peers.values()) try { pc.close(); } catch {}
  bc.peers.clear();
  if (bc.stream) bc.stream.getTracks().forEach(t => { if (!bc.el) t.stop(); });
  if (bc.el) { bc.el.pause(); bc.el.removeAttribute("src"); }
  if (bc.url) URL.revokeObjectURL(bc.url);
  bc.stream = null; bc.el = null; bc.url = null;
  if (!silent) liveSend("stop", {});
}
function liveWant(sharer) { liveSend("want", { to: sharer }); }
function liveClose(sharer) { const pc = viewerPeers.get(sharer); if (pc) { try { pc.close(); } catch {} viewerPeers.delete(sharer); } }
async function liveSignal(op, local) {
  if (local || op.to !== me.id) return;
  const from = op.by;
  if (op.t === "want") {
    if (!bc.active || !bc.stream) return;
    const old = bc.peers.get(from); if (old) try { old.close(); } catch {}
    const pc = new RTCPeerConnection({ iceServers: ICE });
    bc.peers.set(from, pc);
    bc.stream.getTracks().forEach(t => pc.addTrack(t, bc.stream));
    pc.onicecandidate = e => { if (e.candidate) liveSend("sig", { to: from, cand: e.candidate.toJSON() }); };
    pc.onnegotiationneeded = async () => { try { await pc.setLocalDescription(); liveSend("sig", { to: from, desc: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }); } catch (e) { console.warn("live offer", e); } };
    // Bildqualität fürs Teilen etwas anheben
    for (const snd of pc.getSenders()) if (snd.track && snd.track.kind === "video") { try { const pr = snd.getParameters(); pr.encodings = [{ ...(pr.encodings && pr.encodings[0]), maxBitrate: 2500000 }]; snd.setParameters(pr); } catch {} }
    return;
  }
  if (op.t === "sig") {
    // Antwort/Kandidaten an den Teilenden …
    if (bc.peers.has(from)) {
      const pc = bc.peers.get(from);
      try { if (op.desc) await pc.setRemoteDescription(op.desc); else if (op.cand) await pc.addIceCandidate(op.cand); } catch (e) { console.warn("live sig", e); }
      return;
    }
    // … oder als Zuschauer vom Teilenden
    let pc = viewerPeers.get(from);
    if (!pc) {
      pc = new RTCPeerConnection({ iceServers: ICE });
      viewerPeers.set(from, pc); pc._cands = [];
      const ms = new MediaStream();
      pc.ontrack = e => { ms.addTrack(e.track); if (player && player.kind === "live" && player.attach) player.attach(ms); };
      pc.onicecandidate = e => { if (e.candidate) liveSend("sig", { to: from, cand: e.candidate.toJSON() }); };
    }
    try {
      if (op.desc) {
        await pc.setRemoteDescription(op.desc);
        for (const c of pc._cands.splice(0)) await pc.addIceCandidate(c).catch(() => {});
        if (op.desc.type === "offer") { await pc.setLocalDescription(); liveSend("sig", { to: from, desc: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }); }
      } else if (op.cand) {
        if (pc.remoteDescription) await pc.addIceCandidate(op.cand).catch(() => {}); else pc._cands.push(op.cand);
      }
    } catch (e) { console.warn("live view", e); }
  }
}
$("#screenBtn").onclick = () => { if (bc.active && bc.stream && !bc.el) endBroadcast(); else startScreen(); };
$("#fileBtn").onclick = () => $("#fileInput").click();
$("#fileInput").onchange = e => { const f = e.target.files && e.target.files[0]; e.target.value = ""; startFile(f); };
if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) $("#screenBtn").hidden = true;

// ---------------------------------------------------------------- Zufallsnamen
const NAME_ADJ = ["Flinker", "Müder", "Wilder", "Lässiger", "Chaotischer", "Hungriger", "Cooler", "Schläfriger", "Kichernder", "Mutiger", "Neugieriger", "Gemütlicher", "Verpeilter", "Funkelnder", "Grummeliger", "Tanzender", "Geheimer", "Fluffiger", "Epischer", "Sonniger"];
const NAME_NOUN = ["Fuchs", "Pinguin", "Otter", "Waschbär", "Dachs", "Biber", "Igel", "Koala", "Panda", "Hamster", "Uhu", "Elch", "Lemur", "Tukan", "Gecko", "Yeti", "Kaktus", "Toast", "Keks", "Nacho", "Popcorn-Bär", "Kraken"];
function randomName() {
  const r = n => Math.floor(Math.random() * n);
  for (let i = 0; i < 10; i++) { const n = `${NAME_ADJ[r(NAME_ADJ.length)]} ${NAME_NOUN[r(NAME_NOUN.length)]}`; if (n.length <= 24) return n; }
  return "Popcorn-Bär";
}
$$("[data-dice]").forEach(b => b.onclick = () => {
  const inp = $("#" + b.dataset.dice); inp.value = randomName();
  b.classList.remove("roll"); void b.offsetWidth; b.classList.add("roll");
  inp.focus();
});

// ---------------------------------------------------------------- Einstiegs-Animation
let fxStart = 0;
function playEnterFx(code, creating) {
  const fx = $("#enterFx");
  fx.classList.remove("open", "done"); fx.hidden = false;
  $("#fxTxt").textContent = creating ? "Raum wird erstellt …" : "Betrete Raum …";
  const box = $("#fxCode"); box.innerHTML = "";
  [...code].forEach((ch, i) => { const s = document.createElement("span"); s.textContent = ch; s.style.animationDelay = (0.15 + i * 0.07) + "s"; box.appendChild(s); });
  fxStart = now();
}
function finishEnterFx(ok) {
  const fx = $("#enterFx"); if (fx.hidden) return;
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = Math.max(0, (reduce ? 300 : 1500) - (now() - fxStart));
  setTimeout(() => {
    $("#fxTxt").textContent = ok ? "Los geht's!" : "Verbinde weiter im Hintergrund …";
    fx.classList.add("open");
    setTimeout(() => { fx.classList.add("done"); fx.hidden = true; }, reduce ? 200 : 900);
  }, wait);
}

// ---------------------------------------------------------------- Redesign: Mini-Chat, Titel, Menüs, Kinomodus
function renderMiniChat() {
  const box = $("#miniChat"); if (!box) return;
  const recent = state.chat.filter(m => now() - m.ts < 45000).slice(-4);
  box.hidden = !recent.length || !state.video;
  $("#miniChatBody").innerHTML = recent.map(m => `<p><b style="color:${esc(m.color || colorFor(m.by))}">${esc(m.name)}:</b> ${esc(m.text)}</p>`).join("");
}
setInterval(() => { if (room) renderMiniChat(); }, 5000);
function renderStageTitle() {
  const v = state.video;
  $("#stageTitle").hidden = !v;
  if (v) $("#stageTitleTxt").textContent = v.title || "";
}
$("#meBtn").onclick = e => { e.stopPropagation(); const m = $("#meMenu"); m.hidden = !m.hidden; };
document.addEventListener("click", e => { if (!e.target.closest("#meMenu")) $("#meMenu").hidden = true; });
$("#settingsBtn").onclick = () => {
  $("#setName").value = state.title || "";
  $("#setFs").value = fsMode();
  hkCapture = false; renderHotkeyBtn();
  $("#setVoice").checked = roomAllows("voice"); $("#setCam").checked = roomAllows("cam"); $("#setCam").disabled = !$("#setVoice").checked;
  $("#settingsModal").hidden = false; $("#setName").focus();
};
$("#setVoice").onchange = () => { $("#setCam").disabled = !$("#setVoice").checked; };
$("#setCancel").onclick = () => { $("#settingsModal").hidden = true; };
$("#settingsModal").addEventListener("click", e => { if (e.target.id === "settingsModal") $("#settingsModal").hidden = true; });
$("#setSave").onclick = () => {
  const t = $("#setName").value.trim();
  if (t && t !== state.title) send({ k: "title", title: t });
  const ns = { voice: $("#setVoice").checked, cam: $("#setVoice").checked && $("#setCam").checked, fsCams: $("#setFs").value };
  if (ns.voice !== roomAllows("voice") || ns.cam !== roomAllows("cam") || ns.fsCams !== fsMode()) send({ k: "settings", settings: ns });
  hkCapture = false;
  $("#settingsModal").hidden = true;
  toast("Gespeichert");
};
$("#qClear").onclick = () => { if (state.queue.length) send({ k: "qclear" }); };
$("#theaterBtn").onclick = () => {
  document.body.classList.toggle("theater");
  $("#theaterBtn").classList.toggle("live", document.body.classList.contains("theater"));
};

// ---------------------------------------------------------------- Kameras im Vollbild
const FS_MODES = { rail: "Leiste rechts", pip: "Frei verschiebbar", speaker: "Nur wer spricht", off: "Keine Kameras" };
const fsMode = () => (state.settings && FS_MODES[state.settings.fsCams]) ? state.settings.fsCams : "rail";
const lastSpoke = new Map();
const fsActive = () => document.fullscreenElement === $(".stage");
let fsIdleT = null;
function renderFsCams() {
  const box = $("#fsCams"); if (!box) return;
  const mode = fsMode();
  if (box.dataset.mode !== mode) { box.innerHTML = ""; box.dataset.mode = mode; }
  box.className = "fs-cams mode-" + mode + (store.get("sc_fs_rail_closed", false) ? " closed" : "");
  if (!fsActive() || mode === "off") { box.innerHTML = ""; box.hidden = true; return; }
  const tiles = $$(".cam-tile", $("#camStrip"));
  box.hidden = !tiles.length;
  const have = new Set();
  tiles.forEach((t, i) => {
    const id = t.dataset.uid; have.add(id);
    let f = box.querySelector(`.fs-tile[data-uid="${CSS.escape(id)}"]`);
    if (!f) {
      f = document.createElement("div"); f.className = "fs-tile" + (t.classList.contains("self") ? " self" : ""); f.dataset.uid = id;
      f.innerHTML = `<video autoplay playsinline muted></video><span class="nm">${esc(t.querySelector(".nm").textContent)}</span>`;
      box.appendChild(f);
      if (mode === "pip") placePip(f, i);
    }
    const src = t.querySelector("video").srcObject, v = f.querySelector("video");
    if (v.srcObject !== src) { v.srcObject = src; v.play().catch(() => {}); }
  });
  $$(".fs-tile", box).forEach(f => { if (!have.has(f.dataset.uid)) f.remove(); });
  if (mode === "rail" && tiles.length && !box.querySelector(".fs-toggle")) {
    const b = document.createElement("button"); b.type = "button"; b.className = "fs-toggle"; b.title = "Kameras ein-/ausklappen"; b.setAttribute("aria-label", b.title);
    b.innerHTML = `<span class="ms">videocam</span>`;
    b.onclick = e => { e.stopPropagation(); store.set("sc_fs_rail_closed", !store.get("sc_fs_rail_closed", false)); renderFsCams(); };
    box.prepend(b);
  }
  updateFsSpeaking();
}
function updateFsSpeaking() {
  const box = $("#fsCams"); if (!box || box.hidden) return;
  const speakerMode = fsMode() === "speaker";
  $$(".fs-tile", box).forEach(f => {
    const id = f.dataset.uid, talking = voice.speaking.has(id);
    f.classList.toggle("speaking", talking);
    if (speakerMode) f.classList.toggle("show", talking || now() - (lastSpoke.get(id) || 0) < 2000);
  });
}
// B) frei verschiebbare Kacheln – Position wird pro Person gemerkt
function placePip(f, i) {
  const pos = store.get("sc_pip_" + f.dataset.uid, null);
  if (pos) { f.style.left = pos.x + "%"; f.style.top = pos.y + "%"; }
  else { f.style.right = "16px"; f.style.bottom = (90 + i * 180) + "px"; }
  f.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const box = $("#fsCams").getBoundingClientRect(), r = f.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    f.setPointerCapture(e.pointerId); f.classList.add("dragging");
    const move = ev => {
      const x = clamp(ev.clientX - box.left - dx, 0, box.width - r.width), y = clamp(ev.clientY - box.top - dy, 0, box.height - r.height);
      f.style.right = f.style.bottom = "auto"; f.style.left = (x / box.width * 100) + "%"; f.style.top = (y / box.height * 100) + "%";
    };
    const up = () => {
      f.releasePointerCapture(e.pointerId); f.classList.remove("dragging");
      f.removeEventListener("pointermove", move); f.removeEventListener("pointerup", up);
      if (f.style.left) store.set("sc_pip_" + f.dataset.uid, { x: parseFloat(f.style.left), y: parseFloat(f.style.top) });
    };
    f.addEventListener("pointermove", move); f.addEventListener("pointerup", up);
  });
}
document.addEventListener("fullscreenchange", () => { $("#fsCams").innerHTML = ""; renderFsCams(); poke(); });
// Leiste blendet sich nach 3 s ohne Maus halb aus
function poke() {
  const st = $(".stage"); st.classList.remove("idle");
  clearTimeout(fsIdleT); fsIdleT = setTimeout(() => { if (fsActive()) st.classList.add("idle"); }, 3000);
}
$(".stage").addEventListener("mousemove", poke);

// ---------------------------------------------------------------- Mikro-Hotkey
let hkCapture = false;
function hotkeyLabel(hk) {
  if (!hk) return "Nicht festgelegt";
  const k = hk.code.replace(/^Key/, "").replace(/^Digit/, "").replace(/^Numpad/, "Num ").replace("Backquote", "^").replace("Space", "Leertaste");
  return [hk.ctrl && "Strg", hk.alt && "Alt", hk.shift && "Shift", hk.meta && "Cmd", k].filter(Boolean).join(" + ");
}
function renderHotkeyBtn() {
  const b = $("#setHotkey"); if (!b) return;
  b.textContent = hkCapture ? "Taste drücken … (Esc = abbrechen, Entf = löschen)" : hotkeyLabel(store.get("sc_mic_hotkey", null));
  b.classList.toggle("capturing", hkCapture);
}
$("#setHotkey").onclick = () => { hkCapture = !hkCapture; renderHotkeyBtn(); };
// ---------------------------------------------------------------- Room lifecycle
function genCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const r = crypto.getRandomValues(new Uint8Array(6));
  const s = Array.from(r, b => A[b % A.length]).join("");
  return s.slice(0, 3) + "-" + s.slice(3);
}
const normCode = c => { const s = String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); return s.length === 6 ? s.slice(0, 3) + "-" + s.slice(3) : s; };
function inviteUrl(withPw) {
  const base = location.protocol === "file:" ? location.href.split("#")[0] : location.origin + location.pathname;
  return base + "#/r/" + room.code + (withPw && room.pw ? "?k=" + b64e(room.pw) : "");
}

async function enterRoom({ name, code, pw, title, creating, settings }) {
  name = name.trim().slice(0, 24) || randomName();
  playEnterFx(code, creating);
  store.set("sc_name", name);
  const id = store.sget("sc_id", null) || uid(12);
  store.sset("sc_id", id);
  me = { id, name, color: colorFor(id + name), joinedAt: now() };
  const channel = (await sha256(code + "\u0000" + (pw || ""))).slice(0, 32);
  room = { code, pw: pw || "", channel };
  state = freshState();
  if (creating) { state.title = (title || "").trim() || `Raum von ${name}`; state.settings = settings || { voice: true, cam: true }; }
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
    for (const id of before) if (!after.has(id) && id !== me.id) { sys(`${(prevPeople.get(id) || {}).name || "Jemand"} hat den Raum verlassen`); voice.members.delete(id); closePeer(id); if (bc.peers.has(id)) { try { bc.peers.get(id).close(); } catch {} bc.peers.delete(id); } if (state.video && state.video.src === "live" && state.video.ref === id) { state.video = null; renderAll(); syncPlayer(true); } if ((state.adWait || []).some(x => x.id === id)) { state.adWait = state.adWait.filter(x => x.id !== id); releaseAdHold(); } }
    prevPeople = new Map(list.map(p => [p.id, p]));
    renderHead(); renderPeople();
  });
  try {
    await transport.connect(channel, me);
  } catch (e) {
    finishEnterFx(false);
    toast("Verbindung fehlgeschlagen – ich versuche es weiter.", 5000);
    onStatus("offline");
    return;
  }
  finishEnterFx(true);
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
    mergeSavedStats();
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
  saveStats(); pollSel = null;
  if (bc.active) endBroadcast();
  for (const id of [...viewerPeers.keys()]) liveClose(id);
  voiceLeave(); hideUpNext(); clearTimeout(reconnectT); offlineSince = 0;
  voice.members.clear();
  transport && transport.leave(); transport = null;
  if (player) { player.destroy(); player = null; } loadedKey = "";
  room = null; synced = false; people = [];
  store.sdel("sc_session");
  history.replaceState(null, "", location.pathname + location.search);
  $("#room").hidden = true; $("#lobby").hidden = false;
  document.title = "SharedCueTV – Gemeinsam schauen";
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
  const settings = { voice: $("#cVoice").checked, cam: $("#cVoice").checked && $("#cCam").checked };
  store.set("sc_room_opts", settings);
  enterRoom({ name: $("#cName").value, code: genCode(), pw: $("#cPass").value, title: $("#cTitle").value, creating: true, settings });
});
$("#formJoin").addEventListener("submit", e => {
  e.preventDefault();
  const code = normCode($("#jCode").value);
  if (!/^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(code)) { toast("Der Code hat 6 Zeichen, z. B. K7Q-4MX."); return; }
  enterRoom({ name: $("#jName").value, code, pw: $("#jPass").value, creating: false });
});

$("#qAdd").addEventListener("submit", e => { e.preventDefault(); addLink($("#qAddInput").value, $("#qAddInput")); });
$("#chatForm").addEventListener("submit", e => { e.preventDefault(); sendChat($("#chatInput").value); $("#chatInput").value = ""; });

$("#qList").addEventListener("click", e => {
  const btn = e.target.closest("button[data-act]"); if (!btn) return;
  const qid = btn.closest(".q-item").dataset.qid;
  const it = state.queue.find(q => q.qid === qid); if (!it) return;
  const act = btn.dataset.act, mine = (it.votes || {})[me.id] || 0;
  if (act === "pick") { if (pollSel.has(qid)) pollSel.delete(qid); else if (pollSel.size < 4) pollSel.add(qid); else toast("Höchstens 4 Videos."); renderPollBar(); renderQueue(); return; }
  if (act === "play") send({ k: "load", video: it, pos: it.start || 0, playing: true });
  if (act === "del") send({ k: "qdel", qid });
  if (act === "up") send({ k: "qvote", qid, v: mine === 1 ? 0 : 1 });
  if (act === "down") send({ k: "qvote", qid, v: mine === -1 ? 0 : -1 });
});
let drag = null;
$("#qList").addEventListener("pointerdown", e => {
  const h = e.target.closest(".drag"); if (!h || filter !== "all") return;
  const item = h.closest(".q-item");
  e.preventDefault();
  h.setPointerCapture(e.pointerId);
  drag = { item, qid: item.dataset.qid, startY: e.clientY, to: null };
  item.classList.add("dragging");
});
$("#qList").addEventListener("pointermove", e => {
  if (!drag) return;
  drag.item.style.transform = `translateY(${e.clientY - drag.startY}px)`;
  const items = $$(".q-item", $("#qList")).filter(x => x !== drag.item);
  let to = items.length;
  for (let i = 0; i < items.length; i++) { const r = items[i].getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { to = i; break; } }
  drag.to = to;
  items.forEach((x, i) => { x.classList.toggle("drop-before", i === to); x.classList.toggle("drop-after", to === items.length && i === items.length - 1); });
});
function endDrag() {
  if (!drag) return;
  const d = drag; drag = null;
  d.item.classList.remove("dragging"); d.item.style.transform = "";
  $$(".q-item").forEach(x => x.classList.remove("drop-before", "drop-after"));
  const from = state.queue.findIndex(q => q.qid === d.qid);
  if (d.to !== null && d.to !== from) send({ k: "qmove", qid: d.qid, to: d.to });
}
$("#qList").addEventListener("pointerup", endDrag);
$("#qList").addEventListener("pointercancel", endDrag);
$$(".fchip").forEach(b => b.onclick = () => {
  filter = b.dataset.f;
  $$(".fchip").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  renderQueue();
});
function selectRTab(which) {
  if (which === true) which = "chat"; if (which === false) which = "queue";
  chatActive = which === "chat"; statsActive = which === "stats";
  [["queue", "#rtQueue", "#paneQueue"], ["chat", "#rtChat", "#paneChat"], ["stats", "#rtStats", "#paneStats"]].forEach(([k, t, pn]) => {
    $(t).setAttribute("aria-selected", String(which === k)); $(pn).hidden = which !== k;
  });
  if (chatActive) { $("#unread").hidden = true; const b = $("#chatList"); b.scrollTop = b.scrollHeight; }
  if (statsActive) renderStats();
}
$("#rtStats").onclick = () => selectRTab("stats");
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
$("#gestureSkip").onclick = () => { $("#gesture").hidden = true; gestureNeeded = false; const n = sortedQueue()[0]; if (n) send({ k: "load", video: n, pos: n.start || 0, playing: true }); else send({ k: "pause", pos: expectedPos() }); };
$("#adHoldGo").onclick = () => send({ k: "adClear" });

$("#codeChip").onclick = () => copyInvite();
async function copyInvite() {
  const url = inviteUrl(true);
  try { await navigator.clipboard.writeText(url); }
  catch { const t = document.createElement("textarea"); t.value = url; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); } catch {} t.remove(); }
  toast("Einladungslink kopiert – jetzt einfach verschicken");
  const c = $("#codeChip"); c.classList.add("copied"); setTimeout(() => c.classList.remove("copied"), 1200);
}
$("#pwInLink").onchange = () => $("#inviteLink").value = inviteUrl($("#pwInLink").checked);
$("#inviteCopy").onclick = () => copy($("#inviteLink").value, $("#inviteCopy"));
$("#inviteClose").onclick = () => $("#inviteModal").hidden = true;
$("#inviteModal").addEventListener("click", e => { if (e.target.id === "inviteModal") $("#inviteModal").hidden = true; });
$("#leaveBtn").onclick = leaveRoom;
$("#extBtn").onclick = () => { $("#extModal").hidden = false; };
$("#extClose").onclick = () => { $("#extModal").hidden = true; };
$("#extModal").addEventListener("click", e => { if (e.target.id === "extModal") $("#extModal").hidden = true; });

async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); }
  const old = btn.textContent; btn.textContent = "Kopiert!"; setTimeout(() => btn.textContent = old, 1500);
}

document.addEventListener("keydown", e => {
  if (!room) { return; }
  if (hkCapture) {
    if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === "Escape") { hkCapture = false; renderHotkeyBtn(); return; }
    if (e.key === "Backspace" || e.key === "Delete") { store.set("sc_mic_hotkey", null); hkCapture = false; renderHotkeyBtn(); toast("Mikro-Hotkey entfernt"); return; }
    const hk = { code: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey };
    if (!hk.ctrl && !hk.alt && !hk.meta && ["Space", "KeyK", "KeyJ", "KeyL", "KeyF", "ArrowLeft", "ArrowRight"].includes(hk.code)) { toast("Diese Taste ist schon belegt (Play/Spulen/Vollbild)."); return; }
    store.set("sc_mic_hotkey", hk); hkCapture = false; renderHotkeyBtn(); toast("Mikro-Hotkey: " + hotkeyLabel(hk));
    return;
  }
  const hk = store.get("sc_mic_hotkey", null);
  if (hk && e.code === hk.code && e.ctrlKey === !!hk.ctrl && e.altKey === !!hk.alt && e.shiftKey === !!hk.shift && e.metaKey === !!hk.meta) {
    const t = (e.target.tagName || "").toLowerCase();
    const typing = t === "input" || t === "textarea" || e.target.isContentEditable;
    if (!typing || hk.ctrl || hk.alt || hk.meta) {
      e.preventDefault();
      if (!voice.on) toast("Du bist nicht im Sprachchat.");
      else { voiceToggleMute(); toast(voice.muted ? "Mikro aus" : "Mikro an", 1200); }
      return;
    }
  }
  if (e.key === "Escape") { $("#inviteModal").hidden = true; $("#settingsModal").hidden = true; $("#extModal").hidden = true; $("#meMenu").hidden = true; return; }
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
  const ro = store.get("sc_room_opts", { voice: true, cam: true });
  $("#cVoice").checked = ro.voice !== false; $("#cCam").checked = ro.cam !== false; $("#cCam").disabled = !$("#cVoice").checked;
  $("#cVoice").onchange = () => { $("#cCam").disabled = !$("#cVoice").checked; };
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
