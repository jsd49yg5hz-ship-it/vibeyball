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

  // ── Security-Header ──
  const headersRes = await fetch(BASE + "/");
  check("Security-Header gesetzt (CSP, X-Frame-Options)",
    (headersRes.headers.get("content-security-policy") || "").includes("script-src 'self'") &&
    headersRes.headers.get("x-frame-options") === "DENY");

  // ── Rate-Limiting überlebt in der Datenbank ──
  const attemptsDb = new Database(path.join(DATA_DIR, "vibeyball.db"));
  const attemptRows = attemptsDb.prepare("SELECT COUNT(*) AS n FROM login_attempts").get();
  attemptsDb.close();
  check("Fehlversuche persistent in SQLite", attemptRows.n >= 1);

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

  // ── Punkt 2 & 10: Nachbereitung mit Bewertung und Anwesenheit ──
  await page.waitForSelector("#dlg-review[open]");
  check("Nachbereitungs-Dialog öffnet beim Ausführen", true);
  await page.locator('#review-stars [data-v="4"]').click();
  await page.fill("#review-present", "9");
  await page.fill("#review-total", "12");
  await page.fill("#review-note", "Mehr Aufschlagdruck");
  await page.click('#review-form button[type="submit"]');
  await page.locator("#dlg-review[open]").waitFor({ state: "hidden" });
  const reviewText = await page.textContent("#review-text");
  check("Editor zeigt Nachbereitung", reviewText.includes("★★★★☆") && reviewText.includes("9/12"));

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
  await page.click("#btn-back");
  await page.waitForSelector("#view-list:not(.hidden)");

  // ── Punkt 2/10: Nachbereitung auf der Karte sichtbar ──
  const doneCardText = (await page.locator(".session-card.is-done", { hasText: "Testtraining" }).first().textContent()) || "";
  check("Karte zeigt Bewertung und Anwesenheit", doneCardText.includes("★★★★☆") && doneCardText.includes("9/12"));

  // ── Punkt 6: Matchtag erfassen und bearbeiten ──
  await page.click("#btn-new-match");
  await page.waitForSelector("#dlg-match[open]");
  await page.fill("#match-opponent", "VBC Winterthur");
  await page.fill("#match-result", "3:1");
  await page.fill("#match-team", "Damen 1");
  await page.click('#match-form button[type="submit"]');
  await page.locator("#dlg-match[open]").waitFor({ state: "hidden" });
  const matchCardLoc = page.locator(".match-card", { hasText: "VBC Winterthur" });
  check("Match-Karte sichtbar mit Resultat", ((await matchCardLoc.textContent()) || "").includes("3:1"));
  await matchCardLoc.click();
  await page.waitForSelector("#dlg-match[open]");
  check("Match-Dialog lädt Werte zum Bearbeiten", (await page.inputValue("#match-opponent")) === "VBC Winterthur");
  await page.fill("#match-result", "3:2");
  await page.click('#match-form button[type="submit"]');
  await page.locator("#dlg-match[open]").waitFor({ state: "hidden" });
  check("Match-Bearbeitung gespeichert", ((await matchCardLoc.textContent()) || "").includes("3:2"));

  // ── Punkt 4: Saisonblock anlegen, Badge + Statistik-Filter ──
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAhead = new Date(today); weekAhead.setDate(weekAhead.getDate() + 7);
  await page.click("#btn-blocks");
  await page.waitForSelector("#dlg-blocks[open]");
  await page.fill("#block-name", "Saisonvorbereitung");
  await page.fill("#block-from", iso(weekAgo));
  await page.fill("#block-to", iso(weekAhead));
  await page.fill("#block-goal", "Annahme stabilisieren");
  await page.click('#block-form button[type="submit"]');
  await page.locator("#blocks-list .tpl-row", { hasText: "Saisonvorbereitung" }).waitFor();
  await page.click("#btn-blocks-close");
  const badgeCard = (await page.locator(".session-card", { hasText: "Testtraining" }).first().textContent()) || "";
  check("Session-Karte zeigt Saisonblock-Badge", badgeCard.includes("Saisonvorbereitung"));
  await page.click("#tab-stats");
  await page.waitForSelector("#stats-panel:not(.hidden)");
  await page.selectOption("#stats-block", { label: "📅 Saisonvorbereitung" });
  const blockStats = (await page.textContent("#stats-panel")) || "";
  check("Statistik filtert nach Block (Ziel sichtbar)", blockStats.includes("Annahme stabilisieren"));
  await page.selectOption("#stats-block", "");
  await page.click("#tab-sessions");

  // ── Punkt 7: Übungsvarianten (leichter/schwerer) ──
  await page.locator(".session-card", { hasText: "Testtraining" }).first().click();
  await page.waitForSelector("#view-editor:not(.hidden)");
  const baggernItem = page.locator(".plan-item", { hasText: "Baggern an der Wand" });
  await baggernItem.locator('[data-act="harder"]').click();
  await page.locator(".plan-item", { hasText: "Partnerbaggern" }).waitFor();
  check("Plan-Item auf schwerere Variante gewechselt", true);
  await page.fill("#f-search", "Partnerbaggern");
  const variantLinks = (await page.locator(".exercise-card .ex-variants").first().textContent()) || "";
  check("Bibliothek zeigt Varianten-Links", variantLinks.includes("Leichter") && variantLinks.includes("Schwerer"));

  // ── Punkt 1: Skizze zeichnen und speichern ──
  await page.fill("#f-search", "Lauf-ABC");
  await page.locator('.exercise-card [data-act="sketch"]').first().click();
  await page.waitForSelector("#dlg-sketch[open]");
  await page.locator('#sketch-tools [data-tool="p"]').click();
  const canvas = page.locator("#sketch-canvas");
  await canvas.click({ position: { x: 100, y: 150 } });
  await canvas.click({ position: { x: 160, y: 200 } });
  await page.locator('#sketch-tools [data-tool="a"]').click();
  await canvas.click({ position: { x: 100, y: 300 } });
  await canvas.click({ position: { x: 200, y: 380 } });
  await page.click("#btn-sketch-save");
  await page.locator(".toast", { hasText: "Skizze gespeichert" }).waitFor();
  await page.locator(".exercise-card .ex-thumb").first().waitFor();
  check("Skizze gespeichert und Thumbnail sichtbar", true);
  // Skizze wieder öffnen → Objekte editierbar geladen
  await page.locator('.exercise-card [data-act="sketch"]').first().click();
  await page.waitForSelector("#dlg-sketch[open]");
  const objectCount = await page.locator("#sketch-canvas [data-idx]").count();
  check("Skizze ist wieder editierbar (3 Objekte)", objectCount === 3);
  await page.click("#btn-sketch-cancel");
  // Skizzen kommen als cachebare Bild-URLs, nicht als Base64-Bulk
  const thumbSrc = await page.locator(".exercise-card .ex-thumb").first().getAttribute("src");
  check("Skizze wird als URL geladen (nicht Base64)", thumbSrc.startsWith("api/exercise-images/"));
  const imgResponse = await page.evaluate((src) => fetch(src).then((r) => ({
    status: r.status, type: r.headers.get("content-type"), cache: r.headers.get("cache-control"),
  })), thumbSrc);
  check("Bild-Endpunkt liefert SVG mit Cache-Header",
    imgResponse.status === 200 && imgResponse.type.includes("svg") && imgResponse.cache.includes("immutable"));

  // PDF mit Skizze
  await page.fill("#f-search", "");
  const [pdfImg] = await Promise.all([page.waitForEvent("download"), page.click("#btn-pdf")]);
  check("PDF mit Skizze generiert", (pdfImg.suggestedFilename() || "").endsWith(".pdf"));

  // ── Bearbeitungskonflikt: zweiter Schreiber ändert dieselbe Session ──
  const conflictInfo = await page.evaluate(async () => {
    const s = sessions.find((x) => x.id === currentId);
    const copy = JSON.parse(JSON.stringify(s));
    copy.titel = "Konkurrenz-Titel";
    const res = await fetch("api/sessions/" + s.id, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(copy),
    });
    return res.status;
  });
  check("Fremder Schreibzugriff angenommen (Version erhöht)", conflictInfo === 200);
  await page.fill("#f-title", "Testtraining geändert");
  await page.waitForSelector("#dlg-conflict[open]", { timeout: 8000 });
  check("Konfliktdialog erscheint beim veralteten Speichern", true);
  await page.click("#btn-conflict-reload");
  await page.locator("#dlg-conflict[open]").waitFor({ state: "hidden" });
  check("«Deren Stand übernehmen» lädt den Serverstand", (await page.inputValue("#f-title")) === "Konkurrenz-Titel");
  // Danach speichert die Session wieder normal (Version ist aktuell)
  await page.fill("#f-title", "Testtraining");
  await page.waitForSelector(".save-status.saved", { timeout: 8000 });
  check("Speichern nach Konfliktauflösung funktioniert", true);

  // ── Teilen-Link mit Ablaufdatum ──
  await page.click("#btn-share");
  await page.waitForSelector("#dlg-share[open]");
  check("Teilen-Dialog zeigt Gültigkeitsdatum", ((await page.textContent("#share-expires-text")) || "").includes("gültig bis"));
  const shareUrl2 = await page.inputValue("#share-url");
  const shareToken2 = shareUrl2.split("/").pop();
  await page.click("#btn-share-close");
  const dbExpire = new Database(path.join(DATA_DIR, "vibeyball.db"));
  dbExpire.prepare("UPDATE sessions SET share_expires = '2000-01-01 00:00:00' WHERE share_token = ?").run(shareToken2);
  dbExpire.close();
  const expiredRes = await fetch(BASE + "/api/shared/" + shareToken2);
  check("Abgelaufener Teilen-Link liefert 410", expiredRes.status === 410);

  // ── Punkt 5: Übung mit allen Coaches teilen (inkl. Skizze) ──
  await page.click("#btn-new-exercise");
  await page.fill("#ex-name", "Geteilter Drill");
  await page.fill("#ex-desc", "Für alle Coaches sichtbar.");
  await page.check("#ex-public");
  await page.click('#exercise-form button[type="submit"]');
  await page.waitForTimeout(400);
  // Skizze an die geteilte Übung hängen
  await page.fill("#f-search", "Geteilter Drill");
  await page.locator('.exercise-card [data-act="sketch"]').first().click();
  await page.waitForSelector("#dlg-sketch[open]");
  await page.locator('#sketch-tools [data-tool="p"]').click();
  await page.locator("#sketch-canvas").click({ position: { x: 120, y: 200 } });
  await page.click("#btn-sketch-save");
  await page.locator(".toast", { hasText: "Skizze gespeichert" }).waitFor();
  await page.fill("#f-search", "");

  // ── Punkt 9: Trainerteam (zweiter Coach, Rolle Lesen) ──
  const invite2 = createInviteCode();
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
  const pageB = await ctxB.newPage();
  pageB.on("pageerror", (e) => pageErrors.push("B: " + e.message));
  await pageB.goto(BASE);
  await pageB.click("#tab-register");
  await pageB.fill("#auth-name", "Co-Trainerin Berta");
  await pageB.fill("#auth-email", "berta@example.ch");
  await pageB.fill("#auth-password", "geheim5678");
  await pageB.fill("#auth-invite", invite2);
  await pageB.click("#auth-submit");
  await pageB.waitForSelector("#view-list:not(.hidden)");

  // Punkt 5 aus Sicht von B: geteilte Übung in der Bibliothek
  await pageB.click("#btn-new-session");
  await pageB.waitForSelector("#view-editor:not(.hidden)");
  await pageB.fill("#f-search", "Geteilter Drill");
  const sharedCard = pageB.locator(".exercise-card", { hasText: "Geteilter Drill" });
  const sharedTag = (await sharedCard.textContent()) || "";
  check("Geteilte Übung bei anderem Coach sichtbar", sharedTag.includes("geteilt von Coach Test"));
  check("Skizze der geteilten Übung sichtbar", (await sharedCard.locator(".ex-thumb").count()) === 1);
  await pageB.click("#btn-back");

  // A lädt B mit Rolle «Lesen» ein
  await page.click("#btn-team");
  await page.waitForSelector("#dlg-team[open]");
  await page.fill("#team-email", "berta@example.ch");
  await page.selectOption("#team-role", "read");
  await page.click('#team-form button[type="submit"]');
  await page.locator("#team-list .tpl-row", { hasText: "Berta" }).waitFor();
  check("Team-Einladung erstellt", true);
  await page.click("#btn-team-close");

  // B wechselt in As Workspace (Reload lädt die Mitgliedschaft)
  await pageB.reload();
  await pageB.waitForSelector("#view-list:not(.hidden)");
  await pageB.waitForSelector("#workspace-select:not(.hidden)");
  await pageB.selectOption("#workspace-select", { label: "Team von Coach Test (Lesen)" });
  await pageB.locator(".session-card", { hasText: "Testtraining" }).first().waitFor();
  check("Co-Trainerin sieht Sessions des Teams", true);
  check("Nur-Lese-Modus versteckt Schreib-Knöpfe", !(await pageB.locator("#btn-new-session").isVisible()));
  const writeBlocked = await pageB.evaluate(async () => {
    const sessions = await fetch("api/sessions", { headers: { "X-Workspace": "1" } }).then((r) => r.json());
    const res = await fetch("api/sessions/" + sessions[0].id, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Workspace": "1" },
      body: JSON.stringify(sessions[0]),
    });
    return res.status;
  });
  check("Server blockiert Schreiben mit Rolle «Lesen» (403)", writeBlocked === 403);

  // ── Punkt 3: Passwort in der App ändern ──
  await page.click("#btn-account");
  await page.waitForSelector("#dlg-account[open]");
  await page.fill("#acc-current", "geheim1234");
  await page.fill("#acc-next", "neuespass99");
  await page.click('#account-form button[type="submit"]');
  await page.locator(".toast", { hasText: "Passwort geändert" }).waitFor();
  await page.click("#btn-logout");
  await page.waitForSelector("#view-auth:not(.hidden)");
  await page.fill("#auth-email", "coach@example.ch");
  await page.fill("#auth-password", "geheim1234");
  await page.click("#auth-submit");
  await page.waitForSelector("#auth-error:not(.hidden)");
  check("Altes Passwort funktioniert nicht mehr", true);
  await page.fill("#auth-password", "neuespass99");
  await page.click("#auth-submit");
  await page.waitForSelector("#view-list:not(.hidden)");
  check("Neues Passwort funktioniert", true);

  // ── Punkt 3: Passwort per CLI zurücksetzen ──
  const cliOut = require("child_process").execSync(
    `node ${path.join(__dirname, "..", "scripts", "reset-password.js")} berta@example.ch cliPasswort1`,
    { env: { ...process.env, DATA_DIR } }
  ).toString();
  check("CLI-Reset meldet Erfolg", cliOut.includes("zurückgesetzt"));
  const cliLogin = await fetch(BASE + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "berta@example.ch", password: "cliPasswort1" }),
  });
  check("Login mit CLI-Passwort funktioniert", cliLogin.status === 200);

  // ── Einladungscodes: Admin-UI (erster Benutzer ist Admin) ──
  check("Admin sieht Einladungscode-Knopf", await page.locator("#btn-invites").isVisible());
  check("Nicht-Admin sieht Knopf nicht", !(await pageB.locator("#btn-invites").isVisible()));
  await page.click("#btn-invites");
  await page.waitForSelector("#dlg-invites[open]");
  await page.click("#btn-invite-create");
  await page.locator(".toast", { hasText: "Neuer Einladungscode" }).waitFor();
  const inviteRows = await page.locator("#invites-list .tpl-row").count();
  check("Neuer Code erscheint in der Liste", inviteRows >= 1);
  const usedRow = (await page.locator("#invites-list").textContent()) || "";
  check("Verwendete Codes zeigen Benutzer", usedRow.includes("coach@example.ch"));
  await page.click("#btn-invites-close");

  // ── Punkt 12: Backup-Import stellt gelöschte Session wieder her ──
  const [backup2] = await Promise.all([page.waitForEvent("download"), page.click("#btn-backup")]);
  const backup2Path = path.join(DATA_DIR, "backup2.json");
  await backup2.saveAs(backup2Path);
  const tCountBefore = await page.locator(".session-card", { hasText: "Testtraining" }).count();
  await page.locator(".session-card", { hasText: "Testtraining" }).first()
    .locator('[data-act="del"]').click();
  await page.locator(".toast", { hasText: "gelöscht" }).waitFor();
  await page.waitForTimeout(6500); // Undo-Toast ablaufen lassen
  check("Session vor Import gelöscht",
    (await page.locator(".session-card", { hasText: "Testtraining" }).count()) === tCountBefore - 1);
  await page.locator("#import-file").setInputFiles(backup2Path);
  await page.locator(".toast", { hasText: "Import abgeschlossen" }).waitFor();
  await page.waitForTimeout(600);
  check("Import stellt Session wieder her",
    (await page.locator(".session-card", { hasText: "Testtraining" }).count()) === tCountBefore);

  // ── Punkt 11: PWA (Manifest, Service Worker) ──
  const manifestOk = (await fetch(BASE + "/manifest.webmanifest")).status === 200;
  const swOk = (await fetch(BASE + "/sw.js")).status === 200;
  const iconOk = (await fetch(BASE + "/icons/icon-192.png")).status === 200;
  check("PWA-Dateien werden ausgeliefert", manifestOk && swOk && iconOk);
  const swRegistered = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    return !!reg;
  });
  check("Service Worker registriert", swRegistered);

  await ctxB.close();

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
