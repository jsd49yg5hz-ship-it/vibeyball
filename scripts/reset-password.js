/* Passwort eines Benutzers zurücksetzen.
 *   npm run reset-password -- coach@verein.ch            → zufälliges Passwort erzeugen
 *   npm run reset-password -- coach@verein.ch NeuesPass  → bestimmtes Passwort setzen
 */

const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const db = new Database(path.join(DATA_DIR, "vibeyball.db"));

const email = (process.argv[2] || "").toLowerCase();
let password = process.argv[3];

if (!email) {
  console.log("Verwendung: npm run reset-password -- <email> [neues-passwort]");
  process.exit(1);
}

const user = db.prepare("SELECT id, name FROM users WHERE email = ?").get(email);
if (!user) {
  console.error("Kein Konto mit dieser E-Mail gefunden: " + email);
  process.exit(1);
}

if (!password) {
  const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
  password = Array.from(crypto.randomBytes(12), (b) => ALPHABET[b % ALPHABET.length]).join("");
}
if (password.length < 8) {
  console.error("Passwort braucht mindestens 8 Zeichen.");
  process.exit(1);
}

db.prepare("UPDATE users SET pass_hash = ? WHERE id = ?").run(bcrypt.hashSync(password, 10), user.id);
console.log(`Passwort für ${user.name} (${email}) zurückgesetzt.`);
console.log("Neues Passwort: " + password);
