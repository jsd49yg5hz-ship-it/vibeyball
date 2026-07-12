/* VibeyBall – Trainingsplaner für Volleyball-Coaches
 * Frontend: Auth + zentrale Speicherung über die REST-API des Servers. */

const FOCUS_TAGS = ["Annahme", "Block", "Verteidigung", "Zuspiel", "Angriff", "Taktik"];

let user = null;
let sessions = [];
let customExercises = [];
let currentId = null;      // ID der Session im Editor
let editingExerciseId = null; // ID der eigenen Übung im Bearbeiten-Dialog
let listTab = "sessions";  // aktiver Reiter der Übersicht: "sessions" | "stats"

// ═══════════ API ═══════════

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.startsWith("api/login")) {
    showAuthView();
    throw new Error(data.error || "Nicht angemeldet");
  }
  if (!res.ok) throw new Error(data.error || "Serverfehler (" + res.status + ")");
  return data;
}

function currentSession() {
  return sessions.find((s) => s.id === currentId);
}

// Speichern mit kurzer Verzögerung, damit nicht jeder Tastendruck einen Request auslöst
const pendingSaves = new Map();
function saveSession(s) {
  clearTimeout(pendingSaves.get(s.id));
  pendingSaves.set(s.id, setTimeout(() => {
    api("PUT", "api/sessions/" + s.id, s).catch((e) => console.error("Speichern fehlgeschlagen:", e));
  }, 400));
}

// ═══════════ Hilfsfunktionen ═══════════

