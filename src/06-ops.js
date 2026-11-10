// ---------------------------------------------------------------- Ops
function send(op) {
  op.by = me.id; op.name = me.name;
  applyOp(op, true);
  transport && transport.send("op", op);
}
function applyOp(op, local) {
  const actor = local ? "Du" : (op.name || "Jemand");
  switch (op.k) {
    case "load": {
      if (op.prev && vkey(state.video) !== op.prev) return; // jemand war schneller
      if (op.video) {
        ST().videos++;
        if (op.video.qid && !state.queue.some(q => q.qid === op.video.qid) && !op.prev && op.video.by === op.by) bump("added", op.video.byName);
      }
      if (bc.active && !(op.video && op.video.src === "live" && op.video.ref === me.id)) stopBroadcast(true);
      state.video = op.video;
      setPb(op.playing !== false, op.pos || 0, 1);
      state.adWait = []; state.adHeld = false;
      gestureNeeded = false; { const g = $("#gesture"); if (g) g.hidden = true; }
      if (player) { player.inAd = false; player.inAdSent = false; player._lt = null; player._adHits = 0; player.loadAt = now(); }
      hideUpNext();
      if (op.video && op.video.qid) state.queue = state.queue.filter(q => q.qid !== op.video.qid);
      if (!local && op.video) actorToast(`${actor} startet: ${op.video.title}`);
      break;
    }
    case "play": state.adHeld = false; setPb(true, op.pos); if (!local) actorToast(`${actor} hat abgespielt`); flash("play_arrow"); break;
    case "pause": setPb(false, op.pos); if (!local) actorToast(`${actor} hat pausiert`); flash("pause"); break;
    case "seek": setPb(state.pb.playing, op.pos); if (!local) actorToast(`${actor} spult zu ${fmt(op.pos)}`); break;
    case "qadd":
      if (!state.queue.some(q => q.qid === op.item.qid)) { state.queue.push(op.item); bump("added", op.item.byName); }
      if (!local) showNotice(`${actor} hat „${op.item.title}“ zur Warteschlange hinzugefügt`);
      break;
    case "qdel": state.queue = state.queue.filter(q => q.qid !== op.qid); break;
    case "qaddMany":
      for (const it of op.items || []) if (!state.queue.some(q => q.qid === it.qid)) { state.queue.push(it); bump("added", it.byName); }
      if (!local) showNotice(`${actor} hat eine Playlist mit ${(op.items || []).length} Videos hinzugefügt`);
      break;
    case "rate":
      setPb(state.pb.playing, op.pos, clamp(+op.rate || 1, 0.25, 2));
      if (!local) actorToast(`${actor}: Geschwindigkeit ${fmtRate(RATE())}`);
      break;
    case "upnext":
      if (vkey(state.video) !== op.prev) return;
      showUpNext(op.video, op.secs || 5, op.prev);
      return;
    case "upnextCancel": hideUpNext(); if (!local) actorToast(`${actor} hat das nächste Video abgebrochen`); return;
    case "qvote": {
      const it = state.queue.find(q => q.qid === op.qid);
      if (it) {
        it.votes = it.votes || {};
        const before = it.votes[op.by] || 0;
        if (op.v) it.votes[op.by] = op.v; else delete it.votes[op.by];
        if (before !== 1 && op.v === 1) bump("upv", it.byName, 1);
        if (before === 1 && op.v !== 1) bump("upv", it.byName, -1);
        resortByVotes();
      }
      break;
    }
    case "qmove": {
      const from = state.queue.findIndex(q => q.qid === op.qid);
      if (from < 0) break;
      const [it] = state.queue.splice(from, 1);
      state.queue.splice(clamp(op.to | 0, 0, state.queue.length), 0, it);
      break;
    }
    case "ad": {
      // Jemand hat Werbung → Raum wartet an der aktuellen Stelle, bis alle durch sind
      state.adWait = (state.adWait || []).filter(x => x.id !== op.by);
      if (op.on) {
        state.adWait.push({ id: op.by, name: op.name });
        if (state.pb.playing && !state.adHeld) { setPb(false, op.pos); state.adHeld = true; adHeldSince = now(); }
      } else releaseAdHold();
      break;
    }
    case "adClear": state.adWait = []; releaseAdHold(true); break;
    case "chat":
      state.chat.push(op.msg);
      if (state.chat.length > CHAT_MAX) state.chat.splice(0, state.chat.length - CHAT_MAX);
      if (!local && !chatActive) $("#unread").hidden = false;
      break;
    case "react": spawnEmoji(op.emoji, local ? "" : op.name); bump("react", op.name); if (statsActive) renderStats(); return;
    case "poll":
      state.poll = { pid: op.pid, options: op.options, votes: {}, by: op.by, name: op.name, endsAt: now() + (op.secs || 30) * 1000 };
      if (!local) actorToast(`${actor} startet eine Abstimmung`);
      renderPoll(); return;
    case "pollVote":
      if (!state.poll || state.poll.pid !== op.pid) return;
      state.poll.votes[op.by] = op.idx | 0;
      renderPoll(); return;
    case "pollEnd": {
      if (!state.poll || state.poll.pid !== op.pid) return;
      const po = state.poll; state.poll = null; renderPoll();
      if (op.cancel) { toast("Abstimmung abgebrochen"); return; }
      const w = po.options[op.winner]; if (!w) return;
      toast(`Gewonnen: ${w.title}`, 3500);
      if (local) send({ k: "load", video: w, pos: w.start || 0, playing: true });
      return;
    }
    case "countdown": runCountdown(local ? "Du" : op.name); return;
    case "voice": voiceSignal(op, local); return;
    case "live": liveSignal(op, local); return;
    case "fx": fxSignal(op, local); return;
    case "buf": bufInfo.set(op.by, { v: op.v, end: +op.end || 0, at: now() }); return;
    case "title": state.title = String(op.title || "").slice(0, 48) || state.title; break;
    case "settings": state.settings = { voice: op.settings.voice !== false, cam: op.settings.voice !== false && op.settings.cam !== false, fsCams: FS_MODES[op.settings.fsCams] ? op.settings.fsCams : fsMode() }; renderFsCams(); if (!local) actorToast(`${actor} hat die Raum-Einstellungen geändert`); if (!roomAllows("cam") && voice.cam) camToggle(); break;
    case "qclear": state.queue = []; if (!local) actorToast(`${actor} hat die Warteschlange geleert`); break;
  }
  renderAll();
  syncPlayer(true);
}

