// SharedCueTV-Erweiterung – läuft auf Netflix, Disney+ und Prime Video.
// Beobachtet das <video>-Element, meldet Play/Pause/Spulen und wendet Befehle der anderen an.
(() => {
  const site = location.hostname.includes("netflix") ? "netflix" : location.hostname.includes("disneyplus") ? "disney" : "prime";
  const SITE_NAME = { netflix: "Netflix", disney: "Disney+", prime: "Prime Video" }[site];
  let port = null, st = { connected: false, leader: true, people: [] };
  let ignoreUntil = 0, hooked = new WeakSet();

  // Kennung des laufenden Titels, damit Befehle für eine andere Folge nicht stören
  function cid() {
    const p = location.pathname;
    if (site === "netflix") { const m = p.match(/\/watch\/(\d+)/); return m ? "nf:" + m[1] : ""; }
    if (site === "disney") { const m = p.match(/\/(?:video|play)\/([\w-]+)/); return m ? "dp:" + m[1] : ""; }
    const u = new URL(location.href); const g = u.searchParams.get("gti") || (p.match(/\/(?:detail|dp)\/([\w.-]+)/) || [])[1];
    return g ? "pv:" + g : "";
  }
  function video() {
    return [...document.querySelectorAll("video")]
      .filter(v => v.readyState > 0 && v.duration > 0)
      .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] || null;
  }
  function seekTo(v, pos) {
    if (site === "netflix") window.postMessage({ __sharedcue: "seek", pos }, "*");
    else v.currentTime = pos;
  }
  function connect() {
    try { port = chrome.runtime.connect({ name: "sharedcue" }); } catch { return; }
    port.onMessage.addListener(onBg);
    port.onDisconnect.addListener(() => { port = null; setTimeout(connect, 1500); });
  }
  const post = m => { try { port && port.postMessage(m); } catch {} };

  function report(a) {
    if (!st.connected || Date.now() < ignoreUntil) return;
    const v = video(); if (!v) return;
    post({ type: "local", a, pos: v.currentTime, playing: !v.paused, cid: cid(), site });
  }
  function hook(v) {
    if (hooked.has(v)) return;
    hooked.add(v);
    v.addEventListener("play", () => report("play"));
    v.addEventListener("pause", () => report("pause"));
    v.addEventListener("seeked", () => report("seek"));
  }
  setInterval(() => { const v = video(); if (v) hook(v); }, 1000);

  function apply(m) {
    const v = video();
    if (!v) { if (m.a !== "tick") toast(`${m.n || "Jemand"}: ${m.a === "pause" ? "Pause" : "Play"} – öffne denselben Titel auf ${SITE_NAME}`); return; }
    const mine = cid();
    if (m.cid && mine && m.cid !== mine) { if (m.a !== "tick") toast(`${m.n || "Jemand"} schaut gerade einen anderen Titel`); return; }
    const far = pos => Math.abs(v.currentTime - pos) > 1.5;
    if (m.a === "tick") {
      if (st.leader) return;
      if (m.playing && v.paused) { ignoreUntil = Date.now() + 1500; v.play().catch(() => {}); }
      if (far(m.pos + 0.3)) { ignoreUntil = Date.now() + 1500; seekTo(v, m.pos + 0.3); }
      return;
    }
    ignoreUntil = Date.now() + 1500;
    if (m.a === "play") { if (far(m.pos)) seekTo(v, m.pos); v.play().catch(() => toast("Bitte einmal ins Video klicken")); toast(`${m.n} hat abgespielt`); }
    else if (m.a === "pause") { v.pause(); if (far(m.pos)) seekTo(v, m.pos); toast(`${m.n} hat pausiert`); }
    else if (m.a === "seek") { seekTo(v, m.pos); toast(`${m.n} hat gespult`); }
    else if (m.a === "sync") { seekTo(v, m.pos); if (m.playing) v.play().catch(() => {}); else v.pause(); toast(`Mit ${m.n} synchronisiert`); }
  }
  function onBg(m) {
    if (m.type === "status") { st = m; badge(); }
    else if (m.type === "remote") apply(m);
    else if (m.type === "needState") { const v = video(); if (v) post({ type: "state", to: m.to, pos: v.currentTime, playing: !v.paused, cid: cid(), site }); }
  }
  // Der am längsten Verbundene gibt alle 4 s die Position vor
  setInterval(() => {
    if (!st.connected || !st.leader) return;
    const v = video(); if (!v || v.paused) return;
    post({ type: "tick", pos: v.currentTime, playing: true, cid: cid() });
  }, 4000);

  // --- kleine Einblendung unten links
  let box, toastT;
  function ensureBox() {
    if (box && document.contains(box)) return box;
    box = document.createElement("div");
    box.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:2147483647;font:600 13px/1.3 system-ui,sans-serif;color:#fff;display:flex;flex-direction:column;gap:6px;pointer-events:none";
    box.innerHTML = `<div data-t style="display:none;padding:8px 12px;border-radius:999px;background:rgba(10,14,24,.88)"></div><div data-b style="padding:6px 10px;border-radius:999px;background:linear-gradient(135deg,#06b6d4,#6366f1);align-self:flex-start"></div>`;
    (document.fullscreenElement || document.body).appendChild(box);
    return box;
  }
  function badge() {
    const b = ensureBox().querySelector("[data-b]");
    b.style.display = st.connected ? "" : "none";
    b.textContent = `SharedCueTV · ${st.people.length} verbunden`;
  }
  function toast(text) {
    const t = ensureBox().querySelector("[data-t]");
    t.textContent = text; t.style.display = "";
    clearTimeout(toastT); toastT = setTimeout(() => { t.style.display = "none"; }, 2500);
  }
  document.addEventListener("fullscreenchange", () => { if (box) { box.remove(); box = null; } badge(); });

  connect();
})();
