// Baut app.js aus den Dateien in src/ (in Dateinamen-Reihenfolge) und setzt den Cache-Buster in index.html.
//   node tools/build.mjs          → app.js + index.html aktualisieren
//   node tools/build.mjs --check  → nur prüfen, ob app.js/index.html aktuell sind (Exit-Code 1 wenn nicht)
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const src = join(root, "src");
const files = readdirSync(src).filter(f => /^\d\d-.*\.js$/.test(f)).sort();

let out = readFileSync(join(src, "_banner.txt"), "utf8");
out += "// AUTOMATISCH ERZEUGT aus src/*.js – nicht direkt bearbeiten, sondern src/ ändern und `npm run build` ausführen.\n";
out += '(() => {\n"use strict";\n';
for (const f of files) out += `\n// ======================================================== src/${f}\n` + readFileSync(join(src, f), "utf8");
out += "})();\n";

// Cache-Buster: Hash über app.js + styles.css + sw.js → ?v=<hash> in index.html
const css = readFileSync(join(root, "styles.css"), "utf8");
const ver = createHash("sha256").update(out).update(css).digest("hex").slice(0, 8);
const htmlPath = join(root, "index.html");
const html = readFileSync(htmlPath, "utf8");
const newHtml = html.replace(/\?v=[\w]+/g, "?v=" + ver);

if (check) {
  const ok = readFileSync(join(root, "app.js"), "utf8") === out && html === newHtml;
  if (!ok) { console.error("✗ app.js oder index.html ist nicht aktuell – bitte `npm run build` ausführen."); process.exit(1); }
  console.log("✓ Build ist aktuell (v=" + ver + ")");
} else {
  writeFileSync(join(root, "app.js"), out);
  writeFileSync(htmlPath, newHtml);
  console.log(`✓ app.js gebaut aus ${files.length} Dateien · Version ${ver}`);
}
