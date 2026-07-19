/* VibeyBall – Server: Auth, zentrale Speicherung (SQLite), Teilen-Links */

const express = require("express");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Geheimnis für Auth-Tokens (wird beim ersten Start erzeugt) ──
const SECRET_FILE = path.join(DATA_DIR, "secret.key");
const SECRET = process.env.SECRET_KEY ||
  (fs.existsSync(SECRET_FILE)
    ? fs.readFileSync(SECRET_FILE, "utf8").trim()
    : (() => {
        const s = crypto.randomBytes(32).toString("hex");
        fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 });
        return s;
      })());

// ── Datenbank ──
const db = new Database(path.join(DATA_DIR, "vibeyball.db"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    pass_hash TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    data TEXT NOT NULL,
    share_token TEXT UNIQUE,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS exercises (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS invite_codes (
    code TEXT PRIMARY KEY,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    used_by INTEGER REFERENCES users(id),
    used_at TEXT
  );
  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS blocks (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS exercise_images (
    user_id INTEGER NOT NULL REFERENCES users(id),
    exercise_id TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (user_id, exercise_id)
  );
  CREATE TABLE IF NOT EXISTS team_members (
    owner_id INTEGER NOT NULL REFERENCES users(id),
    member_id INTEGER NOT NULL REFERENCES users(id),
    role TEXT NOT NULL CHECK (role IN ('read', 'edit')),
    PRIMARY KEY (owner_id, member_id)
  );
`);

// Migrationen für bestehende Datenbanken
try { db.exec("ALTER TABLE users ADD COLUMN favorites TEXT DEFAULT '[]'"); } catch { /* Spalte existiert schon */ }
try { db.exec("ALTER TABLE exercises ADD COLUMN public INTEGER DEFAULT 0"); } catch { /* Spalte existiert schon */ }
try { db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0"); } catch { /* Spalte existiert schon */ }
try { db.exec("ALTER TABLE sessions ADD COLUMN version INTEGER DEFAULT 0"); } catch { /* Spalte existiert schon */ }
try { db.exec("ALTER TABLE sessions ADD COLUMN updated_by INTEGER"); } catch { /* Spalte existiert schon */ }
try { db.exec("ALTER TABLE sessions ADD COLUMN share_expires TEXT"); } catch { /* Spalte existiert schon */ }
try { db.exec("ALTER TABLE exercise_images ADD COLUMN updated_at TEXT"); } catch { /* Spalte existiert schon */ }

// Persistente Fehlversuch-Zähler fürs Rate-Limiting (überlebt Neustarts)
db.exec(`
  CREATE TABLE IF NOT EXISTS login_attempts (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    first INTEGER NOT NULL
  );
`);

// Bestehende Instanzen: ältester Benutzer wird Admin, falls noch keiner existiert
db.prepare(`
  UPDATE users SET is_admin = 1
  WHERE id = (SELECT MIN(id) FROM users)
    AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin = 1)
`).run();

// ── Auth-Token (HMAC-signiert, im httpOnly-Cookie) ──
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage

function signToken(userId) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + TOKEN_TTL_MS })).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return payload + "." + sig;
}

function verifyToken(token) {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return exp > Date.now() ? uid : null;
  } catch {
    return null;
  }
}

function getCookie(req, name) {
  const match = (req.headers.cookie || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]*)"));
  return match ? match[1] : null;
}

function setAuthCookie(res, token) {
  res.setHeader("Set-Cookie",
    `vb_auth=${token}; HttpOnly; Path=/; Max-Age=${TOKEN_TTL_MS / 1000}; SameSite=Lax`);
}

function requireAuth(req, res, next) {
  const uid = verifyToken(getCookie(req, "vb_auth"));
  if (!uid) return res.status(401).json({ error: "Nicht angemeldet" });
  req.userId = uid;
  next();
}

// Trainerteam: Der Header X-Workspace wählt, in wessen Datenbestand gearbeitet wird.
// Ohne Header (oder eigene ID) arbeitet man in den eigenen Daten mit vollen Rechten;
// fremde Workspaces erfordern eine Mitgliedschaft (Rolle read oder edit).
function workspace(req, res, next) {
  // Query-Parameter als Alternative zum Header, damit auch <img src>-Requests
  // (die keine eigenen Header setzen können) workspace-scoped funktionieren.
  const ws = parseInt(req.headers["x-workspace"], 10) || parseInt(req.query.ws, 10) || req.userId;
  if (ws === req.userId) {
    req.wsId = ws;
    req.canWrite = true;
    return next();
  }
  const membership = db.prepare("SELECT role FROM team_members WHERE owner_id = ? AND member_id = ?").get(ws, req.userId);
  if (!membership) return res.status(403).json({ error: "Kein Zugriff auf dieses Trainerteam." });
  req.wsId = ws;
  req.canWrite = membership.role === "edit";
  next();
}

function requireWrite(req, res, next) {
  if (!req.canWrite) return res.status(403).json({ error: "Nur-Lese-Zugriff in diesem Trainerteam." });
  next();
}

// ── Rate-Limiting für Login/Registrierung (persistent in SQLite) ──
const RATE_LIMIT = 10;                 // Fehlversuche …
const RATE_WINDOW_MS = 15 * 60 * 1000; // … pro 15 Minuten

// Alte Einträge beim Start aufräumen
db.prepare("DELETE FROM login_attempts WHERE first < ?").run(Date.now() - RATE_WINDOW_MS);

function clientIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";
}

function isRateLimited(key) {
  const entry = db.prepare("SELECT count, first FROM login_attempts WHERE key = ?").get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > RATE_WINDOW_MS) {
    db.prepare("DELETE FROM login_attempts WHERE key = ?").run(key);
    return false;
  }
  return entry.count >= RATE_LIMIT;
}

function recordFailure(key) {
  const entry = db.prepare("SELECT count, first FROM login_attempts WHERE key = ?").get(key);
  if (!entry || Date.now() - entry.first > RATE_WINDOW_MS) {
    db.prepare("INSERT OR REPLACE INTO login_attempts (key, count, first) VALUES (?, 1, ?)").run(key, Date.now());
  } else {
    db.prepare("UPDATE login_attempts SET count = count + 1 WHERE key = ?").run(key);
  }
}

function clearFailures(key) {
  db.prepare("DELETE FROM login_attempts WHERE key = ?").run(key);
}

function requireAdmin(req, res, next) {
  const row = db.prepare("SELECT is_admin FROM users WHERE id = ?").get(req.userId);
  if (!row?.is_admin) return res.status(403).json({ error: "Nur für Administratoren." });
  next();
}

// ── App ──
const app = express();

// Security-Header (CSP ohne Inline-Skripte; Inline-Styles bleiben erlaubt)
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; " +
    "base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  next();
});

app.use(express.json({ limit: "8mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ── Auth-Endpunkte ──
app.post("/api/register", (req, res) => {
  const { name, email, password, invite } = req.body || {};
  const rateKey = "reg|" + clientIp(req);
  if (isRateLimited(rateKey)) return res.status(429).json({ error: "Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen." });
  if (!name || !email || !email.includes("@")) return res.status(400).json({ error: "Name und gültige E-Mail angeben." });
  if (!password || password.length < 8) return res.status(400).json({ error: "Passwort braucht mindestens 8 Zeichen." });
  const code = (invite || "").trim().toUpperCase();
  const inviteRow = db.prepare("SELECT code FROM invite_codes WHERE code = ? AND used_by IS NULL").get(code);
  if (!inviteRow) {
    recordFailure(rateKey);
    return res.status(403).json({ error: "Ungültiger oder bereits verwendeter Einladungscode." });
  }
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: "Diese E-Mail ist bereits registriert." });
  // Der erste registrierte Benutzer wird automatisch Administrator
  const isFirst = !db.prepare("SELECT id FROM users LIMIT 1").get();
  const info = db.prepare("INSERT INTO users (email, name, pass_hash, is_admin) VALUES (?, ?, ?, ?)")
    .run(email.toLowerCase(), name, bcrypt.hashSync(password, 10), isFirst ? 1 : 0);
  db.prepare("UPDATE invite_codes SET used_by = ?, used_at = datetime('now') WHERE code = ?")
    .run(info.lastInsertRowid, code);
  setAuthCookie(res, signToken(info.lastInsertRowid));
  res.status(201).json({ id: info.lastInsertRowid, name, email: email.toLowerCase(), isAdmin: !!isFirst });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};
  const rateKey = "login|" + clientIp(req) + "|" + (email || "").toLowerCase();
  if (isRateLimited(rateKey)) return res.status(429).json({ error: "Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen." });
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get((email || "").toLowerCase());
  if (!user || !bcrypt.compareSync(password || "", user.pass_hash)) {
    recordFailure(rateKey);
    return res.status(401).json({ error: "E-Mail oder Passwort falsch." });
  }
  clearFailures(rateKey);
  setAuthCookie(res, signToken(user.id));
  res.json({ id: user.id, name: user.name, email: user.email, isAdmin: !!user.is_admin });
});

app.post("/api/logout", (_req, res) => {
  res.setHeader("Set-Cookie", "vb_auth=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
  res.json({ ok: true });
});

app.get("/api/me", requireAuth, (req, res) => {
  const user = db.prepare("SELECT id, name, email, is_admin FROM users WHERE id = ?").get(req.userId);
  res.json({ id: user.id, name: user.name, email: user.email, isAdmin: !!user.is_admin });
});

// ── Trainingssessions (und Matchtage: gleiche Tabelle, typ = "match") ──
app.get("/api/sessions", requireAuth, workspace, (req, res) => {
  const rows = db.prepare("SELECT data, share_token, version FROM sessions WHERE user_id = ?").all(req.wsId);
  res.json(rows.map((r) => ({ ...JSON.parse(r.data), shareToken: r.share_token, version: r.version })));
});

app.post("/api/sessions", requireAuth, workspace, requireWrite, (req, res) => {
  const s = req.body;
  if (!s || !s.id) return res.status(400).json({ error: "Ungültige Session." });
  db.prepare("INSERT INTO sessions (id, user_id, data, version, updated_by, updated_at) VALUES (?, ?, ?, 0, ?, datetime('now'))")
    .run(s.id, req.wsId, JSON.stringify(s), req.userId);
  res.status(201).json({ ok: true, version: 0 });
});

// Optimistische Sperre: Der Client schickt die Version mit, die er zuletzt gesehen
// hat. Hat inzwischen jemand anderes gespeichert, gibt es 409 samt aktuellem Stand.
app.put("/api/sessions/:id", requireAuth, workspace, requireWrite, (req, res) => {
  const row = db.prepare("SELECT version, updated_by FROM sessions WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.wsId);
  if (!row) return res.status(404).json({ error: "Session nicht gefunden." });

  const expected = Number.isInteger(req.body.version) ? req.body.version : row.version;
  const info = db.prepare(`
    UPDATE sessions SET data = ?, version = version + 1, updated_by = ?, updated_at = datetime('now')
    WHERE id = ? AND user_id = ? AND version = ?
  `).run(JSON.stringify(req.body), req.userId, req.params.id, req.wsId, expected);

  if (!info.changes) {
    const current = db.prepare(`
      SELECT s.data, s.version, s.share_token, u.name AS editor
      FROM sessions s LEFT JOIN users u ON u.id = s.updated_by
      WHERE s.id = ? AND s.user_id = ?
    `).get(req.params.id, req.wsId);
    return res.status(409).json({
      error: "Diese Session wurde inzwischen geändert.",
      editor: current.editor || "einer anderen Person",
      current: { ...JSON.parse(current.data), shareToken: current.share_token, version: current.version },
    });
  }
  res.json({ ok: true, version: expected + 1 });
});

app.delete("/api/sessions/:id", requireAuth, workspace, requireWrite, (req, res) => {
  db.prepare("DELETE FROM sessions WHERE id = ? AND user_id = ?").run(req.params.id, req.wsId);
  res.json({ ok: true });
});

// ── Teilen-Links (mit Ablaufdatum) ──
app.post("/api/sessions/:id/share", requireAuth, workspace, requireWrite, (req, res) => {
  const row = db.prepare("SELECT share_token FROM sessions WHERE id = ? AND user_id = ?").get(req.params.id, req.wsId);
  if (!row) return res.status(404).json({ error: "Session nicht gefunden." });
  const days = [7, 30, 365].includes(Number(req.body?.days)) ? Number(req.body.days) : 30;
  const token = row.share_token || crypto.randomBytes(12).toString("base64url");
  db.prepare("UPDATE sessions SET share_token = ?, share_expires = datetime('now', ?) WHERE id = ?")
    .run(token, `+${days} days`, req.params.id);
  const expires = db.prepare("SELECT share_expires FROM sessions WHERE id = ?").get(req.params.id).share_expires;
  res.json({ token, expires });
});

app.delete("/api/sessions/:id/share", requireAuth, workspace, requireWrite, (req, res) => {
  db.prepare("UPDATE sessions SET share_token = NULL WHERE id = ? AND user_id = ?").run(req.params.id, req.wsId);
  res.json({ ok: true });
});

app.get("/api/shared/:token", (req, res) => {
  const row = db.prepare("SELECT user_id, data, share_expires FROM sessions WHERE share_token = ?").get(req.params.token);
  if (!row) return res.status(404).json({ error: "Geteilter Plan nicht gefunden." });
  if (row.share_expires && row.share_expires < new Date().toISOString().slice(0, 19).replace("T", " ")) {
    return res.status(410).json({ error: "Dieser Teilen-Link ist abgelaufen." });
  }
  const session = JSON.parse(row.data);
  // Skizzen der verwendeten Übungen mitliefern, damit die geteilte Ansicht sie zeigen kann
  const images = {};
  for (const item of session.items || []) {
    const img = db.prepare("SELECT data FROM exercise_images WHERE user_id = ? AND exercise_id = ?")
      .get(row.user_id, item.exerciseId);
    if (img) images[item.exerciseId] = img.data;
  }
  res.json({ ...session, images });
});

app.get("/share/:token", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "share.html"));
});

// ── Übungen (eigene + von anderen Coaches geteilte) ──
app.get("/api/exercises", requireAuth, workspace, (req, res) => {
  const own = db.prepare("SELECT data FROM exercises WHERE user_id = ?").all(req.wsId)
    .map((r) => JSON.parse(r.data));
  const shared = db.prepare(`
    SELECT e.data, u.name AS autor FROM exercises e
    JOIN users u ON u.id = e.user_id
    WHERE e.public = 1 AND e.user_id != ?
  `).all(req.wsId)
    .map((r) => ({ ...JSON.parse(r.data), autor: r.autor, fremd: true }));
  res.json([...own, ...shared]);
});

app.post("/api/exercises", requireAuth, workspace, requireWrite, (req, res) => {
  const ex = req.body;
  if (!ex || !ex.id || !ex.name) return res.status(400).json({ error: "Ungültige Übung." });
  db.prepare("INSERT INTO exercises (id, user_id, data, public) VALUES (?, ?, ?, ?)")
    .run(ex.id, req.wsId, JSON.stringify(ex), ex.oeffentlich ? 1 : 0);
  res.status(201).json({ ok: true });
});

app.put("/api/exercises/:id", requireAuth, workspace, requireWrite, (req, res) => {
  const info = db.prepare("UPDATE exercises SET data = ?, public = ? WHERE id = ? AND user_id = ?")
    .run(JSON.stringify(req.body), req.body.oeffentlich ? 1 : 0, req.params.id, req.wsId);
  if (!info.changes) return res.status(404).json({ error: "Übung nicht gefunden." });
  res.json({ ok: true });
});

app.delete("/api/exercises/:id", requireAuth, workspace, requireWrite, (req, res) => {
  db.prepare("DELETE FROM exercises WHERE id = ? AND user_id = ?").run(req.params.id, req.wsId);
  res.json({ ok: true });
});

// ── Übungs-Skizzen/Bilder (pro Workspace, für beliebige Übungen) ──
// Die Liste liefert nur Metadaten (Versionsstempel + Typ), die Bilddaten selbst
// kommen einzeln und cachebar über GET /api/exercise-images/:id.
app.get("/api/exercise-images", requireAuth, workspace, (req, res) => {
  const rows = db.prepare(`
    SELECT exercise_id, updated_at,
           CASE WHEN data LIKE 'data:image/svg%' THEN 'svg' ELSE 'raster' END AS type
    FROM exercise_images WHERE user_id = ?
    UNION
    SELECT ei.exercise_id, ei.updated_at,
           CASE WHEN ei.data LIKE 'data:image/svg%' THEN 'svg' ELSE 'raster' END AS type
    FROM exercise_images ei
    JOIN exercises e ON e.id = ei.exercise_id AND e.user_id = ei.user_id
    WHERE e.public = 1 AND e.user_id != ?
  `).all(req.wsId, req.wsId);
  res.json(Object.fromEntries(rows.map((r) => [r.exercise_id, { v: r.updated_at || "0", type: r.type }])));
});

// Data-URL aus der Datenbank in echte Bild-Bytes umwandeln und cachebar ausliefern
function sendImage(res, dataUrl) {
  const match = dataUrl.match(/^data:(image\/[a-z+.-]+);base64,(.*)$/s);
  if (!match) return res.status(500).json({ error: "Bild beschädigt." });
  res.setHeader("Content-Type", match[1]);
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.send(Buffer.from(match[2], "base64"));
}

app.get("/api/exercise-images/:exerciseId", requireAuth, workspace, (req, res) => {
  let row = db.prepare("SELECT data FROM exercise_images WHERE user_id = ? AND exercise_id = ?")
    .get(req.wsId, req.params.exerciseId);
  if (!row) {
    // Fallback: Skizze des Autors einer instanzweit geteilten Übung
    row = db.prepare(`
      SELECT ei.data FROM exercise_images ei
      JOIN exercises e ON e.id = ei.exercise_id AND e.user_id = ei.user_id
      WHERE ei.exercise_id = ? AND e.public = 1
    `).get(req.params.exerciseId);
  }
  if (!row) return res.status(404).json({ error: "Keine Skizze vorhanden." });
  sendImage(res, row.data);
});

app.put("/api/exercise-images/:exerciseId", requireAuth, workspace, requireWrite, (req, res) => {
  const { data } = req.body || {};
  if (typeof data !== "string" || !data.startsWith("data:image/") || data.length > 2_000_000) {
    return res.status(400).json({ error: "Ungültiges oder zu grosses Bild (max. ~1.5 MB)." });
  }
  db.prepare("INSERT OR REPLACE INTO exercise_images (user_id, exercise_id, data, updated_at) VALUES (?, ?, ?, datetime('now'))")
    .run(req.wsId, req.params.exerciseId, data);
  res.json({ ok: true });
});

app.delete("/api/exercise-images/:exerciseId", requireAuth, workspace, requireWrite, (req, res) => {
  db.prepare("DELETE FROM exercise_images WHERE user_id = ? AND exercise_id = ?").run(req.wsId, req.params.exerciseId);
  res.json({ ok: true });
});

// ── Einladungscodes (Admin) ──
app.get("/api/invites", requireAuth, requireAdmin, (_req, res) => {
  const rows = db.prepare(`
    SELECT c.code, c.created_at, c.used_at, u.email AS used_by
    FROM invite_codes c LEFT JOIN users u ON u.id = c.used_by
    ORDER BY c.created_at DESC
  `).all();
  res.json(rows);
});

const INVITE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
app.post("/api/invites", requireAuth, requireAdmin, (_req, res) => {
  const part = (n) => Array.from(crypto.randomBytes(n), (b) => INVITE_ALPHABET[b % INVITE_ALPHABET.length]).join("");
  const code = `VB-${part(4)}-${part(4)}`;
  db.prepare("INSERT INTO invite_codes (code) VALUES (?)").run(code);
  res.status(201).json({ code });
});

app.delete("/api/invites/:code", requireAuth, requireAdmin, (req, res) => {
  db.prepare("DELETE FROM invite_codes WHERE code = ? AND used_by IS NULL").run(req.params.code);
  res.json({ ok: true });
});

// ── Session-Vorlagen ──
app.get("/api/templates", requireAuth, workspace, (req, res) => {
  const rows = db.prepare("SELECT data FROM templates WHERE user_id = ?").all(req.wsId);
  res.json(rows.map((r) => JSON.parse(r.data)));
});

app.post("/api/templates", requireAuth, workspace, requireWrite, (req, res) => {
  const tpl = req.body;
  if (!tpl || !tpl.id || !tpl.name) return res.status(400).json({ error: "Ungültige Vorlage." });
  db.prepare("INSERT INTO templates (id, user_id, data) VALUES (?, ?, ?)").run(tpl.id, req.wsId, JSON.stringify(tpl));
  res.status(201).json({ ok: true });
});

app.delete("/api/templates/:id", requireAuth, workspace, requireWrite, (req, res) => {
  db.prepare("DELETE FROM templates WHERE id = ? AND user_id = ?").run(req.params.id, req.wsId);
  res.json({ ok: true });
});

// ── Saisonblöcke ──
app.get("/api/blocks", requireAuth, workspace, (req, res) => {
  const rows = db.prepare("SELECT data FROM blocks WHERE user_id = ?").all(req.wsId);
  res.json(rows.map((r) => JSON.parse(r.data)));
});

app.post("/api/blocks", requireAuth, workspace, requireWrite, (req, res) => {
  const block = req.body;
  if (!block || !block.id || !block.name) return res.status(400).json({ error: "Ungültiger Block." });
  db.prepare("INSERT OR REPLACE INTO blocks (id, user_id, data) VALUES (?, ?, ?)")
    .run(block.id, req.wsId, JSON.stringify(block));
  res.status(201).json({ ok: true });
});

app.delete("/api/blocks/:id", requireAuth, workspace, requireWrite, (req, res) => {
  db.prepare("DELETE FROM blocks WHERE id = ? AND user_id = ?").run(req.params.id, req.wsId);
  res.json({ ok: true });
});

// ── Übungs-Favoriten (persönlich, unabhängig vom Workspace) ──
app.get("/api/favorites", requireAuth, (req, res) => {
  const row = db.prepare("SELECT favorites FROM users WHERE id = ?").get(req.userId);
  try { res.json(JSON.parse(row.favorites || "[]")); } catch { res.json([]); }
});

app.put("/api/favorites", requireAuth, (req, res) => {
  const favs = req.body;
  if (!Array.isArray(favs) || favs.some((f) => typeof f !== "string")) {
    return res.status(400).json({ error: "Ungültige Favoritenliste." });
  }
  db.prepare("UPDATE users SET favorites = ? WHERE id = ?").run(JSON.stringify(favs), req.userId);
  res.json({ ok: true });
});

// ── Trainerteam ──
app.get("/api/workspaces", requireAuth, (req, res) => {
  const memberships = db.prepare(`
    SELECT t.owner_id AS id, u.name, t.role FROM team_members t
    JOIN users u ON u.id = t.owner_id WHERE t.member_id = ?
  `).all(req.userId);
  res.json(memberships);
});

app.get("/api/team", requireAuth, (req, res) => {
  const members = db.prepare(`
    SELECT u.id, u.name, u.email, t.role FROM team_members t
    JOIN users u ON u.id = t.member_id WHERE t.owner_id = ?
  `).all(req.userId);
  res.json(members);
});

app.post("/api/team", requireAuth, (req, res) => {
  const { email, role } = req.body || {};
  if (!["read", "edit"].includes(role)) return res.status(400).json({ error: "Ungültige Rolle." });
  const member = db.prepare("SELECT id, name FROM users WHERE email = ?").get((email || "").toLowerCase());
  if (!member) return res.status(404).json({ error: "Kein Konto mit dieser E-Mail gefunden. Die Person muss sich zuerst registrieren." });
  if (member.id === req.userId) return res.status(400).json({ error: "Du kannst dich nicht selbst einladen." });
  db.prepare("INSERT OR REPLACE INTO team_members (owner_id, member_id, role) VALUES (?, ?, ?)")
    .run(req.userId, member.id, role);
  res.status(201).json({ id: member.id, name: member.name, email: (email || "").toLowerCase(), role });
});

app.put("/api/team/:memberId", requireAuth, (req, res) => {
  const { role } = req.body || {};
  if (!["read", "edit"].includes(role)) return res.status(400).json({ error: "Ungültige Rolle." });
  const info = db.prepare("UPDATE team_members SET role = ? WHERE owner_id = ? AND member_id = ?")
    .run(role, req.userId, req.params.memberId);
  if (!info.changes) return res.status(404).json({ error: "Mitglied nicht gefunden." });
  res.json({ ok: true });
});

app.delete("/api/team/:memberId", requireAuth, (req, res) => {
  db.prepare("DELETE FROM team_members WHERE owner_id = ? AND member_id = ?").run(req.userId, req.params.memberId);
  res.json({ ok: true });
});

// ── Passwort ändern ──
app.post("/api/change-password", requireAuth, (req, res) => {
  const { current, next: nextPassword } = req.body || {};
  if (!nextPassword || nextPassword.length < 8) return res.status(400).json({ error: "Neues Passwort braucht mindestens 8 Zeichen." });
  const user = db.prepare("SELECT pass_hash FROM users WHERE id = ?").get(req.userId);
  if (!bcrypt.compareSync(current || "", user.pass_hash)) {
    return res.status(403).json({ error: "Aktuelles Passwort ist falsch." });
  }
  db.prepare("UPDATE users SET pass_hash = ? WHERE id = ?").run(bcrypt.hashSync(nextPassword, 10), req.userId);
  res.json({ ok: true });
});

// ── Backup-Export & -Import ──
app.get("/api/export", requireAuth, workspace, (req, res) => {
  const parse = (rows) => rows.map((r) => JSON.parse(r.data));
  const images = db.prepare("SELECT exercise_id, data FROM exercise_images WHERE user_id = ?").all(req.wsId);
  res.json({
    exportedAt: new Date().toISOString(),
    sessions: parse(db.prepare("SELECT data FROM sessions WHERE user_id = ?").all(req.wsId)),
    exercises: parse(db.prepare("SELECT data FROM exercises WHERE user_id = ?").all(req.wsId)),
    templates: parse(db.prepare("SELECT data FROM templates WHERE user_id = ?").all(req.wsId)),
    blocks: parse(db.prepare("SELECT data FROM blocks WHERE user_id = ?").all(req.wsId)),
    exerciseImages: Object.fromEntries(images.map((r) => [r.exercise_id, r.data])),
  });
});

app.post("/api/import", requireAuth, workspace, requireWrite, (req, res) => {
  const b = req.body || {};
  const counts = { sessions: 0, exercises: 0, templates: 0, blocks: 0, images: 0 };
  const tx = db.transaction(() => {
    for (const s of b.sessions || []) {
      if (!s.id) continue;
      db.prepare("INSERT OR REPLACE INTO sessions (id, user_id, data, updated_at) VALUES (?, ?, ?, datetime('now'))")
        .run(s.id, req.wsId, JSON.stringify(s));
      counts.sessions++;
    }
    for (const ex of b.exercises || []) {
      if (!ex.id) continue;
      db.prepare("INSERT OR REPLACE INTO exercises (id, user_id, data, public) VALUES (?, ?, ?, ?)")
        .run(ex.id, req.wsId, JSON.stringify(ex), ex.oeffentlich ? 1 : 0);
      counts.exercises++;
    }
    for (const tpl of b.templates || []) {
      if (!tpl.id) continue;
      db.prepare("INSERT OR REPLACE INTO templates (id, user_id, data) VALUES (?, ?, ?)")
        .run(tpl.id, req.wsId, JSON.stringify(tpl));
      counts.templates++;
    }
    for (const block of b.blocks || []) {
      if (!block.id) continue;
      db.prepare("INSERT OR REPLACE INTO blocks (id, user_id, data) VALUES (?, ?, ?)")
        .run(block.id, req.wsId, JSON.stringify(block));
      counts.blocks++;
    }
    for (const [exId, data] of Object.entries(b.exerciseImages || {})) {
      if (typeof data !== "string" || !data.startsWith("data:image/")) continue;
      db.prepare("INSERT OR REPLACE INTO exercise_images (user_id, exercise_id, data) VALUES (?, ?, ?)")
        .run(req.wsId, exId, data);
      counts.images++;
    }
  });
  tx();
  res.json(counts);
});

app.listen(PORT, () => {
  console.log(`VibeyBall läuft auf http://localhost:${PORT}`);
});
