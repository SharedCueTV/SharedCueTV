const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { setup, createRoom, joinRoom, until } = require("./helpers.cjs");

let env, A, B;
before(async () => { env = await setup(8774); ({ page: A } = await createRoom(env, "Felix")); B = await joinRoom(env, (await A.textContent("#codeLabel")).trim(), "Kevin"); });
after(async () => { await env.close(); });

test("Sprachchat beitreten und Kamera an → Kachel bei beiden", async () => {
  for (const P of [A, B]) { await P.click("#voiceCtl button[data-v=join]"); await P.waitForTimeout(800); }
  await A.click("#voiceCtl button[data-v=cam]");
  await until(B, () => document.querySelectorAll("#camStrip .cam-tile").length >= 1, null, 15000);
});

test("Mikro-Hotkey: festlegen und damit stummschalten", async () => {
  await A.click("#settingsBtn");
  await A.click("#setHotkey");
  await A.keyboard.press("Control+m");
  assert.match(await A.textContent("#setHotkey"), /Strg \+ M/);
  await A.click("#setSave");
  await A.keyboard.press("Control+m");
  await until(A, () => /Mikro aus/.test(document.querySelector("#toasts").textContent), null, 3000);
});

test("Keine JavaScript-Fehler auf den Seiten", () => { assert.deepEqual(env.errors, []); });
