/* VibeyBall – Trainingsplaner für Volleyball-Coaches
 * Datenhaltung: localStorage (Schlüssel "vibeyball.sessions") */

const STORAGE_KEY = "vibeyball.sessions";

let sessions = loadSessions();
let currentId = null; // ID der Session, die gerade im Editor offen ist

// ═══════════ Persistenz ═══════════

function loadSessions() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveSessions() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

function currentSession() {
  return sessions.find((s) => s.id === currentId);
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

// ═══════════ Navigation zwischen Ansichten ═══════════

function showListView() {
  currentId = null;
  $("#view-editor").classList.add("hidden");
  $("#view-list").classList.remove("hidden");
  renderSessionList();
}

function showEditorView(id) {
  currentId = id;
  $("#view-list").classList.add("hidden");
  $("#view-editor").classList.remove("hidden");
  fillEditorForm();
  renderPlan();
  renderLibrary();
}

// ═══════════ Session-Übersicht ═══════════

function renderSessionList() {
  const list = $("#session-list");
  list.innerHTML = "";
  $("#empty-hint").classList.toggle("hidden", sessions.length > 0);

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
        <button class="btn-icon danger" title="Session löschen">🗑️</button>
      </div>`;
    card.addEventListener("click", () => showEditorView(s.id));
    card.querySelector(".btn-icon").addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm(`Session «${s.titel || "Ohne Titel"}» wirklich löschen?`)) {
        sessions = sessions.filter((x) => x.id !== s.id);
        saveSessions();
        renderSessionList();
      }
    });
    list.appendChild(card);
  }
}

function createSession() {
  const session = {
    id: uid(),
    titel: "",
    team: "",
    datum: new Date().toISOString().slice(0, 10),
    uhrzeit: "",
    ort: "",
    schwerpunkt: "",
    notizen: "",
    items: [], // { key, exerciseId, dauer, notiz }
  };
  sessions.push(session);
  saveSessions();
  showEditorView(session.id);
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
      saveSessions();
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

  s.items.forEach((item, i) => {
    const ex = EXERCISES.find((e) => e.id === item.exerciseId);
    const li = document.createElement("li");
    li.className = "plan-item";
    li.innerHTML = `
      <span class="order">${i + 1}</span>
      <span>
        <span class="name">${esc(ex ? ex.name : "Unbekannte Übung")}</span><br>
        <span class="cat">${esc(ex ? ex.kategorie : "")}</span>
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
      saveSessions();
      $("#total-duration").textContent = totalDuration(s) + " min";
    });
    li.querySelector(".item-note input").addEventListener("input", (e) => {
      item.notiz = e.target.value;
      saveSessions();
    });
    li.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = btn.dataset.act;
        if (act === "remove") s.items.splice(i, 1);
        if (act === "up" && i > 0) [s.items[i - 1], s.items[i]] = [s.items[i], s.items[i - 1]];
        if (act === "down" && i < s.items.length - 1) [s.items[i + 1], s.items[i]] = [s.items[i], s.items[i + 1]];
        saveSessions();
        renderPlan();
      });
    });
    list.appendChild(li);
  });
}

function addExerciseToPlan(exerciseId) {
  const s = currentSession();
  const ex = EXERCISES.find((e) => e.id === exerciseId);
  s.items.push({ key: uid(), exerciseId, dauer: ex.dauer, notiz: "" });
  saveSessions();
  renderPlan();
}

// ═══════════ Editor: Übungsbibliothek ═══════════

function populateCategoryFilter() {
  const categories = [...new Set(EXERCISES.map((e) => e.kategorie))];
  const select = $("#f-category");
  for (const cat of categories) {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    select.appendChild(opt);
  }
}

function renderLibrary() {
  const query = $("#f-search").value.trim().toLowerCase();
  const cat = $("#f-category").value;
  const level = $("#f-level").value;
  const list = $("#exercise-list");
  list.innerHTML = "";

  const filtered = EXERCISES.filter((ex) => {
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
    const card = document.createElement("div");
    card.className = "exercise-card";
    card.innerHTML = `
      <div class="ex-head">
        <span class="ex-name">${esc(ex.name)}</span>
        <button class="btn-add">+ Hinzufügen</button>
      </div>
      <div class="ex-tags">
        <span class="tag cat">${esc(ex.kategorie)}</span>
        <span class="tag">${esc(ex.niveau)}</span>
        <span class="tag">ab ${ex.spieler} Sp.</span>
        <span class="tag">~${ex.dauer} min</span>
      </div>
      <div class="ex-desc">${esc(ex.beschreibung)}</div>`;
    card.querySelector(".btn-add").addEventListener("click", () => addExerciseToPlan(ex.id));
    list.appendChild(card);
  }
}

// ═══════════ PDF-Export (über Druckansicht) ═══════════

function exportPdf() {
  const s = currentSession();
  const rows = s.items.map((item, i) => {
    const ex = EXERCISES.find((e) => e.id === item.exerciseId);
    return `
      <tr>
        <td>${i + 1}</td>
        <td>
          <strong>${esc(ex ? ex.name : "Unbekannte Übung")}</strong>
          <div class="p-desc">${esc(ex ? ex.beschreibung : "")}</div>
          ${item.notiz ? `<div class="p-note">Notiz: ${esc(item.notiz)}</div>` : ""}
        </td>
        <td>${esc(ex ? ex.kategorie : "")}</td>
        <td>${item.dauer} min</td>
      </tr>`;
  }).join("");

  $("#print-view").innerHTML = `
    <h1>${esc(s.titel) || "Trainingssession"}</h1>
    <div class="print-meta">
      <div><strong>Mannschaft:</strong> ${esc(s.team) || "–"}</div>
      <div><strong>Datum:</strong> ${formatDate(s.datum) || "–"}${s.uhrzeit ? ", " + esc(s.uhrzeit) + " Uhr" : ""}</div>
      <div><strong>Ort:</strong> ${esc(s.ort) || "–"}</div>
      <div><strong>Schwerpunkt:</strong> ${esc(s.schwerpunkt) || "–"}</div>
    </div>
    <table>
      <thead>
        <tr><th style="width:8mm">#</th><th>Übung</th><th style="width:28mm">Kategorie</th><th style="width:16mm">Dauer</th></tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="4">Keine Übungen geplant.</td></tr>`}</tbody>
    </table>
    <div class="print-total">Gesamtdauer: ${totalDuration(s)} min</div>
    ${s.notizen ? `<div class="print-notes"><strong>Notizen:</strong> ${esc(s.notizen)}</div>` : ""}
    <div class="print-footer">Erstellt mit VibeyBall · ${new Date().toLocaleDateString("de-CH")}</div>`;

  window.print();
}

// ═══════════ Initialisierung ═══════════

document.addEventListener("DOMContentLoaded", () => {
  populateCategoryFilter();
  bindEditorForm();

  $("#btn-new-session").addEventListener("click", createSession);
  $("#btn-back").addEventListener("click", showListView);
  $("#btn-pdf").addEventListener("click", exportPdf);

  $("#f-search").addEventListener("input", renderLibrary);
  $("#f-category").addEventListener("change", renderLibrary);
  $("#f-level").addEventListener("change", renderLibrary);

  showListView();
});