const $ = (sel) => document.querySelector(sel);

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function esc(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso + "T00:00:00").toLocaleDateString("de-CH", {
    weekday: "short", day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function totalDuration(session) {
  return session.items.reduce((sum, it) => sum + (Number(it.dauer) || 0), 0);
}

function addMinutes(hhmm, minutes) {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return String(Math.floor(total / 60) % 24).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
}

// Alle Übungen: eingebaute Bibliothek + eigene Übungen
function allExercises() {
  return [...customExercises, ...EXERCISES];
}

// Übungsdaten für ein Plan-Element: live nachschlagen, sonst Schnappschuss aus dem Item
function resolveExercise(item) {
  const ex = allExercises().find((e) => e.id === item.exerciseId);
  return ex || { name: item.name || "Gelöschte Übung", kategorie: item.kategorie || "", beschreibung: item.beschreibung || "" };
}

// ═══════════ Ansichten ═══════════

function switchView(id) {
  for (const v of ["view-auth", "view-list", "view-editor"]) {
    document.getElementById(v).classList.toggle("hidden", v !== id);
  }
}

function showAuthView() {
  user = null;
  $("#user-box").classList.add("hidden");
  switchView("view-auth");
}

function showListView() {
  currentId = null;
  switchView("view-list");
  renderListView();
}

function showEditorView(id) {
  currentId = id;
  switchView("view-editor");
  fillEditorForm();
  renderPlan();
  renderLibrary();
  populateCategoryFilter();
}

// ═══════════ Auth ═══════════

let authMode = "login";

function setAuthMode(mode) {
  authMode = mode;
  $("#tab-login").classList.toggle("active", mode === "login");
  $("#tab-register").classList.toggle("active", mode === "register");
  $("#auth-name-label").classList.toggle("hidden", mode === "login");
  $("#auth-invite-label").classList.toggle("hidden", mode === "login");
  $("#auth-submit").textContent = mode === "login" ? "Anmelden" : "Konto erstellen";
  $("#auth-password").autocomplete = mode === "login" ? "current-password" : "new-password";
  $("#auth-error").classList.add("hidden");
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const body = {
    name: $("#auth-name").value.trim(),
    email: $("#auth-email").value.trim(),
    password: $("#auth-password").value,
    invite: $("#auth-invite").value.trim(),
  };
  try {
    user = await api("POST", authMode === "login" ? "api/login" : "api/register", body);
    await enterApp();
  } catch (err) {
    const el = $("#auth-error");
    el.textContent = err.message;
    el.classList.remove("hidden");
  }
}

async function enterApp() {
  $("#user-name").textContent = user.name;
  $("#user-box").classList.remove("hidden");
  [sessions, customExercises] = await Promise.all([
    api("GET", "api/sessions"),
    api("GET", "api/exercises"),
  ]);
  showListView();
}

async function logout() {
  await api("POST", "api/logout");
  sessions = [];
  customExercises = [];
  setAuthMode("login");
  $("#auth-password").value = "";
  showAuthView();
}

// ═══════════ Übersicht (Reiter: Trainings | Statistik) ═══════════

function renderListView() {
  $("#tab-sessions").classList.toggle("active", listTab === "sessions");
  $("#tab-stats").classList.toggle("active", listTab === "stats");
  $("#session-list").classList.toggle("hidden", listTab !== "sessions");
  $("#stats-panel").classList.toggle("hidden", listTab !== "stats");
  $("#empty-hint").classList.toggle("hidden", listTab !== "sessions" || sessions.length > 0);
  if (listTab === "sessions") renderSessionList(); else renderStats();
}

function renderSessionList() {
  const list = $("#session-list");
  list.innerHTML = "";

  const sorted = [...sessions].sort((a, b) => (b.datum || "").localeCompare(a.datum || ""));
  for (const s of sorted) {
    const card = document.createElement("div");
    card.className = "session-card" + (s.ausgefuehrt ? " is-done" : "");
    const tags = s.tags || [];
    card.innerHTML = `
      <h3>${esc(s.titel) || "Ohne Titel"}</h3>
      <div class="meta">
        ${esc(s.team) || "Keine Mannschaft"}
        ${s.datum ? " · " + formatDate(s.datum) : ""}${s.uhrzeit ? ", " + esc(s.uhrzeit) : ""}
        ${s.ort ? " · " + esc(s.ort) : ""}
      </div>
      ${tags.length ? `<div class="ex-tags">${tags.map((t) => `<span class="tag cat">${esc(t)}</span>`).join("")}</div>` : ""}
      <div class="card-footer">
        <span>
          <span class="badge">${s.items.length} Übungen · ${totalDuration(s)} min</span>
          ${s.ausgefuehrt ? `<span class="badge done">✓ Ausgeführt</span>` : ""}
        </span>
        <span>
          <button class="btn-icon done-toggle ${s.ausgefuehrt ? "is-done" : ""}" data-act="done"
            title="${s.ausgefuehrt ? "Als nicht ausgeführt markieren" : "Als ausgeführt markieren"}">✓</button>
          <button class="btn-icon" data-act="dup" title="Duplizieren">📋</button>
          <button class="btn-icon danger" data-act="del" title="Session löschen">🗑️</button>
        </span>
      </div>`;
    card.addEventListener("click", () => showEditorView(s.id));
    card.querySelector('[data-act="done"]').addEventListener("click", (e) => {
      e.stopPropagation();
      s.ausgefuehrt = !s.ausgefuehrt;
      saveSession(s);
      renderListView();
    });
    card.querySelector('[data-act="dup"]').addEventListener("click", async (e) => {
      e.stopPropagation();
      await duplicateSession(s, { openEditor: false });
      renderListView();
    });
    card.querySelector('[data-act="del"]').addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm(`Session «${s.titel || "Ohne Titel"}» wirklich löschen?`)) {
        await api("DELETE", "api/sessions/" + s.id);
        sessions = sessions.filter((x) => x.id !== s.id);
        renderListView();
      }
    });
    list.appendChild(card);
  }
}

// ═══════════ Statistik (Spider Chart der Fokus-Tags) ═══════════

function renderStats() {
  const panel = $("#stats-panel");
  const done = sessions.filter((s) => s.ausgefuehrt);
  const counts = FOCUS_TAGS.map((tag) => done.filter((s) => (s.tags || []).includes(tag)).length);

  if (!done.length) {
    panel.innerHTML = `
      <div class="panel">
        <h3>Trainierte Schwerpunkte</h3>
        <p class="empty-hint">Noch keine Trainings als ausgeführt markiert.<br>
        Markiere abgeschlossene Trainings mit dem ✓ auf der Karte oder im Editor – hier erscheint dann die Auswertung.</p>
      </div>`;
    return;
  }

  panel.innerHTML = `
    <div class="panel">
      <h3>Trainierte Schwerpunkte</h3>
      <p class="stats-sub">${done.length} ausgeführte${done.length === 1 ? "s" : ""} Training${done.length === 1 ? "" : "s"} · gezählt wird jeder gesetzte Fokus-Tag</p>
      <div class="stats-grid">
        ${radarChartSvg(FOCUS_TAGS, counts)}
        <ul class="stats-list">
          ${FOCUS_TAGS.map((tag, i) => `
            <li>
              <span class="stats-dot"></span>
              <span class="stats-label">${esc(tag)}</span>
              <strong>${counts[i]}×</strong>
            </li>`).join("")}
        </ul>
      </div>
    </div>`;
}

