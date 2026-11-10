// ---------------------------------------------------------------- State
const CFG = window.SHAREDCUE_CONFIG || {};
const HAS_SUPA = !!(CFG.supabaseUrl && CFG.supabaseKey);
const DRIFT_MAX = 1.5;         // Sekunden Abweichung bis Auto-Resync
const TICK_MS = 4000;          // Leader-Abgleich
const CHAT_MAX = 80;
const EMOJIS = ["🔥", "😂", "😱", "💜", "👏", "🎉", "👀", "💀"];

let me = null;            // {id,name,color,joinedAt}
let room = null;          // {code, pw, channel}
let transport = null;
let people = [];          // presence list
let synced = false;       // Snapshot erhalten (oder erster im Raum)
let state = freshState();
let sysMsgs = [];
let player = null;        // aktueller Adapter
let loadedKey = "";       // src:ref im Player
let filter = "all";
let seeking = false;
let lastCorrection = 0;
let lastPlayCmd = 0;
let chatActive = false;
let refreshWanted = false;  // frischen Stand anfordern (nach Verbindungsabbruch)
let offlineSince = 0, reconnectT = null, backoff = 0, hiddenAt = 0;
const fmtRate = r => String(+r.toFixed(2)).replace(".", ",") + "×";

function freshStats() { return { added: {}, upv: {}, react: {}, sec: 0, videos: 0 }; }
const ST = () => (state.stats = state.stats || freshStats());
const bump = (map, name, n = 1) => { if (!name) return; const m = ST()[map]; m[name] = Math.max(0, (m[name] || 0) + n); };
function freshState() {
  return { title: "", video: null, pb: { playing: false, pos: 0, at: now(), rate: 1 }, queue: [], chat: [], settings: { voice: true, cam: true }, poll: null, stats: freshStats() };
}
const RATE = () => state.pb.rate || 1;
const expectedPos = () => state.pb.playing ? state.pb.pos + (now() - state.pb.at) / 1000 * RATE() : state.pb.pos;
const setPb = (playing, pos, rate = RATE()) => { state.pb = { playing, pos, at: now(), rate }; };
const leader = () => [...people].sort((a, b) => (a.joinedAt - b.joinedAt) || (a.id < b.id ? -1 : 1))[0];
const isLeader = () => { const l = leader(); return !l || l.id === me.id; };
const nameOf = id => (people.find(p => p.id === id) || {}).name;
const vkey = v => v ? v.src + ":" + (v.src === "live" ? v.qid : v.ref) : "";
const score = it => Object.values(it.votes || {}).reduce((a, b) => a + b, 0);
const sortedQueue = () => [...state.queue];
const resortByVotes = () => { state.queue = [...state.queue].sort((a, b) => score(b) - score(a)); };
