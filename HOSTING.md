# VibeyBall auf der eigenen Website hosten – Schritt für Schritt

VibeyBall besteht aus einem kleinen Node.js-Server (Login, zentrale Speicherung in SQLite)
und dem Frontend im Ordner `public/`. Reines statisches Hosting (z. B. GitHub Pages)
reicht deshalb **nicht** – du brauchst einen Server, auf dem Node.js laufen kann.

Die üblichste Variante für eine eigene Website ist ein kleiner **VPS** (virtueller Server,
z. B. bei Hetzner, Infomaniak, DigitalOcean ab ca. 4–6 CHF/Monat). Die Anleitung unten
geht diesen Weg komplett durch. Am Ende findest du Alternativen (Docker, Plattformen wie
Railway/Render) und wie du die App unter einem Unterpfad deiner bestehenden Website einbindest.

---

## Variante A: Eigener Server (VPS) mit Nginx und HTTPS

### Schritt 1: Server vorbereiten

Miete einen kleinen VPS mit Ubuntu 24.04 (1 vCPU / 1 GB RAM genügt völlig) und verbinde dich:

```bash
ssh root@DEINE-SERVER-IP
```

System aktualisieren und Node.js 22 installieren:

```bash
apt update && apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs git nginx
node --version   # sollte v22.x anzeigen
```

### Schritt 2: App auf den Server bringen

```bash
# Als eigener Benutzer (empfohlen, nicht als root laufen lassen):
adduser --system --group --home /opt/vibeyball vibeyball

# Code holen (per git clone von deinem Repo – oder per scp hochladen):
git clone https://github.com/DEIN-BENUTZER/vibeyball.git /opt/vibeyball/app
cd /opt/vibeyball/app
npm ci --omit=dev

chown -R vibeyball:vibeyball /opt/vibeyball
```

Kurz testen:

```bash
sudo -u vibeyball node server.js
# → "VibeyBall läuft auf http://localhost:3000", mit Ctrl+C beenden
```

### Schritt 3: Als Dienst einrichten (startet automatisch, auch nach Reboot)

Datei `/etc/systemd/system/vibeyball.service` anlegen:

```ini
[Unit]
Description=VibeyBall Trainingsplaner
After=network.target

[Service]
Type=simple
User=vibeyball
WorkingDirectory=/opt/vibeyball/app
ExecStart=/usr/bin/node server.js
Restart=always
Environment=PORT=3000
Environment=DATA_DIR=/opt/vibeyball/data

[Install]
WantedBy=multi-user.target
```

Dienst aktivieren:

```bash
mkdir -p /opt/vibeyball/data && chown vibeyball:vibeyball /opt/vibeyball/data
systemctl daemon-reload
systemctl enable --now vibeyball
systemctl status vibeyball   # sollte "active (running)" zeigen
```

### Schritt 4: Domain aufschalten

Lege beim DNS-Anbieter deiner Domain einen **A-Record** an, der auf die Server-IP zeigt,
z. B. `training.deine-domain.ch → DEINE-SERVER-IP`. (Eine Subdomain ist am einfachsten;
für einen Unterpfad wie `deine-domain.ch/training` siehe unten.)

### Schritt 5: Nginx als Reverse Proxy

Datei `/etc/nginx/sites-available/vibeyball` anlegen:

```nginx
server {
    listen 80;
    server_name training.deine-domain.ch;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Aktivieren:

```bash
ln -s /etc/nginx/sites-available/vibeyball /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### Schritt 6: HTTPS mit Let's Encrypt (gratis, Pflicht wegen Passwörtern!)

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d training.deine-domain.ch
```

Certbot richtet das Zertifikat samt automatischer Erneuerung und HTTP→HTTPS-Umleitung ein.

**Fertig!** Die App läuft jetzt unter `https://training.deine-domain.ch`. 🎉

### Schritt 7: Backups (empfohlen)

Alle Daten liegen in einer einzigen Datei: `/opt/vibeyball/data/vibeyball.db`
(plus `secret.key` daneben). Ein nächtliches Backup per Cronjob:

```bash
crontab -e
# Zeile hinzufügen (Backup täglich um 03:00):
0 3 * * * cp /opt/vibeyball/data/vibeyball.db /opt/vibeyball/backup-$(date +\%a).db
```

### Updates einspielen

```bash
cd /opt/vibeyball/app
sudo -u vibeyball git pull
sudo -u vibeyball npm ci --omit=dev
systemctl restart vibeyball
```

---

## Variante B: Docker

Wenn dein Server Docker hat, geht es noch schneller (Schritte 4–6 von oben gelten weiterhin):

```bash
git clone https://github.com/DEIN-BENUTZER/vibeyball.git && cd vibeyball
docker build -t vibeyball .
docker run -d --name vibeyball --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -v vibeyball-data:/app/data \
  vibeyball
```

---

## Variante C: Hosting-Plattform (ohne eigenen Server)

Plattformen wie **Railway**, **Render** oder **Fly.io** können das Repo direkt deployen:

1. Repo bei GitHub pushen.
2. Auf der Plattform «New Project → Deploy from GitHub» wählen, das Repo verbinden.
3. Startbefehl: `npm start`, Port wird über die Umgebungsvariable `PORT` automatisch übernommen.
4. **Wichtig:** Ein *persistentes Volume* einrichten und die Umgebungsvariable
   `DATA_DIR` auf dessen Pfad setzen (z. B. `/data`) – sonst ist die Datenbank
   nach jedem Deployment leer.
5. Eigene Domain in den Plattform-Einstellungen verbinden (CNAME-Record setzen).

---

## App unter einem Unterpfad der bestehenden Website (z. B. deine-domain.ch/training)

Das Frontend verwendet durchgehend relative Pfade und funktioniert daher auch
unter einem Unterpfad. In der Nginx-Konfiguration deiner bestehenden Website ergänzen:

```nginx
location /training/ {
    proxy_pass http://127.0.0.1:3000/;   # der Schrägstrich am Ende ist wichtig
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Aufruf dann über `https://deine-domain.ch/training/` (mit Schrägstrich am Ende).

---

## Wichtige Hinweise

- **Daten:** Alles liegt in `DATA_DIR` (Standard: `./data`) – eine SQLite-Datei und der
  Schlüssel `secret.key`, mit dem die Login-Cookies signiert werden. Diesen Ordner sichern!
- **HTTPS ist Pflicht,** sobald echte Benutzer Passwörter eingeben.
- **Registrierung nur mit Einladungscode:** Neue Konten brauchen einen einmalig
  verwendbaren Code. Auf dem Server erzeugen (Umgebungsvariable `DATA_DIR` muss auf
  denselben Datenordner zeigen wie beim Dienst):

  ```bash
  cd /opt/vibeyball/app
  sudo -u vibeyball DATA_DIR=/opt/vibeyball/data npm run invite          # 1 Code
  sudo -u vibeyball DATA_DIR=/opt/vibeyball/data npm run invite -- 5     # 5 Codes
  sudo -u vibeyball DATA_DIR=/opt/vibeyball/data npm run invite -- list  # Status ansehen
  ```

  Den ersten Code brauchst du für deine eigene Registrierung direkt nach dem Deployment.