// Spider-/Radar-Chart als Inline-SVG; Farben kommen aus den Theme-Variablen (CSS)
function radarChartSvg(labels, values) {
  const cx = 235, cy = 165, R = 110, rings = 4;
  const n = labels.length;
  const gridMax = Math.max(rings, Math.ceil(Math.max(...values) / rings) * rings);
  const angle = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i, r) => [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))];
  const poly = (r) => labels.map((_, i) => pt(i, r).map((v) => v.toFixed(1)).join(",")).join(" ");

  // Gitterringe + Achsen (dezent)
  let grid = "";
  for (let k = 1; k <= rings; k++) grid += `<polygon class="radar-ring" points="${poly((R * k) / rings)}"/>`;
  let axes = "";
  for (let i = 0; i < n; i++) {
    const [x, y] = pt(i, R);
    axes += `<line class="radar-axis" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
  }

  // Ringwerte entlang der obersten Achse
  let ringLabels = "";
  for (let k = 1; k <= rings; k++) {
    ringLabels += `<text class="radar-ringlabel" x="${cx + 5}" y="${(cy - (R * k) / rings + 3).toFixed(1)}">${(gridMax * k) / rings}</text>`;
  }

  // Datenpolygon + Eckpunkte
  const dataPoints = values.map((v, i) => pt(i, (R * v) / gridMax));
  const dataPoly = dataPoints.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ");
  const dots = dataPoints.map(([x, y], i) =>
    `<circle class="radar-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4"><title>${esc(labels[i])}: ${values[i]}×</title></circle>`).join("");

  // Achsenbeschriftungen ausserhalb
  const texts = labels.map((label, i) => {
    const [x, y] = pt(i, R + 16);
    const c = Math.cos(angle(i));
    const anchor = c > 0.3 ? "start" : c < -0.3 ? "end" : "middle";
    return `<text class="radar-label" x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${anchor}">${esc(label)}</text>`;
  }).join("");

  return `
    <svg class="radar" viewBox="0 0 470 330" role="img" aria-label="Spider Chart der trainierten Schwerpunkte">
      ${grid}${axes}${ringLabels}
      <polygon class="radar-area" points="${dataPoly}"/>
      ${dots}${texts}
    </svg>`;
}

async function createSession() {
  const session = {
    id: uid(),
    titel: "",
    team: "",
    datum: new Date().toISOString().slice(0, 10),
    uhrzeit: "",
    ort: "",
    tags: [],
    ausgefuehrt: false,
    notizen: "",
    items: [], // { key, exerciseId, name, kategorie, beschreibung, dauer, notiz }
  };
  await api("POST", "api/sessions", session);
  sessions.push(session);
  showEditorView(session.id);
}

async function duplicateSession(src, { openEditor = true, dateShiftDays = 0, titleSuffix = " (Kopie)" } = {}) {
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = uid();
  delete copy.shareToken;
  copy.ausgefuehrt = false; // Kopien/Serien sind neue, noch nicht ausgeführte Trainings
  copy.items.forEach((it) => (it.key = uid()));
  if (dateShiftDays && copy.datum) {
    const d = new Date(copy.datum + "T00:00:00");
    d.setDate(d.getDate() + dateShiftDays);
    copy.datum = d.toISOString().slice(0, 10);
  } else if (titleSuffix) {
    copy.titel = (copy.titel || "Ohne Titel") + titleSuffix;
  }
  await api("POST", "api/sessions", copy);
  sessions.push(copy);
  if (openEditor) showEditorView(copy.id);
  return copy;
}

async function createSeries(count) {
  const s = currentSession();
  for (let week = 1; week <= count; week++) {
    await duplicateSession(s, { openEditor: false, dateShiftDays: 7 * week, titleSuffix: "" });
  }
}

// ═══════════ Editor: Session-Details ═══════════

const FIELD_MAP = {
  "f-title": "titel",
  "f-team": "team",
  "f-date": "datum",
  "f-time": "uhrzeit",
  "f-location": "ort",
  "f-notes": "notizen",
};

