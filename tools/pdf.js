const PDFDocument = require("pdfkit");
const fs = require("fs");

function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/\r\n/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim();
}

function safeFileName(name, ext = ".pdf") {
  const raw = cleanText(name || "lucy-profesyonel-rapor")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "lucy-profesyonel-rapor";
  return raw.toLowerCase().endsWith(ext) ? raw : `${raw}${ext}`;
}

function parseMarkdownTable(text = "") {
  const lines = cleanText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("|"));
  if (lines.length < 2) return { columns: [], rows: [] };

  const splitRow = (line) => line.replace(/^\|/, "").replace(/\|$/, "").split("|").map(cleanText);
  const headerIndex = lines.findIndex((line, index) => {
    const next = lines[index + 1] || "";
    return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(next);
  });
  if (headerIndex < 0) return { columns: [], rows: [] };

  const columns = splitRow(lines[headerIndex]).map((h, i) => h || `Sütun ${i + 1}`);
  const rows = lines.slice(headerIndex + 2).map(splitRow).filter((cells) => cells.some(Boolean)).map((cells) => {
    const row = {};
    columns.forEach((column, index) => { row[column] = cells[index] || ""; });
    return row;
  });
  return { columns, rows };
}

function normalizeTable(input = {}) {
  const rows = Array.isArray(input.rows) ? input.rows : Array.isArray(input.data) ? input.data : Array.isArray(input.table) ? input.table : [];
  if (rows.length) {
    const columns = Array.isArray(input.columns) && input.columns.length
      ? input.columns.map(cleanText).filter(Boolean)
      : Array.from(new Set(rows.flatMap((row) => Object.keys(row || {}))));
    return { columns, rows };
  }
  return parseMarkdownTable(input.markdown || input.tableMarkdown || input.text || input.raw || "");
}

function loadFont(doc) {
  const fontCandidates = [
    process.env.LUCY_PDF_FONT,
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "C:/Windows/Fonts/calibri.ttf",
  ].filter(Boolean);
  const fontPath = fontCandidates.find((candidate) => fs.existsSync(candidate));
  if (fontPath) doc.font(fontPath);
}

function drawText(doc, text) {
  cleanText(text).split("\n").forEach((line) => {
    if (!line.trim()) doc.moveDown(0.6);
    else doc.fontSize(11).fillColor("#111827").text(line, { align: "left", lineGap: 4 });
  });
}

function drawTable(doc, columns, rows) {
  if (!columns.length || !rows.length) return;

  const startX = doc.page.margins.left;
  const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colWidth = tableWidth / columns.length;
  const rowPadding = 6;
  const minRowHeight = 25;

  const drawHeader = () => {
    const y = doc.y;
    doc.rect(startX, y, tableWidth, minRowHeight).fill("#111827");
    columns.forEach((column, index) => {
      const x = startX + index * colWidth;
      doc.fillColor("#ffffff").fontSize(9).text(column, x + rowPadding, y + 7, {
        width: colWidth - rowPadding * 2,
        align: "left",
      });
      doc.strokeColor("#6b7280").rect(x, y, colWidth, minRowHeight).stroke();
    });
    doc.y = y + minRowHeight;
  };

  drawHeader();

  rows.forEach((row, rowIndex) => {
    const values = columns.map((column) => cleanText(row?.[column]));
    const heights = values.map((value) => doc.heightOfString(value || " ", { width: colWidth - rowPadding * 2 }) + rowPadding * 2);
    const rowHeight = Math.max(minRowHeight, ...heights);

    if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      drawHeader();
    }

    const y = doc.y;
    doc.rect(startX, y, tableWidth, rowHeight).fill(rowIndex % 2 === 0 ? "#ffffff" : "#f9fafb");

    values.forEach((value, index) => {
      const x = startX + index * colWidth;
      doc.strokeColor("#e5e7eb").rect(x, y, colWidth, rowHeight).stroke();
      doc.fillColor("#111827").fontSize(9).text(value || "", x + rowPadding, y + rowPadding, {
        width: colWidth - rowPadding * 2,
        align: "left",
      });
    });

    doc.y = y + rowHeight;
  });
}

module.exports = {
  name: "pdf",
  description: "Metinden veya tablo verisinden profesyonel PDF raporu üretir",

  async execute(input = {}) {
    const title = cleanText(input.title || input.name || "LUCY Rapor");
    const text = cleanText(input.text || input.content || "");
    const { columns, rows } = normalizeTable(input);

    if (!text && !rows.length) {
      return {
        success: false,
        error: "content_required",
        message: "PDF üretmek için text veya tablo verisi gerekli.",
      };
    }

    const chunks = [];
    const doc = new PDFDocument({ margin: 50, size: "A4", bufferPages: true });
    loadFont(doc);

    return await new Promise((resolve) => {
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          success: true,
          mimeType: "application/pdf",
          filename: safeFileName(input.filename || title),
          title,
          rows: rows.length || undefined,
          columns: columns.length || undefined,
          text: rows.length ? "Profesyonel PDF tablo dosyası hazır." : "PDF dosyası hazır.",
          base64: buffer.toString("base64"),
        });
      });

      doc.fontSize(20).fillColor("#111827").text(title, { underline: true });
      doc.moveDown(1.2);

      if (text && !rows.length) drawText(doc, text);
      if (rows.length) {
        if (text && !text.includes("|")) {
          drawText(doc, text);
          doc.moveDown(1);
        }
        drawTable(doc, columns, rows);
      }

      doc.end();
    });
  },
};
