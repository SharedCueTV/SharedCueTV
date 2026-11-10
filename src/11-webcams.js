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
