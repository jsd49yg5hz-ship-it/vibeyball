# 🏐 VibeyBall – Trainingsplaner für Volleyball-Coaches

Eine leichtgewichtige Web-App, mit der Volleyball-Coaches ihre Trainingssessions planen können – ganz ohne Build-Tools oder Server.

## Features

- **Trainingssessions erstellen** mit Titel, Mannschaft, Datum, Uhrzeit, Ort, Trainingsschwerpunkt und Notizen
- **Übungsbibliothek** mit über 60 Volleyball-Übungen (Aufwärmen, Baggern, Pritschen, Zuspiel, Aufschlag, Annahme, Angriff, Block, Abwehr, Taktik, Spielformen, Athletik, Cool-down)
  - Volltextsuche sowie Filter nach Kategorie und Niveau
  - Jede Übung mit Beschreibung, Mindest-Spielerzahl und empfohlener Dauer
- **Trainingsablauf zusammenstellen**: Übungen zur Session hinzufügen, Dauer pro Übung anpassen, Reihenfolge ändern, optionale Notizen pro Übung, automatische Gesamtdauer
- **PDF-Export**: druckoptimierter Trainingsplan über den Browser-Druckdialog (dort «Als PDF speichern» wählen)
- **Automatisches Speichern** im Browser (localStorage) – kein Account nötig

## Nutzung

Einfach `index.html` im Browser öffnen – fertig. Optional mit einem lokalen Server:

```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

## Technik

- Reines HTML/CSS/JavaScript, keine Abhängigkeiten
- `exercises.js` enthält die Übungsbibliothek und kann einfach erweitert werden
- Daten werden pro Browser im `localStorage` gespeichert
