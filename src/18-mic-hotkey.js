// ---------------------------------------------------------------- Mikro-Hotkey
let hkCapture = false;
function hotkeyLabel(hk) {
  if (!hk) return "Nicht festgelegt";
  const k = hk.code.replace(/^Key/, "").replace(/^Digit/, "").replace(/^Numpad/, "Num ").replace("Backquote", "^").replace("Space", "Leertaste");
  return [hk.ctrl && "Strg", hk.alt && "Alt", hk.shift && "Shift", hk.meta && "Cmd", k].filter(Boolean).join(" + ");
}
function renderHotkeyBtn() {
  const b = $("#setHotkey"); if (!b) return;
  b.textContent = hkCapture ? "Taste drücken … (Esc = abbrechen, Entf = löschen)" : hotkeyLabel(store.get("sc_mic_hotkey", null));
  b.classList.toggle("capturing", hkCapture);
}
$("#setHotkey").onclick = () => { hkCapture = !hkCapture; renderHotkeyBtn(); };
