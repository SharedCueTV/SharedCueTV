// ---------------------------------------------------------------- Verbindung halten
function requestRefresh() {
  if (!transport || !room || people.length < 2) return;
  refreshWanted = true;
  transport.send("hello", {});
  setTimeout(() => { refreshWanted = false; }, 4000);
}
function onStatus(s) {
  if (!room) return;
  if (s === "online") {
    setLive(true);
    clearTimeout(reconnectT);
    if (offlineSince) { offlineSince = 0; backoff = 0; setTimeout(requestRefresh, 800); }
  } else {
    setLive(false, "getrennt – verbinde neu …");
    if (!offlineSince) offlineSince = now();
    scheduleReconnect();
  }
}
function scheduleReconnect(delay) {
  clearTimeout(reconnectT);
  reconnectT = setTimeout(async () => {
    if (!room || !offlineSince || !transport) return;
    try { transport.leave(); await transport.connect(room.channel, me); }
    catch { backoff = Math.min(backoff + 1, 5); scheduleReconnect(); }
  }, delay ?? 6000 * (1 + backoff));
}
document.addEventListener("visibilitychange", () => {
  if (!room) return;
  if (document.hidden) { hiddenAt = now(); return; }
  if (offlineSince) scheduleReconnect(0);
  else if (hiddenAt && now() - hiddenAt > 20000) requestRefresh();
  hiddenAt = 0;
});
window.addEventListener("online", () => { if (room && offlineSince) scheduleReconnect(0); });
window.addEventListener("offline", () => { if (room) { setLive(false, "offline"); if (!offlineSince) offlineSince = now(); } });
