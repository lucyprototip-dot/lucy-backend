const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

function normalizePdfText(value = "") {
  return String(value || "").normalize("NFC").replace(/\r\n/g, "\n").trim();
}

function restoreCommonTurkish(value = "") {
  let text = String(value ?? "");
  const replacements = [
    [/\bAlisveris\b/g, "Alışveriş"], [/\balisveris\b/g, "alışveriş"],
    [/\bUrunleri\b/g, "Ürünleri"], [/\burunleri\b/g, "ürünleri"],
    [/\bUrun\b/g, "Ürün"], [/\burun\b/g, "ürün"],
    [/\bSut\b/g, "Süt"], [/\bsut\b/g, "süt"], [/\bYogurt\b/g, "Yoğurt"], [/\byogurt\b/g, "yoğurt"],
    [/\bKasar\b/g, "Kaşar"], [/\bkasar\b/g, "kaşar"], [/\bFirin\b/g, "Fırın"], [/\bfirin\b/g, "fırın"],
    [/\bSarkuteri\b/g, "Şarküteri"], [/\bsarkuteri\b/g, "şarküteri"], [/\bSalkim\b/g, "Salkım"], [/\bsalkim\b/g, "salkım"],
    [/\bSalatalik\b/g, "Salatalık"], [/\bsalatalik\b/g, "salatalık"], [/\bCarliston\b/g, "Çarliston"], [/\bcarliston\b/g, "çarliston"],
    [/\bYesil\b/g, "Yeşil"], [/\byesil\b/g, "yeşil"], [/\bSikmalik\b/g, "Sıkmalık"], [/\bsikmalik\b/g, "sıkmalık"],
    [/\bBugday\b/g, "Buğday"], [/\bbugday\b/g, "buğday"], [/\bPogaca\b/g, "Poğaça"], [/\bpogaca\b/g, "poğaça"],
    [/\bgogsu\b/g, "göğsü"], [/\bGogsu\b/g, "Göğsü"], [/\bSise\b/g, "Şişe"], [/\bsise\b/g, "şişe"],
    [/\bBulasik\b/g, "Bulaşık"], [/\bbulasik\b/g, "bulaşık"], [/\bCamashir\b/g, "Çamaşır"], [/\bcamashir\b/g, "çamaşır"],
    [/\bCamasir\b/g, "Çamaşır"], [/\bcamasir\b/g, "çamaşır"], [/\bCop\b/g, "Çöp"], [/\bcop\b/g, "çöp"],
    [/\bposeti\b/g, "poşeti"], [/\bPoseti\b/g, "Poşeti"], [/\byagli\b/g, "yağlı"], [/\bYagli\b/g, "Yağlı"],
  ];
  for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
  return text;
}

function degradeEmojiForPdfKit(value = "") {
  return restoreCommonTurkish(normalizePdfText(value))
    .replace(/❤️‍🔥|❤‍🔥/g, "♥ 🔥")
    .replace(/[❤♥]/g, "♥")
    .replace(/[🔥]/g, "🔥")
    .replace(/[📄📝📃]/g, "[Belge]")
    .replace(/[📊📈📉]/g, "[Grafik]")
    .replace(/[🗜️]/g, "[ZIP]")
    .replace(/[✅]/g, "✓")
    .replace(/[❌]/g, "×")
    .replace(/\u200d/g, "");
}

function findFont() {
  const candidates = [
    process.env.LUCY_PDF_FONT,
    path.resolve(__dirname, "..", "fonts", "DejaVuSans.ttf"),
    path.resolve(__dirname, "..", "fonts", "NotoSans-Regular.ttf"),
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "C:/Windows/Fonts/calibri.ttf",
    "C:/Windows/Fonts/segoeui.ttf",
  ].filter(Boolean);
  return candidates.find((candidate) => {
    try { return fs.existsSync(candidate) && fs.statSync(candidate).isFile(); } catch { return false; }
  });
}

