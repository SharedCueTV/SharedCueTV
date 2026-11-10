// ---------------------------------------------------------------- Abstimmung
let pollSel = null; // Set der ausgewählten qids im Auswahlmodus
function pollWinner(po) {
  const c = po.options.map(() => 0);
  for (const i of Object.values(po.votes)) if (c[i] !== undefined) c[i]++;
  let best = 0; c.forEach((v, i) => { if (v > c[best]) best = i; });
  return { counts: c, best };
}
function endPoll(cancel) {
  const po = state.poll; if (!po) return;
  send({ k: "pollEnd", pid: po.pid, winner: pollWinner(po).best, cancel: !!cancel });
}
function updatePollTimer() {
  const el = $("#pollLeft"); if (!el || !state.poll) return;
  el.textContent = Math.max(0, Math.ceil((state.poll.endsAt - now()) / 1000));
}
function renderPoll() {
  const card = $("#pollCard"), po = state.poll;
  card.hidden = !po;
  if (!po) return;
  const { counts } = pollWinner(po), total = counts.reduce((a, b) => a + b, 0), mine = po.votes[me.id];
  card.innerHTML = `<div class="poll-head"><span class="ms">how_to_vote</span><b>Was schauen wir?</b><span class="muted">noch <span id="pollLeft">${Math.max(0, Math.ceil((po.endsAt - now()) / 1000))}</span> s · ${total} ${total === 1 ? "Stimme" : "Stimmen"}</span>
    ${po.by === me.id ? `<button class="btn btn-ghost" type="button" data-poll="end">Jetzt auswerten</button><button class="icon-btn" type="button" data-poll="cancel" aria-label="Abstimmung abbrechen"><span class="ms">close</span></button>` : ""}</div>
    <div class="poll-opts">${po.options.map((o, i) => {
      const pct = total ? Math.round(counts[i] / total * 100) : 0;
      const th = o.thumb ? `<img src="${esc(o.thumb)}" alt="">` : `<div class="tw-fill ${SRC_CLASS[o.src]}"><span class="ms">${SRC_ICON[o.src]}</span></div>`;
      return `<button type="button" class="poll-opt ${mine === i ? "mine" : ""}" data-idx="${i}" aria-pressed="${mine === i}">
        <span class="thumb">${th}</span><span class="po-body"><span class="po-title">${esc(o.title)}</span>
        <span class="po-bar"><span style="width:${pct}%"></span></span><span class="po-n">${counts[i]} · ${pct} %</span></span></button>`;
    }).join("")}</div>`;
}
$("#pollCard").addEventListener("click", e => {
  const b = e.target.closest("[data-poll]");
  if (b) { endPoll(b.dataset.poll === "cancel"); return; }
  const o = e.target.closest(".poll-opt"); if (!o || !state.poll) return;
  send({ k: "pollVote", pid: state.poll.pid, idx: +o.dataset.idx });
});
function renderPollBar() {
  const bar = $("#pollBar");
  if (!pollSel) { bar.innerHTML = `<button class="btn btn-ghost" type="button" id="pollStart"><span class="ms">how_to_vote</span>Abstimmen lassen</button>`; return; }
  const n = pollSel.size;
  bar.innerHTML = `<span class="label-sm" style="color:var(--primary)">${n} von 2–4 gewählt</span>
    <button class="btn btn-primary" type="button" id="pollGo" ${n < 2 ? "disabled" : ""}><span class="ms">how_to_vote</span>Starten (30 s)</button>
    <button class="btn btn-ghost" type="button" id="pollStop">Abbrechen</button>`;
}
$("#pollBar").addEventListener("click", e => {
  const id = (e.target.closest("button") || {}).id;
  if (id === "pollStart") {
    if (state.poll) { toast("Es läuft schon eine Abstimmung."); return; }
    if (state.queue.length < 2) { toast("Dafür braucht die Warteschlange mindestens 2 Videos."); return; }
    pollSel = new Set(); filter = "all"; $$(".fchip").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.f === "all")));
  } else if (id === "pollStop") pollSel = null;
  else if (id === "pollGo" && pollSel && pollSel.size >= 2) {
    const options = state.queue.filter(q => pollSel.has(q.qid)).slice(0, 4);
    pollSel = null;
    send({ k: "poll", pid: uid(8), options, secs: 30 });
  }
  renderPollBar(); renderQueue();
});

// ---------------------------------------------------------------- Statistik
let statsActive = false, lastStatsSave = 0;
function saveStats() {
  lastStatsSave = now();
  if (room && state.stats) store.set("sc_stats_" + room.code, state.stats);
}
function mergeSavedStats() {
  // Wenn der Raum leer war, bleibt die Statistik trotzdem erhalten (lokal im Browser gespeichert)
  const saved = room && store.get("sc_stats_" + room.code, null);
  if (!saved) return;
  const cur = ST();
  if ((saved.sec || 0) > (cur.sec || 0)) state.stats = { ...freshStats(), ...saved };
}
function topList(map, unit) {
  const rows = Object.entries(map || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!rows.length) return `<div class="muted" style="font-size:13px">Noch nichts.</div>`;
  const max = rows[0][1];
  return rows.map(([n, v], i) => `<div class="st-row"><span class="st-rank">${i === 0 ? "👑" : i + 1}</span><span class="st-name">${esc(n)}</span>
    <span class="st-bar"><span style="width:${Math.round(v / max * 100)}%"></span></span><span class="st-val">${v}${unit}</span></div>`).join("");
}
function renderStats() {
  const s = ST(), h = Math.floor(s.sec / 3600), m = Math.floor((s.sec % 3600) / 60);
  $("#statsBody").innerHTML = `
    <div class="st-big"><div><b>${h ? h + " h " : ""}${m} min</b><span>zusammen geschaut</span></div><div><b>${s.videos}</b><span>Videos gestartet</span></div></div>
    <h4>Meiste Videos eingereicht</h4>${topList(s.added, "")}
    <h4>Meiste Upvotes bekommen</h4>${topList(s.upv, " ▲")}
    <h4>Reaktions-Könige</h4>${topList(s.react, "")}
    <p class="muted" style="font-size:12px;margin:8px 0 0">Die Statistik gilt für diesen Raum (Code ${esc(room.code)}) und bleibt in euren Browsern gespeichert.</p>`;
}
