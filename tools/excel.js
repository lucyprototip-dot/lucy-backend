const ExcelJS = require("exceljs");

function parseMarkdownTable(text = "") {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const headerIndex = lines.findIndex((line, i) => line.includes("|") && lines[i + 1] && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(lines[i + 1]));
  if (headerIndex < 0) return [];
  const split = (line) => line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
  const headers = split(lines[headerIndex]);
  const rows = [];
  for (let i = headerIndex + 2; i < lines.length && lines[i].includes("|"); i += 1) {
    const cells = split(lines[i]);
    const row = {};
    headers.forEach((header, index) => { row[header || `Sütun ${index + 1}`] = cells[index] || ""; });
    rows.push(row);
  }
  return rows;
}

function fallbackRows(input = {}) {
  if (Array.isArray(input.labels) && Array.isArray(input.values)) {
    return input.labels.map((label, index) => ({ Başlık: label, Değer: input.values[index] ?? "" }));
  }
  const text = String(input.text || input.content || input.value || "").trim();
  const parsed = parseMarkdownTable(text);
  if (parsed.length) return parsed;
  if (text) {
    return text.split(/\r?\n/).filter(Boolean).map((line, index) => ({ No: index + 1, İçerik: line.trim() }));
  }
  return [];
}

module.exports = {
  name: "excel",
  description: "JSON satırlarından veya metinden Excel çalışma kitabı oluşturur",

  async execute(input = {}) {
    const rows = Array.isArray(input.rows) && input.rows.length ? input.rows : fallbackRows(input);

    if (!rows.length) {
      return {
        success: false,
        error: "rows_required",
        message: "Excel oluşturmak için rows dizisi veya dönüştürülebilir text/table gerekli.",
      };
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "LUCY";
    const sheet = workbook.addWorksheet(input.sheetName || "LUCY");
    const columns = Array.from(rows.reduce((set, row) => {
      Object.keys(row || {}).forEach((key) => set.add(key));
      return set;
    }, new Set()));

    sheet.columns = columns.map((key) => ({
      header: key,
      key,
      width: Math.min(48, Math.max(16, String(key).length + 8)),
    }));

    rows.forEach((row) => sheet.addRow(row));
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: "A1", to: `${String.fromCharCode(64 + Math.min(columns.length, 26))}1` };
    sheet.eachRow((row) => row.eachCell((cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
    }));

    const buffer = await workbook.xlsx.writeBuffer();

    return {
      success: true,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: input.filename || "lucy.xlsx",
      base64: Buffer.from(buffer).toString("base64"),
      rows: rows.length,
    };
  },
};