function onMessage(t, d, from) {
  if (t === "op") { if (synced && validOp(d, from)) applyOp(d, false); return; }
  if (t === "hello") {
    // Der Leader (ohne den Neuen) schickt den Raumzustand
    const others = people.filter(p => p.id !== from);
    const l = [...others].sort((a, b) => (a.joinedAt - b.joinedAt) || (a.id < b.id ? -1 : 1))[0];
    if (synced && (!l || l.id === me.id)) {
      const snap = JSON.parse(JSON.stringify(state));
      if (snap.poll) snap.poll.leftMs = Math.max(0, state.poll.endsAt - now());
      snap.pb = { playing: state.pb.playing, pos: player && loadedKey === vkey(state.video) && isLeader() && !player.manual && !player.live ? player.time() : expectedPos(), at: 0, rate: RATE() };
      transport.send("snap", { to: from, state: snap });
    }
    if (voice.on) transport.send("op", { k: "voice", t: "here", by: me.id, name: me.name, muted: voice.muted });
    return;
  }
  if (t === "snap") {
    if (d.to !== me.id || (synced && !refreshWanted)) return;
    const clean = cleanSnapshot(d.state);
    if (!clean) return;
    const wasRefresh = synced && refreshWanted;
    synced = true; refreshWanted = false;
    state = clean;
    state.pb.at = now();
    if (state.poll) state.poll.endsAt = now() + (state.poll.leftMs || 0);
    mergeSavedStats();
    if (wasRefresh) actorToast("Wieder verbunden – Stand aktualisiert");
    if (!state.title) state.title = "Raum " + room.code;
    renderAll(); syncPlayer(true);
    return;
  }
  if (t === "tick") {
    if (!synced || from === me.id) return;
    if (vkey(state.video) !== d.v) return;
    setPb(d.playing, d.pos, d.rate || RATE());
    return;
  }
}
