// ---------------------------------------------------------------- Rendering
function renderAll() {
  renderHead(); renderPeople(); renderQueue(); renderChat(); renderNow(); renderSource(); renderAdHold(); renderPoll(); renderPollBar(); renderStageTitle();
}
function avatarHTML(p, cls = "") {
  return `<span class="avatar ${cls}" data-uid="${esc(p.id)}" style="background:${esc(p.color || colorFor(p.id))}" title="${esc(p.name)}">${esc(initials(p.name))}</span>`;
}
function renderHead() {
  $("#roomTitle").textContent = state.title || "Raum";
  document.title = (state.title ? state.title + " · " : "") + "SharedCueTV";
  const n = people.length;
  $("#roomSub").textContent = `${n} ${n === 1 ? "Person" : "Personen"} im Raum · Code ${room.code}` + (room.pw ? " · mit Passwort" : "") + (!roomAllows("voice") ? " · ohne Sprachchat" : !roomAllows("cam") ? " · ohne Webcams" : "");
  $("#liveTxt").textContent = `${n} ${n === 1 ? "Person" : "Freunde"} synchron`;
  $("#codeLabel").textContent = room.code;
  $("#roomName").textContent = state.title || "Raum";
  const ma = $("#meAvatar"); ma.textContent = initials(me.name); ma.style.background = me.color;
  $("#meName").textContent = me.name;
  const url = inviteUrl(true);
  $("#codeChip").title = "Klicken: Einladungslink kopieren · " + url.replace(/^https?:\/\//, "");
  const hp = people.slice(0, 6).map(p => avatarHTML(p, p.id === me.id ? "me" : "")).join("");
  $("#headPeople").innerHTML = hp + (people.length > 6 ? `<span class="avatar" style="background:var(--c-highest)">+${people.length - 6}</span>` : "");
}
function renderPeople() {
  const l = leader();
  $("#peopleCount").textContent = people.length;
  const camIds = new Set($$(".cam-tile", $("#camStrip")).map(t => t.dataset.uid));
  $("#peopleList").innerHTML = people.filter(p => !camIds.has(p.id)).map(p => {
    const vm = voice.members.get(p.id);
    const mic = vm ? `<span class="rmic ${vm.muted ? "off" : ""}"><span class="ms">${vm.muted ? "mic_off" : "mic"}</span></span>` : "";
    const st = p.id === me.id ? "Du" : vm ? (vm.muted ? "Stumm" : "Im Sprachchat") : l && l.id === p.id ? "Sync-Referenz" : "Online";
    return `<li><button class="rchip" type="button" data-uid="${esc(p.id)}" title="${esc(p.name)} · ${esc(st)}${vm && p.id !== me.id ? " – Klick: Lautstärke" : ""}">
      ${avatarHTML(p, p.id === me.id ? "me" : "")}${mic}<span class="rname">${esc(p.id === me.id ? "Du" : p.name)}</span></button></li>`;
  }).join("");
  // Namen/Mikro auf den Kamera-Kacheln aktuell halten
  $$(".cam-tile", $("#camStrip")).forEach(t => {
    const vm = voice.members.get(t.dataset.uid), b = t.querySelector(".tmic");
    if (b) { b.className = "tmic" + (vm && vm.muted ? " off" : ""); b.innerHTML = `<span class="ms">${vm && vm.muted ? "mic_off" : "mic"}</span>`; }
  });
  renderVoice();
}
function renderSource() {
  const v = state.video, b = $("#srcBadge");
  if (!v) { b.hidden = true; $("#driftBadge").hidden = true; $("#seek").disabled = true; return; }
  b.hidden = false;
  b.className = "sbadge " + SRC_CLASS[v.src];
  b.innerHTML = `<span class="ms">${v.src === "yt" ? "smart_display" : SRC_ICON[v.src]}</span>${esc(v.src === "live" ? (v.kind === "file" ? "Datei geteilt" : "Bildschirm · LIVE") : srcLabel(v.src))}${v.src === "twl" ? " · LIVE" : ""}`;
  const noSeek = v.src === "twl" || v.src === "ig";
  $("#seek").disabled = noSeek;
  $("#back10").disabled = $("#fwd10").disabled = noSeek;
  $("#igHint").hidden = v.src !== "ig";
}
function renderNow() {
  const v = state.video;
  $("#nowCard").hidden = !v;
  if (!v) return;
  $("#nowTitle").textContent = v.title || "Video";
  const chips = [`<span class="chip">${esc(srcLabel(v.src))}</span>`];
  if (v.author) chips.push(`<span class="chip c2">${esc(v.author)}</span>`);
  if (v.byName) chips.push(`<span class="chip c2">eingereicht von ${esc(v.byName)}</span>`);
  $("#nowChips").innerHTML = chips.join("");
}
function renderQueue() {
  const all = sortedQueue();
  $("#qCount").textContent = all.length; $("#qCount2").textContent = all.length;
  $("#qClear").hidden = !all.length;
  const list = all.filter(q => filter === "all" || family(q.src) === filter);
  if (!list.length) {
    $("#qList").innerHTML = `<div class="q-empty"><span class="ms">queue_music</span><div>${all.length ? "Nichts in diesem Filter." : "Die Warteschlange ist leer.<br>Füge oben einen Link hinzu."}</div></div>`;
    return;
  }
  $("#qList").innerHTML = list.map(q => {
    const mine = (q.votes || {})[me.id] || 0, sc = score(q);
    const picked = pollSel && pollSel.has(q.qid);
    const fillIcon = { twl: "live_tv", twv: "videocam", tt: "music_note", ig: "photo_camera" }[q.src] || "videocam";
    const thumb = q.thumb ? `<img src="${esc(q.thumb)}" alt="" loading="lazy">` : `<div class="tw-fill ${SRC_CLASS[q.src]}"><span class="ms">${fillIcon}</span></div>`;
    return `<div class="q-item" data-qid="${esc(q.qid)}">
      ${pollSel ? `<button class="pick ${picked ? "on" : ""}" type="button" data-act="pick" aria-pressed="${!!picked}" aria-label="Für Abstimmung auswählen"><span class="ms">${picked ? "check_box" : "check_box_outline_blank"}</span></button>`
        : filter === "all" ? `<button class="drag" type="button" aria-label="Verschieben (ziehen)" title="Ziehen zum Verschieben"><span class="ms">drag_indicator</span></button>` : ""}
      <div class="thumb">${thumb}<span class="src ${SRC_CLASS[q.src]}"><span class="ms">${SRC_ICON[q.src]}</span></span></div>
      <div class="q-body">
        <div class="q-title">${esc(q.title)}</div>
        <div class="q-meta">${esc(srcLabel(q.src))} · von <b>${esc(q.byName || "?")}</b></div>
        <div class="q-actions">
          <button data-act="play" type="button"><span class="ms">play_arrow</span>Jetzt</button>
          <button data-act="del" type="button" aria-label="Entfernen"><span class="ms">delete</span></button>
        </div>
      </div>
      <div class="votes">
        <button type="button" data-act="up" class="${mine === 1 ? "on" : ""}" aria-label="Hochvoten" aria-pressed="${mine === 1}"><span class="ms ${mine === 1 ? "fill" : ""}">arrow_upward</span></button>
        <span class="score">${sc}</span>
        <button type="button" data-act="down" class="${mine === -1 ? "on down" : ""}" aria-label="Runtervoten" aria-pressed="${mine === -1}"><span class="ms ${mine === -1 ? "fill" : ""}">arrow_downward</span></button>
      </div></div>`;
  }).join("");
}
function renderChat() {
  const box = $("#chatList");
  $("#chatCount").textContent = state.chat.length;
  renderMiniChat();
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  const all = [...state.chat.map(m => ({ ...m, kind: "msg" })), ...sysMsgs.map(m => ({ ...m, kind: "sys" }))].sort((a, b) => a.ts - b.ts);
  box.innerHTML = all.length ? all.map(m => m.kind === "sys"
    ? `<div class="chat-sys">${esc(m.text)}</div>`
    : `<div class="chat-msg">${avatarHTML({ id: m.by, name: m.name, color: m.color })}<div class="bubble"><div><span class="nm">${esc(m.name)}</span><span class="ts">${hhmm(m.ts)}</span></div><div class="tx">${linkTimes(esc(m.text))}</div></div></div>`
  ).join("") : `<div class="q-empty"><span class="ms">forum</span><div>Noch keine Nachrichten.</div></div>`;
  if (atBottom) box.scrollTop = box.scrollHeight;
}
// "bei 2:31" im Chat → klickbarer Sprung für alle
function linkTimes(html) {
  if (!state.video || state.video.src === "twl" || state.video.src === "ig") return html;
  const dur = player && player.ready ? player.duration() : 0;
  return html.replace(/(^|[^\d:])(\d{1,2}):([0-5]\d)(?::([0-5]\d))?(?![\d:])/g, (m, pre, a, b, c) => {
    const secs = c !== undefined ? (+a) * 3600 + (+b) * 60 + (+c) : (+a) * 60 + (+b);
    if (dur && secs > dur + 1) return m;
    return `${pre}<button type="button" class="ts-link" data-t="${secs}" title="Für alle dorthin springen">${m.slice(pre.length)}</button>`;
  });
}
function sys(text) { sysMsgs.push({ text, ts: now() }); if (sysMsgs.length > 40) sysMsgs.shift(); renderChat(); }

let noticeT;
function showNotice(text) {
  $("#qNoticeTxt").textContent = text; $("#qNotice").hidden = false;
  clearTimeout(noticeT); noticeT = setTimeout(() => $("#qNotice").hidden = true, 5000);
}
let actorT;
function actorToast(text) {
  const el = $("#actorToast"); el.textContent = text; el.classList.add("show");
  clearTimeout(actorT); actorT = setTimeout(() => el.classList.remove("show"), 2200);
}
let flashT;
function flash(icon) {
  $("#centerIcon").textContent = icon; $("#centerFlash").classList.add("show");
  clearTimeout(flashT); flashT = setTimeout(() => $("#centerFlash").classList.remove("show"), 600);
}
function spawnEmoji(emoji, name) {
  if (!EMOJIS.includes(emoji)) return;
  const el = document.createElement("span");
  el.className = "float-emoji";
  el.style.left = (55 + Math.random() * 38) + "%";
  el.innerHTML = esc(emoji) + (name ? `<small>${esc(name)}</small>` : "");
  $("#reactLayer").appendChild(el);
  setTimeout(() => el.remove(), 2700);
}
let cdTimer = null;
function runCountdown(who) {
  const el = $("#countdown");
  clearInterval(cdTimer);
  let n = 3;
  el.hidden = false;
  el.innerHTML = `<div class="cd-num">${n}</div><div class="cd-txt">${esc(who)} startet den Countdown</div>`;
  cdTimer = setInterval(() => {
    n--;
    if (n > 0) { el.querySelector(".cd-num").textContent = n; return; }
    clearInterval(cdTimer);
    el.innerHTML = `<div class="cd-num go">LOS!</div><div class="cd-txt">Jetzt auf Play drücken</div>`;
    setTimeout(() => { el.hidden = true; }, 1800);
  }, 1000);
}
function updateDrift() {
  const b = $("#driftBadge"), info = $("#syncInfo"), badge = $("#syncBadge");
  if (!state.video || !player || !player.ready) { b.hidden = true; info.textContent = state.video ? "Player lädt …" : "Warte auf Video …"; return; }
  b.hidden = false;
  if (player.inAd) { $("#driftTxt").textContent = "WERBUNG"; info.textContent = "YouTube zeigt dir gerade Werbung. Danach springst du automatisch zu den anderen."; badge.textContent = "WERBUNG"; badge.className = "pill badge-warn"; return; }
  if (player.manual) { $("#driftTxt").textContent = "COUNTDOWN"; info.textContent = "Instagram erlaubt keine Fernsteuerung. Drückt Play gemeinsam nach dem Countdown."; badge.textContent = "MANUELL"; badge.className = "pill badge-sync"; return; }
  if (player.live) { $("#driftTxt").textContent = "LIVE"; info.textContent = "Livestream: Play und Pause werden geteilt. Spulen ist bei Live nicht möglich."; badge.textContent = "SYNCHRON"; badge.className = "pill badge-sync"; return; }
  const d = Math.abs(player.time() - expectedPos());
  const leaderSelf = isLeader() && people.length > 1;
  if (leaderSelf) { $("#driftTxt").textContent = "REFERENZ"; info.textContent = "Dein Player ist die Referenz, die anderen gleichen sich an dich an."; }
  else { $("#driftTxt").textContent = `SYNC ${d.toFixed(1)}s`; info.textContent = d < 0.5 ? "Perfekt synchron." : d < DRIFT_MAX ? `Abweichung ${d.toFixed(1)} s – im grünen Bereich.` : `Abweichung ${d.toFixed(1)} s – hole auf …`; }
  const ok = leaderSelf || d < DRIFT_MAX;
  badge.textContent = ok ? "SYNCHRON" : "HOLT AUF";
  badge.className = "pill " + (ok ? "badge-sync" : "badge-warn");
}

// Controls-Anzeige
setInterval(() => {
  if (!room) return;
  const playing = state.pb.playing;
  const manual = !!(player && player.manual);
  $("#playIcon").textContent = manual ? "timer" : playing ? "pause" : "play_arrow";
  $("#rateBtn").textContent = fmtRate(RATE());
  const sharingScreen = bc.active && bc.stream && !bc.el;
  { const sb = $("#screenBtn"), want = sharingScreen ? "stop_screen_share" : "screen_share";
    if (sb.dataset.st !== want) { sb.dataset.st = want; sb.innerHTML = `<span class="ms">${want}</span>`; sb.title = sharingScreen ? "Teilen beenden" : "Bildschirm teilen"; sb.setAttribute("aria-label", sb.title); } }
  $("#screenBtn").classList.toggle("danger-btn", !!sharingScreen);
  $("#rateBtn").hidden = !(player && player.setRate);
  $("#playBtn").setAttribute("aria-label", manual ? "Countdown für alle starten" : playing ? "Pausieren" : "Abspielen");
  // Klick-Schutz erst aktiv, wenn der Player einmal lief: so bleiben Altersabfragen
  // ("Start Watching" bei Twitch) und Einwilligungen im Player anklickbar
  const shieldOn = !!(player && player.ready && player.started && !manual && player.kind !== "yt") && now() > shieldPauseUntil;
  $("#shield").style.pointerEvents = shieldOn ? "auto" : "none";
  if (!player || !player.ready || !state.video) { $("#timeTxt").textContent = "0:00 / 0:00"; setRange($("#seek"), 0); return; }
  if (manual) { $("#timeTxt").textContent = "Instagram · per Countdown"; setRange($("#seek"), 0); return; }
  if (player.live) { $("#timeTxt").textContent = "● LIVE"; setRange($("#seek"), 1000); return; }
  const d = player.duration(), t = player.time();
  if (!seeking) { setRange($("#seek"), d ? (t / d) * 1000 : 0); $("#timeTxt").textContent = `${fmt(t)} / ${fmt(d)}`; }
  // zweiter Balken: so weit ist das Video bei ALLEN geladen (der Langsamste zählt)
  const g = d ? groupLoaded() : null, sk = $("#seek");
  if (g) {
    sk.style.setProperty("--b", clamp(g.end / d * 100, 0, 100) + "%");
    sk.parentElement.title = g.end >= d - 1 ? "Komplett geladen – läuft ohne Stocken" : `Für alle geladen bis ${fmt(g.end)}` + (g.who && g.who !== me.name ? ` (am langsamsten: ${g.who})` : "");
  } else { sk.style.setProperty("--b", "0%"); sk.parentElement.title = ""; }
}, 250);