function escapeHtml(s = "") {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function stripInlineMd(s = "") {
  return restoreCommonTurkish(String(s || "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/_([^_]+)_/g, "$1").replace(/`([^`]+)`/g, "$1"));
}

function isSeparatorLine(line = "") {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(String(line || "").trim());
}

function splitMarkdownRow(line = "") {
  return String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => stripInlineMd(cell.trim()));
}

function markdownToHtml(text = "") {
  const lines = restoreCommonTurkish(normalizePdfText(text)).split(/\n/);
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] || "";
    const line = raw.trim();
    if (!line) { out.push("<div class='gap'></div>"); continue; }

    if (line.includes("|") && lines[i + 1] && isSeparatorLine(lines[i + 1])) {
      const headers = splitMarkdownRow(line);
      const rows = [];
      i += 2;
      for (; i < lines.length; i += 1) {
        if (!String(lines[i] || "").includes("|") || isSeparatorLine(lines[i])) { i -= 1; break; }
        const cells = splitMarkdownRow(lines[i]);
        if (!cells.length) break;
        rows.push(cells);
      }
      out.push(`<table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((cells) => `<tr>${headers.map((_, idx) => `<td>${escapeHtml(cells[idx] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = Math.min(3, heading[1].length);
      out.push(`<h${level}>${escapeHtml(stripInlineMd(heading[2]))}</h${level}>`);
      continue;
    }

    if (/^[-*•]\s+/.test(line)) {
      out.push(`<p class='bullet'>• ${escapeHtml(stripInlineMd(line.replace(/^[-*•]\s+/, "")))}</p>`);
      continue;
    }

    out.push(`<p>${escapeHtml(stripInlineMd(line))}</p>`);
  }
  return out.join("\n");
}

async function puppeteerPdf({ title, text }) {
  let puppeteer;
  try { puppeteer = require("puppeteer"); } catch { return null; }
  let browser = null;
  try {
    browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    const safeTitle = restoreCommonTurkish(normalizePdfText(title));
    const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>
      @page{size:A4;margin:44px 42px 56px} body{font-family:'DejaVu Sans','Noto Sans','Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',Arial,sans-serif;color:#111827;font-size:13.5px;line-height:1.48;margin:0}
      h1{font-size:25px;margin:0 0 18px;font-weight:800;border-bottom:3px solid #111827;padding-bottom:10px} h2{font-size:18px;margin:18px 0 8px} h3{font-size:15px;margin:16px 0 8px} p{margin:6px 0}.gap{height:8px}.bullet{padding-left:10px}
      table{border-collapse:collapse;width:100%;margin:12px 0 18px;font-size:12.5px;page-break-inside:auto}tr{page-break-inside:avoid;page-break-after:auto}th,td{border:1px solid #c7ccd4;padding:7px 8px;text-align:left;vertical-align:top;word-break:break-word}th{background:#eef0f3;font-weight:800}tbody tr:nth-child(even) td{background:#fafafa}
      .footer{position:fixed;bottom:-34px;left:0;right:0;text-align:left;color:#9ca3af;font-size:9px}
    </style></head><body><h1>${escapeHtml(safeTitle)}</h1>${markdownToHtml(text)}<div class="footer">LUCY PDF çıktısı</div></body></html>`;
    await page.setContent(html, { waitUntil: "networkidle0" });
    return await page.pdf({ format: "A4", printBackground: true, margin: { top: "44px", right: "42px", bottom: "56px", left: "42px" } });
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
    if (fontPath) { doc.registerFont("LucyUnicode", fontPath); doc.font("LucyUnicode"); } else { doc.font("Helvetica"); }
    doc.fontSize(20).text(degradeEmojiForPdfKit(title), { underline: true });
    doc.moveDown(1.2);
    doc.fontSize(11).text(degradeEmojiForPdfKit(text).split(/\n/).map(stripInlineMd).join("\n"), { align: "left", lineGap: 4 });
    doc.end();
  });
}

module.exports = {
  name: "pdf",
  description: "Metin ve markdown tablolardan Türkçe karakter destekli PDF raporu üretir",
  async execute(input = {}) {
    const title = restoreCommonTurkish(normalizePdfText(input.title || "LUCY Rapor"));
    const text = restoreCommonTurkish(normalizePdfText(input.text || input.content || input.value || ""));
    if (!text) return { success: false, error: "text_required", message: "PDF üretmek için text gerekli." };
    const htmlPdf = await puppeteerPdf({ title, text });
    const buffer = htmlPdf || await pdfkitPdf({ title, text });
    return {
      success: true,
      title,
      mimeType: "application/pdf",
      filename: input.filename || "lucy-report.pdf",
      base64: Buffer.from(buffer).toString("base64"),
      engine: htmlPdf ? "puppeteer-html-table" : "pdfkit-unicode-safe",
      font: findFont() || "browser/system",
    };
  },
};
