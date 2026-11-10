# SharedCueTV

YouTube und Twitch mit Freunden synchron schauen – mit Warteschlange (Upvotes), Chat, Emoji-Reaktionen und optionalem Raum-Passwort.

## So funktioniert's
- Statische Seite (GitHub Pages), kein eigener Server.
- Synchronisation über **Supabase Realtime** (Broadcast + Presence), keine Datenbank-Tabellen.
- Der Raumzustand lebt in den Browsern der Teilnehmer. Wer neu dazukommt, bekommt den Stand vom Teilnehmer, der am längsten im Raum ist.
- Das Passwort wird nie übertragen: Code + Passwort ergeben per SHA-256 den Kanalnamen. Falsches Passwort = anderer, leerer Raum.

## Entwickeln
Der Code liegt in `src/` und wird mit `npm run build` zu `app.js` zusammengebaut (keine Abhängigkeiten nötig).
- `npm run dev` – lokaler Server im Testmodus (http://localhost:8766)
- `npm test` – automatische Browser-Tests (einmalig vorher: `npm install && npx playwright install chromium`)
- Details zur Architektur und zu den Regeln stehen in [`CLAUDE.md`](CLAUDE.md).

## Dateien
- `index.html`, `styles.css` – Oberfläche
- `src/` – Quellcode (wird zu `app.js` gebaut), `sw.js` – Service Worker für geteilte Dateien
- `tests/` – Browser-Tests, `tools/` – Build und lokaler Server
- `config.js` – Supabase-URL und Publishable Key (öffentlich, kein Secret)
- `fonts/` – lokal eingebundene Schriften (keine Google-Fonts-Anfragen)
- `vendor/` – supabase-js 2.45.4

## Lokal testen
`npm run dev` starten. Das liefert eine leere `config.js` aus → Testmodus (Sync zwischen Tabs desselben Browsers).
