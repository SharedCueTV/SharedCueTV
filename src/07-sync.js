// ---------------------------------------------------------------- Player sync
const host = () => $("#playerHost");
const playerCb = {
  ended() { if (isLeader()) playNext(vkey(state.video), true); },
  rate(r) {
    // Geschwindigkeit wurde im YouTube-Menü geändert → für alle übernehmen
    if (!state.video || Math.abs(r - RATE()) < 0.01) return;
    send({ k: "rate", rate: r, pos: curPos() });
  },
  blocked() { if (state.pb.playing) handleBlocked(); },
  // Play/Pause direkt im YouTube-Player → für alle übernehmen
  native(p, st) {
    if (p !== player || !state.video || p.inAd || loadedKey !== vkey(state.video)) return;
    if (now() - p.cmdAt < 1200 || now() - (p.loadAt || 0) < 2500) return;   // war unser eigener Befehl
    if (!userInPlayer()) return;   // nur echte Bedienung im Player zählt (kein Pausieren durch Browser/Puffer)
    if (st === 2 && state.pb.playing) {
      const d = p.duration(), t = p.time();
      if (d && t >= d - 1) return;
      send({ k: "pause", pos: t });
    } else if (st === 1 && !state.pb.playing) {
      send({ k: "play", pos: p.time() });
    }
  },
  error(msg) {
    toast(msg, 4000);
    if (isLeader() && state.video) { const k = vkey(state.video); setTimeout(() => playNext(k), 3000); }
  },
  volume(p) {
    const v = store.get("sc_vol", 80), m = store.get("sc_mute", false);
    // Noch kein Klick auf der Seite (z. B. nach F5 automatisch wieder im Raum) → Browser blockiert Ton-Autoplay, also gleich stumm starten
    if (!m && !autoMuted && state.pb.playing && MUTE_OK[p.kind] && navigator.userActivation && !navigator.userActivation.hasBeenActive) setAutoMute(true, true);
    p.setVolume(v, m || autoMuted);
  }
};

// Blockiert der Browser den Ton (nur ohne Klick auf der Seite, z. B. nach F5), läuft das Video stumm weiter –
// ohne Fenster, ohne Hinweis. Der erste Klick/Tastendruck irgendwo schaltet den Ton wieder ein.
const MUTE_OK = { yt: 1, tw: 1, tt: 1, file: 1, live: 1 };
let autoMuted = false, autoMuteFails = 0, autoMutedAt = 0;
function setAutoMute(on, quiet) {
  autoMuted = on; autoMutedAt = now();
  if (!quiet) applyVol(); else applyVolIcon();
}
let autoUnmutedAt = 0;
function unmuteByUser() {
  if (!autoMuted || autoMuteFails > 1) return;
  autoUnmutedAt = now();   // der Klick auf den Lautsprecher-Knopf soll danach nicht gleich wieder stumm schalten
  setAutoMute(false);
  // Manche Browser (Safari) pausieren beim Ton-Einschalten ohne Klick im Player → dann wieder stumm
  setTimeout(() => {
    if (!autoMuted && player && player.ready && state.pb.playing && !player.inAd && !player.isPlaying() && !player.isBuffering()) {
      autoMuteFails++; setAutoMute(true); player.play();
    }
  }, 1500);
}
document.addEventListener("pointerdown", unmuteByUser, true);
document.addEventListener("keydown", unmuteByUser, true);

async function syncPlayer(force) {
  const v = state.video;
  $("#emptyStage").hidden = !!v;
  if (!v) {
    if (player) { player.destroy(); player = null; loadedKey = ""; }
    renderSource();
    return;
  }
  const key = vkey(v);
  if (key !== loadedKey) {
    loadedKey = key;
    const want = isTw(v.src) ? "tw" : v.src === "tt" ? "tt" : v.src === "ig" ? "ig" : v.src === "file" ? "file" : v.src === "live" ? "live" : "yt";
    if (player && (player.kind !== want || want === "live" || want === "file")) { player.destroy(); player = null; }
    if (!player) {
      const A = { yt: YTAdapter, tw: TwitchAdapter, tt: TikTokAdapter, ig: InstaAdapter, file: FileAdapter, live: LiveAdapter }[want];
      player = new A(host(), playerCb);
    }
    $(".screen").classList.toggle("portrait", want === "tt" || want === "ig");
    renderSource();
    try {
      await player.load(want === "yt" ? v.ref : v, expectedPos(), state.pb.playing);
    } catch (e) { toast("Player konnte nicht geladen werden."); return; }
    if (loadedKey !== key) return;
    lastPlayCmd = now();
    setTimeout(checkBlocked, 2500);
    return;
  }
  if (!player || !player.ready) return;
  if (force) enforce(true);
}

