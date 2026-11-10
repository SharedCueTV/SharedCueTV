const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { setup, createRoom, joinRoom, diag, until, addGeneratedVideos } = require("./helpers.cjs");

let env, A, B;
before(async () => { env = await setup(8772); ({ page: A } = await createRoom(env, "Felix")); B = await joinRoom(env, (await A.textContent("#codeLabel")).trim(), "Kevin"); });
after(async () => { await env.close(); });

const bVideo = () => B.evaluate(() => { const v = document.querySelector("#playerHost video"); return v ? { src: v.src, w: v.videoWidth, t: v.currentTime } : null; });

test("Eigene Dateien: erste läuft sofort, zweite kommt in die Warteschlange", async () => {
  await addGeneratedVideos(A, [{ name: "Erster", secs: 12, w: 1280, h: 720 }, { name: "Zweiter", secs: 6, w: 640, h: 360 }]);
  await until(A, () => __sharedcue().video.startsWith("file:p2p:") && __sharedcue().queue.length === 1, null, 40000);
  assert.deepEqual((await diag(B)).queue, ["Zweiter"]);
});

test("Zuschauer bekommt die Originaldatei per P2P in voller Auflösung, synchron", async () => {
  await until(B, () => { const v = document.querySelector("#playerHost video"); return v && v.videoWidth > 0 && v.currentTime > 1; }, null, 20000);
  const v = await bVideo();
  assert.match(v.src, /__p2p\//);
  assert.equal(v.w, 1280);
  const d = await diag(B);
  assert.ok(Math.abs(d.playerTime - d.expected) < 1.5, `Abweichung ${d.playerTime} vs ${d.expected}`);
});

test("Spulen beim Teilenden gilt auch beim Zuschauer", async () => {
  await A.evaluate(() => { const s = document.querySelector("#seek"); s.value = String(Math.round(8 / 12 * 1000)); s.dispatchEvent(new Event("input", { bubbles: true })); s.dispatchEvent(new Event("change", { bubbles: true })); });
  await until(B, () => { const v = document.querySelector("#playerHost video"); return v && v.currentTime > 7; }, null, 10000);
});

test("Ladebalken zeigt, wie weit bei allen geladen ist", async () => {
  await until(B, () => parseFloat(document.querySelector("#seek").style.getPropertyValue("--b")) > 0, null, 10000);
});

test("Überspringen spielt die nächste Datei aus der Warteschlange", async () => {
  const before = (await diag(B)).video;
  await A.click("#skipBtn");
  await until(B, prev => __sharedcue().video !== prev && __sharedcue().video.startsWith("file:p2p:"), before, 10000);
  await until(B, () => { const v = document.querySelector("#playerHost video"); return v && v.videoWidth === 640; }, null, 20000);
});

test("Keine JavaScript-Fehler auf den Seiten", () => { assert.deepEqual(env.errors, []); });
