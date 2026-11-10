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
    this.started = false; this.ccDone = false; this.loadAt = this.cmdAt = now();
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
        playerVars: { autoplay: playing ? 1 : 0, controls: 1, disablekb: 0, cc_load_policy: 0, modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0, start: Math.floor(pos), origin: location.origin && location.origin !== "null" ? location.origin : undefined },
        events: {
          onReady: () => { this.ready = true; this.cb.volume(this); if (pos) this.p.seekTo(pos, true); if (playing) this.p.playVideo(); resolve(); },
          onStateChange: e => {
            if (e.data === 1) { this.started = true; if (!this.ccDone) { this.ccDone = true; this.captionsOff(); } }
            if (e.data === 0) this.cb.ended();
            this.cb.native && this.cb.native(this, e.data);
          },
          onPlaybackRateChange: e => { if (Math.abs(e.data - (this.setRateTo || 1)) > 0.01) this.cb.rate(e.data); },
          onError: e => this.cb.error(e.data === 101 || e.data === 150 ? "Dieses Video läuft nur direkt auf YouTube (Einbetten gesperrt oder Altersbeschränkung)." : e.data === 100 ? "Video nicht gefunden oder privat." : "YouTube-Fehler " + e.data)
        }
      });
    });
  }
  play() { if (!this.ready) return; this.cmdAt = now(); this.p.playVideo(); }
  pause() { if (!this.ready) return; this.cmdAt = now(); this.p.pauseVideo(); }
  seek(t) { if (!this.ready) return; this.cmdAt = now(); this.p.seekTo(t, true); }
  // Untertitel starten immer aus – wer sie will, schaltet sie im Player ein (gilt dann für dieses Video)
  captionsOff() { try { this.p.unloadModule("captions"); } catch {} try { this.p.unloadModule("cc"); } catch {} }
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
    el.playsInline = true; el.preload = "auto";
    this.item = item; this.retries = 0;
    if (item.p2p) {
      const src = await p2pSrc(item);
      if (src.err) { this.host.appendChild(wrap); this.ready = true; this.cb.error(src.err); return; }
      el.src = src.url;
    } else el.src = item.ref;
    wrap.appendChild(el); this.host.appendChild(wrap);
    el.addEventListener("ended", () => this.cb.ended());
    el.addEventListener("playing", () => {
      this.started = true; wrap.classList.add("playing");
      if (!this.audioChecked && item.kind !== "audio") { this.audioChecked = true; setTimeout(() => { if (this.el === el && !el.paused && el.webkitAudioDecodedByteCount === 0) toast("Hinweis: Den Ton dieser Datei kann der Browser nicht abspielen (oft AC3/DTS bei MKV). Mit HandBrake in AAC umwandeln.", 8000); }, 5000); }
    });
    el.addEventListener("pause", () => wrap.classList.remove("playing"));
    el.addEventListener("error", () => {
      if (item.p2p && item.p2p.owner !== me.id) {
        const here = people.some(x => x.id === item.p2p.owner);
        // Verbindung kurz weg → bis zu 3× neu laden, an der aktuellen Stelle weiter
        if (here && this.retries < 3) { this.retries++; const t = expectedPos(); setTimeout(() => { if (this.el !== el) return; el.src = el.src.split("#")[0] + "#r" + this.retries; el.load(); el.currentTime = t; if (state.pb.playing) el.play().catch(() => {}); }, 1500); return; }
        this.cb.error(here ? `Die Datei von ${item.byName || "?"} kommt nicht durch (Netzwerk blockiert die Direktverbindung).` : `${item.byName || "Der Teilende"} ist nicht mehr im Raum – Datei übersprungen.`);
        return;
      }
      this.cb.error(item.warn === "http" ? "Unsichere http-Links blockiert der Browser – nimm einen https-Link." : "Die Datei lässt sich nicht abspielen (Link prüfen).");
    });
    await new Promise(r => { el.addEventListener("loadedmetadata", r, { once: true }); setTimeout(r, item.p2p ? 20000 : 10000); });
    this.ready = true; this.cb.volume(this);
    if (pos > 0.5) el.currentTime = pos;
    if (playing) el.play().catch(() => {});
  }
  play() { this.el && this.el.play().catch(() => {}); }
  pause() { this.el && this.el.pause(); }
  seek(t) { if (this.el) this.el.currentTime = Math.max(0, t); }
  time() { return this.el ? this.el.currentTime || 0 : 0; }
  duration() { return this.el && isFinite(this.el.duration) ? this.el.duration : (this.item && this.item.dur) || 0; }
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
  waiting(txt) {
    if (!this.wrap || this.gotMedia && !txt) return;
    this.gotMedia = false; this.wrap.classList.add("live-wait");
    const s = this.wrap.querySelector(".live-note span:last-child"); if (s && txt) s.textContent = txt;
  }
  attach(stream) {
    if (!this.el || this.local) return;
    this.gotMedia = true;
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