function fillEditorForm() {
  const s = currentSession();
  for (const [elId, prop] of Object.entries(FIELD_MAP)) {
    document.getElementById(elId).value = s[prop] || "";
  }
  $("#f-done").checked = !!s.ausgefuehrt;
  document.querySelectorAll("#f-tags input").forEach((cb) => {
    cb.checked = (s.tags || []).includes(cb.value);
  });
}

function bindEditorForm() {
  for (const [elId, prop] of Object.entries(FIELD_MAP)) {
    document.getElementById(elId).addEventListener("input", (e) => {
      const s = currentSession();
      if (!s) return;
      s[prop] = e.target.value;
      saveSession(s);
      if (elId === "f-time") renderPlan(); // Zeitspalten aktualisieren
    });
  }

  $("#f-done").addEventListener("change", (e) => {
    const s = currentSession();
    if (!s) return;
    s.ausgefuehrt = e.target.checked;
    saveSession(s);
  });

  // Fokus-Tag-Chips einmalig aufbauen
  $("#f-tags").innerHTML = FOCUS_TAGS.map((tag) => `
    <label class="tag-chip"><input type="checkbox" value="${tag}">${tag}</label>`).join("");
  document.querySelectorAll("#f-tags input").forEach((cb) => {
    cb.addEventListener("change", () => {
      const s = currentSession();
      if (!s) return;
      s.tags = [...document.querySelectorAll("#f-tags input:checked")].map((el) => el.value);
      saveSession(s);
    });
  });
}

// ═══════════ Editor: Trainingsablauf ═══════════

function renderPlan() {
  const s = currentSession();
  const list = $("#plan-list");
  list.innerHTML = "";
  $("#plan-empty").classList.toggle("hidden", s.items.length > 0);
  $("#total-duration").textContent = totalDuration(s) + " min";

  let clock = s.uhrzeit || null;

  s.items.forEach((item, i) => {
    const ex = resolveExercise(item);
    const timeLabel = clock ? `${clock}–${addMinutes(clock, Number(item.dauer) || 0)}` : "";
    if (clock) clock = addMinutes(clock, Number(item.dauer) || 0);

    const li = document.createElement("li");
    li.className = "plan-item";
    li.innerHTML = `
      <span class="order">${i + 1}</span>
      <span>
        <span class="name">${esc(ex.name)}</span>
        ${timeLabel ? `<span class="time-range">${timeLabel}</span>` : ""}<br>
        <span class="cat">${esc(ex.kategorie)}</span>
      </span>
      <span class="item-actions">
        <input type="number" class="duration-input" min="1" max="180" value="${item.dauer}">
        <span class="unit">min</span>
        <button class="btn-icon" data-act="up" title="Nach oben">↑</button>
        <button class="btn-icon" data-act="down" title="Nach unten">↓</button>
        <button class="btn-icon danger" data-act="remove" title="Entfernen">✕</button>
      </span>
      <span class="item-note">
        <input type="text" placeholder="Notiz zur Übung (optional)" value="${esc(item.notiz || "")}">
      </span>`;

    li.querySelector(".duration-input").addEventListener("input", (e) => {
      item.dauer = Number(e.target.value) || 0;
      saveSession(s);
      renderPlanTimesOnly();
    });
    li.querySelector(".item-note input").addEventListener("input", (e) => {
      item.notiz = e.target.value;
      saveSession(s);
    });
    li.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = btn.dataset.act;
        if (act === "remove") s.items.splice(i, 1);
        if (act === "up" && i > 0) [s.items[i - 1], s.items[i]] = [s.items[i], s.items[i - 1]];
        if (act === "down" && i < s.items.length - 1) [s.items[i + 1], s.items[i]] = [s.items[i], s.items[i + 1]];
        saveSession(s);
        renderPlan();
      });
    });
    list.appendChild(li);
  });
}

// Nur Gesamtdauer + Zeitbereiche aktualisieren, ohne Fokus im Dauer-Feld zu verlieren
function renderPlanTimesOnly() {
  const s = currentSession();
  $("#total-duration").textContent = totalDuration(s) + " min";
  let clock = s.uhrzeit || null;
  document.querySelectorAll("#plan-list .plan-item").forEach((li, i) => {
    const el = li.querySelector(".time-range");
    if (!clock || !el) return;
    const dauer = Number(s.items[i]?.dauer) || 0;
    el.textContent = `${clock}–${addMinutes(clock, dauer)}`;
    clock = addMinutes(clock, dauer);
  });
}

