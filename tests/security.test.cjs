const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { setup, createRoom, joinRoom, diag, until, injectRaw } = require("./helpers.cjs");

let env, A, B, ch, aId;
before(async () => {
  env = await setup(8773);
  ({ page: A } = await createRoom(env, "Felix"));
  B = await joinRoom(env, (await A.textContent("#codeLabel")).trim(), "Kevin");
  ({ channel: ch, me: aId } = await diag(A));
});
after(async () => { await env.close(); });
const op = (from, d) => ({ t: "op", f: from, d: { by: from, name: "Böse", ...d } });

test("Gültige Op eines anderen Clients wird angewendet (Kontrolle)", async () => {
  await injectRaw(env, ch, [op("fremd1", { k: "title", title: "Kontrolle" })]);
  await until(B, () => __sharedcue().title === "Kontrolle");
});

test("Op, die sich als jemand anderes ausgibt, wird verworfen", async () => {
  await injectRaw(env, ch, [{ t: "op", f: "fremd2", d: { k: "title", title: "Gefälscht", by: aId, name: "Felix" } }]);
  await B.waitForTimeout(800);
  assert.equal((await diag(B)).title, "Kontrolle");
});

test("Ops mit falschen Typen werden verworfen", async () => {
  const pbBefore = (await diag(B)).pb;
  await injectRaw(env, ch, [
    op("fremd3", { k: "seek", pos: "abc" }),
    op("fremd3", { k: "rate", rate: 50 }),
    op("fremd3", { k: "qadd", item: { src: "evil", ref: "x" } }),
    op("fremd3", { k: "qadd", item: { src: "yt", ref: "abc", qid: "q1", title: "x", thumb: "javascript:alert(1)" } }),
    op("fremd3", { k: "unbekannt" }),
    op("fremd3", { k: "chat", msg: { text: "x".repeat(5000) } })
  ]);
  await B.waitForTimeout(800);
  const d = await diag(B);
  assert.equal(d.queue.length, 0);
  assert.equal(d.rate, 1);
  assert.equal(d.pb.pos, pbBefore.pos);
  assert.equal(d.chat.length, 0);
});

test("Spam wird gebremst (max. 40 Ops pro 5 s je Absender)", async () => {
  const msgs = Array.from({ length: 150 }, (_, i) => op("spammer", { k: "chat", msg: { id: "m" + i, text: "spam " + i } }));
  await injectRaw(env, ch, msgs);
  await B.waitForTimeout(1000);
  const n = (await diag(B)).chat.filter(t => t.startsWith("spam")).length;
  assert.ok(n > 0 && n <= 40, `${n} Nachrichten angekommen`);
});

test("Keine JavaScript-Fehler auf den Seiten", () => { assert.deepEqual(env.errors, []); });