// YouTube-Werbung erkennen: Status "nicht gestartet" (-1), aber die Zeit läuft weiter
function detectAd() {
  if (!player || player.kind !== "yt" || !player.ready || !player.p.getPlayerState) return false;
  const st = player.p.getPlayerState(), t = player.time(), tNow = now();
  const dt = player._lat ? (tNow - player._lat) / 1000 : 0;
  // Zeit läuft ungefähr in Echtzeit weiter (kein Sprung durch eigenes Spulen)
  const advancing = player._lt != null && dt > 0 && t - player._lt > 0.4 * dt && t - player._lt < 2.5 * dt + 0.3;
  player._lt = t; player._lat = tNow;
  const recentSeek = tNow - lastCorrection < 2500 || tNow - (player.loadAt || 0) < 1500;
  if (st === 1 || st === 2 || st === 0 || st === 3) { player.inAd = false; player._adHits = 0; }
  else if (st === -1 && advancing && !recentSeek) { player._adHits = (player._adHits || 0) + 1; if (player._adHits >= 2) player.inAd = true; }
  else if (st === -1 && !advancing) player._adHits = 0;
  return !!player.inAd;
}
let adHeldSince = 0;
function releaseAdHold(force) {
  if (!state.adHeld) return;
  if (!force && (state.adWait || []).length) return;
  state.adHeld = false;
  setPb(true, state.pb.pos);
}
function reportAd() {
  if (!player || !state.video) return;
  detectAd();
  const on = !!player.inAd;
  if (on !== !!player.inAdSent) { player.inAdSent = on; send({ k: "ad", on, pos: expectedPos() }); }
}
function renderAdHold() {
  const el = $("#adHold"); if (!el) return;
  const w = (state.adWait || []).filter(x => x.id !== me.id);
  const show = !!state.adHeld && w.length > 0 && !(player && player.inAd);
  el.hidden = !show;
  if (show) $("#adHoldTxt").textContent = `Warte auf ${w.map(x => x.name).join(", ")} – Werbung läuft …`;
}
function enforce(fromOp) {
  if (!player || !player.ready || player.manual || !state.video || loadedKey !== vkey(state.video)) return;
  if (player.inAd) return;   // während Werbung nichts erzwingen – danach wird aufgeholt
  const want = state.pb.playing;
  if (want && !player.isPlaying() && !player.isBuffering()) { player.play(); lastPlayCmd = now(); setTimeout(checkBlocked, 2000); }
  if (!want && player.isPlaying()) player.pause();
  if (player.setRate && Math.abs(player.rate() - RATE()) > 0.01) player.setRate(RATE());
  if (player.live) return;
  if (player.kind === "file" && player.isBuffering() && !fromOp) return;
  const diff = player.time() - expectedPos();
  // Die Referenz gleicht nur kleine Abweichungen per Tick aus; große (z. B. nach Werbung) holt auch sie auf
  const leaderSelf = isLeader() && people.length > 1 && !fromOp && Math.abs(diff) < 4;
  if (Math.abs(diff) > (fromOp ? 0.6 : DRIFT_MAX) && !leaderSelf && (fromOp || now() - lastCorrection > 2500)) {
    player.seek(expectedPos());
    lastCorrection = now();
  }
}

function checkBlocked() {
  if (!player || !player.ready || player.manual || player.inAd || !state.pb.playing) return;
  detectAd(); if (player.inAd) return;
  if (player.kind === "tw" && !player.blocked && player.isBuffering()) return;
  if (player.isPlaying() || player.isBuffering()) { player._retried = 0; return; }
  // Wer schon auf der Seite geklickt hat (z. B. „Beitreten“), darf mit Ton abspielen – dann lädt der Player
  // nur langsam oder es läuft Werbung. Also weiter versuchen statt stumm schalten oder „Mitschauen“ zeigen.
  const clicked = !navigator.userActivation || navigator.userActivation.hasBeenActive;
  if ((player._retried || 0) < (clicked ? 5 : 1)) { player._retried = (player._retried || 0) + 1; player.play(); setTimeout(checkBlocked, 2000); return; }
  player._retried = 0;
  handleBlocked();
}

