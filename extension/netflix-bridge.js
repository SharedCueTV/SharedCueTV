// Läuft im Seitenkontext von Netflix. Netflix verträgt kein direktes Setzen von video.currentTime
// (Fehler M7375) – Spulen deshalb über Netflix' eigene Player-Schnittstelle.
(() => {
  window.addEventListener("message", e => {
    if (e.source !== window || !e.data || e.data.__sharedcue !== "seek") return;
    try {
      const vp = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
      const id = vp.getAllPlayerSessionIds()[0];
      vp.getVideoPlayerBySessionId(id).seek(Math.max(0, Math.round(e.data.pos * 1000)));
    } catch (err) {
      console.warn("[SharedCueTV] Netflix-Spulen fehlgeschlagen", err);
    }
  });
})();
