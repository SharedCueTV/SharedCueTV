// ---------------------------------------------------------------- Live teilen (Bildschirm / eigene Datei)
const bc = { active: false, stream: null, el: null, url: null, audioOnly: false, peers: new Map() };  // als Teilender
const viewerPeers = new Map();  // als Zuschauer: sharerId → pc
function liveSend(t, extra) { send({ k: "live", t, ...extra }); }
// Qualität beim Teilen (persönlich): Ziel-Höhe, Bitrate je Zuschauer, max. Bilder/s
const SHARE_Q = { "720": { h: 720, br: 3000000, fps: 30 }, auto: { h: 1080, br: 6000000, fps: 30 }, max: { h: 4320, br: 12000000, fps: 60 } };
const shareQ = () => SHARE_Q[store.get("sc_share_q", "auto")] || SHARE_Q.auto;
function applyShareQuality(pc) {
  const q = shareQ();
  for (const snd of pc.getSenders()) {
    if (!snd.track || snd.track.kind !== "video") continue;
    try {
      const pr = snd.getParameters();
      if (!pr.encodings || !pr.encodings.length) continue;
      const h = (bc.el && bc.el.videoHeight) || snd.track.getSettings().height || 1080;
      pr.encodings[0].maxBitrate = q.br;
      pr.encodings[0].maxFramerate = q.fps;
      pr.encodings[0].scaleResolutionDownBy = Math.max(1, h / q.h);
      pr.degradationPreference = "maintain-framerate";   // lieber kurz unschärfer als ruckeln
      snd.setParameters(pr).catch(() => {});
    } catch {}
  }
}
// H.264 bevorzugen: wird meist von der Grafikkarte kodiert → weniger CPU-Last, flüssiger
function preferH264(pc) {
  try {
    const caps = RTCRtpSender.getCapabilities && RTCRtpSender.getCapabilities("video");
    if (!caps) return;
    const codecs = [...caps.codecs].sort((a, b) => (/h264/i.test(b.mimeType) ? 1 : 0) - (/h264/i.test(a.mimeType) ? 1 : 0));
    for (const tr of pc.getTransceivers()) if (tr.sender && tr.sender.track && tr.sender.track.kind === "video" && tr.setCodecPreferences) tr.setCodecPreferences(codecs);
  } catch {}
}
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
  const isAudio = /^audio\//.test(file.type) || /\.(mp3|m4a|aac|ogg|oga|wav|flac|opus|weba)$/i.test(file.name);
  const el = document.createElement("video");
  el.playsInline = true; el.preload = "auto";
  const url = URL.createObjectURL(file);
  el.src = url;
  try { await new Promise((res, rej) => { el.onloadedmetadata = res; el.onerror = rej; setTimeout(rej, 15000); }); }
  catch { URL.revokeObjectURL(url); toast("Diese Datei kann dein Browser nicht abspielen. Am sichersten: MP4 (H.264 + AAC). Umwandeln geht z. B. mit HandBrake.", 7000); return; }
  if (!isAudio && !el.videoWidth) { URL.revokeObjectURL(url); toast("Das Bildformat dieser Datei kann dein Browser nicht abspielen (z. B. H.265/HEVC oder AVI). Mit HandBrake in MP4 (H.264) umwandeln.", 8000); return; }
  // Ton prüfen: MKVs haben oft AC3/DTS-Ton, den Browser nicht abspielen
  el.addEventListener("playing", () => setTimeout(() => {
    if (bc.el === el && !el.paused && el.webkitAudioDecodedByteCount === 0) toast("Hinweis: Den Ton dieser Datei kann dein Browser nicht abspielen (oft AC3/DTS bei MKV). Mit HandBrake in AAC umwandeln.", 8000);
  }, 4000), { once: true });
  const cap = el.captureStream || el.mozCaptureStream;
  if (!cap) { URL.revokeObjectURL(url); toast("Dein Browser kann Dateien nicht teilen – nimm Chrome oder Edge."); return; }
  const stream = cap.call(el);
  stream.getVideoTracks().forEach(t => { try { t.contentHint = "motion"; } catch {} });
  bc.el = el; bc.url = url; bc.audioOnly = isAudio;
  el.addEventListener("ended", () => { if (state.video && state.video.src === "live" && state.video.ref === me.id) playNext(vkey(state.video), true); });
  // neue Spuren (z. B. nach dem ersten Abspielen) an alle Zuschauer nachreichen
  stream.addEventListener("addtrack", e => { if (e.track.kind === "video") try { e.track.contentHint = "motion"; } catch {} for (const pc of bc.peers.values()) try { pc.addTrack(e.track, stream); preferH264(pc); } catch {} });
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
let liveTry = null;   // {sharer, sid, at, n, ok}
function liveWant(sharer, retry) {
  liveClose(sharer);
  const n = retry && liveTry && liveTry.sharer === sharer ? liveTry.n + 1 : 1;
  liveTry = { sharer, sid: uid(6), at: now(), n, ok: false };
  liveSend("want", { to: sharer, sid: liveTry.sid });
}
function liveClose(sharer) { const pc = viewerPeers.get(sharer); if (pc) { try { pc.close(); } catch {} viewerPeers.delete(sharer); } }
// Wächter: kommt kein Bild/Ton an oder bricht die Verbindung ab → automatisch neu verbinden
setInterval(() => {
  const p = player;
  if (!room || !p || p.kind !== "live" || p.local || !p.item || p.item.ref === me.id) return;
  const sharer = p.item.ref;
  if (!liveTry || liveTry.sharer !== sharer) { liveWant(sharer); return; }
  const pc = viewerPeers.get(sharer), cs = pc ? pc.connectionState : "new";
  if (cs === "connected" && p.gotMedia) { liveTry.ok = true; liveTry.badSince = 0; return; }
  if (liveTry.ok && (cs === "disconnected" || cs === "failed")) {
    liveTry.badSince = liveTry.badSince || now();
    if (cs === "failed" || now() - liveTry.badSince > 4000) { p.waiting(`Verbindung zu ${p.item.byName || "?"} unterbrochen – verbinde neu …`); liveWant(sharer, true); }
    return;
  }
  const wait = Math.min(6000 + liveTry.n * 2000, 15000);
  if (!liveTry.ok && now() - liveTry.at > wait) {
    const here = people.some(x => x.id === sharer);
    p.waiting(here ? `Verbinde mit dem Stream von ${p.item.byName || "?"} … (Versuch ${liveTry.n + 1})` : `${p.item.byName || "Der Teilende"} ist gerade nicht im Raum …`);
    liveWant(sharer, true);
  }
}, 1500);
async function liveSignal(op, local) {
  if (local || op.to !== me.id) return;
  const from = op.by;
  if (op.t === "want") {
    if (!bc.active || !bc.stream) return;
    const old = bc.peers.get(from); if (old) try { old.close(); } catch {}
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const sid = op.sid || "";
    pc._sid = sid;
    bc.peers.set(from, pc);
    bc.stream.getTracks().forEach(t => pc.addTrack(t, bc.stream));
    preferH264(pc);
    pc.onicecandidate = e => { if (e.candidate) liveSend("sig", { to: from, sid, cand: e.candidate.toJSON() }); };
    pc.onnegotiationneeded = async () => { try { await pc.setLocalDescription(); liveSend("sig", { to: from, sid, desc: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }); applyShareQuality(pc); } catch (e) { console.warn("live offer", e); } };
    pc.onconnectionstatechange = () => { if (pc.connectionState === "connected") applyShareQuality(pc); };
    return;
  }
  if (op.t === "sig") {
    // Antwort/Kandidaten an den Teilenden …
    if (bc.peers.has(from)) {
      const pc = bc.peers.get(from);
      if ((op.sid || "") !== pc._sid) return;   // veralteter Versuch
      // Kandidaten, die vor der Antwort eintreffen, puffern statt verwerfen (sonst klappt es oft erst beim 2. Versuch)
      try {
        if (op.desc) { await pc.setRemoteDescription(op.desc); for (const c of (pc._cands || []).splice(0)) await pc.addIceCandidate(c).catch(() => {}); }
        else if (op.cand) { if (pc.remoteDescription) await pc.addIceCandidate(op.cand); else (pc._cands = pc._cands || []).push(op.cand); }
      } catch (e) { console.warn("live sig", e); }
      return;
    }
    // … oder als Zuschauer vom Teilenden (nur Antworten auf den aktuellen Verbindungsversuch)
    if (op.sid && (!liveTry || liveTry.sharer !== from || liveTry.sid !== op.sid)) return;
    let pc = viewerPeers.get(from);
    if (!pc) {
      pc = new RTCPeerConnection({ iceServers: ICE });
      viewerPeers.set(from, pc); pc._cands = [];
      const ms = new MediaStream(), sid = op.sid;
      pc.ontrack = e => { ms.addTrack(e.track); if (player && player.kind === "live" && player.attach) player.attach(ms); };
      pc.onicecandidate = e => { if (e.candidate) liveSend("sig", { to: from, sid, cand: e.candidate.toJSON() }); };
    }
    try {
      if (op.desc) {
        await pc.setRemoteDescription(op.desc);
        for (const c of pc._cands.splice(0)) await pc.addIceCandidate(c).catch(() => {});
        if (op.desc.type === "offer") { await pc.setLocalDescription(); liveSend("sig", { to: from, sid: op.sid, desc: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }); }
      } else if (op.cand) {
        if (pc.remoteDescription) await pc.addIceCandidate(op.cand).catch(() => {}); else pc._cands.push(op.cand);
      }
    } catch (e) { console.warn("live view", e); }
  }
}
$("#screenBtn").onclick = () => { if (bc.active && bc.stream && !bc.el) endBroadcast(); else startScreen(); };
$("#fileBtn").onclick = () => $("#fileInput").click();
$("#fileInput").onchange = e => { const fs = [...(e.target.files || [])]; e.target.value = ""; if (!fs.length) return; if (P2P_OK) addFiles(fs); else startFile(fs[0]); };
if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) $("#screenBtn").hidden = true;