function playNext(prevKey, withCountdown) {
  const next = sortedQueue()[0];
  if (next && withCountdown) send({ k: "upnext", video: next, prev: prevKey, secs: 5 });
  else if (next) send({ k: "load", video: next, pos: next.start || 0, playing: true, prev: prevKey });
  else if (state.pb.playing) send({ k: "pause", pos: player ? player.time() : expectedPos() });
}

// Steuerung durch den Nutzer
// Aktuelle Position: echte Player-Zeit, außer sie hinkt dem Raumzustand hinterher (z. B. direkt nach dem Spulen)
function curPos() {
  const exp = expectedPos();
  if (!player || !player.ready || player.live || player.manual) return exp;
  const t = player.time();
  return Math.abs(t - exp) < 2 ? t : exp;
}
let lastCountdown = 0;
function userToggle() {
  if (!state.video) return;
  if (player && player.manual) {
    if (now() - lastCountdown < 5000) return;
    lastCountdown = now();
    send({ k: "countdown" });
    return;
  }
  const pos = curPos();
  send({ k: state.pb.playing ? "pause" : "play", pos });
}
function userSeek(t) {
  if (!state.video || (player && (player.live || player.manual))) return;
  const d = player ? player.duration() : 0;
  t = clamp(t, 0, d ? d - 0.5 : t);
  send({ k: "seek", pos: t });
}
// Abspielen blockiert → stumm schalten (erlaubt jeder Browser) und weiter versuchen. Kein Fenster.
function handleBlocked() {
  if (!player || !player.ready || player.manual) return;
  if (MUTE_OK[player.kind] && !autoMuted && !store.get("sc_mute", false)) setAutoMute(true);
  player.play(); lastPlayCmd = now();
}

// Hat der Nutzer gerade im YouTube-Player geklickt/getippt? (Fokus liegt dann im iframe)
function userInPlayer() { const a = document.activeElement; return !document.hidden && !!a && a.tagName === "IFRAME" && host().contains(a); }
// Spulen direkt in der YouTube-Zeitleiste erkennen: Zeit springt plötzlich weg, obwohl wir nichts gesteuert haben
setInterval(() => {
  const p = player;
  if (!room || !synced || !p || p.kind !== "yt" || !p.ready || p.inAd || !state.video || loadedKey !== vkey(state.video)) { if (p) p._sd = null; return; }
  const st = p.p.getPlayerState ? p.p.getPlayerState() : -1;
  if (st !== 1 && st !== 2 && st !== 3) { p._sd = null; return; }
  const diff = p.time() - expectedPos();
  const quiet = userInPlayer() && now() - p.cmdAt > 1500 && now() - lastCorrection > 1500 && now() - (p.loadAt || 0) > 3000;
  if (quiet && p._sd != null && Math.abs(p._sd) < 1.2 && Math.abs(diff) > 2.5) { p._sd = null; send({ k: "seek", pos: p.time() }); return; }
  p._sd = diff;
}, 400);

// Leader-Tick + Drift-Schleife
setInterval(() => {
  if (!room || !synced) return;
  reportAd();
  // „Mitschauen“ steht noch da, aber das Video läuft inzwischen (z. B. nach Werbung oder langsamem Laden) → Fenster weg
  // Ton direkt im YouTube-Player eingeschaltet → Hinweis weg
  if (autoMuted && player && player.ready && player.isMuted && now() - autoMutedAt > 3000 && !player.isMuted()) setAutoMute(false, true);
  enforce(false);
  updateDrift();
  renderAdHold();
  // Sicherung: nach 90 s Werbung geht es ohne den Wartenden weiter
  if (state.adHeld && isLeader() && now() - adHeldSince > 90000) send({ k: "adClear" });
  if (state.video && state.pb.playing && !state.adHeld) ST().sec++;
  if (state.poll) { updatePollTimer(); if (now() >= state.poll.endsAt && isLeader()) endPoll(false); }
  if (now() - lastStatsSave > 10000) saveStats();
  if (statsActive && now() % 5000 < 1000) renderStats();
}, 1000);
setInterval(() => {
  if (!room || !synced || !transport || !isLeader() || people.length < 2) return;
  if (!state.video || !player || !player.ready || player.manual || loadedKey !== vkey(state.video)) return;
  if (player.isBuffering() || player.inAd) return;
  if (!player.live && Math.abs(player.time() - expectedPos()) > 3) return; // eigener Player hängt hinterher → nicht als Referenz senden
  const pos = player.live ? 0 : player.time();
  setPb(state.pb.playing, pos);
  transport.send("tick", { v: vkey(state.video), pos, playing: state.pb.playing, rate: RATE() });
}, TICK_MS);
