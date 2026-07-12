/* Einladungscodes verwalten.
 *   npm run invite          → einen neuen Code erzeugen
 *   npm run invite -- 5     → fünf neue Codes erzeugen
 *   npm run invite -- list  → alle Codes mit Status anzeigen
 */

const Database = require("better-sqlite3");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, "vibeyball.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS invite_codes (
    code TEXT PRIMARY KEY,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    used_by INTEGER,
    used_at TEXT
  );
`);

// Ohne leicht verwechselbare Zeichen (0/O, 1/I/L)
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function generateCode() {
  const part = (n) => Array.from(crypto.randomBytes(n), (b) => ALPHABET[b % ALPHABET.length]).join("");
  return `VB-${part(4)}-${part(4)}`;
}

const arg = process.argv[2];

if (arg === "list") {
  const rows = db.prepare(`
    SELECT c.code, c.created_at, c.used_at, u.email
    FROM invite_codes c LEFT JOIN users u ON u.id = c.used_by
    ORDER BY c.created_at DESC
  `).all();
  if (!rows.length) {
    console.log("Noch keine Einladungscodes vorhanden. Mit `npm run invite` einen erzeugen.");
  }
  for (const r of rows) {
    console.log(`${r.code}  ${r.email ? "verwendet von " + r.email + " (" + r.used_at + ")" : "offen (erstellt " + r.created_at + ")"}`);
  }
} else {
  const count = Math.min(100, Math.max(1, Number(arg) || 1));
  const insert = db.prepare("INSERT INTO invite_codes (code) VALUES (?)");
  for (let i = 0; i < count; i++) {
    const code = generateCode();
    insert.run(code);
    console.log(code);
  }
}
