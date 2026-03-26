# BF Wien Mitarbeiterliste

## Erster Befehl (Terminal)

`npm install`

`npm start`

## Automatisch aktualisieren (Entwicklung)

`npm run dev`

Bei jeder Aenderung an `app.js`, `views` oder `public` startet der Server automatisch neu und die Website aktualisiert sich im Browser automatisch.

Oeffentliche Mitarbeiterliste fuer die BF Wien (Feuerwehr) mit geschuetzter Bearbeitung.

## Funktionen

- Oeffentliche Ansicht der Mitarbeiterliste
- Login nur fuer von Admin angelegte Konten
- Mitarbeiter anlegen und bearbeiten (eingeloggte Benutzer)
- Adminbereich zum Erstellen/Verwalten von Konten

## Starten

1. Abhaengigkeiten installieren:
   - `npm install`
2. Server starten:
   - `npm start`
3. Website oeffnen:
   - `http://localhost:3000`

## Standard-Admin

Beim ersten Start wird automatisch ein Admin erstellt:

- Benutzername: `admin`
- Passwort: `admin123!`

Optional kannst du eigene Werte setzen:

- `ADMIN_USER`
- `ADMIN_PASS`
- `SESSION_SECRET`

## Oeffentlich auf Render deployen

1. Projekt auf GitHub hochladen
2. Auf [Render](https://render.com/) einloggen
3. `New +` -> `Blueprint`
4. GitHub-Repo auswaehlen (Render erkennt `render.yaml`)
5. Deploy starten
6. Nach dem Deploy bekommst du eine URL wie:
   - `https://bfw-mitarbeiterliste.onrender.com`

Hinweis:
- Render Free Plan kann beim ersten Aufruf kurz schlafen.
- Fuer Google-Indexierung spaeter eine eigene Domain verbinden.

## Daten dauerhaft speichern

Die App speichert alle Aenderungen in SQLite-Dateien im Ordner `data/`.
Damit bleiben Mitarbeiter, Konten und Einstellungen nach Neustarts erhalten.

Optional kannst du eigene Pfade setzen:

- `DATA_DIR` (z. B. `C:\\bfw-data`)
- `DATABASE_PATH` (z. B. `C:\\bfw-data\\database.sqlite`)
- `SESSION_DB_PATH` (z. B. `C:\\bfw-data\\sessions.sqlite`)

### Wichtiger Hinweis fuer Render

Auf Render musst du einen Persistent Disk mounten (z. B. `/var/data`) und setzen:

- `DATA_DIR=/var/data`

Dann bleiben deine Website-Aenderungen auch nach Deploy/Restart erhalten.
