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
