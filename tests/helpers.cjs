// Gemeinsame Helfer für die Browser-Tests (Playwright + node:test).
// Läuft im Testmodus: leere config.js → Sync per BroadcastChannel zwischen Tabs desselben Browsers.
const { chromium } = require("playwright");
const { start } = require("../tools/serve.cjs");

async function setup(port) {
  const server = await start(port, { local: true });
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ["microphone", "camera"] });
  const errors = [];
  const base = `http://127.0.0.1:${port}/`;
  const newPage = async () => {
    const p = await ctx.newPage();
    p.on("pageerror", e => errors.push(e.message));
    return p;
  };
  return {
    base, ctx, errors, newPage,
    async close() { await browser.close(); await new Promise(r => server.close(r)); }
  };
}

async function createRoom(env, name = "Felix") {
  const page = await env.newPage();
  await page.goto(env.base);
  await page.fill("#cName", name);
  await page.click("#formCreate button[type=submit]");
  await page.waitForFunction(() => window.__sharedcue && __sharedcue().synced);
  const code = (await page.textContent("#codeLabel")).trim();
  return { page, code };
}

async function joinRoom(env, code, name = "Kevin") {
  const page = await env.newPage();
  await page.goto(env.base + "#/r/" + code);
  await page.fill("#jName", name);
  await page.click("#formJoin button[type=submit]");
  await page.waitForFunction(() => window.__sharedcue && __sharedcue().synced && __sharedcue().people.length >= 2, null, { timeout: 15000 });
  return page;
}

const diag = page => page.evaluate(() => __sharedcue());
const until = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 250 });

// Erzeugt im Browser ein kurzes Test-Video (Canvas → WebM) und wählt es im Datei-Feld aus.
async function addGeneratedVideos(page, specs) {
  await page.evaluate(async specs => {
    const files = [];
    for (const { name, secs, w, h } of specs) {
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const g = c.getContext("2d"), st = c.captureStream(30);
      const rec = new MediaRecorder(st, { mimeType: "video/webm;codecs=vp8", videoBitsPerSecond: 2e6 });
      const parts = []; rec.ondataavailable = e => parts.push(e.data);
      let f = 0; const iv = setInterval(() => { g.fillStyle = `hsl(${f * 5 % 360},70%,40%)`; g.fillRect(0, 0, w, h); g.fillStyle = "#fff"; g.font = "60px sans-serif"; g.fillText(name + " " + f++, 40, h / 2); }, 33);
      rec.start(250); await new Promise(r => setTimeout(r, secs * 1000)); rec.stop(); await new Promise(r => (rec.onstop = r)); clearInterval(iv);
      files.push(new File(parts, name + ".webm", { type: "video/webm" }));
    }
    const dt = new DataTransfer(); files.forEach(f => dt.items.add(f));
    const inp = document.querySelector("#fileInput"); inp.files = dt.files; inp.dispatchEvent(new Event("change"));
  }, specs);
}

// Schickt eine rohe Nachricht in den Raum-Kanal (wie ein manipulierter Client)
async function injectRaw(env, channel, messages) {
  const p = await env.newPage();
  await p.goto(env.base + "icon.svg");
  await p.evaluate(({ channel, messages }) => { const bc = new BroadcastChannel("sharedcue:" + channel); for (const m of messages) bc.postMessage(m); }, { channel, messages });
  await p.close();
}

module.exports = { setup, createRoom, joinRoom, diag, until, addGeneratedVideos, injectRaw };
