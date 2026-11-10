const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { setup, createRoom, joinRoom, diag, until } = require("./helpers.cjs");

let env, A, B;
before(async () => { env = await setup(8771); ({ page: A } = await createRoom(env, "Felix")); B = await joinRoom(env, (await A.textContent("#codeLabel")).trim(), "Kevin"); });
after(async () => { await env.close(); });

test("Raum erstellen und beitreten: beide sehen sich", async () => {
  await until(A, () => __sharedcue().people.length === 2);
  const a = await diag(A), b = await diag(B);
  assert.equal(a.channel, b.channel);
  assert.deepEqual([...a.people].sort(), ["Felix", "Kevin"]);
});

test("Chat kommt an, HTML im Text wird nicht ausgeführt", async () => {
  await A.click("#rtChat");
  await A.fill("#chatInput", 'Hallo <img src=x onerror="window.__pwned=1"> du');
  await A.press("#chatInput", "Enter");
  await until(B, () => __sharedcue().chat.some(t => t.includes("Hallo")));
  assert.equal(await B.evaluate(() => document.querySelectorAll("#chatList img[src='x'], #miniChat img[src='x']").length), 0);
  assert.equal(await B.evaluate(() => window.__pwned), undefined);
});

test("Raumname und Vollbild-Kameramodus gelten für alle", async () => {
  await A.click("#settingsBtn");
  await A.fill("#setName", "Filmabend");
  await A.selectOption("#setFs", "speaker");
  await A.click("#setSave");
  await until(B, () => __sharedcue().title === "Filmabend" && __sharedcue().settings.fsCams === "speaker");
});

test("Keine JavaScript-Fehler auf den Seiten", () => { assert.deepEqual(env.errors, []); });
