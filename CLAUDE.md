# SharedCueTV – Hinweise für Claude Code

Eigene Watch-Together-Seite für Kevin und seine Freunde (Ersatz für SyncTube/Watch2Gether).
Live: https://sharedcuetv.github.io/SharedCueTV/ · Repo: `SharedCueTV/SharedCueTV`, GitHub Pages aus `main` (Root).

**Sprache:** Oberfläche, Kommentare und Commit-Nachrichten auf **Deutsch**. Antworten an Kevin auf Deutsch, kurz und direkt.

## Wichtigste Regeln
1. **Nie `app.js` direkt bearbeiten.** Code liegt in `src/*.js`. Nach jeder Änderung `npm run build` – das baut `app.js` und setzt den Cache-Buster `?v=<hash>` in `index.html` automatisch.
2. **Vor jedem Commit `npm test`** (prüft auch, ob der Build aktuell ist). Neue Funktionen bekommen einen Test in `tests/`.
3. **Deploy = Push auf `main`.** GitHub Pages ist nach ca. 1 Minute aktuell. Nutzer müssen danach einmal neu laden (F5).
4. Keine Build-Tools/Frameworks einführen – die Seite muss als statische Dateien auf GitHub Pages laufen. Keine externen CDNs (Schriften/Bibliotheken liegen lokal in `fonts/` und `vendor/`).

## Befehle
| Befehl | Zweck |
|---|---|
| `npm install && npx playwright install chromium` | einmalig: Test-Browser installieren |
| `npm run build` | `src/*.js` → `app.js`, Version in `index.html` setzen |
| `npm test` | Build prüfen + alle Browser-Tests (Playwright, `node:test`) |
| `npm run dev` | lokaler Server auf http://localhost:8766 im **Testmodus** (ohne Supabase, Sync nur zwischen Tabs desselben Browsers) |
| `npm run serve` | lokaler Server mit echter Supabase-Verbindung |

## Architektur
- **Kein Server, keine Datenbank.** Sync läuft über **Supabase Realtime** (Broadcast + Presence) im geteilten Projekt (Projekt-URL/Publishable Key in `config.js`, öffentlich). Leere `config.js` → `LocalTransport` (BroadcastChannel) für Tests.
- Kanalname = `"sc:" + sha256(code + "\0" + passwort).slice(0,32)`; Passwort wird nie übertragen. Aktuell ist das Passwortfeld in der Oberfläche ausgeblendet.
- **Zustand lebt in den Browsern.** Jede Aktion ist eine **Op** (`send(op)` → lokal `applyOp` + Broadcast). Neue Teilnehmer schicken `hello`, der **Leader** (am längsten im Raum) antwortet mit `snap`. Der Leader sendet regelmäßig die Position; Drift > 1,5 s wird korrigiert.
- **Fremde Ops werden geprüft** (`src/06-validate.js`): Typen, Längen, Absender = `op.by`, Spam-Bremse (40 Ops/5 s, Signalisierung 400/5 s). Neue Op-Art ⇒ Regel in `OP_RULES` ergänzen, sonst wird sie bei den anderen verworfen!
- **Player-Adapter** (`src/04-players.js`): `YTAdapter` (IFrame-API, volle YouTube-Bedienung, Play/Pause/Spulen im YouTube-Player wird erkannt – nur wenn der Fokus im iframe liegt), `TwitchAdapter`, `TikTokAdapter` (postMessage), `InstaAdapter` (Countdown-Modus), `FileAdapter` (`<video>` für Links **und** P2P-Dateien), `LiveAdapter` (WebRTC-Stream für Bildschirm teilen).
- **Eigene Dateien** (`src/15-p2p-files.js` + `sw.js`): Die Originaldatei bleibt beim Teilenden. Zuschauer-`<video>` lädt `…/__p2p/<owner>/<fid>/<size>/<mime>`; der Service Worker beantwortet die Range-Anfragen, die Bytes kommen per WebRTC-Datenkanal vom Teilenden. Volle Qualität, spulbar, Warteschlange. Teilender muss den Tab offen lassen. Hart neu laden (Strg+F5) umgeht den Service Worker → dann normal neu laden.
- **Bildschirm teilen** (`src/14-live-share.js`): `getDisplayMedia` → WebRTC an jeden Zuschauer, mit automatischer Neuverbindung, H.264 bevorzugt, Qualitätswahl (persönliche Einstellung).
- **Sprachchat/Webcams** (`src/10-voice.js`, `src/11-webcams.js`): Mesh-WebRTC (jeder mit jedem, „perfect negotiation“). Ab ~5–6 Personen wird es eng.
- **Werbung bei YouTube:** wird erkannt (`detectAd`), dann wartet der ganze Raum („ad-hold“).
- Browser-Erweiterung für Netflix/Disney+/Prime liegt in `extension/` (eigener Kanal `scx:`), gepackt als `sharedcuetv-extension.zip`.

## Dateien
```
index.html        Oberfläche (Lobby, Raum, Modals)
styles.css        alle Styles (unten neuere Blöcke, die ältere überschreiben)
app.js            GEBAUT – nicht bearbeiten
src/              Quellcode, wird in Dateinamen-Reihenfolge zu einer IIFE zusammengefügt
  01-helpers  02-media-links  03-transport  04-players  05-state  06-ops  06-validate
  07-sync  08-render  09-playback-extras  10-voice  11-webcams  12-reconnect
  13-polls-stats  14-live-share  15-p2p-files  16-ui-extras  17-fullscreen-cams
  18-mic-hotkey  19-room  20-actions  21-wiring  22-boot
sw.js             Service Worker für P2P-Dateien
config.js         Supabase-URL + Publishable Key
tools/            build.mjs (Build), serve.cjs (lokaler Server)
tests/            Browser-Tests (*.test.cjs), helpers.cjs
extension/        Chrome-Erweiterung (Beta)
fonts/ vendor/    lokale Schriften, supabase-js
```
Alle `src/`-Dateien teilen sich einen Gültigkeitsbereich (eine IIFE): Funktionen und `const`/`let` aus anderen Dateien sind direkt nutzbar. Funktionsdeklarationen werden „gehoistet“; Top-Level-`const` müssen aber vor ihrer ersten *Ausführung* definiert sein (Reihenfolge der Dateien beachten).

## Testen & Debuggen
- Tests laufen im Testmodus mit zwei Tabs im selben Browser; Videos werden im Browser erzeugt (Canvas → WebM), kein Netzwerk nötig. YouTube/Twitch lassen sich so nicht testen – dafür auf der Live-Seite mit zwei Tabs prüfen.
- In der Browser-Konsole liefert `__sharedcue()` den Sync-Zustand (Leader, Position, Drift, Warteschlange, Kanal …).
- Fake-Kamera/Mikro: Chromium mit `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` (in `tests/helpers.cjs` schon gesetzt).

## Bekannte Grenzen / Ideen
- Kein TURN-Server: In sehr strengen Netzen (Firmen-WLAN) können WebRTC-Verbindungen (Sprache, Datei, Bildschirm) scheitern.
- Supabase-Free-Projekt wird mit ToastBuddy geteilt; eine GitHub Action pingt es zweimal pro Woche, damit es nicht pausiert.
- Offene Ideen: CSS aufräumen (ältere überschriebene Blöcke entfernen, Design-Tokens zentral), Zuschneiden beim Bildschirm teilen, SFU-Server für größere Gruppen.
