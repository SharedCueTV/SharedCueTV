// ---------------------------------------------------------------- Media links
function parseMedia(raw) {
  let s = String(raw || "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u; try { u = new URL(s); } catch { return null; }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  const ext = (u.pathname.match(/\.(mp4|m4v|webm|mkv|mov|ogv|mp3|m4a|aac|ogg|oga|wav|flac|opus)$/i) || [])[1];
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
