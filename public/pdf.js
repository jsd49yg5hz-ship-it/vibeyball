/* VibeyBall – PDF-Generierung mit jsPDF (A4, eigenes Layout) */

(function () {
  const COLORS = {
    primary: [22, 32, 60],    // dunkles Navy (Theme «Volleyball-warm»)
    primaryDark: [234, 88, 12], // Orange-Akzentlinie unter dem Kopfband
    accent: [234, 88, 12],    // Orange für Zeiten
    text: [30, 36, 51],
    muted: [121, 113, 95],
    light: [246, 241, 231],   // Sand für Boxen
    zebra: [250, 246, 238],
    line: [231, 221, 204],
  };

  const PAGE = { w: 210, h: 297, margin: 16 };
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
    return {
      time,
      name: CONTENT_W - time - cat - dur,
      cat,
      dur,
    };
  }

  window.generateSessionPdf = function (session, exerciseLookup) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const hasTime = !!session.uhrzeit;
    const col = columns(hasTime);
    const total = session.items.reduce((s, it) => s + (Number(it.dauer) || 0), 0);

    let pageNo = 1;
    let y;

    // ── Kopfbereich Seite 1 ──
    function drawHeader() {
      doc.setFillColor(...COLORS.primary);
      doc.rect(0, 0, PAGE.w, 30, "F");
      doc.setFillColor(...COLORS.primaryDark);
      doc.rect(0, 27, PAGE.w, 3, "F");

      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(17);
      doc.text(session.titel || "Trainingssession", PAGE.margin, 14);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(247, 213, 181);
      doc.text("Trainingsplan · VibeyBall", PAGE.margin, 21);

      // Gesamtdauer rechts im Kopf
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(255, 255, 255);
      doc.text(total + " min", PAGE.w - PAGE.margin, 14, { align: "right" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(247, 213, 181);
      doc.text("Gesamtdauer", PAGE.w - PAGE.margin, 20, { align: "right" });

      y = 38;
    }

    // ── Meta-Box mit Sessiondaten ──
    function drawMeta() {
      const rows = [
        ["Mannschaft", session.team || "–", "Datum", fmtDate(session.datum) + (session.uhrzeit ? ", " + session.uhrzeit + " Uhr" : "")],
        ["Ort / Halle", session.ort || "–", "Schwerpunkt", session.schwerpunkt || "–"],
      ];
      const boxH = 8 + rows.length * 7;
      doc.setFillColor(...COLORS.light);
      doc.roundedRect(PAGE.margin, y, CONTENT_W, boxH, 2, 2, "F");

      let ry = y + 9;
      const colW = CONTENT_W / 2;
      for (const [l1, v1, l2, v2] of rows) {
        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...COLORS.muted);
        doc.text(l1.toUpperCase(), PAGE.margin + 5, ry);
        doc.text(l2.toUpperCase(), PAGE.margin + colW + 3, ry);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...COLORS.text);
        doc.text(String(v1), PAGE.margin + 32, ry, { maxWidth: colW - 38 });
        doc.text(String(v2), PAGE.margin + colW + 30, ry, { maxWidth: colW - 36 });
        ry += 7;
      }
      y += boxH + 8;
    }

    // ── Tabellenkopf ──
    function drawTableHead() {
      doc.setFillColor(...COLORS.primary);
      doc.rect(PAGE.margin, y, CONTENT_W, 8, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      let x = PAGE.margin + 3;
      if (hasTime) { doc.text("ZEIT", x, y + 5.4); x += col.time; }
      doc.text("ÜBUNG", x, y + 5.4); x += col.name;
      doc.text("KATEGORIE", x, y + 5.4); x += col.cat;
      doc.text("DAUER", x, y + 5.4);
      y += 8;
    }

    function drawFooter() {
      doc.setDrawColor(...COLORS.line);
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

    session.items.forEach((item, i) => {
      const ex = exerciseLookup(item);
      const dauer = Number(item.dauer) || 0;

      doc.setFontSize(8);
      const descLines = ex.beschreibung ? doc.splitTextToSize(ex.beschreibung, nameW) : [];
      const noteLines = item.notiz ? doc.splitTextToSize("Notiz: " + item.notiz, nameW) : [];
      const rowH = Math.max(10, 7 + descLines.length * 3.4 + noteLines.length * 3.4 + (descLines.length || noteLines.length ? 2 : 0));

      if (y + rowH > PAGE.h - 18) newPage();

      // Zebra-Hintergrund
      if (i % 2 === 1) {
        doc.setFillColor(...COLORS.zebra);
        doc.rect(PAGE.margin, y, CONTENT_W, rowH, "F");
      }

      let x = PAGE.margin + 3;
      const baseline = y + 5.5;

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
      x += col.name;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...COLORS.muted);
      doc.text(ex.kategorie || "–", x, baseline, { maxWidth: col.cat - 3 });
      x += col.cat;

      doc.setFont("helvetica", "bold");
      doc.setTextColor(...COLORS.text);
      doc.text(dauer + "'", x, baseline);

      // Trennlinie
      doc.setDrawColor(...COLORS.line);
      doc.setLineWidth(0.15);
      doc.line(PAGE.margin, y + rowH, PAGE.w - PAGE.margin, y + rowH);

      y += rowH;
      if (clock) clock = addMinutes(clock, dauer);
    });

    if (session.items.length === 0) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.setTextColor(...COLORS.muted);
      doc.text("Keine Übungen geplant.", PAGE.margin + 3, y + 6);
      y += 10;
    }

    // ── Notizen ──
    if (session.notizen) {
      const noteLines = doc.splitTextToSize(session.notizen, CONTENT_W - 10);
      const boxH = 10 + noteLines.length * 4;
      if (y + boxH > PAGE.h - 18) newPage();
      y += 5;
      doc.setFillColor(...COLORS.light);
      doc.roundedRect(PAGE.margin, y, CONTENT_W, boxH, 2, 2, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(...COLORS.muted);
      doc.text("NOTIZEN", PAGE.margin + 5, y + 6);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...COLORS.text);
      doc.text(noteLines, PAGE.margin + 5, y + 11.5);
      y += boxH;
    }

    drawFooter();

    const fname = ((session.titel || "trainingsplan") + (session.datum ? "_" + session.datum : ""))
      .toLowerCase().replace(/[^a-z0-9äöü_-]+/gi, "-") + ".pdf";
    doc.save(fname);
  };
})();
