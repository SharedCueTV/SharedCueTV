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
  $("#setShareQ").value = store.get("sc_share_q", "auto");
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
  if ($("#setShareQ").value !== store.get("sc_share_q", "auto")) { store.set("sc_share_q", $("#setShareQ").value); for (const pc of bc.peers.values()) applyShareQuality(pc); }
  $("#settingsModal").hidden = true;
  toast("Gespeichert");
};
$("#qClear").onclick = () => { if (state.queue.length) send({ k: "qclear" }); };
$("#theaterBtn").onclick = () => {
  document.body.classList.toggle("theater");
  $("#theaterBtn").classList.toggle("live", document.body.classList.contains("theater"));
};
