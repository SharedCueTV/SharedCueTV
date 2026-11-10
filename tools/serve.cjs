// Kleiner statischer Server für Entwicklung und Tests.
//   node tools/serve.cjs [port] [--local]
//   --local: liefert eine leere config.js aus → Testmodus (Sync nur zwischen Tabs desselben Browsers, kein Supabase)
const http = require("node:http"), fs = require("node:fs"), path = require("node:path");
const ROOT = path.join(__dirname, "..");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".webm": "video/webm", ".mp4": "video/mp4" };

function start(port = 8766, { local = false } = {}) {
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (local && u.endsWith("/config.js")) { res.writeHead(200, { "Content-Type": TYPES[".js"] }); return res.end("window.SHAREDCUE_CONFIG = {};\n"); }
    let file = path.normalize(path.join(ROOT, u));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end("not found"); }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(data);
    });
  });
  return new Promise(r => server.listen(port, "127.0.0.1", () => r(server)));
}
module.exports = { start };

if (require.main === module) {
  const port = +process.argv.find(a => /^\d+$/.test(a)) || 8766, local = process.argv.includes("--local");
  start(port, { local }).then(() => console.log(`SharedCueTV läuft auf http://localhost:${port}/` + (local ? "  (Testmodus ohne Supabase)" : "")));
}
