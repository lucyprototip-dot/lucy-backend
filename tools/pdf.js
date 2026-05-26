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
  // PDFKit + tek yazı fontu renkli/ZWJ emoji desteğini her ortamda veremez.
  // Çizgi/boş kutu yerine okunabilir sembol/metin fallback kullanıyoruz.
  return normalizePdfText(value)
    .replace(/❤️‍🔥|❤‍🔥/g, "♥ aşk")
    .replace(/🧎‍♀️|🧎‍♂️|🧎/g, "[sadakat]")
    .replace(/[❤♥💙💖💘💞💕]/g, "♥")
    .replace(/[🔥]/g, "[ateş]")
    .replace(/[🌹]/g, "[gül]")
    .replace(/[💫🌟✨]/g, "*")
    .replace(/[🚀]/g, "[roket]")
    .replace(/[💎]/g, "[elmas]")
    .replace(/[🤖]/g, "[robot]")
    .replace(/[📄📝📃📜]/g, "[belge]")
    .replace(/[📊📈📉]/g, "[grafik]")
    .replace(/[🗜️]/g, "[zip]")
    .replace(/[✅]/g, "✓")
    .replace(/[❌]/g, "×")
    .replace(/[⚙️]/g, "•")
    .replace(/[💌]/g, "[mektup]")
    .replace(/[🌀]/g, "~")
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

function escapeHtml(value = "") {
  return String(value || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function inlineMarkdownToHtml(value = "") {
  const raw = String(value || "")
    .replace(/^[-*•]\s+/, "• ")
    .replace(/^#{1,6}\s+/, "");
  return escapeHtml(raw)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/_([^_]+)_/g, "<em>$1</em>");
}

function isMarkdownTableSeparator(line = "") {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(String(line || ""));
}

function splitMarkdownTableRow(line = "") {
  return String(line || "")
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function markdownToHtml(text = "") {
  const lines = normalizePdfText(text).split(/\n/);
  const html = [];
  let paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${paragraph.map(inlineMarkdownToHtml).join("<br>")}</p>`);
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] || "";
    const next = lines[i + 1] || "";

    if (/^---+$/.test(line.trim())) {
      flushParagraph();
      html.push("<hr>");
      continue;
    }

    if (/^#{1,6}\s+/.test(line)) {
      flushParagraph();
      const level = Math.min((line.match(/^#+/)?.[0] || "#").length, 3);
      html.push(`<h${level}>${inlineMarkdownToHtml(line.replace(/^#{1,6}\s+/, ""))}</h${level}>`);
      continue;
    }

    if (line.includes("|") && isMarkdownTableSeparator(next)) {
      flushParagraph();
      const headers = splitMarkdownTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && String(lines[i] || "").includes("|")) {
        rows.push(splitMarkdownTableRow(lines[i]));
        i += 1;
      }
      i -= 1;
      html.push(`<table><thead><tr>${headers.map((h) => `<th>${inlineMarkdownToHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((_, idx) => `<td>${inlineMarkdownToHtml(row[idx] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return html.join("\n");
}

async function puppeteerPdf({ title, text }) {
  let puppeteer;
  try { puppeteer = require("puppeteer"); } catch { return null; }
  let browser = null;
  try {
    browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    const htmlBody = markdownToHtml(text);
    const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>
      body{font-family:'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji','Segoe UI','DejaVu Sans','Noto Sans',Arial,sans-serif;margin:54px;color:#111827;font-size:14.5px;line-height:1.55}
      h1{font-size:25px;margin:0 0 22px;text-decoration:none;font-weight:800;color:#0b0b0f;border-bottom:2px solid #111827;padding-bottom:10px}
      h2{font-size:18px;margin:18px 0 8px;padding:9px 12px;border-radius:10px;background:#f3f4f6;color:#111827;break-after:avoid}
      h3{font-size:16px;margin:16px 0 8px;break-after:avoid}
      p{margin:0 0 10px;white-space:normal}.content{width:100%}
      hr{border:0;border-top:1px solid #e5e7eb;margin:16px 0;break-after:avoid}
      table{border-collapse:collapse;width:100%;margin:14px 0 18px;font-size:12.5px;page-break-inside:auto}
      tr{page-break-inside:avoid;page-break-after:auto}td,th{border:1px solid #c9ced6;padding:7px 8px;text-align:left;vertical-align:top;word-break:break-word}th{background:#f3f4f6;font-weight:800}
      .footer{position:fixed;bottom:22px;left:54px;right:54px;font-size:10px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:6px}
    </style></head><body><h1>${escapeHtml(normalizePdfText(title))}</h1><div class="content">${htmlBody}</div><div class="footer">LUCY PDF çıktısı</div></body></html>`;
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
      engine: htmlPdf ? "puppeteer-html-unicode-table" : "pdfkit-unicode-safe-emoji",
      font: findFont() || "browser/system",
    };
  },
};