function addExerciseToPlan(exerciseId) {
  const s = currentSession();
  const ex = allExercises().find((e) => e.id === exerciseId);
  // Schnappschuss der Übungsdaten, damit der Plan auch nach Löschen der Übung vollständig bleibt
  s.items.push({
    key: uid(), exerciseId,
    name: ex.name, kategorie: ex.kategorie, beschreibung: ex.beschreibung,
    dauer: ex.dauer, notiz: "",
  });
  saveSession(s);
  renderPlan();
}

// ═══════════ Editor: Übungsbibliothek ═══════════

function allCategories() {
  return [...new Set(allExercises().map((e) => e.kategorie).filter(Boolean))];
}

function populateCategoryFilter() {
  const select = $("#f-category");
  const previous = select.value;
  select.innerHTML = `<option value="">Alle Kategorien</option>`;
  for (const cat of allCategories()) {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    select.appendChild(opt);
  }
  select.value = previous;

  const datalist = $("#category-options");
  datalist.innerHTML = allCategories().map((c) => `<option value="${esc(c)}">`).join("");
}

function renderLibrary() {
  const query = $("#f-search").value.trim().toLowerCase();
  const cat = $("#f-category").value;
  const level = $("#f-level").value;
  const list = $("#exercise-list");
  list.innerHTML = "";

  const filtered = allExercises().filter((ex) => {
    if (cat && ex.kategorie !== cat) return false;
    if (level && ex.niveau !== level) return false;
    if (query && !(ex.name + " " + ex.kategorie + " " + ex.beschreibung).toLowerCase().includes(query)) return false;
    return true;
  });

  if (filtered.length === 0) {
    list.innerHTML = `<p class="empty-hint">Keine Übungen gefunden.</p>`;
    return;
  }

  for (const ex of filtered) {
    const isCustom = customExercises.some((c) => c.id === ex.id);
    const card = document.createElement("div");
    card.className = "exercise-card" + (isCustom ? " custom" : "");
    card.innerHTML = `
      <div class="ex-head">
        <span class="ex-name">${esc(ex.name)}</span>
        <span class="ex-head-actions">
          ${isCustom ? `
            <button class="btn-icon" data-act="edit" title="Bearbeiten">✏️</button>
            <button class="btn-icon danger" data-act="delete" title="Löschen">🗑️</button>` : ""}
          <button class="btn-add">+ Hinzufügen</button>
        </span>
      </div>
      <div class="ex-tags">
        <span class="tag cat">${esc(ex.kategorie)}</span>
        <span class="tag">${esc(ex.niveau)}</span>
        <span class="tag">ab ${ex.spieler} Sp.</span>
        <span class="tag">~${ex.dauer} min</span>
        ${isCustom ? `<span class="tag own">Eigene Übung</span>` : ""}
      </div>
      <div class="ex-desc">${esc(ex.beschreibung)}</div>`;
    card.querySelector(".btn-add").addEventListener("click", () => addExerciseToPlan(ex.id));
    if (isCustom) {
      card.querySelector('[data-act="edit"]').addEventListener("click", () => openExerciseDialog(ex));
      card.querySelector('[data-act="delete"]').addEventListener("click", async () => {
        if (!confirm(`Übung «${ex.name}» löschen?`)) return;
        await api("DELETE", "api/exercises/" + ex.id);
        customExercises = customExercises.filter((c) => c.id !== ex.id);
        populateCategoryFilter();
        renderLibrary();
      });
    }
    list.appendChild(card);
  }
}

// ═══════════ Dialog: Eigene Übung ═══════════

function openExerciseDialog(ex = null) {
  editingExerciseId = ex ? ex.id : null;
  $("#dlg-exercise-title").textContent = ex ? "Übung bearbeiten" : "Eigene Übung erstellen";
  $("#ex-name").value = ex ? ex.name : "";
  $("#ex-category").value = ex ? ex.kategorie : "";
  $("#ex-level").value = ex ? ex.niveau : "Alle";
  $("#ex-players").value = ex ? ex.spieler : 2;
  $("#ex-duration").value = ex ? ex.dauer : 10;
  $("#ex-desc").value = ex ? ex.beschreibung : "";
  document.getElementById("dlg-exercise").showModal();
}

