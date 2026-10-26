// SharedCueTV – Service Worker für geteilte Dateien.
// Der Video-Player fragt ".../__p2p/<owner>/<fid>/<size>/<mime>" mit Byte-Bereichen an.
// Die Seite holt diese Bytes per WebRTC direkt vom PC des Teilenden – Originalqualität, normal spulbar.
const CHUNK = 4 * 1024 * 1024;   // max. 4 MB pro Anfrage → Spulen verschwendet wenig

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("message", e => { if (e.data === "claim") self.clients.claim(); });

self.addEventListener("fetch", e => {
  const m = new URL(e.request.url).pathname.match(/\/__p2p\/([^/]+)\/([^/]+)\/(\d+)\/([^/]+)$/);
  if (!m) return;
  e.respondWith(serve(e, m[1], m[2], +m[3], decodeURIComponent(m[4])));
});

async function serve(e, owner, fid, size, type) {
  let start = 0, end = size - 1;
  const r = /bytes=(\d*)-(\d*)/.exec(e.request.headers.get("range") || "");
  if (r) {
    if (r[1]) { start = +r[1]; if (r[2]) end = +r[2]; }
    else if (r[2]) start = Math.max(0, size - +r[2]);   // "bytes=-N" = letzte N Bytes
  }
  if (start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  end = Math.min(end, start + CHUNK - 1, size - 1);

  let client = e.clientId ? await self.clients.get(e.clientId) : null;
  if (!client) client = (await self.clients.matchAll({ type: "window" }))[0];
  if (!client) return new Response(null, { status: 503 });

  const ch = new MessageChannel();
  const body = new ReadableStream({
    start(ctrl) {
      ch.port1.onmessage = ev => {
        const d = ev.data;
        if (d === null) { try { ctrl.close(); } catch {} ch.port1.close(); }
        else if (d && d.err) { try { ctrl.error(new Error(d.err)); } catch {} ch.port1.close(); }
        else { try { ctrl.enqueue(new Uint8Array(d)); } catch {} }
      };
    },
    cancel() { try { ch.port1.postMessage("cancel"); ch.port1.close(); } catch {} }
  });
  client.postMessage({ p2p: 1, owner, fid, start, end }, [ch.port2]);
  return new Response(body, {
    status: 206,
    headers: {
      "Content-Type": type || "video/mp4",
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store"
    }
  });
}
