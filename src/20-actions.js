// ---------------------------------------------------------------- Actions
async function addLink(raw, inputEl) {
  const media = parseMedia(raw);
  if (!media) { toast("Unterstützt: YouTube, Twitch, TikTok und Instagram-Reels.", 3500); return; }
  if (media.src === "clip") { toast("Twitch-Clips lassen sich nicht synchron steuern. Nimm das ganze Video (twitch.tv/videos/…)."); return; }
  if (media.src === "ytpl") return addPlaylist(media.ref, inputEl);
  if (inputEl) { inputEl.disabled = true; }
  const item = await buildItem(media);
  if (inputEl) { inputEl.disabled = false; inputEl.focus(); }
  if (!item) { toast("TikTok-Kurzlink nicht lesbar. Öffne ihn einmal und kopiere die volle Adresse (tiktok.com/@…/video/…).", 5000); return; }
  if (inputEl) inputEl.value = "";
  if (!state.video) send({ k: "load", video: item, pos: item.start || 0, playing: true });
  else { send({ k: "qadd", item }); toast("Zur Warteschlange hinzugefügt"); }
}
// YouTube-Playlist: Video-IDs über einen unsichtbaren YouTube-Player holen (kein API-Schlüssel nötig)
async function resolvePlaylist(list) {
  await loadYT();
  return new Promise(res => {
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:fixed;left:-10000px;top:0;width:320px;height:180px;pointer-events:none";
    const el = document.createElement("div"); wrap.appendChild(el); document.body.appendChild(wrap);
    let done = false, p;
    const finish = ids => { if (done) return; done = true; try { p && p.destroy(); } catch {} wrap.remove(); res(ids || []); };
    p = new YT.Player(el, {
      width: 320, height: 180,
      playerVars: { listType: "playlist", list, autoplay: 0, mute: 1, controls: 0 },
      events: {
        onReady: () => {
          const poll = n => { const ids = p.getPlaylist && p.getPlaylist(); if (ids && ids.length) return finish(ids.slice(0, 100)); if (n > 30) return finish([]); setTimeout(() => poll(n + 1), 300); };
          poll(0);
        },
        onError: () => finish([])
      }
    });
    setTimeout(() => finish([]), 15000);
  });
}
async function addPlaylist(list, inputEl) {
  if (inputEl) inputEl.disabled = true;
  toast("Lade Playlist …");
  const ids = await resolvePlaylist(list);
  if (!ids.length) { if (inputEl) inputEl.disabled = false; toast("Playlist nicht lesbar (privat oder ein YouTube-Mix?).", 4000); return; }
  const items = new Array(ids.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(6, ids.length) }, async () => {
    while (i < ids.length) { const k = i++; items[k] = await buildItem({ src: "yt", ref: ids[k], start: 0 }); items[k].at = now() + k; }
  }));
  if (inputEl) { inputEl.disabled = false; inputEl.value = ""; inputEl.focus(); }
  let rest = items;
  if (!state.video) { send({ k: "load", video: items[0], pos: 0, playing: true }); rest = items.slice(1); }
  if (rest.length) send({ k: "qaddMany", items: rest });
  toast(`Playlist: ${items.length} Videos hinzugefügt`, 3000);
}
function sendChat(text) {
  text = text.trim().slice(0, 500);
  if (!text) return;
  send({ k: "chat", msg: { id: uid(8), by: me.id, name: me.name, color: me.color, text, ts: now() } });
}
let lastReact = 0;
function react(emoji) {
  if (now() - lastReact < 350) return;
  lastReact = now();
  send({ k: "react", emoji });
}
function buildReactBar() {
  $("#reactBar").innerHTML = EMOJIS.map(e => `<button type="button" data-e="${e}" aria-label="Reaktion ${e}">${e}</button>`).join("");
}
