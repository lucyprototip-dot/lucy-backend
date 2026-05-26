const ExcelJS = require("exceljs");

module.exports = {
  name: "excel",
  description: "JSON satırlarından Excel çalışma kitabı oluşturur",

  async execute(input = {}) {
    const rows = Array.isArray(input.rows) ? input.rows : [];

    if (!rows.length) {
      return {
        success: false,
        error: "rows_required",
        message: "Excel oluşturmak için rows dizisi gerekli.",
      };
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(input.sheetName || "LUCY");
    const columns = Object.keys(rows[0]);

    sheet.columns = columns.map((key) => ({
      header: key,
      key,
      width: Math.max(14, key.length + 4),
    }));

    rows.forEach((row) => sheet.addRow(row));

    const buffer = await workbook.xlsx.writeBuffer();

    return {
      success: true,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: input.filename || "lucy.xlsx",
      base64: Buffer.from(buffer).toString("base64"),
    };
  },
};
