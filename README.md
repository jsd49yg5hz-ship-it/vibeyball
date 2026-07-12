# 🏐 VibeyBall – Trainingsplaner für Volleyball-Coaches

Web-App, mit der Volleyball-Coaches ihre Trainings planen: Sessions zusammenstellen,
Übungen aus einer grossen Bibliothek wählen, Zeiten planen und den fertigen Plan als
gestaltetes PDF exportieren. Mit Login und zentraler Speicherung auf dem eigenen Server.

## Features

- **Konten & zentrale Speicherung**: Registrierung/Login, alle Daten liegen zentral in
  einer SQLite-Datenbank auf dem Server (kein localStorage). Die Registrierung ist durch
  **Einladungscodes** geschützt (`npm run invite`).
- **Dark Mode & warmes Theme**: folgt automatisch der Systemeinstellung, mit manuellem
  Hell/Dunkel-Umschalter im Header; Sand-/Orangetöne auf dunklem Blau.
- **Trainingssessions** mit Titel, Mannschaft, Datum, Startzeit, Ort, Fokus-Tags und Notizen;
  Trainings lassen sich als **ausgeführt** markieren (per ✓ in der Übersicht oder im Editor).
- **Fokus-Tags**: pro Session mehrere Schwerpunkte wählbar (Annahme, Block, Verteidigung,
  Zuspiel, Angriff, Taktik).
- **Statistik-Reiter**: Spider Chart zeigt, welcher Fokus wie oft trainiert wurde
  (gezählt werden ausgeführte Trainings).
- **Übungsbibliothek**: 60+ eingebaute Übungen für Indoor-6er-Volleyball (Aufwärmen bis
  Cool-down) mit Volltextsuche und Filtern nach Kategorie und Niveau.
- **Eigene Übungen**: erstellen, bearbeiten, löschen – inklusive eigener Kategorien.
- **Trainingsablauf**: Übungen hinzufügen, Dauer anpassen, Reihenfolge ändern, Notizen pro
  Übung; bei gesetzter Startzeit werden konkrete Uhrzeiten pro Übung berechnet
  (z. B. 18:30–18:40) und die Gesamtdauer automatisch summiert.
- **PDF-Export**: direkt generiertes, druckfreundliches A4-PDF (jsPDF) – keine Farbflächen,
  klare Typografie mit dezenten Farbakzenten, Zeitspalte, mehrseitiger Umbruch.
- **Duplizieren & Serien**: Session kopieren oder als wöchentliche Serie wiederholen.
- **Teilen**: Read-only-Link pro Session für Co-Trainer oder das Team (inkl. PDF-Download),
  jederzeit widerrufbar.

## Lokal starten

```bash
npm install
npm run invite   # erzeugt einen Einladungscode für die erste Registrierung
npm start
# → http://localhost:3000
```

Einladungscodes verwalten:

```bash
npm run invite          # einen neuen Code erzeugen
npm run invite -- 5     # fünf Codes auf einmal
npm run invite -- list  # alle Codes und ihren Status anzeigen
```

Jeder Code ist einmal verwendbar.

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
