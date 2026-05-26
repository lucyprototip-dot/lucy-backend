const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

function findPdfFont() {
  const candidates = [
    process.env.LUCY_PDF_FONT,
    path.join(__dirname, "..", "fonts", "NotoSans-Regular.ttf"),
    path.join(__dirname, "..", "fonts", "DejaVuSans.ttf"),
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf",
    "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "C:/Windows/Fonts/segoeui.ttf",
  ].filter(Boolean);

  return candidates.find((candidate) => {
    try { return fs.existsSync(candidate); } catch { return false; }
  }) || "";
}

function cleanPdfText(value = "") {
  return String(value || "")
    .normalize("NFC")
    // Emoji fontu ayrı gömülmediği için PDF metnini bozmaması adına kaldırılır.
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/\r\n/g, "\n")
    .trim();
}

module.exports = {
  name: "pdf",
  description: "Türkçe karakter destekli PDF raporu üretir",

  async execute(input = {}) {
    const title = cleanPdfText(input.title || "LUCY Rapor");
    const text = cleanPdfText(input.text || "");

    if (!text) {
      return {
        success: false,
        error: "text_required",
        message: "PDF üretmek için text gerekli.",
      };
    }

    const chunks = [];
    const fontPath = findPdfFont();
    const doc = new PDFDocument({ margin: 50, size: "A4", bufferPages: true });

    return await new Promise((resolve) => {
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("error", (error) => resolve({
        success: false,
        error: "pdf_generation_failed",
        message: error.message || "PDF üretilemedi.",
      }));
      doc.on("end", () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          success: true,
          mimeType: "application/pdf",
          filename: input.filename || "lucy-report.pdf",
          base64: buffer.toString("base64"),
          font: fontPath ? path.basename(fontPath) : "builtin-fallback",
        });
      });

      if (fontPath) doc.font(fontPath);

      doc.fontSize(20).text(title, { underline: true });
      doc.moveDown();
      doc.fontSize(12).text(text, { align: "left", lineGap: 4 });
      doc.end();
    });
  },
};
