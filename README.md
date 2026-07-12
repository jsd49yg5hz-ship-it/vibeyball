# 🏐 VibeyBall – Trainingsplaner für Volleyball-Coaches

Web-App, mit der Volleyball-Coaches ihre Trainings planen: Sessions zusammenstellen,
Übungen aus einer grossen Bibliothek wählen, Zeiten planen und den fertigen Plan als
gestaltetes PDF exportieren. Mit Login und zentraler Speicherung auf dem eigenen Server.

## Features

- **Konten & zentrale Speicherung**: Registrierung/Login, alle Daten liegen zentral in
  einer SQLite-Datenbank auf dem Server (kein localStorage).
- **Trainingssessions** mit Titel, Mannschaft, Datum, Startzeit, Ort, Schwerpunkt und Notizen.
- **Übungsbibliothek**: 60+ eingebaute Übungen für Indoor-6er-Volleyball (Aufwärmen bis
  Cool-down) mit Volltextsuche und Filtern nach Kategorie und Niveau.
- **Eigene Übungen**: erstellen, bearbeiten, löschen – inklusive eigener Kategorien.
- **Trainingsablauf**: Übungen hinzufügen, Dauer anpassen, Reihenfolge ändern, Notizen pro
  Übung; bei gesetzter Startzeit werden konkrete Uhrzeiten pro Übung berechnet
  (z. B. 18:30–18:40) und die Gesamtdauer automatisch summiert.
- **PDF-Export**: direkt generiertes, gestaltetes A4-PDF (jsPDF) mit Kopfbereich,
  Sessiondaten, Zeitspalte und mehrseitigem Umbruch.
- **Duplizieren & Serien**: Session kopieren oder als wöchentliche Serie wiederholen.
- **Kalender & iCal**: Monatskalender-Ansicht der Trainings und Export aller Sessions
  als `.ics`-Datei für Google/Apple/Outlook-Kalender.
- **Teilen**: Read-only-Link pro Session für Co-Trainer oder das Team (inkl. PDF-Download),
  jederzeit widerrufbar.

## Lokal starten

```bash
npm install
npm start
# → http://localhost:3000
```

Daten (SQLite-Datenbank + Cookie-Signaturschlüssel) landen im Ordner `data/`
(konfigurierbar über die Umgebungsvariable `DATA_DIR`, Port über `PORT`).

## Auf der eigenen Website hosten

Siehe **[HOSTING.md](HOSTING.md)** für eine Schritt-für-Schritt-Anleitung
(VPS mit Nginx + HTTPS, Docker oder Hosting-Plattform).

## Technik

- **Backend**: Node.js + Express, SQLite (better-sqlite3), bcrypt-Passwort-Hashes,
  HMAC-signierte httpOnly-Auth-Cookies – siehe `server.js`.
- **Frontend**: Vanilla HTML/CSS/JS ohne Build-Schritt (`public/`),
  PDF-Generierung mit jsPDF (`public/pdf.js`).
- **Übungsbibliothek**: `public/exercises.js` – einfach erweiterbar.
