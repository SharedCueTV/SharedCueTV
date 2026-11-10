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
window.__sharedcue = () => ({ synced, leader: (leader() || {}).name, isLeader: isLeader(), people: people.map(p => p.name), video: vkey(state.video), loadedKey, pb: { ...state.pb }, expected: +expectedPos().toFixed(2), playerTime: player && player.ready ? +player.time().toFixed(2) : null, playing: player && player.ready ? player.isPlaying() : null, buffering: player && player.ready ? player.isBuffering() : null, ytState: player && player.p && player.p.getPlayerState ? player.p.getPlayerState() : null, gestureNeeded, lastCorrection: now() - lastCorrection, rate: RATE(),
  // für automatische Tests
  channel: room && room.channel, me: me.id, title: state.title, queue: state.queue.map(q => q.title), chat: state.chat.map(m => m.text), settings: { ...state.settings } });
