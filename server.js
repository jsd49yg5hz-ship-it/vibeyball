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
`);

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

// ── App ──
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ── Auth-Endpunkte ──
app.post("/api/register", (req, res) => {
  const { name, email, password, invite } = req.body || {};
  if (!name || !email || !email.includes("@")) return res.status(400).json({ error: "Name und gültige E-Mail angeben." });
  if (!password || password.length < 8) return res.status(400).json({ error: "Passwort braucht mindestens 8 Zeichen." });
  const code = (invite || "").trim().toUpperCase();
  const inviteRow = db.prepare("SELECT code FROM invite_codes WHERE code = ? AND used_by IS NULL").get(code);
  if (!inviteRow) return res.status(403).json({ error: "Ungültiger oder bereits verwendeter Einladungscode." });
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: "Diese E-Mail ist bereits registriert." });
  const info = db.prepare("INSERT INTO users (email, name, pass_hash) VALUES (?, ?, ?)")
    .run(email.toLowerCase(), name, bcrypt.hashSync(password, 10));
  db.prepare("UPDATE invite_codes SET used_by = ?, used_at = datetime('now') WHERE code = ?")
    .run(info.lastInsertRowid, code);
  setAuthCookie(res, signToken(info.lastInsertRowid));
  res.status(201).json({ id: info.lastInsertRowid, name, email: email.toLowerCase() });
});

app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get((email || "").toLowerCase());
  if (!user || !bcrypt.compareSync(password || "", user.pass_hash)) {
    return res.status(401).json({ error: "E-Mail oder Passwort falsch." });
  }
  setAuthCookie(res, signToken(user.id));
  res.json({ id: user.id, name: user.name, email: user.email });
});

app.post("/api/logout", (_req, res) => {
  res.setHeader("Set-Cookie", "vb_auth=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
  res.json({ ok: true });
});

app.get("/api/me", requireAuth, (req, res) => {
  const user = db.prepare("SELECT id, name, email FROM users WHERE id = ?").get(req.userId);
  res.json(user);
});

// ── Trainingssessions ──
app.get("/api/sessions", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT data, share_token FROM sessions WHERE user_id = ?").all(req.userId);
  res.json(rows.map((r) => ({ ...JSON.parse(r.data), shareToken: r.share_token })));
});

app.post("/api/sessions", requireAuth, (req, res) => {
  const s = req.body;
  if (!s || !s.id) return res.status(400).json({ error: "Ungültige Session." });
  db.prepare("INSERT INTO sessions (id, user_id, data, updated_at) VALUES (?, ?, ?, datetime('now'))")
    .run(s.id, req.userId, JSON.stringify(s));
  res.status(201).json({ ok: true });
});

app.put("/api/sessions/:id", requireAuth, (req, res) => {
  const info = db.prepare("UPDATE sessions SET data = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
    .run(JSON.stringify(req.body), req.params.id, req.userId);
  if (!info.changes) return res.status(404).json({ error: "Session nicht gefunden." });
  res.json({ ok: true });
});

app.delete("/api/sessions/:id", requireAuth, (req, res) => {
  db.prepare("DELETE FROM sessions WHERE id = ? AND user_id = ?").run(req.params.id, req.userId);
  res.json({ ok: true });
});

// ── Teilen-Links ──
app.post("/api/sessions/:id/share", requireAuth, (req, res) => {
  const row = db.prepare("SELECT share_token FROM sessions WHERE id = ? AND user_id = ?").get(req.params.id, req.userId);
  if (!row) return res.status(404).json({ error: "Session nicht gefunden." });
  const token = row.share_token || crypto.randomBytes(12).toString("base64url");
  db.prepare("UPDATE sessions SET share_token = ? WHERE id = ?").run(token, req.params.id);
  res.json({ token });
});

app.delete("/api/sessions/:id/share", requireAuth, (req, res) => {
  db.prepare("UPDATE sessions SET share_token = NULL WHERE id = ? AND user_id = ?").run(req.params.id, req.userId);
  res.json({ ok: true });
});

app.get("/api/shared/:token", (req, res) => {
  const row = db.prepare("SELECT data FROM sessions WHERE share_token = ?").get(req.params.token);
  if (!row) return res.status(404).json({ error: "Geteilter Plan nicht gefunden." });
  res.json(JSON.parse(row.data));
});

app.get("/share/:token", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "share.html"));
});

// ── Eigene Übungen ──
app.get("/api/exercises", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT data FROM exercises WHERE user_id = ?").all(req.userId);
  res.json(rows.map((r) => JSON.parse(r.data)));
});

app.post("/api/exercises", requireAuth, (req, res) => {
  const ex = req.body;
  if (!ex || !ex.id || !ex.name) return res.status(400).json({ error: "Ungültige Übung." });
  db.prepare("INSERT INTO exercises (id, user_id, data) VALUES (?, ?, ?)").run(ex.id, req.userId, JSON.stringify(ex));
  res.status(201).json({ ok: true });
});

app.put("/api/exercises/:id", requireAuth, (req, res) => {
  const info = db.prepare("UPDATE exercises SET data = ? WHERE id = ? AND user_id = ?")
    .run(JSON.stringify(req.body), req.params.id, req.userId);
  if (!info.changes) return res.status(404).json({ error: "Übung nicht gefunden." });
  res.json({ ok: true });
});

app.delete("/api/exercises/:id", requireAuth, (req, res) => {
  db.prepare("DELETE FROM exercises WHERE id = ? AND user_id = ?").run(req.params.id, req.userId);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`VibeyBall läuft auf http://localhost:${PORT}`);
});
