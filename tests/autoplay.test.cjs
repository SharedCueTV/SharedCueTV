// Echte Autoplay-Regel: Ton erst nach einem Klick auf der Seite.
// Wer per F5 automatisch wieder im Raum landet, hat noch nicht geklickt → Video läuft stumm weiter, ohne „Mitschauen“.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { setup, createRoom, joinRoom, diag, until, addGeneratedVideos } = require("./helpers.cjs");

let env, A, B;
before(async () => {
  env = await setup(8775, { realAutoplay: true });
  ({ page: A } = await createRoom(env, "Felix"));
  B = await joinRoom(env, (await A.textContent("#codeLabel")).trim(), "Kevin");
});
after(async () => { await env.close(); });

const bVideo = () => B.evaluate(() => { const v = document.querySelector("#playerHost video"); return v ? { t: v.currentTime, paused: v.paused, muted: v.muted } : null; });

test("Normal beigetreten (Klick auf „Beitreten“): laufendes Video läuft einfach mit Ton", async () => {
  await addGeneratedVideos(A, [{ name: "Film", secs: 20, w: 640, h: 360 }]);
  await until(B, () => { const v = document.querySelector("#playerHost video"); return v && v.currentTime > 1; }, null, 40000);
  const v = await bVideo(), d = await diag(B);
  assert.equal(v.paused, false);
  assert.equal(v.muted, false);
  assert.equal(d.autoMuted, false);
  assert.equal(await B.isVisible("#soundHint"), false);
  assert.equal(await B.isVisible("#gesture"), false);
});

test("Nach F5 ohne Klick: Video läuft stumm weiter, kein „Mitschauen“", async () => {
  await B.reload();
  // Nicht abfragen, solange der Player startet: Playwright-evaluate zählt sonst als Klick (Nutzer-Aktivierung)
  await B.waitForTimeout(9000);
  const v = await bVideo(), d = await diag(B);
  assert.ok(v && !v.paused && v.t > 0.5, "Video läuft nicht: " + JSON.stringify(v));
  assert.equal(v.muted, true);
  assert.equal(d.autoMuted, true);
  assert.equal(d.gestureNeeded, false);
  assert.equal(await B.isVisible("#gesture"), false);
  assert.equal(await B.isVisible("#soundHint"), true);
});

test("Ein Klick auf den Hinweis schaltet den Ton ein, Video läuft weiter", async () => {
  await B.click("#soundHint");
  await until(B, () => !__sharedcue().autoMuted && !document.querySelector("#playerHost video").muted, null, 5000);
  await new Promise(r => setTimeout(r, 2000));
  const v = await bVideo();
  assert.equal(v.paused, false);
  assert.equal(await B.isVisible("#soundHint"), false);
  assert.equal(await B.isVisible("#gesture"), false);
});

test("Keine JavaScript-Fehler auf den Seiten", () => { assert.deepEqual(env.errors, []); });
