const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

function normalizePdfText(value = "") {
  return String(value || "")
    .normalize("NFC")
    .replace(/\r\n/g, "\n")
    .trim();
}

function escapeHtml(value = "") {
  return String(value || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
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
    .replace(/[➡️→]/g, "→")
    .replace(/[•●]/g, "•")
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

function inlineMarkdownToHtml(value = "") {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
}

function splitMarkdownRow(line = "") {
  const cells = [];
  let current = "";
  let escaped = false;
  const source = String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "");
  for (const char of source) {
    if (escaped) { current += char; escaped = false; continue; }
    if (char === "\\") { escaped = true; continue; }
    if (char === "|") { cells.push(current.trim()); current = ""; continue; }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function isMarkdownDivider(line = "") {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(String(line || ""));
}

function markdownToHtml(markdown = "") {
  const lines = normalizePdfText(markdown).split(/\n/);
  const html = [];
  let listOpen = false;
  let codeOpen = false;
  let codeBuffer = [];

  const closeList = () => { if (listOpen) { html.push("</ul>"); listOpen = false; } };
  const closeCode = () => {
    if (codeOpen) {
      html.push(`<pre><code>${escapeHtml(codeBuffer.join("\n"))}</code></pre>`);
      codeOpen = false;
      codeBuffer = [];
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trim();

    if (line.startsWith("```")) {
      if (codeOpen) closeCode();
      else { closeList(); codeOpen = true; codeBuffer = []; }
      continue;
    }
    if (codeOpen) { codeBuffer.push(raw); continue; }

    if (!line) { closeList(); html.push('<div class="spacer"></div>'); continue; }

    if (line.includes("|") && i + 1 < lines.length && isMarkdownDivider(lines[i + 1])) {
      closeList();
      const head = splitMarkdownRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitMarkdownRow(lines[i]));
        i += 1;
      }
      i -= 1;
      html.push("<table><thead><tr>");
      head.forEach((cell) => html.push(`<th>${inlineMarkdownToHtml(cell)}</th>`));
      html.push("</tr></thead><tbody>");
      rows.forEach((row) => {
        html.push("<tr>");
        head.forEach((_, index) => html.push(`<td>${inlineMarkdownToHtml(row[index] || "")}</td>`));
        html.push("</tr>");
      });
      html.push("</tbody></table>");
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = Math.min(3, heading[1].length + 1);
      html.push(`<h${level}>${inlineMarkdownToHtml(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      if (!listOpen) { html.push("<ul>"); listOpen = true; }
      html.push(`<li>${inlineMarkdownToHtml(bullet[1])}</li>`);
      continue;
    }

    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      if (!listOpen) { html.push("<ul>"); listOpen = true; }
      html.push(`<li>${inlineMarkdownToHtml(ordered[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${inlineMarkdownToHtml(raw)}</p>`);
  }

  closeCode();
  closeList();
  return html.join("\n");
}

async function puppeteerPdf({ title, text }) {
  let puppeteer;
  try { puppeteer = require("puppeteer"); } catch { return null; }
  let browser = null;
  try {
    browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    const body = markdownToHtml(text);
    const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>
      @page{size:A4;margin:42px}
      *{box-sizing:border-box}
      body{font-family:'DejaVu Sans','Noto Sans','Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',Arial,sans-serif;color:#111827;font-size:14px;line-height:1.55;margin:0;background:#fff}
      h1{font-size:25px;margin:0 0 22px;font-weight:850;letter-spacing:-.02em;color:#050505;border-bottom:2px solid #111827;padding-bottom:10px}
      h2{font-size:19px;margin:20px 0 8px}h3{font-size:16px;margin:16px 0 6px}p{margin:7px 0;white-space:pre-wrap}.spacer{height:8px}
      ul{margin:8px 0 12px 20px;padding:0}li{margin:4px 0}code{font-family:Consolas,monospace;background:#f3f4f6;padding:1px 4px;border-radius:4px}pre{background:#111827;color:#f9fafb;border-radius:10px;padding:12px;white-space:pre-wrap;overflow-wrap:anywhere}
      table{border-collapse:collapse;width:100%;margin:14px 0 18px;font-size:12.5px;page-break-inside:auto;border:1px solid #94a3b8}
      tr{page-break-inside:avoid;page-break-after:auto}th,td{border:1px solid #94a3b8;padding:8px 9px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#111827;color:#fff;font-weight:800}tbody tr:nth-child(even) td{background:#f8fafc}
      a{color:#075985;text-decoration:none}.footer{margin-top:28px;font-size:10px;color:#64748b;border-top:1px solid #e5e7eb;padding-top:8px}
    </style></head><body><h1>${escapeHtml(normalizePdfText(title))}</h1><main>${body}</main><div class="footer">LUCY tarafından hazırlandı</div></body></html>`;
    await page.setContent(html, { waitUntil: "networkidle0" });
    return await page.pdf({ format: "A4", printBackground: true, margin: { top: "42px", right: "42px", bottom: "42px", left: "42px" } });
  } catch {
    return null;
  } finally {
    try { await browser?.close(); } catch {}
  }
}

function renderPlainMarkdownLine(line = "") {
  return String(line || "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/^[-*•]\s+/, "• ");
}

function pdfkitPdf({ title, text }) {
  return new Promise((resolve) => {
    const chunks = [];
    const doc = new PDFDocument({ margin: 50, size: "A4", info: { Title: title, Creator: "LUCY" } });
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const fontPath = findFont();
    if (fontPath) { doc.registerFont("LucyUnicode", fontPath); doc.font("LucyUnicode"); }
    else doc.font("Helvetica");

    const safeTitle = degradeEmojiForPdfKit(title);
    const safeText = degradeEmojiForPdfKit(text).split(/\n/).map(renderPlainMarkdownLine).join("\n");

    doc.fontSize(20).text(safeTitle, { underline: true });
    doc.moveDown(1.2);
    doc.fontSize(12).text(safeText, { align: "left", lineGap: 4 });
    doc.end();
  });
}

module.exports = {
  name: "pdf",
  description: "Markdown, tablo, grafik özeti veya metinden profesyonel Türkçe PDF raporu üretir",

  async execute(input = {}) {
    const title = normalizePdfText(input.title || input.name || "LUCY Rapor");
    const text = normalizePdfText(input.text || input.content || input.value || input.markdown || "");

    if (!text) return { success: false, error: "text_required", message: "PDF üretmek için text gerekli." };

    const htmlPdf = await puppeteerPdf({ title, text });
    const buffer = htmlPdf || await pdfkitPdf({ title, text });

    return {
      success: true,
      type: "file",
      tool: "pdf",
      mimeType: "application/pdf",
      filename: input.filename || "lucy-rapor.pdf",
      base64: Buffer.from(buffer).toString("base64"),
      engine: htmlPdf ? "puppeteer-html-markdown-table" : "pdfkit-unicode-safe-emoji",
      font: findFont() || "browser/system",
      message: "PDF hazırlandı.",
    };
  },
};
