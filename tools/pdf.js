const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

function normalizePdfText(value = "") {
  return String(value || "")
    .normalize("NFC")
    .replace(/\r\n/g, "\n")
    .trim();
}

function degradeEmojiForPdfKit(value = "") {
  return normalizePdfText(value)
    .replace(/❤️‍🔥|❤‍🔥/g, "♥")
    .replace(/[❤♥]/g, "♥")
    .replace(/[🔥]/g, "◆")
    .replace(/[📄📝📃]/g, "[Belge]")
    .replace(/[📊📈📉]/g, "[Grafik]")
    .replace(/[🗜️]/g, "[ZIP]")
    .replace(/[💙💎]/g, "♦")
    .replace(/[✅]/g, "✓")
    .replace(/[❌]/g, "×")
    .replace(/[⚙️]/g, "•")
    .replace(/[\u200d\ufe0f]/g, "")
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, "•");
}

function findFont() {
  const candidates = [
    process.env.LUCY_PDF_FONT,
    path.resolve(__dirname, "..", "fonts", "DejaVuSans.ttf"),
    path.resolve(__dirname, "..", "fonts", "NotoSans-Regular.ttf"),
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "C:/Windows/Fonts/calibri.ttf",
    "C:/Windows/Fonts/segoeui.ttf",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
  ].filter(Boolean);
  return candidates.find((candidate) => {
    try { return fs.existsSync(candidate) && fs.statSync(candidate).isFile(); } catch { return false; }
  });
}

function renderMarkdownLine(line = "") {
  return String(line || "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/^[-*•]\s+/, "• ");
}

async function puppeteerPdf({ title, text }) {
  let puppeteer;
  try { puppeteer = require("puppeteer"); } catch { return null; }
  let browser = null;
  try {
    browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    const escape = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const lines = normalizePdfText(text).split(/\n/).map(renderMarkdownLine).join("\n");
    const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>
      body{font-family:'DejaVu Sans','Noto Sans','Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',Arial,sans-serif;margin:56px;color:#111;font-size:15px;line-height:1.58}
      h1{font-size:26px;margin:0 0 28px;text-decoration:underline;font-weight:800}
      .content{white-space:pre-wrap}
      table{border-collapse:collapse;width:100%;margin:14px 0;font-size:13px}td,th{border:1px solid #bbb;padding:7px 8px;text-align:left;vertical-align:top}th{background:#f1f1f1}
    </style></head><body><h1>${escape(normalizePdfText(title))}</h1><div class="content">${escape(lines)}</div></body></html>`;
    await page.setContent(html, { waitUntil: "networkidle0" });
    return await page.pdf({ format: "A4", printBackground: true, margin: { top: "48px", right: "48px", bottom: "48px", left: "48px" } });
  } catch {
    return null;
  } finally {
    try { await browser?.close(); } catch {}
  }
}

function pdfkitPdf({ title, text }) {
  return new Promise((resolve) => {
    const chunks = [];
    const doc = new PDFDocument({ margin: 50, size: "A4", info: { Title: title, Creator: "LUCY" } });
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const fontPath = findFont();
    if (fontPath) {
      doc.registerFont("LucyUnicode", fontPath);
      doc.font("LucyUnicode");
    } else {
      doc.font("Helvetica");
    }

    const safeTitle = degradeEmojiForPdfKit(title);
    const safeText = degradeEmojiForPdfKit(text).split(/\n/).map(renderMarkdownLine).join("\n");

    doc.fontSize(20).text(safeTitle, { underline: true });
    doc.moveDown(1.2);
    doc.fontSize(12).text(safeText, { align: "left", lineGap: 4 });
    doc.end();
  });
}

module.exports = {
  name: "pdf",
  description: "Metinden Türkçe karakter destekli PDF raporu üretir",

  async execute(input = {}) {
    const title = normalizePdfText(input.title || "LUCY Rapor");
    const text = normalizePdfText(input.text || input.content || input.value || "");

    if (!text) {
      return { success: false, error: "text_required", message: "PDF üretmek için text gerekli." };
    }

    const htmlPdf = await puppeteerPdf({ title, text });
    const buffer = htmlPdf || await pdfkitPdf({ title, text });

    return {
      success: true,
      mimeType: "application/pdf",
      filename: input.filename || "lucy-report.pdf",
      base64: Buffer.from(buffer).toString("base64"),
      engine: htmlPdf ? "puppeteer-html-unicode" : "pdfkit-unicode-safe-emoji",
      font: findFont() || "browser/system",
    };
  },
};
