const ExcelJS = require("exceljs");

function parseMarkdownTable(text = "") {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (!lines[i].includes("|") || !/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(lines[i + 1])) continue;
    const cells = (line) => line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim().replace(/\*\*/g, ""));
    const columns = cells(lines[i]);
    const rows = [];
    for (let j = i + 2; j < lines.length && lines[j].includes("|"); j += 1) {
      const values = cells(lines[j]);
      const row = {};
      columns.forEach((column, index) => { row[column] = values[index] || ""; });
      rows.push(row);
    }
    if (columns.length && rows.length) return { columns, rows };
  }
  return { columns: [], rows: [] };
}

function safeSheetName(name = "LUCY") {
  return String(name || "LUCY").replace(/[\\/*?:[\]]/g, " ").slice(0, 31) || "LUCY";
}

module.exports = {
  name: "excel",
  description: "JSON/markdown satırlarından profesyonel Excel çalışma kitabı oluşturur",

  async execute(input = {}) {
    let rows = Array.isArray(input.rows) ? input.rows : [];
    let columns = Array.isArray(input.columns) ? input.columns : [];
    if (!rows.length) {
      const parsed = parseMarkdownTable(input.markdown || input.text || input.content || "");
      rows = parsed.rows;
      columns = columns.length ? columns : parsed.columns;
    }

    if (!rows.length) {
      return { success: false, error: "rows_required", message: "Excel oluşturmak için rows, markdown tablo veya text gerekli." };
    }

    columns = columns.length ? columns : Object.keys(rows[0]);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "LUCY";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet(safeSheetName(input.sheetName || "LUCY"), {
      views: [{ state: "frozen", ySplit: input.title ? 2 : 1 }],
    });

    if (input.title) {
      sheet.mergeCells(1, 1, 1, columns.length);
      const titleCell = sheet.getCell(1, 1);
      titleCell.value = input.title;
      titleCell.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
      titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
      titleCell.alignment = { vertical: "middle", horizontal: "center" };
      sheet.getRow(1).height = 28;
    }

    const headerRowIndex = input.title ? 2 : 1;
    const headerRow = sheet.getRow(headerRowIndex);
    columns.forEach((key, index) => {
      const cell = headerRow.getCell(index + 1);
      cell.value = key;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111827" } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = { bottom: { style: "thin", color: { argb: "FF9CA3AF" } } };
    });

    rows.forEach((row, rowIndex) => {
      const excelRow = sheet.addRow(columns.map((key) => row[key] ?? ""));
      excelRow.eachCell((cell) => {
        cell.alignment = { vertical: "middle", wrapText: true };
        cell.border = {
          top: { style: "thin", color: { argb: "FFE5E7EB" } },
          bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
          left: { style: "thin", color: { argb: "FFF3F4F6" } },
          right: { style: "thin", color: { argb: "FFF3F4F6" } },
        };
        if (rowIndex % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } };
      });
    });

    columns.forEach((key, index) => {
      const values = [key, ...rows.map((row) => String(row[key] ?? ""))];
      sheet.getColumn(index + 1).width = Math.min(42, Math.max(14, ...values.map((v) => v.length + 3)));
    });
    sheet.autoFilter = { from: { row: headerRowIndex, column: 1 }, to: { row: headerRowIndex, column: columns.length } };

    const buffer = await workbook.xlsx.writeBuffer();
    const requestedName = input.filename || "lucy.xlsx";
    const filename = String(requestedName).replace(/\.xls$/i, ".xlsx");
    return {
      success: true,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename,
      title: input.title || filename,
      rows: rows.length,
      columns: columns.length,
      base64: Buffer.from(buffer).toString("base64"),
    };
  },
};
