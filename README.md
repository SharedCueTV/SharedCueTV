# SharedCueTV

YouTube und Twitch mit Freunden synchron schauen – mit Warteschlange (Upvotes), Chat, Emoji-Reaktionen und optionalem Raum-Passwort.

## So funktioniert's
- Statische Seite (GitHub Pages), kein eigener Server.
- Synchronisation über **Supabase Realtime** (Broadcast + Presence), keine Datenbank-Tabellen.
- Der Raumzustand lebt in den Browsern der Teilnehmer. Wer neu dazukommt, bekommt den Stand vom Teilnehmer, der am längsten im Raum ist.
- Das Passwort wird nie übertragen: Code + Passwort ergeben per SHA-256 den Kanalnamen. Falsches Passwort = anderer, leerer Raum.

## Dateien
- `index.html`, `styles.css`, `app.js` – die App
- `config.js` – Supabase-URL und Publishable Key (öffentlich, kein Secret)
- `fonts/` – lokal eingebundene Schriften (keine Google-Fonts-Anfragen)
- `vendor/` – supabase-js 2.45.4

## Lokal testen
`python3 -m http.server` im Ordner starten. Mit leerer `config.js` läuft der Testmodus (Sync zwischen Tabs).
