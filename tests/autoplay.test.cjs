// Echte Autoplay-Regel: Ton erst nach einem Klick auf der Seite.
// Ziel: Wer in den Raum kommt, sieht das laufende Video einfach weiterlaufen – kein Fenster, kein Hinweis.
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
// Es gibt kein „Mitschauen“-Fenster und keinen Ton-Hinweis mehr
const noPopups = async () => {
  assert.equal(await B.locator("#gesture, #soundHint").count(), 0);
  assert.equal(await B.isVisible("#adHold"), false);
};

test("Normal beigetreten (Klick auf „Beitreten“): laufendes Video läuft einfach mit Ton", async () => {
  await addGeneratedVideos(A, [{ name: "Film", secs: 50, w: 640, h: 360 }]);
  await until(B, () => { const v = document.querySelector("#playerHost video"); return v && v.currentTime > 1; }, null, 80000);
  const v = await bVideo(), d = await diag(B);
  assert.equal(v.paused, false);
  assert.equal(v.muted, false);
  assert.equal(d.autoMuted, false);
  await noPopups();
});

test("Nach F5 ohne Klick: Video läuft weiter (stumm), ohne Fenster", async () => {
  await B.reload();
  // Nicht abfragen, solange der Player startet: Playwright-evaluate zählt sonst als Klick (Nutzer-Aktivierung)
  await B.waitForTimeout(9000);
  const v = await bVideo(), d = await diag(B);
  assert.ok(v && !v.paused && v.t > 0.5, "Video läuft nicht: " + JSON.stringify(v));
  assert.equal(v.muted, true);
  assert.equal(d.autoMuted, true);
  assert.equal(await B.textContent("#volIcon"), "volume_off");
  await noPopups();
});

test("Erster Tastendruck schaltet den Ton ein, Video läuft weiter", async () => {
  await B.keyboard.press("Shift");
  await until(B, () => !__sharedcue().autoMuted && !document.querySelector("#playerHost video").muted, null, 5000);
  await B.waitForTimeout(2000);
  assert.equal((await bVideo()).paused, false);
  assert.notEqual(await B.textContent("#volIcon"), "volume_off");
});

test("Nach F5: Klick auf den Lautsprecher-Knopf schaltet den Ton ein (nicht gleich wieder aus)", async () => {
  await B.reload();
  await B.waitForTimeout(9000);
  assert.equal((await diag(B)).autoMuted, true);
  await B.click("#muteBtn");
  await B.waitForTimeout(500);
  const v = await bVideo();
  assert.equal(v.muted, false);
  assert.notEqual(await B.evaluate(() => localStorage.getItem("sc_mute")), "true");
});

test("Selbst stumm geschaltet + F5: Video läuft, ohne Fenster", async () => {
  await B.evaluate(() => localStorage.setItem("sc_mute", "true"));
  await B.reload();
  await B.waitForTimeout(9000);
  const v = await bVideo();
  assert.ok(v && !v.paused && v.t > 0.5, "Video läuft nicht: " + JSON.stringify(v));
  await noPopups();
});

test("Keine JavaScript-Fehler auf den Seiten", () => { assert.deepEqual(env.errors, []); });
