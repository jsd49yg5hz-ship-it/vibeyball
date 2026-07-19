/* VibeyBall – PDF-Generierung mit jsPDF (A4, eigenes Layout)
 * Druckfreundlich: keine gefüllten Flächen, nur Typografie, feine Linien
 * und dezente Farbschrift (Navy/Orange). */

(function () {
  const COLORS = {
    navy: [22, 32, 60],
    accent: [200, 74, 8],   // gedecktes Orange, gut lesbar auf Weiss
    text: [30, 36, 51],
    muted: [122, 115, 100],
    line: [200, 192, 178],
    hairline: [222, 216, 204],
  };

  const PAGE = { w: 210, h: 297, margin: 18 };
  const CONTENT_W = PAGE.w - 2 * PAGE.margin;

  function fmtDate(iso) {
    if (!iso) return "–";
    return new Date(iso + "T00:00:00").toLocaleDateString("de-CH", {
      weekday: "long", day: "2-digit", month: "2-digit", year: "numeric",
    });
  }

  function addMinutes(hhmm, minutes) {
    const [h, m] = hhmm.split(":").map(Number);
    const total = h * 60 + m + minutes;
    return String(Math.floor(total / 60) % 24).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
  }

  // Spaltenbreiten der Ablauf-Tabelle (Summe = CONTENT_W)
  function columns(hasTime) {
    const time = hasTime ? 24 : 0;
    const cat = 27, dur = 15;
    return { time, name: CONTENT_W - time - cat - dur, cat, dur };
  }

  // Bild für jsPDF aufbereiten: SVG-Skizzen werden über ein Canvas zu PNG,
  // Rasterbilder (Upload) direkt verwendet. Liefert {data, format, ratio (h/w)}.
  function prepareImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onerror = reject;
      if (dataUrl.startsWith("data:image/svg")) {
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = 540; canvas.height = 1020; // Seitenverhältnis der Feld-Skizze (360×680)
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve({ data: canvas.toDataURL("image/jpeg", 0.85), format: "JPEG", ratio: canvas.height / canvas.width });
        };
      } else {
        img.onload = () => resolve({
          data: dataUrl,
          format: dataUrl.includes("image/png") ? "PNG" : "JPEG",
          ratio: img.naturalHeight / img.naturalWidth,
        });
      }
      img.src = dataUrl;
    });
  }

  window.generateSessionPdf = async function (session, exerciseLookup, images = {}) {
    // Skizzen der verwendeten Übungen vorbereiten (asynchron, vor dem Zeichnen)
    const prepared = {};
    for (const item of session.items) {
      const src = images[item.exerciseId];
      if (src && !prepared[item.exerciseId]) {
        try { prepared[item.exerciseId] = await prepareImage(src); } catch { /* Bild überspringen */ }
      }
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const hasTime = !!session.uhrzeit;
    const col = columns(hasTime);
    const total = session.items.reduce((s, it) => s + (Number(it.dauer) || 0), 0);

    let pageNo = 1;
    let y;

    // ── Kopfbereich Seite 1: nur Schrift + orange Linie ──
    function drawHeader() {
      doc.setTextColor(...COLORS.navy);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(19);
      doc.text(session.titel || "Trainingssession", PAGE.margin, 24);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(...COLORS.muted);
      doc.text("Trainingsplan · VibeyBall", PAGE.margin, 30);

      // Gesamtdauer rechts
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(...COLORS.accent);
      doc.text(total + " min", PAGE.w - PAGE.margin, 24, { align: "right" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...COLORS.muted);
      doc.text("Gesamtdauer", PAGE.w - PAGE.margin, 29.5, { align: "right" });

      doc.setDrawColor(...COLORS.accent);
      doc.setLineWidth(0.9);
      doc.line(PAGE.margin, 34.5, PAGE.w - PAGE.margin, 34.5);

      y = 43;
    }

    // ── Sessiondaten: zwei Spalten, nur Schrift, feine Linie darunter ──
    function drawMeta() {
      const fokus = (session.tags && session.tags.length) ? session.tags.join(", ") : (session.schwerpunkt || "–");
      const rows = [
        ["Mannschaft", session.team || "–", "Datum", fmtDate(session.datum) + (session.uhrzeit ? ", " + session.uhrzeit + " Uhr" : "")],
        ["Ort / Halle", session.ort || "–", "Fokus", fokus],
      ];

      const colW = CONTENT_W / 2;
      for (const [l1, v1, l2, v2] of rows) {
        doc.setFontSize(8.5);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...COLORS.muted);
        doc.text(l1.toUpperCase(), PAGE.margin, y);
        doc.text(l2.toUpperCase(), PAGE.margin + colW + 3, y);
        doc.setFontSize(9.5);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...COLORS.text);
        doc.text(String(v1), PAGE.margin + 28, y, { maxWidth: colW - 34 });
        doc.text(String(v2), PAGE.margin + colW + 22, y, { maxWidth: colW - 28 });
        y += 6.5;
      }

      doc.setDrawColor(...COLORS.hairline);
      doc.setLineWidth(0.2);
      doc.line(PAGE.margin, y, PAGE.w - PAGE.margin, y);
      y += 9;
    }

    // ── Tabellenkopf: Schrift + kräftigere Linie, keine Füllung ──
    function drawTableHead() {
      doc.setTextColor(...COLORS.navy);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      let x = PAGE.margin;
      if (hasTime) { doc.text("ZEIT", x, y + 4); x += col.time; }
      doc.text("ÜBUNG", x, y + 4); x += col.name;
      doc.text("KATEGORIE", x, y + 4); x += col.cat;
      doc.text("DAUER", x, y + 4);
      doc.setDrawColor(...COLORS.line);
      doc.setLineWidth(0.5);
      doc.line(PAGE.margin, y + 6.5, PAGE.w - PAGE.margin, y + 6.5);
      y += 10;
    }

    function drawFooter() {
      doc.setDrawColor(...COLORS.hairline);
      doc.setLineWidth(0.2);
      doc.line(PAGE.margin, PAGE.h - 12, PAGE.w - PAGE.margin, PAGE.h - 12);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...COLORS.muted);
      doc.text("Erstellt mit VibeyBall · " + new Date().toLocaleDateString("de-CH"), PAGE.margin, PAGE.h - 8);
      doc.text("Seite " + pageNo, PAGE.w - PAGE.margin, PAGE.h - 8, { align: "right" });
    }

    function newPage() {
      drawFooter();
      doc.addPage();
      pageNo++;
      y = PAGE.margin;
      drawTableHead();
    }

    // ── Inhalt ──
    drawHeader();
    drawMeta();
    drawTableHead();

    let clock = session.uhrzeit || null;
    const nameW = col.name - 6;

    session.items.forEach((item) => {
      const ex = exerciseLookup(item);
      const dauer = Number(item.dauer) || 0;

      doc.setFontSize(8);
      const descLines = ex.beschreibung ? doc.splitTextToSize(ex.beschreibung, nameW) : [];
      const noteLines = item.notiz ? doc.splitTextToSize("Notiz: " + item.notiz, nameW) : [];

      // Skizze: Höhe max. 42 mm, Breite max. 55 mm, Seitenverhältnis erhalten
      const img = prepared[item.exerciseId];
      let imgW = 0, imgH = 0;
      if (img) {
        imgH = 42;
        imgW = imgH / img.ratio;
        if (imgW > 55) { imgW = 55; imgH = imgW * img.ratio; }
      }

      const rowH = Math.max(10,
        7 + descLines.length * 3.4 + noteLines.length * 3.4 +
        (descLines.length || noteLines.length ? 2 : 0) + (img ? imgH + 3 : 0));

      if (y + rowH > PAGE.h - 18) newPage();

      let x = PAGE.margin;
      const baseline = y + 4;

      if (hasTime) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.setTextColor(...COLORS.accent);
        doc.text(clock + "–" + addMinutes(clock, dauer), x, baseline);
        x += col.time;
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(...COLORS.text);
      doc.text(ex.name, x, baseline, { maxWidth: nameW });

      let ty = baseline + 4.5;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...COLORS.muted);
      for (const line of descLines) { doc.text(line, x, ty); ty += 3.4; }
      if (noteLines.length) {
        doc.setFont("helvetica", "italic");
        doc.setTextColor(...COLORS.text);
        for (const line of noteLines) { doc.text(line, x, ty); ty += 3.4; }
      }
      if (img) {
        doc.addImage(img.data, img.format, x, ty, imgW, imgH);
        doc.setDrawColor(...COLORS.hairline);
        doc.setLineWidth(0.2);
        doc.rect(x, ty, imgW, imgH);
      }
      x += col.name;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...COLORS.muted);
      doc.text(ex.kategorie || "–", x, baseline, { maxWidth: col.cat - 3 });
      x += col.cat;

      doc.setFont("helvetica", "bold");
      doc.setTextColor(...COLORS.navy);
      doc.text(dauer + "'", x, baseline);

      // feine Trennlinie zwischen den Übungen
      doc.setDrawColor(...COLORS.hairline);
      doc.setLineWidth(0.2);
      doc.line(PAGE.margin, y + rowH - 2, PAGE.w - PAGE.margin, y + rowH - 2);

      y += rowH;
      if (clock) clock = addMinutes(clock, dauer);
    });

    if (session.items.length === 0) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.setTextColor(...COLORS.muted);
      doc.text("Keine Übungen geplant.", PAGE.margin, y + 6);
      y += 10;
    }

    // ── Notizen: Label + Text, keine Box ──
    if (session.notizen) {
      const noteLines = doc.splitTextToSize(session.notizen, CONTENT_W);
      const blockH = 12 + noteLines.length * 4;
      if (y + blockH > PAGE.h - 18) newPage();
      y += 6;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(...COLORS.navy);
      doc.text("NOTIZEN", PAGE.margin, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...COLORS.text);
      doc.text(noteLines, PAGE.margin, y + 5);
      y += blockH;
    }

    drawFooter();

    const fname = ((session.titel || "trainingsplan") + (session.datum ? "_" + session.datum : ""))
      .toLowerCase().replace(/[^a-z0-9äöü_-]+/gi, "-") + ".pdf";
    doc.save(fname);
  };
})();
