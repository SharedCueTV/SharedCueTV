// SharedCueTV-Erweiterung – Hintergrund: hält die Verbindung zum Raum (Supabase Realtime)
// und verteilt Befehle an die Tabs mit Netflix / Disney+ / Prime Video.
importScripts("supabase.js");

const CFG = {
  url: "https://pvwgktntvrzcmivxsiaf.supabase.co",
  key: "sb_publishable_gawxkr-pLpLLoFYUElz0mA_WkpuDN1b"
};

let client = null, ch = null, joined = false, me = null, session = null;
let people = [];
const ports = new Set();

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
}
const sorted = () => [...people].sort((a, b) => (a.joinedAt - b.joinedAt) || (a.id < b.id ? -1 : 1));
const isLeader = () => { const l = sorted()[0]; return !l || (me && l.id === me.id); };
function status() {
  return { connected: joined, session: session && { code: session.code, name: session.name, hasPw: !!session.pw }, people: people.map(p => p.name), leader: isLeader() };
}
function toTabs(msg) { for (const p of ports) { try { p.postMessage(msg); } catch {} } }
function pushStatus() { toTabs({ type: "status", ...status() }); chrome.runtime.sendMessage({ type: "status", ...status() }).catch(() => {}); }
function send(t, d) { if (ch && joined) ch.send({ type: "broadcast", event: "m", payload: { t, d, f: me.id, n: me.name } }); }

async function leave() {
  if (ch) { const c = ch; ch = null; joined = false; try { await c.untrack(); } catch {} try { await client.removeChannel(c); } catch {} }
  people = [];
}
async function join(s) {
  await leave();
  session = s;
  me = { id: s.id, name: s.name, joinedAt: Date.now() };
  client = client || supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: false } });
  const name = (await sha256(s.code + "\u0000" + (s.pw || ""))).slice(0, 32);
  const c = ch = client.channel("scx:" + name, { config: { broadcast: { self: false }, presence: { key: me.id } } });
  c.on("broadcast", { event: "m" }, ({ payload }) => { if (payload && payload.f !== me.id) onMsg(payload); });
  c.on("presence", { event: "sync" }, () => {
    people = Object.values(c.presenceState()).map(a => a[0]).filter(Boolean);
    if (!people.some(p => p.id === me.id)) people.push(me);
    pushStatus();
  });
  c.subscribe(async st => {
    if (ch !== c) return;
    if (st === "SUBSCRIBED") { joined = true; await c.track(me); send("hello", {}); pushStatus(); }
    else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT" || st === "CLOSED") { joined = false; pushStatus(); setTimeout(() => { if (session && ch === c && !joined) join(session); }, 5000); }
  });
  await chrome.storage.local.set({ session: s });
  pushStatus();
}

function onMsg({ t, d, f, n }) {
  if (t === "hello") {
    // Wer am längsten drin ist, schickt dem Neuen den aktuellen Stand
    const others = sorted().filter(p => p.id !== f);
    if (!others.length || others[0].id === me.id) toTabs({ type: "needState", to: f });
  } else if (t === "snap") {
    if (d.to === me.id) toTabs({ type: "remote", a: "sync", ...d, n });
  } else if (t === "cmd") {
    toTabs({ type: "remote", ...d, n });
  } else if (t === "tick") {
    toTabs({ type: "remote", a: "tick", ...d, n });
  }
}

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "sharedcue") return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  port.onMessage.addListener(m => {
    if (m.type === "local") send("cmd", { a: m.a, pos: m.pos, playing: m.playing, cid: m.cid, site: m.site });
    else if (m.type === "tick" && isLeader()) send("tick", { pos: m.pos, playing: m.playing, cid: m.cid });
    else if (m.type === "state") send("snap", { to: m.to, pos: m.pos, playing: m.playing, cid: m.cid, site: m.site });
  });
  port.postMessage({ type: "status", ...status() });
});

chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (m.cmd === "join") { join(m.session).then(() => reply(status())); return true; }
  if (m.cmd === "leave") { session = null; chrome.storage.local.remove("session"); leave().then(() => { pushStatus(); reply(status()); }); return true; }
  if (m.cmd === "status") { reply(status()); return false; }
});

// Nach einem Neustart des Hintergrunds automatisch wieder in den Raum
chrome.storage.local.get("session").then(({ session: s }) => { if (s && !ch) join(s); });
