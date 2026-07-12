/* VibeyBall – Trainingsplaner für Volleyball-Coaches
 * Frontend: Auth + zentrale Speicherung über die REST-API des Servers. */

let user = null;
let sessions = [];
let customExercises = [];
let currentId = null;      // ID der Session im Editor
let editingExerciseId = null; // ID der eigenen Übung im Bearbeiten-Dialog
let calendarMode = false;
let calendarMonth = null;  // Date (1. des angezeigten Monats)

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
  renderListOrCalendar();
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

// ═══════════ Session-Übersicht (Liste + Kalender) ═══════════

function renderListOrCalendar() {
  $("#btn-toggle-calendar").textContent = calendarMode ? "📋 Liste" : "📆 Kalender";
  $("#session-list").classList.toggle("hidden", calendarMode);
  $("#calendar").classList.toggle("hidden", !calendarMode);
  $("#empty-hint").classList.toggle("hidden", sessions.length > 0 || calendarMode);
  if (calendarMode) renderCalendar(); else renderSessionList();
}

function renderSessionList() {
  const list = $("#session-list");
  list.innerHTML = "";

  const sorted = [...sessions].sort((a, b) => (b.datum || "").localeCompare(a.datum || ""));
  for (const s of sorted) {
    const card = document.createElement("div");
    card.className = "session-card";
    card.innerHTML = `
      <h3>${esc(s.titel) || "Ohne Titel"}</h3>
      <div class="meta">
        ${esc(s.team) || "Keine Mannschaft"}
        ${s.datum ? " · " + formatDate(s.datum) : ""}${s.uhrzeit ? ", " + esc(s.uhrzeit) : ""}
        ${s.ort ? " · " + esc(s.ort) : ""}
      </div>
      <div class="card-footer">
        <span class="badge">${s.items.length} Übungen · ${totalDuration(s)} min</span>
        <span>
          <button class="btn-icon" data-act="dup" title="Duplizieren">📋</button>
          <button class="btn-icon danger" data-act="del" title="Session löschen">🗑️</button>
        </span>
      </div>`;
    card.addEventListener("click", () => showEditorView(s.id));
    card.querySelector('[data-act="dup"]').addEventListener("click", async (e) => {
      e.stopPropagation();
      await duplicateSession(s, { openEditor: false });
      renderListOrCalendar();
    });
    card.querySelector('[data-act="del"]').addEventListener("click", async (e) => {
      e.stopPropagation();
      if (confirm(`Session «${s.titel || "Ohne Titel"}» wirklich löschen?`)) {
        await api("DELETE", "api/sessions/" + s.id);
        sessions = sessions.filter((x) => x.id !== s.id);
        renderListOrCalendar();
      }
    });
    list.appendChild(card);
  }
}

function renderCalendar() {
  const cal = $("#calendar");
  if (!calendarMonth) calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const monthName = calendarMonth.toLocaleDateString("de-CH", { month: "long", year: "numeric" });

  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // Mo = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayIso = new Date().toISOString().slice(0, 10);

  let cells = "";
  for (let i = 0; i < firstWeekday; i++) cells += `<div class="cal-cell cal-empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const daySessions = sessions.filter((s) => s.datum === iso);
    cells += `
      <div class="cal-cell ${iso === todayIso ? "cal-today" : ""}">
        <div class="cal-day">${d}</div>
        ${daySessions.map((s) => `
          <button class="cal-chip" data-id="${s.id}" title="${esc(s.titel)}">
            ${s.uhrzeit ? esc(s.uhrzeit) + " " : ""}${esc(s.titel) || "Training"}
          </button>`).join("")}
      </div>`;
  }

  cal.innerHTML = `
    <div class="cal-header">
      <button class="btn" id="cal-prev">←</button>
      <h3>${monthName}</h3>
      <button class="btn" id="cal-next">→</button>
    </div>
    <div class="cal-grid cal-weekdays">
      ${["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((d) => `<div>${d}</div>`).join("")}
    </div>
    <div class="cal-grid">${cells}</div>`;

  $("#cal-prev").addEventListener("click", () => { calendarMonth = new Date(year, month - 1, 1); renderCalendar(); });
  $("#cal-next").addEventListener("click", () => { calendarMonth = new Date(year, month + 1, 1); renderCalendar(); });
  cal.querySelectorAll(".cal-chip").forEach((chip) => {
    chip.addEventListener("click", () => showEditorView(chip.dataset.id));
  });
}

async function createSession() {
  const session = {
    id: uid(),
    titel: "",
    team: "",
    datum: new Date().toISOString().slice(0, 10),
    uhrzeit: "",
    ort: "",
    schwerpunkt: "",
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

// ═══════════ iCal-Export ═══════════

function icalEscape(str) {
  return String(str || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function exportIcal() {
  const events = sessions.filter((s) => s.datum);
  if (!events.length) { alert("Keine Sessions mit Datum vorhanden."); return; }

  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//VibeyBall//Trainingsplaner//DE"];
  for (const s of events) {
    const date = s.datum.replace(/-/g, "");
    const dur = totalDuration(s) || 90;
    lines.push("BEGIN:VEVENT");
    lines.push("UID:" + s.id + "@vibeyball");
    lines.push("DTSTAMP:" + new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z");
    if (s.uhrzeit) {
      const start = s.uhrzeit.replace(":", "") + "00";
      const end = addMinutes(s.uhrzeit, dur).replace(":", "") + "00";
      lines.push("DTSTART:" + date + "T" + start);
      lines.push("DTEND:" + date + "T" + end);
    } else {
      lines.push("DTSTART;VALUE=DATE:" + date);
    }
    lines.push("SUMMARY:" + icalEscape((s.titel || "Volleyballtraining") + (s.team ? " (" + s.team + ")" : "")));
    if (s.ort) lines.push("LOCATION:" + icalEscape(s.ort));
    if (s.schwerpunkt) lines.push("DESCRIPTION:" + icalEscape("Schwerpunkt: " + s.schwerpunkt));
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");

  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "vibeyball-trainings.ics";
  a.click();
  URL.revokeObjectURL(a.href);
}

// ═══════════ Editor: Session-Details ═══════════

const FIELD_MAP = {
  "f-title": "titel",
  "f-team": "team",
  "f-date": "datum",
  "f-time": "uhrzeit",
  "f-location": "ort",
  "f-focus": "schwerpunkt",
  "f-notes": "notizen",
};

function fillEditorForm() {
  const s = currentSession();
  for (const [elId, prop] of Object.entries(FIELD_MAP)) {
    document.getElementById(elId).value = s[prop] || "";
  }
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

document.addEventListener("DOMContentLoaded", async () => {
  bindEditorForm();

  // Auth
  $("#tab-login").addEventListener("click", () => setAuthMode("login"));
  $("#tab-register").addEventListener("click", () => setAuthMode("register"));
  $("#auth-form").addEventListener("submit", handleAuthSubmit);
  $("#btn-logout").addEventListener("click", logout);

  // Übersicht
  $("#btn-new-session").addEventListener("click", createSession);
  $("#btn-toggle-calendar").addEventListener("click", () => { calendarMode = !calendarMode; renderListOrCalendar(); });
  $("#btn-ical").addEventListener("click", exportIcal);

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
