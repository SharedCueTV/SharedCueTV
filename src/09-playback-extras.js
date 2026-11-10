// ---------------------------------------------------------------- Ladebalken
const bufInfo = new Map();   // personId → {v, end, at}
// Wie weit ist das aktuelle Video bei mir ab der aktuellen Stelle geladen (Sekunden)?
function loadedEnd() {
  if (!player || !player.ready || player.live || player.manual) return null;
  if (player.kind === "yt") { const f = player.p.getVideoLoadedFraction ? player.p.getVideoLoadedFraction() : 0; return f * player.duration(); }
  if (player.kind === "file" && player.el) {
    const el = player.el, b = el.buffered, t = el.currentTime;
    if (player.item && player.item.p2p && player.item.p2p.owner === me.id) return player.duration();   // liegt bei mir komplett
    for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 0.5 && b.end(i) >= t) return b.end(i);
    return t;
  }
  return null;
}
function groupLoaded() {
  const v = vkey(state.video), mine = loadedEnd();
  if (mine == null) return null;
  let end = mine, who = me.name;
  for (const p of people) {
    if (p.id === me.id) continue;
    const b = bufInfo.get(p.id);
    if (!b || b.v !== v || now() - b.at > 12000) continue;
    if (b.end < end) { end = b.end; who = p.name; }
  }
  return { end, who };
}
let bufSent = { v: "", end: -99, at: 0 };
setInterval(() => {
  if (!room || !synced || !state.video || people.length < 2) return;
  const e = loadedEnd(); if (e == null) return;
  const v = vkey(state.video);
  if (v === bufSent.v && Math.abs(e - bufSent.end) < 2 && now() - bufSent.at < 6000) return;
  bufSent = { v, end: e, at: now() };
  send({ k: "buf", v, end: +e.toFixed(1) });
}, 2000);
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
    toast("Qualität, Untertitel & Co.: einfach im YouTube-Player aufs Zahnrad klicken (Maus übers Video bewegen).", 5000);
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
