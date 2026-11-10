// ---------------------------------------------------------------- Eigene Dateien: Originaldatei direkt von PC zu PC
// Zuschauer laden die Originaldatei stückweise per WebRTC-Datenkanal vom Teilenden (über sw.js).
// Kein Neukodieren → volle Qualität, normal spulbar, landet wie Links in der Warteschlange.
const P2P_OK = "serviceWorker" in navigator && window.isSecureContext && !!window.RTCPeerConnection && !!window.ReadableStream;
const myFiles = new Map();     // fid → {file, url}
const fxOut = new Map();       // als Zuschauer: ownerId → {pc, dc, sid, cands, ready}
const fxIn = new Map();        // als Teilender: viewerId → {pc, dc, sid, cands, cancel}
const fxReqs = new Map();      // reqId → {port, got, len, owner}
let fxSeq = 1, swReg = null;
if (P2P_OK) {
  swReg = navigator.serviceWorker.register("sw.js", { scope: "./" }).then(r => navigator.serviceWorker.ready).catch(() => null);
  navigator.serviceWorker.addEventListener("message", fxFromSw);
  navigator.serviceWorker.startMessages && navigator.serviceWorker.startMessages();
}
const mimeFor = n => ({ mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska", mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", wav: "audio/wav", ogg: "audio/ogg", opus: "audio/ogg" })[(n.split(".").pop() || "").toLowerCase()] || "video/mp4";

async function p2pSrc(item) {
  const f = item.p2p;
  if (f.owner === me.id) { const m = myFiles.get(f.fid); return m ? { url: m.url } : { err: "Diese Datei ist nach dem Neuladen nicht mehr da – bitte neu hinzufügen." }; }
  if (!P2P_OK) return { err: "Dein Browser kann geteilte Dateien nicht abspielen – nimm Chrome, Edge oder Firefox." };
  await Promise.race([swReg, new Promise(r => setTimeout(r, 5000))]);
  if (!navigator.serviceWorker.controller) {
    try { (await navigator.serviceWorker.ready).active.postMessage("claim"); } catch {}
    await new Promise(r => { navigator.serviceWorker.addEventListener("controllerchange", r, { once: true }); setTimeout(r, 3000); });
  }
  if (!navigator.serviceWorker.controller) return { err: "Für geteilte Dateien die Seite bitte einmal normal neu laden (F5)." };
  const base = location.href.split("#")[0].split("?")[0].replace(/[^/]*$/, "");
  return { url: `${base}__p2p/${encodeURIComponent(f.owner)}/${encodeURIComponent(f.fid)}/${f.size}/${encodeURIComponent(f.mime || "video/mp4")}` };
}

async function addFiles(files) {
  let added = 0;
  const startsNow = !state.video;
  for (const file of files) {
    const isAudio = /^audio\//.test(file.type) || /\.(mp3|m4a|aac|ogg|oga|wav|flac|opus|weba)$/i.test(file.name);
    const url = URL.createObjectURL(file);
    const el = document.createElement("video"); el.preload = "metadata"; el.muted = true; el.src = url;
    const ok = await new Promise(res => { el.onloadedmetadata = () => res(true); el.onerror = () => res(false); setTimeout(() => res(false), 15000); });
    if (!ok) { URL.revokeObjectURL(url); toast(`„${file.name}“ kann dein Browser nicht abspielen. Am sichersten: MP4 (H.264 + AAC), z. B. mit HandBrake umwandeln.`, 7000); continue; }
    if (!isAudio && !el.videoWidth) { URL.revokeObjectURL(url); toast(`„${file.name}“: Bildformat wird nicht unterstützt (z. B. H.265/HEVC oder AVI). Mit HandBrake in MP4 (H.264) umwandeln.`, 8000); continue; }
    const dur = isFinite(el.duration) ? el.duration : 0;
    el.removeAttribute("src"); el.load();
    const fid = uid(10);
    myFiles.set(fid, { file, url });
    const item = { qid: uid(8), src: "file", ref: "p2p:" + fid, kind: isAudio ? "audio" : "video", title: file.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").slice(0, 120), dur, start: 0,
      p2p: { fid, owner: me.id, size: file.size, mime: file.type || mimeFor(file.name) }, by: me.id, byName: me.name, votes: {}, at: now() + added, thumb: "" };
    if (!state.video && !added) send({ k: "load", video: item, pos: 0, playing: true });
    else send({ k: "qadd", item });
    added++;
  }
  if (!added) return;
  const queued = startsNow ? added - 1 : added;
  toast((startsNow ? "Datei läuft" + (queued ? ` · ${queued} weitere in der Warteschlange` : "") : `${queued} Datei${queued > 1 ? "en" : ""} in der Warteschlange`) + " – Tab offen lassen, die anderen laden direkt von dir.", 5000);
}

