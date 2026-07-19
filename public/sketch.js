/* Skizzen-Editor: Volleyballfeld als SVG.
 * Spieler, Gegner, Bälle, Hütchen und Pfeile platzieren; Ergebnis wird als
 * SVG-Data-URL gespeichert (mit eingebetteten Objektdaten, damit Skizzen
 * später wieder bearbeitet werden können). Alternativ Bild-Upload. */

window.SketchEditor = (function () {
  // Feldgeometrie: 9 m breit, 18 m lang; Massstab ~33 px/m, Rand 30 px
  const W = 360, H = 680;
  const COURT = { x: 30, y: 40, w: 300, h: 600 };
  const ATTACK = 100; // 3-Meter-Linie

  let objects = [];       // {t:'p'|'o'|'b'|'c', x, y} | {t:'a', x1, y1, x2, y2}
  let tool = "move";
  let arrowStart = null;  // Startpunkt beim Pfeilziehen
  let dragObj = null;     // Objekt, das gerade verschoben wird
  let options = {};

  const TOOLS = [
    ["move", "✥", "Verschieben"],
    ["p", "🔵", "Spieler"],
    ["o", "🟠", "Gegner"],
    ["b", "🟡", "Ball"],
    ["c", "🔺", "Hütchen"],
    ["a", "➘", "Pfeil ziehen"],
    ["del", "✕", "Objekt löschen"],
  ];

  function courtSvg() {
    const { x, y, w, h } = COURT;
    const mid = y + h / 2;
    return `
      <rect width="${W}" height="${H}" fill="#f8f5ee"/>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#f3e8d8" stroke="#8a7c62" stroke-width="2.5"/>
      <line x1="${x}" y1="${mid - ATTACK}" x2="${x + w}" y2="${mid - ATTACK}" stroke="#8a7c62" stroke-width="1.5" stroke-dasharray="7 5"/>
      <line x1="${x}" y1="${mid + ATTACK}" x2="${x + w}" y2="${mid + ATTACK}" stroke="#8a7c62" stroke-width="1.5" stroke-dasharray="7 5"/>
      <line x1="${x - 12}" y1="${mid}" x2="${x + w + 12}" y2="${mid}" stroke="#334155" stroke-width="4"/>`;
  }

  function objectsSvg(interactive) {
    let playerNo = 0, oppNo = 0;
    return objects.map((o, idx) => {
      const attrs = interactive ? `data-idx="${idx}" style="cursor:${tool === "move" ? "grab" : tool === "del" ? "not-allowed" : "default"}"` : "";
      if (o.t === "a") {
        return `<g ${attrs}>
          <line x1="${o.x1}" y1="${o.y1}" x2="${o.x2}" y2="${o.y2}" stroke="#1e2433" stroke-width="10" opacity="0"/>
          <line x1="${o.x1}" y1="${o.y1}" x2="${o.x2}" y2="${o.y2}" stroke="#1e2433" stroke-width="3" marker-end="url(#vb-arrow)"/>
        </g>`;
      }
      if (o.t === "p") { playerNo++; return `<g ${attrs}><circle cx="${o.x}" cy="${o.y}" r="13" fill="#1d4ed8" stroke="#fff" stroke-width="2"/><text x="${o.x}" y="${o.y + 4.5}" text-anchor="middle" fill="#fff" font-size="13" font-weight="bold" font-family="sans-serif">${playerNo}</text></g>`; }
      if (o.t === "o") { oppNo++; return `<g ${attrs}><circle cx="${o.x}" cy="${o.y}" r="13" fill="#ea580c" stroke="#fff" stroke-width="2"/><text x="${o.x}" y="${o.y + 4.5}" text-anchor="middle" fill="#fff" font-size="13" font-weight="bold" font-family="sans-serif">${oppNo}</text></g>`; }
      if (o.t === "b") { return `<g ${attrs}><circle cx="${o.x}" cy="${o.y}" r="8" fill="#fbbf24" stroke="#92400e" stroke-width="2"/></g>`; }
      return `<g ${attrs}><path d="M ${o.x} ${o.y - 11} L ${o.x + 10} ${o.y + 8} L ${o.x - 10} ${o.y + 8} Z" fill="#94a3b8" stroke="#475569" stroke-width="1.5"/></g>`;
    }).join("");
  }

  const ARROW_MARKER = `<defs><marker id="vb-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 Z" fill="#1e2433"/></marker></defs>`;

  function render() {
    const svg = document.getElementById("sketch-canvas");
    svg.innerHTML = ARROW_MARKER + courtSvg() + objectsSvg(true) +
      (arrowStart ? `<circle cx="${arrowStart.x}" cy="${arrowStart.y}" r="4" fill="#1e2433"/>` : "");
    document.querySelectorAll("#sketch-tools button[data-tool]").forEach((b) =>
      b.classList.toggle("active", b.dataset.tool === tool));
  }

  function svgPoint(evt) {
    const svg = document.getElementById("sketch-canvas");
    const rect = svg.getBoundingClientRect();
    return {
      x: Math.round(((evt.clientX - rect.left) / rect.width) * W),
      y: Math.round(((evt.clientY - rect.top) / rect.height) * H),
    };
  }

  function onPointerDown(evt) {
    evt.preventDefault();
    const pt = svgPoint(evt);
    const hit = evt.target.closest("[data-idx]");
    if (tool === "del") {
      if (hit) { objects.splice(Number(hit.dataset.idx), 1); render(); }
      return;
    }
    if (tool === "move") {
      if (hit) dragObj = objects[Number(hit.dataset.idx)];
      return;
    }
    if (tool === "a") {
      if (!arrowStart) { arrowStart = pt; render(); }
      else { objects.push({ t: "a", x1: arrowStart.x, y1: arrowStart.y, x2: pt.x, y2: pt.y }); arrowStart = null; render(); }
      return;
    }
    objects.push({ t: tool, x: pt.x, y: pt.y });
    render();
  }

  function onPointerMove(evt) {
    if (!dragObj) return;
    const pt = svgPoint(evt);
    if (dragObj.t === "a") {
      const dx = pt.x - (dragObj.x1 + dragObj.x2) / 2;
      const dy = pt.y - (dragObj.y1 + dragObj.y2) / 2;
      dragObj.x1 += dx; dragObj.x2 += dx; dragObj.y1 += dy; dragObj.y2 += dy;
    } else {
      dragObj.x = pt.x; dragObj.y = pt.y;
    }
    render();
  }

  function exportDataUrl() {
    const svgString =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">` +
      `<desc>vb-sketch:${JSON.stringify(objects)}</desc>` +
      ARROW_MARKER + courtSvg() + objectsSvg(false) + `</svg>`;
    return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgString)));
  }

  // Skizzen-Objekte aus einer früher gespeicherten SVG-Data-URL zurückholen
  function parseExisting(dataUrl) {
    try {
      if (!dataUrl?.startsWith("data:image/svg+xml;base64,")) return null;
      const svgString = decodeURIComponent(escape(atob(dataUrl.split(",")[1])));
      const match = svgString.match(/<desc>vb-sketch:(.*?)<\/desc>/s);
      return match ? JSON.parse(match[1]) : null;
    } catch {
      return null;
    }
  }

  // Hochgeladenes Bild clientseitig verkleinern (max. 900 px Kantenlänge)
  function resizeUpload(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 900 / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  function open(opts) {
    options = opts;
    const existingObjects = parseExisting(opts.existing);
    objects = existingObjects || [];
    tool = "move";
    arrowStart = null;
    dragObj = null;

    document.getElementById("sketch-title").textContent = opts.title || "Skizze";
    document.getElementById("sketch-existing-upload").classList.toggle(
      "hidden", !(opts.existing && !existingObjects));
    if (opts.existing && !existingObjects) {
      document.getElementById("sketch-upload-preview").src = opts.existing;
    }
    document.getElementById("btn-sketch-delete").classList.toggle("hidden", !opts.existing);
    document.getElementById("dlg-sketch").showModal();
    render();
  }

  function init() {
    const tools = document.getElementById("sketch-tools");
    tools.innerHTML =
      TOOLS.map(([id, icon, label]) =>
        `<button type="button" data-tool="${id}" title="${label}">${icon}</button>`).join("") +
      `<button type="button" id="btn-sketch-clear" title="Alles löschen">🗑</button>`;
    tools.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      if (btn.id === "btn-sketch-clear") { objects = []; arrowStart = null; render(); return; }
      tool = btn.dataset.tool;
      arrowStart = null;
      render();
    });

    const svg = document.getElementById("sketch-canvas");
    svg.addEventListener("pointerdown", onPointerDown);
    svg.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", () => { dragObj = null; });

    document.getElementById("sketch-file").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      const dataUrl = await resizeUpload(file);
      document.getElementById("dlg-sketch").close();
      options.onSave?.(dataUrl);
    });

    document.getElementById("btn-sketch-save").addEventListener("click", () => {
      document.getElementById("dlg-sketch").close();
      options.onSave?.(exportDataUrl());
    });
    document.getElementById("btn-sketch-delete").addEventListener("click", () => {
      document.getElementById("dlg-sketch").close();
      options.onDelete?.();
    });
    document.getElementById("btn-sketch-cancel").addEventListener("click", () =>
      document.getElementById("dlg-sketch").close());
  }

  return { open, init };
})();
