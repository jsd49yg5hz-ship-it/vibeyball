/* End-to-End-Tests: startet den Server mit frischer Datenbank und testet die
 * wichtigsten Abläufe im Headless-Browser.
 *
 *   npm test
 *
 * Voraussetzung (einmalig): npx playwright install chromium
 */

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const { chromium } = require("playwright");

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "vibeyball-test-"));

let server;
let browser;
let failures = 0;

function check(name, condition) {
  console.log((condition ? "  ✓ " : "  ✗ ") + name);
  if (!condition) failures++;
}

async function startServer() {
  server = spawn("node", [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Server startet nicht")), 10000);
    server.stdout.on("data", (chunk) => {
      if (String(chunk).includes("läuft")) { clearTimeout(timer); resolve(); }
    });
    server.on("exit", () => reject(new Error("Server sofort beendet")));
  });
}

function createInviteCode() {
  const db = new Database(path.join(DATA_DIR, "vibeyball.db"));
  const code = "VB-TEST-" + Math.random().toString(36).slice(2, 6).toUpperCase();
  db.prepare("INSERT INTO invite_codes (code) VALUES (?)").run(code);
  db.close();
  return code;
}

async function run() {
  await startServer();
  const invite = createInviteCode();

  // ── Rate-Limiting (per fetch, eigene E-Mail, um den UI-Test nicht zu sperren) ──
  let last;
  for (let i = 0; i < 11; i++) {
    last = await fetch(BASE + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "locked@example.ch", password: "falsch" + i }),
    });
  }
  check("Rate-Limiting: 11. Fehlversuch liefert 429", last.status === 429);

  browser = await chromium.launch();
  const ctx = await browser.newContext({
    acceptDownloads: true,
    colorScheme: "light",
    viewport: { width: 1280, height: 1400 }, // hoch genug, damit Drag-Ziele im Viewport liegen
  });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await page.goto(BASE);

  // ── Registrierung mit Einladungscode ──
  await page.click("#tab-register");
  await page.fill("#auth-name", "Coach Test");
  await page.fill("#auth-email", "coach@example.ch");
  await page.fill("#auth-password", "geheim1234");
  await page.fill("#auth-invite", invite);
  await page.click("#auth-submit");
  await page.waitForSelector("#view-list:not(.hidden)");
  check("Registrierung mit Einladungscode", true);

  // ── Session erstellen (keine Vorlagen → direkt) ──
  await page.click("#btn-new-session");
  await page.waitForSelector("#view-editor:not(.hidden)");
  await page.fill("#f-title", "Testtraining");
  await page.fill("#f-team", "Damen 1");
  await page.fill("#f-time", "18:30");
  await page.locator("#f-tags .tag-chip", { hasText: "Annahme" }).click();
  await page.check("#f-done");

  // Übungen hinzufügen
  for (const q of ["Lauf-ABC", "Annahme nach Aufschlag", "Baggern an der Wand"]) {
    await page.fill("#f-search", q);
    await page.locator(".exercise-card .btn-add").first().click();
  }
  await page.fill("#f-search", "");
  check("Drei Übungen im Plan", (await page.locator(".plan-item").count()) === 3);

  // ── Speicher-Indikator ──
  await page.waitForSelector(".save-status.saved", { timeout: 5000 });
  check("Speicher-Indikator zeigt «Gespeichert»", true);

  // ── Drag & Drop: erstes Element ans Ende ziehen ──
  const firstName = await page.locator(".plan-item .name").first().textContent();
  const handleBox = await page.locator(".plan-item .drag-handle").first().boundingBox();
  const targetBox = await page.locator(".plan-item").nth(2).boundingBox();
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  // viele kleine Bewegungen, damit dragstart/dragover zuverlässig ausgelöst werden
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 15 });
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2 + 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const namesAfterDrag = await page.locator(".plan-item .name").allTextContents();
  check("Drag & Drop verschiebt Übung ans Ende", namesAfterDrag[namesAfterDrag.length - 1] === firstName);

  // Pfeil-Verschieben (funktioniert immer)
  const before = await page.locator(".plan-item .name").allTextContents();
  await page.locator('.plan-item [data-act="down"]').first().click();
  const after = await page.locator(".plan-item .name").allTextContents();
  check("Pfeil nach unten verschiebt Übung", after[1] === before[0]);

  // ── Favoriten: letzte Übung der Bibliothek markieren → erscheint zuoberst ──
  const lastExercise = await page.locator(".exercise-card .ex-name").last().textContent();
  await page.locator('.exercise-card [data-act="fav"]').last().click();
  await page.waitForTimeout(300);
  const firstAfterFav = await page.locator(".exercise-card .ex-name").first().textContent();
  check("Favorit erscheint zuoberst in der Bibliothek", firstAfterFav === lastExercise);

  // ── Als Vorlage speichern, neue Session daraus erstellen ──
  await page.click("#btn-template");
  await page.waitForSelector(".toast");
  await page.waitForTimeout(700);
  await page.click("#btn-back");
  await page.waitForSelector("#view-list:not(.hidden)");
  await page.click("#btn-new-session");
  await page.waitForSelector("#dlg-new-session[open]");
  check("Vorlagen-Dialog zeigt Vorlage", (await page.locator(".tpl-row").count()) === 1);
  await page.locator(".tpl-pick").first().click();
  await page.waitForSelector("#view-editor:not(.hidden)");
  const tplItems = await page.locator(".plan-item").count();
  const tplTitle = await page.inputValue("#f-title");
  check("Session aus Vorlage übernimmt Übungen", tplItems === 3);
  check("Session aus Vorlage übernimmt Titel", tplTitle === "Testtraining");
  const tplDone = await page.isChecked("#f-done");
  check("Session aus Vorlage ist nicht ausgeführt", !tplDone);
  await page.waitForTimeout(700);
  await page.click("#btn-back");

  // ── Statistik: Filter und Metriken ──
  await page.click("#tab-stats");
  await page.waitForSelector("#stats-panel:not(.hidden)");
  const countText = (await page.locator(".stats-list li", { hasText: "Annahme" }).textContent()) || "";
  check("Statistik zählt Anzahl (Annahme 1×)", countText.includes("1×"));
  await page.locator('#stats-metric [data-v="minutes"]').click();
  const minText = (await page.locator(".stats-list li", { hasText: "Annahme" }).textContent()) || "";
  check("Minuten-Metrik zeigt min-Wert", / min/.test(minText) && !minText.includes("0 min"));
  await page.locator('#stats-period [data-v="4w"]').click();
  check("Zeitraum-Filter rendert", (await page.locator("#stats-period .active").textContent()) === "4 Wochen");

  // ── Backup-Download ──
  await page.click("#tab-sessions");
  const [backup] = await Promise.all([page.waitForEvent("download"), page.click("#btn-backup")]);
  const backupPath = path.join(DATA_DIR, "backup.json");
  await backup.saveAs(backupPath);
  const backupData = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  check("Backup enthält Sessions/Übungen/Vorlagen",
    Array.isArray(backupData.sessions) && backupData.sessions.length === 2 &&
    Array.isArray(backupData.exercises) && Array.isArray(backupData.templates) && backupData.templates.length === 1);

  // ── Löschen mit Rückgängig ──
  const cardsBefore = await page.locator(".session-card").count();
  await page.locator('.session-card [data-act="del"]').first().click();
  await page.locator(".toast", { hasText: "gelöscht" }).waitFor();
  check("Löschen entfernt Karte", (await page.locator(".session-card").count()) === cardsBefore - 1);
  await page.locator(".toast", { hasText: "gelöscht" }).locator("button").click();
  await page.waitForTimeout(400);
  check("Rückgängig stellt Session wieder her", (await page.locator(".session-card").count()) === cardsBefore);

  // ── PDF-Download ──
  await page.locator(".session-card").first().click();
  await page.waitForSelector("#view-editor:not(.hidden)");
  const [pdf] = await Promise.all([page.waitForEvent("download"), page.click("#btn-pdf")]);
  check("PDF-Download", (pdf.suggestedFilename() || "").endsWith(".pdf"));

  check("Keine JavaScript-Fehler auf der Seite", pageErrors.length === 0);
  if (pageErrors.length) console.log("  Fehler:", pageErrors.join("; "));
}

run()
  .catch((e) => { console.error(e); failures++; })
  .finally(async () => {
    await browser?.close();
    server?.kill();
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    console.log(failures ? `\n${failures} Test(s) fehlgeschlagen` : "\nAlle Tests bestanden");
    process.exit(failures ? 1 : 0);
  });