async function handleExerciseSubmit(e) {
  e.preventDefault();
  const ex = {
    id: editingExerciseId || "u_" + uid(),
    name: $("#ex-name").value.trim(),
    kategorie: $("#ex-category").value.trim() || "Sonstiges",
    niveau: $("#ex-level").value,
    spieler: Number($("#ex-players").value) || 1,
    dauer: Number($("#ex-duration").value) || 10,
    beschreibung: $("#ex-desc").value.trim(),
  };
  if (!ex.name) return;

  if (editingExerciseId) {
    await api("PUT", "api/exercises/" + ex.id, ex);
    customExercises = customExercises.map((c) => (c.id === ex.id ? ex : c));
  } else {
    await api("POST", "api/exercises", ex);
    customExercises.unshift(ex);
  }
  document.getElementById("dlg-exercise").close();
  populateCategoryFilter();
  renderLibrary();
}

// ═══════════ Teilen ═══════════

async function openShareDialog() {
  const s = currentSession();
  const { token } = await api("POST", "api/sessions/" + s.id + "/share");
  s.shareToken = token;
  const base = new URL(".", location.href).href; // funktioniert auch unter einem Unterpfad
  $("#share-url").value = base + "share/" + token;
  document.getElementById("dlg-share").showModal();
}

// ═══════════ Initialisierung ═══════════

// ═══════════ Theme (hell/dunkel) ═══════════

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("#btn-theme").textContent = theme === "dark" ? "☀️" : "🌙";
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem("vb-theme", next);
  applyTheme(next);
}

document.addEventListener("DOMContentLoaded", async () => {
  bindEditorForm();

  // Theme
  applyTheme(document.documentElement.dataset.theme);
  $("#btn-theme").addEventListener("click", toggleTheme);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    if (!localStorage.getItem("vb-theme")) applyTheme(e.matches ? "dark" : "light");
  });

  // Auth
  $("#tab-login").addEventListener("click", () => setAuthMode("login"));
  $("#tab-register").addEventListener("click", () => setAuthMode("register"));
  $("#auth-form").addEventListener("submit", handleAuthSubmit);
  $("#btn-logout").addEventListener("click", logout);

  // Übersicht
  $("#btn-new-session").addEventListener("click", createSession);
  $("#tab-sessions").addEventListener("click", () => { listTab = "sessions"; renderListView(); });
  $("#tab-stats").addEventListener("click", () => { listTab = "stats"; renderListView(); });

  // Editor
  $("#btn-back").addEventListener("click", showListView);
  $("#btn-duplicate").addEventListener("click", () => duplicateSession(currentSession()));
  $("#btn-pdf").addEventListener("click", () => generateSessionPdf(currentSession(), resolveExercise));
  $("#btn-series").addEventListener("click", () => document.getElementById("dlg-series").showModal());
  $("#btn-share").addEventListener("click", openShareDialog);

  // Bibliothek
  $("#f-search").addEventListener("input", renderLibrary);
  $("#f-category").addEventListener("change", renderLibrary);
  $("#f-level").addEventListener("change", renderLibrary);
  $("#btn-new-exercise").addEventListener("click", () => openExerciseDialog());

  // Dialog: eigene Übung
  $("#exercise-form").addEventListener("submit", handleExerciseSubmit);
  $("#btn-ex-cancel").addEventListener("click", () => document.getElementById("dlg-exercise").close());

  // Dialog: Serie
  $("#series-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const count = Math.min(52, Math.max(1, Number($("#series-count").value) || 1));
    await createSeries(count);
    document.getElementById("dlg-series").close();
    alert(count + " weitere Trainings im Wochenabstand erstellt.");
  });
  $("#btn-series-cancel").addEventListener("click", () => document.getElementById("dlg-series").close());

  // Dialog: Teilen
  $("#btn-copy-share").addEventListener("click", () => {
    navigator.clipboard?.writeText($("#share-url").value);
    $("#btn-copy-share").textContent = "Kopiert ✓";
    setTimeout(() => ($("#btn-copy-share").textContent = "Kopieren"), 1500);
  });
  $("#btn-unshare").addEventListener("click", async () => {
    const s = currentSession();
    await api("DELETE", "api/sessions/" + s.id + "/share");
    delete s.shareToken;
    document.getElementById("dlg-share").close();
  });
  $("#btn-share-close").addEventListener("click", () => document.getElementById("dlg-share").close());

  // Beim Laden: eingeloggt?
  try {
    user = await api("GET", "api/me");
    await enterApp();
  } catch {
    showAuthView();
  }
});
