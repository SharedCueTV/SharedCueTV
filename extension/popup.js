const $ = s => document.querySelector(s);
const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const genCode = () => { const r = crypto.getRandomValues(new Uint8Array(6)); const s = Array.from(r, b => A[b % A.length]).join(""); return s.slice(0, 3) + "-" + s.slice(3); };
const norm = c => { const s = String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); return s.length === 6 ? s.slice(0, 3) + "-" + s.slice(3) : s; };

function render(st) {
  const inRoom = !!(st && st.session);
  $("#out").hidden = inRoom; $("#in").hidden = !inRoom;
  $("#in").style.display = inRoom ? "flex" : "none";
  if (!inRoom) return;
  $("#rc").textContent = st.session.code + (st.session.hasPw ? " 🔒" : "");
  $("#st").textContent = st.connected ? "verbunden" : "verbinde …";
  $("#st").className = st.connected ? "ok" : "muted";
  $("#ppl").textContent = st.people.length ? "Im Raum: " + st.people.join(", ") : "";
}

chrome.storage.local.get(["name", "id"]).then(({ name, id }) => {
  if (name) $("#name").value = name;
  if (!id) chrome.storage.local.set({ id: crypto.randomUUID() });
});
chrome.runtime.sendMessage({ cmd: "status" }).then(render).catch(() => {});
chrome.runtime.onMessage.addListener(m => { if (m.type === "status") render(m); });

$("#gen").onclick = () => { $("#code").value = genCode(); };
$("#f").addEventListener("submit", async e => {
  e.preventDefault();
  const code = norm($("#code").value);
  if (!/^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(code)) { $("#code").focus(); return; }
  const name = $("#name").value.trim().slice(0, 24) || "Gast";
  const { id } = await chrome.storage.local.get("id");
  await chrome.storage.local.set({ name });
  render(await chrome.runtime.sendMessage({ cmd: "join", session: { id: id || crypto.randomUUID(), name, code, pw: $("#pw").value } }));
});
$("#leave").onclick = async () => render(await chrome.runtime.sendMessage({ cmd: "leave" }));
