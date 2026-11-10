// ---------------------------------------------------------------- Boot
function boot() {
  $("#modeNote").hidden = HAS_SUPA;
  const ro = store.get("sc_room_opts", { voice: true, cam: true });
  $("#cVoice").checked = ro.voice !== false; $("#cCam").checked = ro.cam !== false; $("#cCam").disabled = !$("#cVoice").checked;
  $("#cVoice").onchange = () => { $("#cCam").disabled = !$("#cVoice").checked; };
  const name = store.get("sc_name", "");
  $("#cName").value = name; $("#jName").value = name;
  const m = location.hash.match(/^#\/r\/([A-Za-z0-9-]+)(?:\?k=([\w-]+))?/);
  if (m) {
    const code = normCode(m[1]);
    const pw = m[2] ? b64d(m[2]) : "";
    selectLobbyTab(true);
    $("#jCode").value = code; $("#jPass").value = pw;
    const sess = store.sget("sc_session", null);
    if (sess && sess.code === code && name) { enterRoom({ name, code, pw: sess.pw, creating: false }); return; }
    // Passwort aus dem Link nicht in der Adresszeile stehen lassen
    if (pw) history.replaceState(null, "", "#/r/" + code);
    (name ? $("#formJoin .btn") : $("#jName")).focus();
  }
}
boot();
