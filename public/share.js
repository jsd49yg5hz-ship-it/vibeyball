/* Geteilte Trainingsplan-Ansicht */

const $ = (sel) => document.querySelector(sel);

// Theme-Umschalter
$("#btn-theme").textContent = document.documentElement.dataset.theme === "dark" ? "☀️" : "🌙";
$("#btn-theme").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem("vb-theme", next);
  document.documentElement.dataset.theme = next;
  $("#btn-theme").textContent = next === "dark" ? "☀️" : "🌙";
});

function esc(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso + "T00:00:00").toLocaleDateString("de-CH", {
    weekday: "long", day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function addMinutes(hhmm, minutes) {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return String(Math.floor(total / 60) % 24).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
}

async function load() {
  const token = location.pathname.split("/").pop();
  const res = await fetch("../api/shared/" + token);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    $("#share-loading").textContent = data.error || "Dieser Trainingsplan existiert nicht mehr oder wird nicht mehr geteilt.";
    return;
  }
  const s = await res.json();
  const total = s.items.reduce((sum, it) => sum + (Number(it.dauer) || 0), 0);

  $("#sh-title").textContent = s.titel || "Trainingssession";
  $("#sh-total").textContent = total + " min";
  $("#sh-meta").innerHTML = [
    s.team && `<strong>Mannschaft:</strong> ${esc(s.team)}`,
    s.datum && `<strong>Datum:</strong> ${formatDate(s.datum)}${s.uhrzeit ? ", " + esc(s.uhrzeit) + " Uhr" : ""}`,
    s.ort && `<strong>Ort:</strong> ${esc(s.ort)}`,
    (s.tags || []).length && `<strong>Fokus:</strong> ${s.tags.map(esc).join(", ")}`,
  ].filter(Boolean).join(" · ");

  let clock = s.uhrzeit || null;
  $("#sh-plan").innerHTML = s.items.map((item, i) => {
    const time = clock ? `${clock}–${addMinutes(clock, Number(item.dauer) || 0)}` : "";
    if (clock) clock = addMinutes(clock, Number(item.dauer) || 0);
    return `
      <li class="plan-item plan-item-static">
        <span class="order">${i + 1}</span>
        <span>
          <span class="name">${esc(item.name)}</span>
          ${time ? `<span class="time-range">${time}</span>` : ""}
          <span class="cat"> · ${esc(item.kategorie)} · ${item.dauer} min</span>
          ${s.images?.[item.exerciseId] ? `<img class="ex-thumb" src="${s.images[item.exerciseId]}" alt="Skizze">` : ""}
          <div class="ex-desc">${esc(item.beschreibung)}</div>
          ${item.notiz ? `<div class="ex-desc"><em>Notiz: ${esc(item.notiz)}</em></div>` : ""}
        </span>
      </li>`;
  }).join("") || `<p class="empty-hint">Keine Übungen geplant.</p>`;

  if (s.notizen) {
    $("#sh-notes").innerHTML = `<strong>Notizen:</strong> ${esc(s.notizen)}`;
    $("#sh-notes").classList.remove("hidden");
  }

  $("#btn-pdf").addEventListener("click", () =>
    generateSessionPdf(s,
      (item) => ({ name: item.name, kategorie: item.kategorie, beschreibung: item.beschreibung }),
      s.images || {}));

  $("#share-loading").classList.add("hidden");
  $("#share-content").classList.remove("hidden");
}

load();