// --- Signalisierung (über den Raum-Kanal)
function fxSend(t, extra) { send({ k: "fx", t, ...extra }); }
function fxWire(e, ownerSide, peer) {
  const dc = e.dc; dc.binaryType = "arraybuffer";
  dc.onmessage = ev => {
    if (typeof ev.data === "string") {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (ownerSide) { if (m.f) fxServe(e, m); else if (m.x != null) e.cancel.add(m.x); }
      else if (m.err) { const r = fxReqs.get(m.q); if (r) { r.port.postMessage({ err: m.err }); fxReqs.delete(m.q); } }
      return;
    }
    const q = new DataView(ev.data).getUint32(0), r = fxReqs.get(q);
    if (!r) return;
    const chunk = ev.data.slice(4); r.got += chunk.byteLength;
    r.port.postMessage(chunk, [chunk]);
    if (r.got >= r.len) { r.port.postMessage(null); fxReqs.delete(q); }
  };
  dc.onclose = () => {
    if (ownerSide) { fxIn.get(peer) === e && fxIn.delete(peer); return; }
    if (fxOut.get(peer) === e) fxOut.delete(peer);
    for (const [q, r] of fxReqs) if (r.owner === peer) { r.port.postMessage({ err: "closed" }); fxReqs.delete(q); }
  };
}
function fxConnect(owner) {
  const old = fxOut.get(owner);
  if (old && !["failed", "closed"].includes(old.pc.connectionState)) return old.ready;
  if (old) try { old.pc.close(); } catch {}
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const e = { pc, dc: pc.createDataChannel("files", { ordered: true }), sid: uid(6), cands: [] };
  fxOut.set(owner, e);
  fxWire(e, false, owner);
  e.ready = new Promise((res, rej) => {
    e.dc.onopen = () => res(e);
    setTimeout(() => { if (e.dc.readyState !== "open") { rej(new Error("timeout")); if (fxOut.get(owner) === e) { fxOut.delete(owner); try { pc.close(); } catch {} } } }, 15000);
  });
  e.ready.catch(() => {});
  pc.onicecandidate = ev => { if (ev.candidate) fxSend("sig", { to: owner, r: "v", sid: e.sid, cand: ev.candidate.toJSON() }); };
  pc.setLocalDescription().then(() => fxSend("sig", { to: owner, r: "v", sid: e.sid, desc: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } })).catch(() => {});
  return e.ready;
}
async function fxSignal(op, local) {
  if (local || op.to !== me.id) return;
  const from = op.by;
  try {
    if (op.r === "v") {                       // Nachricht eines Zuschauers an mich (Teilender)
      let e = fxIn.get(from);
      if (op.desc && op.desc.type === "offer") {
        if (e) try { e.pc.close(); } catch {}
        const pc = new RTCPeerConnection({ iceServers: ICE });
        e = { pc, sid: op.sid, cands: [], cancel: new Set() };
        fxIn.set(from, e);
        pc.ondatachannel = ev => { e.dc = ev.channel; fxWire(e, true, from); };
        pc.onicecandidate = ev => { if (ev.candidate) fxSend("sig", { to: from, r: "o", sid: op.sid, cand: ev.candidate.toJSON() }); };
        await pc.setRemoteDescription(op.desc);
        for (const c of e.cands.splice(0)) await pc.addIceCandidate(c).catch(() => {});
        await pc.setLocalDescription();
        fxSend("sig", { to: from, r: "o", sid: op.sid, desc: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
        return;
      }
      if (!e || e.sid !== op.sid) return;
      if (op.cand) { if (e.pc.remoteDescription) await e.pc.addIceCandidate(op.cand).catch(() => {}); else e.cands.push(op.cand); }
      return;
    }
    if (op.r === "o") {                       // Antwort des Teilenden an mich (Zuschauer)
      const e = fxOut.get(from);
      if (!e || e.sid !== op.sid) return;
      if (op.desc) { await e.pc.setRemoteDescription(op.desc); for (const c of e.cands.splice(0)) await e.pc.addIceCandidate(c).catch(() => {}); }
      else if (op.cand) { if (e.pc.remoteDescription) await e.pc.addIceCandidate(op.cand).catch(() => {}); else e.cands.push(op.cand); }
    }
  } catch (err) { console.warn("fx", err); }
}

// --- Teilender: angefragte Bytes aus der Datei lesen und senden
async function fxServe(e, m) {
  const f = myFiles.get(m.f);
  if (!f) { try { e.dc.send(JSON.stringify({ q: m.q, err: "gone" })); } catch {} return; }
  const PART = 64 * 1024 - 4, READ = 1024 * 1024;
  let pos = m.s; const end = Math.min(m.e, f.file.size - 1);
  while (pos <= end && !e.cancel.has(m.q) && e.dc.readyState === "open") {
    const buf = new Uint8Array(await f.file.slice(pos, Math.min(pos + READ, end + 1)).arrayBuffer());
    for (let o = 0; o < buf.length; o += PART) {
      if (e.cancel.has(m.q) || e.dc.readyState !== "open") break;
      if (e.dc.bufferedAmount > 8 * 1024 * 1024) await new Promise(r => { e.dc.bufferedAmountLowThreshold = 2 * 1024 * 1024; e.dc.addEventListener("bufferedamountlow", r, { once: true }); setTimeout(r, 5000); });
      const part = buf.subarray(o, o + PART), msg = new Uint8Array(4 + part.length);
      new DataView(msg.buffer).setUint32(0, m.q); msg.set(part, 4);
      try { e.dc.send(msg.buffer); } catch { return; }
    }
    pos += buf.length;
  }
  e.cancel.delete(m.q);
}

// --- Zuschauer: Anfrage des Service Workers → Bytes beim Teilenden holen
async function fxFromSw(ev) {
  const d = ev.data, port = ev.ports && ev.ports[0];
  if (!d || !d.p2p || !port) return;
  const q = fxSeq++;
  try {
    const e = await fxConnect(d.owner);
    fxReqs.set(q, { port, got: 0, len: d.end - d.start + 1, owner: d.owner });
    port.onmessage = m => { if (m.data === "cancel") { fxReqs.delete(q); try { e.dc.send(JSON.stringify({ x: q })); } catch {} } };
    e.dc.send(JSON.stringify({ q, f: d.fid, s: d.start, e: d.end }));
  } catch { port.postMessage({ err: "connect" }); }
}
