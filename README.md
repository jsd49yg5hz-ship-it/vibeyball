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
  (gezählt werden ausgeführte Trainings) – filterbar nach Zeitraum (4 Wochen / 3 Monate /
  gesamt), Metrik (Anzahl oder Minuten) und Mannschaft.
- **Session-Vorlagen**: Struktur einer Session als Vorlage speichern und neue Sessions
  daraus erstellen.
- **Übungs-Favoriten**: Übungen mit ★ markieren – Favoriten stehen in der Bibliothek zuoberst.
- **Übungs-Skizzen**: pro Übung eine Feldskizze im eingebauten Zeichen-Editor erstellen
  (Spieler, Gegner, Ball, Hütchen, Laufwege als Pfeile) oder ein Bild hochladen –
  sichtbar in Bibliothek, geteilter Ansicht und PDF.
- **Nachbereitung**: beim Ausführen Bewertung (1–5 ★), Anwesenheit (z. B. 9/12) und eine
  «Beim nächsten Mal»-Notiz erfassen.
- **Matchtage**: Spiele mit Gegner, Resultat und Notizen erfassen – erscheinen in der
  Trainingsliste mit eigener Kennzeichnung.
- **Saisonblöcke**: Zeiträume mit Blockziel definieren («Saisonvorbereitung» etc.);
  Trainings werden über ihr Datum automatisch zugeordnet, die Statistik ist pro Block filterbar.
- **Übungsvarianten**: Übungen sind als Progressionen verkettet (leichter ⇄ schwerer) –
  im Trainingsablauf mit einem Klick die passende Stufe einsetzen; eigene Übungen können
  ebenfalls verkettet werden.
- **Übungen teilen**: eigene Übungen für alle Coaches auf der Instanz freigeben.
- **Trainerteam**: Co-Trainer per E-Mail einladen (Rolle «Lesen» oder «Bearbeiten») –
  sie sehen bzw. bearbeiten alle Sessions, Vorlagen und Übungen des Teams über den
  Team-Umschalter im Header.
- **PWA**: als App installierbar; statische Dateien und zuletzt geladene Pläne sind
  dank Service Worker auch offline abrufbar.
- **Backup & Import**: alle eigenen Daten (Sessions, Übungen, Vorlagen, Blöcke, Skizzen)
  als JSON-Datei sichern und wiederherstellen.
- **Passwort**: eingeloggt über das Konto-Menü änderbar; bei Vergessen per CLI:
  `npm run reset-password -- coach@verein.ch`.
- **Übungsbibliothek**: 60+ eingebaute Übungen für Indoor-6er-Volleyball (Aufwärmen bis
  Cool-down) mit Volltextsuche und Filtern nach Kategorie und Niveau.
- **Eigene Übungen**: erstellen, bearbeiten, löschen – inklusive eigener Kategorien.
- **Trainingsablauf**: Übungen hinzufügen, Dauer anpassen, Reihenfolge per Drag & Drop
  (Griff ⠿) oder Pfeilen ändern, Notizen pro Übung; bei gesetzter Startzeit werden konkrete
  Uhrzeiten pro Übung berechnet (z. B. 18:30–18:40) und die Gesamtdauer automatisch summiert.
  Änderungen werden automatisch gespeichert – mit sichtbarem Status und automatischen
  Wiederholungsversuchen bei Netzwerkproblemen.
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

Jeder Code ist einmal verwendbar. Login und Registrierung sind mit Rate-Limiting
geschützt (10 Fehlversuche pro 15 Minuten).

## Tests

End-to-End-Tests (Playwright, Headless-Chromium):

```bash
npx playwright install chromium   # einmalig: Browser herunterladen
npm test
```

Die Tests laufen auch automatisch bei jedem Push über GitHub Actions
(`.github/workflows/test.yml`).

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
