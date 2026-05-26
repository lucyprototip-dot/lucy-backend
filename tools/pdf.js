const PDFDocument = require("pdfkit");
const fs = require("fs");

module.exports = {
  name: "pdf",
  description: "Metinden basit PDF raporu üretir",

  async execute(input = {}) {
    const title = String(input.title || "LUCY Rapor");
    const text = String(input.text || "").trim();

    if (!text) {
      return {
        success: false,
        error: "text_required",
        message: "PDF üretmek için text gerekli.",
      };
    }

    const chunks = [];
    const doc = new PDFDocument({ margin: 50 });

    return await new Promise((resolve) => {
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          success: true,
          mimeType: "application/pdf",
          filename: input.filename || "lucy-report.pdf",
          base64: buffer.toString("base64"),
        });
      });

      const fontCandidates = [
        process.env.LUCY_PDF_FONT,
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans.ttf",
        "C:/Windows/Fonts/arial.ttf",
      ].filter(Boolean);
      const fontPath = fontCandidates.find((candidate) => fs.existsSync(candidate));
      if (fontPath) doc.font(fontPath);

      doc.fontSize(20).text(title, { underline: true });
      doc.moveDown();
      doc.fontSize(12).text(text, { align: "left" });
      doc.end();
    });
  },
};
