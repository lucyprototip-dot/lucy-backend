const ExcelJS = require("exceljs");

function cleanCell(value = "") {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if (value.text !== undefined) return cleanCell(value.text);
    if (value.result !== undefined) return cleanCell(value.result);
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || "").join("");
    return JSON.stringify(value);
  }
  return String(value).replace(/<br\s*\/?>/gi, "\n").replace(/\s+$/g, "").trim();
}

function splitMarkdownRow(line = "") {
  const cells = [];
  let current = "";
  let escaped = false;
  const source = String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "");

  for (const char of source) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "|") {
      cells.push(cleanCell(current));
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(cleanCell(current));
  return cells;
}

function isMarkdownDivider(line = "") {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(String(line || ""));
}

function rowsFromMatrix(matrix = []) {
  const clean = matrix
    .map((row) => Array.isArray(row) ? row.map(cleanCell) : [])
    .filter((row) => row.some((cell) => String(cell).trim()));
  if (!clean.length) return [];

  const headers = clean[0].map((header, index) => header || `Sütun ${index + 1}`);
  return clean.slice(1).map((row) => {
    const out = {};
    headers.forEach((header, index) => {
      out[header] = row[index] ?? "";
    });
    return out;
  });
}

function parseMarkdownTables(text = "") {
  const lines = String(text || "").split(/\r?\n/);
  const tables = [];

  for (let i = 0; i < lines.length - 1; i += 1) {
    if (!lines[i].includes("|") || !isMarkdownDivider(lines[i + 1])) continue;

    const matrix = [splitMarkdownRow(lines[i])];
    i += 2;
    while (i < lines.length && lines[i].includes("|") && !/^\s*$/.test(lines[i])) {
      matrix.push(splitMarkdownRow(lines[i]));
      i += 1;
    }
    i -= 1;
    const rows = rowsFromMatrix(matrix);
    if (rows.length) tables.push(rows);
  }

  return tables;
}

function parseCsvLike(text = "") {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes(";") ? ";" : lines[0].includes("\t") ? "\t" : lines[0].includes(",") ? "," : null;
  if (!delimiter) return [];
  const matrix = lines.map((line) => line.split(delimiter).map(cleanCell));
  if (matrix[0].length < 2) return [];
  return rowsFromMatrix(matrix);
}

function normalizeRows(rows = []) {
  if (!Array.isArray(rows)) return [];
  if (!rows.length) return [];

  if (Array.isArray(rows[0])) return rowsFromMatrix(rows);

  return rows
    .filter((row) => row && typeof row === "object")
    .map((row, rowIndex) => {
      const out = {};
      Object.entries(row).forEach(([key, value], index) => {
        out[cleanCell(key) || `Sütun ${index + 1}`] = cleanCell(value);
      });
      if (!Object.keys(out).length) out.No = rowIndex + 1;
      return out;
    });
}

function fallbackRows(input = {}) {
  const direct = normalizeRows(input.rows || input.data?.rows || input.table?.rows);
  if (direct.length) return direct;

  if (Array.isArray(input.labels) && Array.isArray(input.values)) {
    return input.labels.map((label, index) => ({ Etiket: cleanCell(label), Değer: cleanCell(input.values[index] ?? "") }));
  }

  const chartLabels = input.data?.labels;
  const chartValues = input.data?.datasets?.[0]?.data;
  if (Array.isArray(chartLabels) && Array.isArray(chartValues)) {
    return chartLabels.map((label, index) => ({ Etiket: cleanCell(label), Değer: cleanCell(chartValues[index] ?? "") }));
  }

  const text = String(input.text || input.content || input.value || input.markdown || "").trim();
  const firstTable = parseMarkdownTables(text)[0];
  if (firstTable?.length) return firstTable;

  const csvRows = parseCsvLike(text);
  if (csvRows.length) return csvRows;

  if (text) {
    return text.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => ({ No: index + 1, İçerik: cleanCell(line) }));
  }

  return [];
}

function safeSheetName(name = "LUCY") {
  return cleanCell(name).replace(/[\\/?*\[\]:]/g, " ").slice(0, 31).trim() || "LUCY";
}

function columnLetter(index) {
  let n = index;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - m) / 26);
  }
  return s || "A";
}

function autoWidth(rows, columns) {
  return columns.map((key) => {
    const longest = Math.max(
      cleanCell(key).length,
      ...rows.map((row) => cleanCell(row[key]).split("\n").reduce((m, part) => Math.max(m, part.length), 0))
    );
    return Math.min(48, Math.max(12, longest + 3));
  });
}

module.exports = {
  name: "excel",
  description: "Markdown tablo, JSON satırları, grafik verisi veya düz metinden profesyonel Excel çalışma kitabı oluşturur",

  async execute(input = {}) {
    const rows = fallbackRows(input);

    if (!rows.length) {
      return {
        success: false,
        error: "rows_required",
        message: "Excel oluşturmak için tablo, rows dizisi, grafik verisi veya dönüştürülebilir metin gerekli.",
      };
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "LUCY";
    workbook.created = new Date();
    workbook.modified = new Date();

    const sheet = workbook.addWorksheet(safeSheetName(input.sheetName || input.title || "LUCY Tablo"));
    const columns = Array.from(rows.reduce((set, row) => {
      Object.keys(row || {}).forEach((key) => set.add(key));
      return set;
    }, new Set()));

    const widths = autoWidth(rows, columns);
    sheet.columns = columns.map((key, index) => ({ header: key, key, width: widths[index] }));

    rows.forEach((row) => sheet.addRow(row));

    const headerRow = sheet.getRow(1);
    headerRow.height = 24;
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111827" } };

    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: "A1", to: `${columnLetter(columns.length)}1` };

    sheet.eachRow((row, rowNumber) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.alignment = { vertical: "top", horizontal: rowNumber === 1 ? "center" : "left", wrapText: true };
        cell.border = {
          top: { style: "thin", color: { argb: "FFCBD5E1" } },
          left: { style: "thin", color: { argb: "FFCBD5E1" } },
          bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
          right: { style: "thin", color: { argb: "FFCBD5E1" } },
        };
        if (rowNumber > 1 && rowNumber % 2 === 0) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
        }
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();

    return {
      success: true,
      type: "file",
      tool: "excel",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: input.filename || "lucy-tablo.xlsx",
      base64: Buffer.from(buffer).toString("base64"),
      title: input.title || "Excel tablosu hazır",
      headers: columns,
      previewRows: rows.slice(0, 12),
      rows: rows.length,
      columns: columns.length,
      sourceType: Array.isArray(input.rows) ? "rows" : input.text ? "text" : "data",
      message: `${rows.length} satır ve ${columns.length} sütun içeren Excel hazırlandı.`,
    };
  },
};
