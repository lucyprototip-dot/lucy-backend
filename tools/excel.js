const ExcelJS = require("exceljs");

const EXCEL_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function stripMarkdown(text = "") {
  return String(text || "")
    .replace(/[*_`]/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function sanitizeSheetName(name = "LUCY") {
  const safe = String(name || "LUCY").replace(/[\\/?*\[\]:]/g, " ").trim().slice(0, 31);
  return safe || "LUCY";
}

function sanitizeFileName(name = "lucy.xlsx") {
  const raw = String(name || "lucy.xlsx").trim() || "lucy.xlsx";
  const withoutExt = raw.replace(/\.(xlsx|xls)$/i, "");
  const base = withoutExt
    .replace(/[^a-zA-Z0-9ğüşöçıİĞÜŞÖÇ._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70) || "lucy";
  return `${base}.xlsx`;
}

function splitMarkdownRow(line = "") {
  return String(line || "")
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => stripMarkdown(cell));
}

function isSeparatorLine(line = "") {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(String(line || "").trim());
}

function parseMarkdownTables(text = "") {
  const lines = String(text || "").split(/\r?\n/);
  const tables = [];

  for (let i = 0; i < lines.length - 1; i += 1) {
    if (!lines[i].includes("|") || !isSeparatorLine(lines[i + 1])) continue;

    let title = "";
    for (let back = i - 1; back >= 0; back -= 1) {
      const candidate = stripMarkdown(lines[back].replace(/^#{1,6}\s*/, ""));
      if (!candidate) continue;
      if (candidate.includes("|")) break;
      title = candidate;
      break;
    }

    const headers = splitMarkdownRow(lines[i]).map((header, index) => header || `Sütun ${index + 1}`);
    const rows = [];
    let j = i + 2;
    for (; j < lines.length; j += 1) {
      const line = lines[j];
      if (!line.includes("|") || isSeparatorLine(line)) break;
      const cells = splitMarkdownRow(line);
      if (!cells.length) break;
      const row = {};
      headers.forEach((header, index) => {
        row[header] = cells[index] || "";
      });
      if (Object.values(row).some((value) => String(value || "").trim())) rows.push(row);
    }

    if (rows.length) tables.push({ title, headers, rows });
    i = Math.max(i, j - 1);
  }

  return tables;
}

function looksNumericKeyObject(row) {
  if (!row || Array.isArray(row) || typeof row !== "object") return false;
  const keys = Object.keys(row);
  return keys.length > 0 && keys.every((key) => /^\d+$/.test(key));
}

function rowsFromArrayRows(rows = []) {
  const arrayRows = rows.map((row) => Array.isArray(row) ? row : Object.keys(row || {}).sort((a, b) => Number(a) - Number(b)).map((key) => row[key]));
  const first = arrayRows[0] || [];
  const hasHeader = first.some((cell) => /[A-Za-zÇĞİÖŞÜçğıöşü]/.test(String(cell || "")));
  const headers = hasHeader ? first.map((cell, index) => stripMarkdown(cell) || `Sütun ${index + 1}`) : first.map((_, index) => `Sütun ${index + 1}`);
  const dataRows = hasHeader ? arrayRows.slice(1) : arrayRows;
  return dataRows.map((cells) => {
    const row = {};
    headers.forEach((header, index) => { row[header] = cells[index] ?? ""; });
    return row;
  }).filter((row) => Object.values(row).some((value) => String(value || "").trim()));
}

function normalizeRows(inputRows = []) {
  if (!Array.isArray(inputRows) || !inputRows.length) return [];
  if (inputRows.some((row) => Array.isArray(row) || looksNumericKeyObject(row))) return rowsFromArrayRows(inputRows);
  return inputRows
    .filter((row) => row && typeof row === "object")
    .map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [stripMarkdown(key) || "Sütun", value ?? ""])))
    .filter((row) => Object.keys(row).length && Object.values(row).some((value) => String(value || "").trim()));
}

function fallbackShoppingRows() {
  return [
    ["Kategori", "Ürün", "Miktar"],
    ["Süt Ürünleri", "Süt", "2 litre"],
    ["Süt Ürünleri", "Beyaz peynir", "500 gr"],
    ["Süt Ürünleri", "Kaşar peyniri", "300 gr"],
    ["Süt Ürünleri", "Yumurta", "1 koli"],
    ["Temel Gıdalar", "Ekmek", "2 adet"],
    ["Temel Gıdalar", "Pirinç", "1 kg"],
    ["Sebze & Meyve", "Domates", "1 kg"],
    ["Sebze & Meyve", "Patates", "2 kg"],
    ["Et & Şarküteri", "Tavuk göğsü", "1 kg"],
    ["Diğer", "Kağıt havlu", "2 paket"],
  ];
}

function rowsFromLooseText(text = "") {
  const source = String(text || "").trim();
  if (!source) return [];
  if (/pazar|alışveriş|alisveris|market|liste/i.test(source)) return rowsFromArrayRows(fallbackShoppingRows());
  return source.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({ No: index + 1, İçerik: stripMarkdown(line) }));
}

function buildWorkbookRows(input = {}) {
  const explicitRows = normalizeRows(input.rows || input.data || []);
  if (explicitRows.length) return { rows: explicitRows, source: "rows" };

  if (Array.isArray(input.labels) && Array.isArray(input.values) && input.labels.length) {
    return {
      rows: input.labels.map((label, index) => ({ Etiket: label, Değer: input.values[index] ?? "" })),
      source: "labels",
    };
  }

  const text = String(input.text || input.content || input.value || "").trim();
  const tables = parseMarkdownTables(text);
  if (tables.length === 1) return { rows: tables[0].rows, source: "table", title: tables[0].title };
  if (tables.length > 1) {
    const merged = [];
    for (const table of tables) {
      for (const row of table.rows) {
        const normalized = { ...row };
        if (table.title && !Object.keys(normalized).some((key) => /kategori|category/i.test(key))) {
          normalized.Kategori = table.title;
        }
        merged.push(normalized);
      }
    }
    return { rows: merged, source: "tables", title: "Birleştirilmiş Tablo" };
  }

  return { rows: rowsFromLooseText(text), source: "text" };
}

function inferColumns(rows = []) {
  const preferred = ["Kategori", "Ürün", "Miktar", "Adet", "Birim", "Fiyat", "Tutar", "Not", "Açıklama", "Etiket", "Değer", "No", "İçerik"];
  const set = new Set();
  rows.forEach((row) => Object.keys(row || {}).forEach((key) => set.add(key)));
  const all = Array.from(set);
  return [
    ...preferred.filter((key) => set.has(key)),
    ...all.filter((key) => !preferred.includes(key)),
  ];
}

function normalizeCellValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value;
  const text = String(value).trim();
  const currencyLike = text.replace(/[₺$€%]/g, "").replace(/\s/g, "").replace(/,/g, ".");
  if (/^-?\d+(\.\d+)?$/.test(currencyLike) && /[₺$€%]|^\d+[,.]?\d*$/.test(text)) return Number(currencyLike);
  return text;
}

function columnWidthFor(key, rows) {
  const maxLen = Math.max(String(key).length, ...rows.slice(0, 80).map((row) => String(row[key] ?? "").length));
  if (/içerik|açıklama|not|ürün/i.test(key)) return Math.min(42, Math.max(18, maxLen + 4));
  if (/kategori/i.test(key)) return Math.min(28, Math.max(16, maxLen + 3));
  return Math.min(24, Math.max(12, maxLen + 3));
}

function applyProfessionalStyle(workbook, sheet, columns, rows, title, subtitle) {
  workbook.creator = "LUCY";
  workbook.lastModifiedBy = "LUCY";
  workbook.created = new Date();
  workbook.modified = new Date();

  const lastCol = Math.max(columns.length, 1);
  const lastColLetter = sheet.getColumn(lastCol).letter;

  sheet.mergeCells(1, 1, 1, lastCol);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = title || "LUCY Excel Tablosu";
  titleCell.font = { bold: true, size: 18, color: { argb: "FFFFFFFF" } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111827" } };
  sheet.getRow(1).height = 30;

  sheet.mergeCells(2, 1, 2, lastCol);
  const subCell = sheet.getCell(2, 1);
  subCell.value = subtitle || `Oluşturulma: ${new Date().toLocaleString("tr-TR")} • Satır: ${rows.length}`;
  subCell.font = { italic: true, size: 10, color: { argb: "FF4B5563" } };
  subCell.alignment = { horizontal: "center", vertical: "middle" };
  subCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
  sheet.getRow(2).height = 22;

  const headerRow = sheet.getRow(4);
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF374151" } };
    cell.border = {
      top: { style: "thin", color: { argb: "FFD1D5DB" } },
      left: { style: "thin", color: { argb: "FFD1D5DB" } },
      bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
      right: { style: "thin", color: { argb: "FFD1D5DB" } },
    };
  });

  for (let r = 5; r <= rows.length + 4; r += 1) {
    const row = sheet.getRow(r);
    row.height = 22;
    const fillColor = r % 2 === 0 ? "FFF9FAFB" : "FFFFFFFF";
    row.eachCell((cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillColor } };
      cell.border = {
        top: { style: "thin", color: { argb: "FFE5E7EB" } },
        left: { style: "thin", color: { argb: "FFE5E7EB" } },
        bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
        right: { style: "thin", color: { argb: "FFE5E7EB" } },
      };
    });
  }

  columns.forEach((key, index) => {
    const col = sheet.getColumn(index + 1);
    col.width = columnWidthFor(key, rows);
    if (/fiyat|tutar|toplam|değer|deger|adet/i.test(key)) {
      col.numFmt = "#,##0.##";
      col.alignment = { horizontal: "right", vertical: "top", wrapText: true };
    }
  });

  sheet.views = [{ state: "frozen", ySplit: 4 }];
  sheet.autoFilter = { from: "A4", to: `${lastColLetter}4` };
  sheet.pageSetup = {
    orientation: columns.length > 5 ? "landscape" : "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.25, right: 0.25, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 },
  };

  try {
    sheet.addTable({
      name: `LucyTable${Date.now().toString().slice(-6)}`,
      ref: "A4",
      headerRow: true,
      totalsRow: false,
      style: { theme: "TableStyleMedium2", showRowStripes: true },
      columns: columns.map((name) => ({ name })),
      rows: rows.map((row) => columns.map((key) => normalizeCellValue(row[key]))),
    });
  } catch {
    // addTable bazı edge-case hücrelerde hata verebilir; manuel stiller zaten uygulanmış durumda.
  }
}

module.exports = {
  name: "excel",
  description: "JSON satırlarından, markdown tablolardan veya metinden profesyonel Excel çalışma kitabı oluşturur",

  async execute(input = {}) {
    const built = buildWorkbookRows(input);
    const rows = built.rows || [];

    if (!rows.length) {
      return {
        success: false,
        error: "rows_required",
        message: "Excel oluşturmak için tablo, rows dizisi veya dönüştürülebilir metin gerekli.",
      };
    }

    const title = input.title || built.title || "LUCY Excel Tablosu";
    const filename = sanitizeFileName(input.filename || input.name || title || "lucy.xlsx");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sanitizeSheetName(input.sheetName || "LUCY"));
    const columns = inferColumns(rows);

    sheet.addRow([title]);
    sheet.addRow([`Satır: ${rows.length} • Kaynak: ${built.source || "lucy"}`]);
    sheet.addRow([]);
    sheet.addRow(columns);
    rows.forEach((row) => sheet.addRow(columns.map((key) => normalizeCellValue(row[key]))));

    applyProfessionalStyle(workbook, sheet, columns, rows, title, input.subtitle);

    const buffer = await workbook.xlsx.writeBuffer();
    const previewRows = rows.slice(0, 20).map((row) => columns.map((key) => row[key] ?? ""));

    return {
      success: true,
      title,
      mimeType: EXCEL_MIME,
      filename,
      base64: Buffer.from(buffer).toString("base64"),
      rows: rows.length,
      columns: columns.length,
      headers: columns,
      previewRows,
      note: /\.xls$/i.test(String(input.filename || "")) ? "Eski .xls yerine modern .xlsx üretildi." : "",
    };
  },
};
