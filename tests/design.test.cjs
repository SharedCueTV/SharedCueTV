// Oberfläche „Eintrittskarte“: Startseite selbsterklärend, Handy-Ansicht mit Player oben.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { setup, createRoom } = require("./helpers.cjs");

let env;
before(async () => { env = await setup(8776); });
after(async () => { await env.close(); });

test("Startseite: Erstellen ist die Hauptaktion, Beitreten per Umschalter", async () => {
  const p = await env.newPage();
  await p.goto(env.base);
  assert.equal(await p.isVisible("#formCreate"), true);
  assert.equal(await p.isVisible("#formJoin"), false);
  // Es wird immer nur die jeweils andere Möglichkeit angeboten
  assert.equal(await p.isVisible("#tabCreate"), false);
  assert.equal(await p.isVisible("#tabJoin"), true);
  await p.click("#tabJoin");
  assert.equal(await p.isVisible("#formJoin"), true);
  assert.equal(await p.isVisible("#formCreate"), false);
  assert.equal(await p.isVisible("#tabCreate"), true);
  assert.equal(await p.isVisible("#tabJoin"), false);
  await p.click("#tabCreate");
  assert.equal(await p.isVisible("#formCreate"), true);
  await p.close();
});

test("Einladungslink öffnet direkt das Beitreten mit eingetragenem Code", async () => {
  const p = await env.newPage();
  await p.goto(env.base + "#/r/ABC-123");
  assert.equal(await p.isVisible("#formJoin"), true);
  assert.equal((await p.inputValue("#jCode")).toUpperCase(), "ABC-123");
  await p.close();
});

test("Handy: Player bleibt beim Scrollen oben, Warteschlange/Chat darunter", async () => {
  const { page } = await createRoom(env, "Handy");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const r = await page.evaluate(async () => {
    const stage = document.querySelector(".stage"), right = document.querySelector(".side-right");
    const before = { stage: stage.getBoundingClientRect(), right: right.getBoundingClientRect() };
    window.scrollTo(0, 700); await new Promise(res => setTimeout(res, 200));
    return { pos: getComputedStyle(stage).position, rightBelow: before.right.top >= before.stage.bottom - 1, stageTop: stage.getBoundingClientRect().top, fullWidth: before.stage.width >= 380 };
  });
  assert.equal(r.pos, "sticky");
  assert.ok(r.rightBelow, "Warteschlange/Chat liegt unter dem Player");
  assert.ok(Math.abs(r.stageTop) < 2, "Player klebt oben");
  assert.ok(r.fullWidth, "Player nutzt die volle Breite");
  await page.close();
});

test("Startseite: Plattform-Icons, Impressum und Datenschutz verlinkt, Erweiterung ausgeblendet", async () => {
  const p = await env.newPage();
  await p.goto(env.base);
  assert.equal(await p.locator(".platforms .pf svg").count(), 5);
  assert.equal(await p.isVisible("#extBtn"), false);
  for (const [link, title] of [["Impressum", /Impressum/], ["Datenschutz", /Datenschutz/]]) {
    await p.goto(env.base);
    await p.click(`.legal a:has-text("${link}")`);
    await p.waitForLoadState();
    assert.match(await p.textContent("h1"), title);
  }
  await p.close();
});

test("Keine JavaScript-Fehler auf den Seiten", () => {
  assert.deepEqual(env.errors, []);
});
