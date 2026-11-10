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
