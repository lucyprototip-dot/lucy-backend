const ExcelJS = require("exceljs");

function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/\r\n/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim();
}

function safeFileName(name, ext = ".xlsx") {
  const raw = cleanText(name || "lucy-profesyonel-tablo")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "lucy-profesyonel-tablo";
  return raw.toLowerCase().endsWith(ext) ? raw : `${raw}${ext}`;
}

function parseMarkdownTable(text = "") {
  const lines = cleanText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("|"));

  if (lines.length < 2) return [];

  const splitRow = (line) => line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cleanText(cell));

  const headerIndex = lines.findIndex((line, index) => {
    const next = lines[index + 1] || "";
    return /\|/.test(line) && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(next);
  });

  if (headerIndex < 0) return [];

  const headers = splitRow(lines[headerIndex]).map((h, i) => h || `Sütun ${i + 1}`);
  const bodyLines = lines.slice(headerIndex + 2);

  return bodyLines
    .map(splitRow)
    .filter((cells) => cells.some(Boolean))
    .map((cells) => {
      const row = {};
      headers.forEach((header, index) => {
        row[header] = cells[index] || "";
      });
      return row;
    });
}

function normalizeRows(input = {}) {
  if (Array.isArray(input.rows)) return input.rows;
  if (Array.isArray(input.data)) return input.data;
  if (Array.isArray(input.table)) return input.table;
  if (Array.isArray(input.values) && Array.isArray(input.columns)) {
    return input.values.map((cells) => {
      const row = {};
      input.columns.forEach((column, index) => {
        row[cleanText(column) || `Sütun ${index + 1}`] = Array.isArray(cells) ? cells[index] : "";
      });
      return row;
    });
  }

  const text = input.markdown || input.tableMarkdown || input.text || input.raw || "";
  const parsed = parseMarkdownTable(text);
  if (parsed.length) return parsed;

  const clean = cleanText(text);
  if (clean) {
    return clean.split("\n").filter(Boolean).map((line, index) => ({
      No: index + 1,
      İçerik: line,
    }));
  }

  return [];
}

function normalizeColumns(rows = [], input = {}) {
  const explicit = Array.isArray(input.columns) ? input.columns.map(cleanText).filter(Boolean) : [];
  const keys = explicit.length ? explicit : Array.from(new Set(rows.flatMap((row) => Object.keys(row || {}))));
  return keys.length ? keys : ["No", "İçerik"];
}

function columnWidth(rows, key) {
  const max = Math.max(
    cleanText(key).length,
    ...rows.slice(0, 150).map((row) => cleanText(row?.[key]).length)
  );
  return Math.min(48, Math.max(14, max + 4));
}

module.exports = {
  name: "excel",
  description: "Profesyonel biçimli Excel çalışma kitabı oluşturur",

  async execute(input = {}) {
    const rows = normalizeRows(input);

    if (!rows.length) {
      return {
        success: false,
        error: "rows_required",
        message: "Excel oluşturmak için rows, markdown tablo veya text gerekli.",
      };
    }

    const title = cleanText(input.title || input.name || "LUCY Profesyonel Tablo");
    const sheetName = cleanText(input.sheetName || "LUCY Tablo").slice(0, 31) || "LUCY Tablo";
    const columns = normalizeColumns(rows, input);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "LUCY";
    workbook.created = new Date();
    workbook.modified = new Date();

    const sheet = workbook.addWorksheet(sheetName, {
      views: [{ state: "frozen", ySplit: 2 }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });

    sheet.addRow([title]);
    sheet.mergeCells(1, 1, 1, columns.length);
    const titleCell = sheet.getCell(1, 1);
    titleCell.font = { name: "Arial", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
    titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111827" } };
    titleCell.alignment = { vertical: "middle", horizontal: "center" };
    sheet.getRow(1).height = 28;

    sheet.addRow(columns);
    const headerRow = sheet.getRow(2);
    headerRow.height = 24;
    headerRow.eachCell((cell) => {
      cell.font = { name: "Arial", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF374151" } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = {
        top: { style: "thin", color: { argb: "FF9CA3AF" } },
        left: { style: "thin", color: { argb: "FF9CA3AF" } },
        bottom: { style: "thin", color: { argb: "FF9CA3AF" } },
        right: { style: "thin", color: { argb: "FF9CA3AF" } },
      };
    });

    rows.forEach((row, rowIndex) => {
      const excelRow = sheet.addRow(columns.map((key) => row?.[key] ?? ""));
      excelRow.height = 22;
      excelRow.eachCell((cell) => {
        cell.font = { name: "Arial", size: 10, color: { argb: "FF111827" } };
        cell.alignment = { vertical: "top", horizontal: "left", wrapText: true };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: rowIndex % 2 === 0 ? "FFFFFFFF" : "FFF9FAFB" },
        };
        cell.border = {
          top: { style: "thin", color: { argb: "FFE5E7EB" } },
          left: { style: "thin", color: { argb: "FFE5E7EB" } },
          bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
          right: { style: "thin", color: { argb: "FFE5E7EB" } },
        };
      });
    });

    sheet.columns = columns.map((key, index) => ({
      key: `col_${index}`,
      width: columnWidth(rows, key),
    }));

    sheet.autoFilter = {
      from: { row: 2, column: 1 },
      to: { row: 2, column: columns.length },
    };

    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (typeof cell.value === "string" && /^\d+(\.\d+)?%?$/.test(cell.value.trim())) {
          cell.alignment = { ...cell.alignment, horizontal: "center" };
        }
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();

    return {
      success: true,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: safeFileName(input.filename || title),
      title,
      rows: rows.length,
      columns: columns.length,
      text: "Profesyonel Excel dosyası hazır.",
      base64: Buffer.from(buffer).toString("base64"),
    };
  },
};
