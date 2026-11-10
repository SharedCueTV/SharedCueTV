// ---------------------------------------------------------------- Transports
class LocalTransport {
  constructor() { this.handlers = {}; this.peers = new Map(); this.kind = "local"; }
  on(ev, fn) { this.handlers[ev] = fn; }
  emit(ev, ...a) { this.handlers[ev] && this.handlers[ev](...a); }
  async connect(channel, meta) {
    this.meta = meta;
    this.bc = new BroadcastChannel("sharedcue:" + channel);
    this.bc.onmessage = e => {
      const m = e.data;
      if (!m || m.f === meta.id) return;
      if (m.t === "_pres") { this.peers.set(m.d.id, { meta: m.d, seen: now() }); this.prune(true); return; }
      if (m.t === "_bye") { this.peers.delete(m.f); this.prune(true); return; }
      this.emit("message", m.t, m.d, m.f);
    };
    const beat = () => this.bc && this.bc.postMessage({ t: "_pres", d: this.meta, f: meta.id });
    beat();
    this.hb = setInterval(() => { beat(); this.prune(false); }, 2000);
    this.lastKey = "";
    this.prune(true);
    this.emit("status", "online");
  }
  prune(force) {
    let changed = false;
    for (const [id, p] of this.peers) if (now() - p.seen > 6500) { this.peers.delete(id); changed = true; }
    const list = [this.meta, ...Array.from(this.peers.values(), p => p.meta)];
    const key = list.map(m => m.id).sort().join(",");
    if (changed || force || key !== this.lastKey) { this.lastKey = key; this.emit("presence", list); }
  }
  send(t, d) { this.bc && this.bc.postMessage({ t, d, f: this.meta.id }); }
  leave() { if (!this.bc) return; this.send("_bye", {}); clearInterval(this.hb); this.bc.close(); this.bc = null; }
}

class SupabaseTransport {
  constructor(cfg) { this.cfg = cfg; this.handlers = {}; this.kind = "supabase"; }
  on(ev, fn) { this.handlers[ev] = fn; }
  emit(ev, ...a) { this.handlers[ev] && this.handlers[ev](...a); }
  async connect(channel, meta) {
    await loadScript("vendor/supabase.min.js");
    this.client = this.client || window.supabase.createClient(this.cfg.supabaseUrl, this.cfg.supabaseKey, {
      auth: { persistSession: false },
      realtime: { params: { eventsPerSecond: 20 } }
    });
    this.meta = meta;
    const ch = this.ch = this.client.channel("sc:" + channel, { config: { broadcast: { self: false }, presence: { key: meta.id } } });
    ch.on("broadcast", { event: "m" }, ({ payload }) => { if (payload && payload.f !== meta.id) this.emit("message", payload.t, payload.d, payload.f); });
    ch.on("presence", { event: "sync" }, () => {
      const st = ch.presenceState();
      const list = Object.values(st).map(a => a[0]).filter(Boolean);
      if (!list.some(m => m.id === meta.id)) list.push(meta);
      this.emit("presence", list);
    });
    await new Promise((resolve, reject) => {
      let done = false;
      ch.subscribe(async status => {
        if (status === "SUBSCRIBED") {
          await ch.track(meta);
          this.emit("status", "online");
          if (!done) { done = true; resolve(); }
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          if (this.ch !== ch) return; // bewusst verlassen
          this.emit("status", "offline");
          if (!done) { done = true; reject(new Error(status)); }
        }
      });
    });
  }
  send(t, d) { this.ch && this.ch.send({ type: "broadcast", event: "m", payload: { t, d, f: this.meta.id } }); }
  leave() {
    if (!this.ch) return;
    const ch = this.ch; this.ch = null; this.leaving = true;
    try { ch.untrack(); } catch {}
    this.client.removeChannel(ch).finally(() => { this.leaving = false; });
  }
}
