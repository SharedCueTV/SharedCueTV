// ---------------------------------------------------------------- Kameras im Vollbild
const FS_MODES = { rail: "Leiste rechts", pip: "Frei verschiebbar", speaker: "Nur wer spricht", off: "Keine Kameras" };
const fsMode = () => (state.settings && FS_MODES[state.settings.fsCams]) ? state.settings.fsCams : "rail";
const lastSpoke = new Map();
const fsActive = () => document.fullscreenElement === $(".stage");
let fsIdleT = null;
function renderFsCams() {
  const box = $("#fsCams"); if (!box) return;
  const mode = fsMode();
  if (box.dataset.mode !== mode) { box.innerHTML = ""; box.dataset.mode = mode; }
  box.className = "fs-cams mode-" + mode + (store.get("sc_fs_rail_closed", false) ? " closed" : "");
  if (!fsActive() || mode === "off") { box.innerHTML = ""; box.hidden = true; return; }
  const tiles = $$(".cam-tile", $("#camStrip"));
  box.hidden = !tiles.length;
  const have = new Set();
  tiles.forEach((t, i) => {
    const id = t.dataset.uid; have.add(id);
    let f = box.querySelector(`.fs-tile[data-uid="${CSS.escape(id)}"]`);
    if (!f) {
      f = document.createElement("div"); f.className = "fs-tile" + (t.classList.contains("self") ? " self" : ""); f.dataset.uid = id;
      f.innerHTML = `<video autoplay playsinline muted></video><span class="nm">${esc(t.querySelector(".nm").textContent)}</span>`;
      box.appendChild(f);
      if (mode === "pip") placePip(f, i);
    }
    const src = t.querySelector("video").srcObject, v = f.querySelector("video");
    if (v.srcObject !== src) { v.srcObject = src; v.play().catch(() => {}); }
  });
  $$(".fs-tile", box).forEach(f => { if (!have.has(f.dataset.uid)) f.remove(); });
  if (mode === "rail" && tiles.length && !box.querySelector(".fs-toggle")) {
    const b = document.createElement("button"); b.type = "button"; b.className = "fs-toggle"; b.title = "Kameras ein-/ausklappen"; b.setAttribute("aria-label", b.title);
    b.innerHTML = `<span class="ms">videocam</span>`;
    b.onclick = e => { e.stopPropagation(); store.set("sc_fs_rail_closed", !store.get("sc_fs_rail_closed", false)); renderFsCams(); };
    box.prepend(b);
  }
  updateFsSpeaking();
}
function updateFsSpeaking() {
  const box = $("#fsCams"); if (!box || box.hidden) return;
  const speakerMode = fsMode() === "speaker";
  $$(".fs-tile", box).forEach(f => {
    const id = f.dataset.uid, talking = voice.speaking.has(id);
    f.classList.toggle("speaking", talking);
    if (speakerMode) f.classList.toggle("show", talking || now() - (lastSpoke.get(id) || 0) < 2000);
  });
}
// B) frei verschiebbare Kacheln – Position wird pro Person gemerkt
function placePip(f, i) {
  const pos = store.get("sc_pip_" + f.dataset.uid, null);
  if (pos) { f.style.left = pos.x + "%"; f.style.top = pos.y + "%"; }
  else { f.style.right = "16px"; f.style.bottom = (90 + i * 180) + "px"; }
  f.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const box = $("#fsCams").getBoundingClientRect(), r = f.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    f.setPointerCapture(e.pointerId); f.classList.add("dragging");
    const move = ev => {
      const x = clamp(ev.clientX - box.left - dx, 0, box.width - r.width), y = clamp(ev.clientY - box.top - dy, 0, box.height - r.height);
      f.style.right = f.style.bottom = "auto"; f.style.left = (x / box.width * 100) + "%"; f.style.top = (y / box.height * 100) + "%";
    };
    const up = () => {
      f.releasePointerCapture(e.pointerId); f.classList.remove("dragging");
      f.removeEventListener("pointermove", move); f.removeEventListener("pointerup", up);
      if (f.style.left) store.set("sc_pip_" + f.dataset.uid, { x: parseFloat(f.style.left), y: parseFloat(f.style.top) });
    };
    f.addEventListener("pointermove", move); f.addEventListener("pointerup", up);
  });
}
document.addEventListener("fullscreenchange", () => { $("#fsCams").innerHTML = ""; renderFsCams(); poke(); });
// Leiste blendet sich nach 3 s ohne Maus halb aus
function poke() {
  const st = $(".stage"); st.classList.remove("idle");
  clearTimeout(fsIdleT); fsIdleT = setTimeout(() => { if (fsActive()) st.classList.add("idle"); }, 3000);
}
$(".stage").addEventListener("mousemove", poke);

// Link-Leiste exakt mittig: beide Seiten so breit wie die breitere Seite
(() => {
  const tb = $(".topbar"), l = $(".top-left"), r = $(".top-actions");
  if (!tb || !l || !r || !window.ResizeObserver) return;
  const fit = () => {
    const w = Math.ceil(Math.max(l.scrollWidth, r.scrollWidth)); if (!w) return;
    const cs = getComputedStyle(tb), free = tb.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 2 * parseFloat(cs.columnGap || 16) - 2 * w;
    tb.classList.toggle("tb-tight", free < 420);   // zu eng: Leiste nimmt den Rest, nicht ganz mittig
    tb.style.setProperty("--tb-side", w + "px");
  };
  const ro = new ResizeObserver(fit); [l, r, tb].forEach(e => ro.observe(e));
  for (const c of l.children) ro.observe(c);
})();
