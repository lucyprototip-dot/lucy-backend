const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

function normalizePdfText(value = "") {
  return String(value || "").normalize("NFC").replace(/\r\n/g, "\n").trim();
}

function normalizeCurrencyForPdf(value = "") {
  return String(value || "").replace(/₺/g, "TL");
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

function stripMarkdown(value = "") {
  return String(value || "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
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

function parseLucyWidget(source = "") {
  const raw = String(source || "").trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {}
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try { return JSON.parse(raw.slice(firstBrace, lastBrace + 1)); } catch {}
  }
  return null;
}

function getChartSeries(widget = {}) {
  const data = widget.data || widget.raw?.data || {};
  const labels = Array.isArray(data.labels) ? data.labels : [];
  const dataset = Array.isArray(data.datasets) && data.datasets[0] ? data.datasets[0] : {};
  const values = Array.isArray(dataset.data) ? dataset.data : [];
  return labels.map((label, index) => ({
    label: String(label || `Veri ${index + 1}`),
    value: Number(String(values[index] ?? 0).replace(/[^0-9.,-]/g, "").replace(".", "").replace(",", ".")) || 0,
  })).filter((item) => item.label && Number.isFinite(item.value));
}

function renderChartHtml(widget = {}) {
  const title = widget.title || widget.raw?.title || "Grafik";
  const chartType = String(widget.chartType || widget.raw?.chartType || "bar").toLowerCase();
  const rows = getChartSeries(widget);
  if (!rows.length) return `<div class="chart-card"><h2>📊 ${escapeHtml(title)}</h2><p>Grafik verisi bulunamadı.</p></div>`;
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  const total = rows.reduce((sum, item) => sum + Math.max(0, item.value), 0) || 1;
  const palette = ["#2563eb", "#16a34a", "#f97316", "#9333ea", "#dc2626", "#0891b2", "#ca8a04", "#475569", "#db2777", "#65a30d"];

  if (chartType.includes("pie") || chartType.includes("pasta")) {
    let cursor = 0;
    const stops = rows.map((row, index) => {
      const start = cursor;
      const end = cursor + (Math.max(0, row.value) / total) * 360;
      cursor = end;
      const color = palette[index % palette.length];
      return `${color} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`;
    }).join(", ");
    return `<section class="chart-card page-avoid"><h2>📊 ${escapeHtml(title)}</h2><div class="pie-layout"><div class="pie" style="background:conic-gradient(${stops})"></div><div class="legend">${rows.map((row, index) => `<div class="legend-row"><span class="swatch" style="background:${palette[index % palette.length]}"></span><span>${escapeHtml(row.label)}</span><strong>${escapeHtml(String(row.value))}</strong></div>`).join("")}</div></div></section>`;
  }

  return `<section class="chart-card page-avoid"><h2>📊 ${escapeHtml(title)}</h2><div class="bar-chart">${rows.map((row, index) => {
    const width = Math.max(3, Math.round((Math.abs(row.value) / max) * 100));
    return `<div class="bar-row"><div class="bar-label">${escapeHtml(row.label)}</div><div class="bar-track"><div class="bar-fill" style="width:${width}%;background:${palette[index % palette.length]}"></div></div><div class="bar-value">${escapeHtml(String(row.value))}</div></div>`;
  }).join("")}</div></section>`;
}

function parseMermaidLabels(code = "") {
  const labels = [];
  const seen = new Set();
  const add = (value) => {
    const cleaned = stripMarkdown(String(value || "").replace(/[{}\[\]()]/g, "").trim());
    if (cleaned && !seen.has(cleaned)) { seen.add(cleaned); labels.push(cleaned); }
  };
  const lineRegex = /(?:^|\s)([A-Za-z0-9_]+)(?:\[([^\]]+)\]|\{([^}]+)\}|\(([^)]+)\))?/g;
  String(code || "").split(/\n/).forEach((line) => {
    if (/^\s*(flowchart|graph)\b/i.test(line)) return;
    const nodeDefs = [...line.matchAll(lineRegex)];
    nodeDefs.forEach((match) => {
      if (match[2] || match[3] || match[4]) add(match[2] || match[3] || match[4]);
    });
  });
  if (!labels.length) {
    String(code || "").split(/-->|---|==>/).forEach((part) => add(part));
  }
  return labels.slice(0, 18);
}

function renderMermaidHtml(code = "", title = "Mermaid Şema") {
  const labels = parseMermaidLabels(code);
  const nodes = labels.length ? labels : ["Başla", "İşlem", "Bitti"];
  return `<section class="diagram-card page-avoid"><h2>🧭 ${escapeHtml(title)}</h2><div class="diagram-flow">${nodes.map((label, index) => `<div class="diagram-node ${index === 0 ? "start" : ""}">${escapeHtml(label)}</div>${index < nodes.length - 1 ? '<div class="diagram-arrow">↓</div>' : ""}`).join("")}</div></section>`;
}

function renderFileWidgetHtml(widget = {}) {
  const title = widget.title || widget.filename || widget.raw?.filename || "Dosya";
  const type = widget.type || widget.raw?.type || "file";
  const icon = String(type).includes("pdf") ? "📄" : String(type).includes("zip") ? "🗜️" : "📎";
  return `<section class="file-card page-avoid"><div class="file-icon">${icon}</div><div><strong>${escapeHtml(title)}</strong><p>Dosya hazırlandı.</p></div></section>`;
}

function renderWidgetHtml(widget = {}) {
  const type = String(widget.type || widget.raw?.type || widget.tool || "").toLowerCase();
  const tool = String(widget.tool || widget.raw?.tool || "").toLowerCase();
  if (type.includes("chart") || tool === "chartdata") return renderChartHtml(widget);
  if (type.includes("mermaid") || tool === "mermaid") return renderMermaidHtml(widget.code || widget.raw?.code || "", widget.title || "Mermaid Şema");
  if (type.includes("file") || widget.url || widget.downloadUrl || widget.filename) return renderFileWidgetHtml(widget);
  return "";
}

function markdownToHtml(markdown = "") {
  const lines = normalizePdfText(markdown).split(/\n/);
  const html = [];
  let listOpen = false;
  let codeOpen = false;
  let codeBuffer = [];
  let codeLang = "";

  const closeList = () => { if (listOpen) { html.push("</ul>"); listOpen = false; } };
  const closeCode = () => {
    if (!codeOpen) return;
    const code = codeBuffer.join("\n");
    const lang = String(codeLang || "").toLowerCase().trim();
    if (lang === "lucy-widget") {
      const widget = parseLucyWidget(code);
      const rendered = widget ? renderWidgetHtml(widget) : "";
      if (rendered) html.push(rendered);
    } else if (lang === "mermaid") {
      html.push(renderMermaidHtml(code, "Mermaid Şema"));
    } else {
      html.push(`<pre><code>${escapeHtml(code)}</code></pre>`);
    }
    codeOpen = false;
    codeBuffer = [];
    codeLang = "";
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trim();

    const fence = line.match(/^```\s*([^`]*)\s*$/);
    if (fence) {
      if (codeOpen) closeCode();
      else { closeList(); codeOpen = true; codeBuffer = []; codeLang = fence[1] || ""; }
      continue;
    }
    if (codeOpen) { codeBuffer.push(raw); continue; }

    // Safety: hide accidental one-line raw widget JSON outside code fences.
    if (/^\s*\{\s*"type"\s*:\s*"(?:chart|mermaid|file|file-pdf)/i.test(line) && line.includes('"tool"')) {
      const widget = parseLucyWidget(line);
      if (widget) { html.push(renderWidgetHtml(widget)); continue; }
    }

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
      head.forEach((cell) => html.push(`<th>${inlineMarkdownToHtml(normalizeCurrencyForPdf(cell))}</th>`));
      html.push("</tr></thead><tbody>");
      rows.forEach((row) => {
        html.push("<tr>");
        head.forEach((_, index) => html.push(`<td>${inlineMarkdownToHtml(normalizeCurrencyForPdf(row[index] || ""))}</td>`));
        html.push("</tr>");
      });
      html.push("</tbody></table>");
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = Math.min(3, heading[1].length + 1);
      html.push(`<h${level}>${inlineMarkdownToHtml(normalizeCurrencyForPdf(heading[2]))}</h${level}>`);
      continue;
    }

    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      if (!listOpen) { html.push("<ul>"); listOpen = true; }
      html.push(`<li>${inlineMarkdownToHtml(normalizeCurrencyForPdf(bullet[1]))}</li>`);
      continue;
    }

    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      if (!listOpen) { html.push("<ul>"); listOpen = true; }
      html.push(`<li>${inlineMarkdownToHtml(normalizeCurrencyForPdf(ordered[1]))}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${inlineMarkdownToHtml(normalizeCurrencyForPdf(raw))}</p>`);
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
      @page{size:A4;margin:38px}
      *{box-sizing:border-box}
      body{font-family:'DejaVu Sans','Noto Sans','Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',Arial,sans-serif;color:#111827;font-size:14px;line-height:1.55;margin:0;background:#fff}
      h1{font-size:25px;margin:0 0 22px;font-weight:850;letter-spacing:-.02em;color:#050505;border-bottom:2px solid #111827;padding-bottom:10px}
      h2{font-size:18px;margin:0 0 12px;font-weight:850}h3{font-size:16px;margin:16px 0 6px}p{margin:7px 0;white-space:pre-wrap}.spacer{height:8px}
      ul{margin:8px 0 12px 20px;padding:0}li{margin:4px 0}code{font-family:Consolas,monospace;background:#f3f4f6;padding:1px 4px;border-radius:4px}pre{background:#111827;color:#f9fafb;border-radius:10px;padding:12px;white-space:pre-wrap;overflow-wrap:anywhere}
      table{border-collapse:collapse;width:100%;margin:14px 0 18px;font-size:12.5px;page-break-inside:auto;border:1px solid #94a3b8;border-radius:10px;overflow:hidden}
      tr{page-break-inside:avoid;page-break-after:auto}th,td{border:1px solid #94a3b8;padding:8px 9px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#111827;color:#fff;font-weight:800}tbody tr:nth-child(even) td{background:#f8fafc}
      a{color:#075985;text-decoration:none}.footer{margin-top:28px;font-size:10px;color:#64748b;border-top:1px solid #e5e7eb;padding-top:8px}
      .page-avoid{break-inside:avoid;page-break-inside:avoid}.chart-card,.diagram-card,.file-card{border:1px solid #cbd5e1;border-radius:16px;padding:16px 18px;margin:16px 0 20px;background:#f8fafc;box-shadow:0 8px 20px rgba(15,23,42,.07)}
      .bar-chart{display:flex;flex-direction:column;gap:9px}.bar-row{display:grid;grid-template-columns:130px 1fr 70px;align-items:center;gap:10px}.bar-label{font-weight:700}.bar-track{height:13px;background:#e2e8f0;border-radius:999px;overflow:hidden}.bar-fill{height:100%;border-radius:999px}.bar-value{font-weight:800;text-align:right;color:#0f172a}
      .pie-layout{display:grid;grid-template-columns:210px 1fr;gap:22px;align-items:center}.pie{width:190px;height:190px;border-radius:50%;border:8px solid #fff;box-shadow:0 0 0 1px #cbd5e1}.legend{display:flex;flex-direction:column;gap:8px}.legend-row{display:grid;grid-template-columns:16px 1fr 76px;gap:8px;align-items:center}.swatch{width:14px;height:14px;border-radius:4px}.legend-row strong{text-align:right}
      .diagram-flow{display:flex;flex-direction:column;align-items:center;gap:5px}.diagram-node{min-width:190px;max-width:92%;padding:9px 14px;text-align:center;border:1.5px solid #64748b;border-radius:12px;background:#fff;font-weight:750}.diagram-node.start{background:#111827;color:#fff;border-color:#111827}.diagram-arrow{font-size:20px;color:#64748b;font-weight:900;line-height:1}
      .file-card{display:flex;align-items:center;gap:12px}.file-icon{width:44px;height:44px;border-radius:12px;background:#111827;color:#fff;display:flex;align-items:center;justify-content:center;font-size:23px}.file-card p{margin:2px 0 0;color:#64748b}
    </style></head><body><h1>${escapeHtml(normalizePdfText(normalizeCurrencyForPdf(title)))}</h1><main>${body}</main><div class="footer">LUCY tarafından hazırlandı</div></body></html>`;
    await page.setContent(html, { waitUntil: "networkidle0" });
    return await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, margin: { top: "38px", right: "38px", bottom: "38px", left: "38px" } });
  } catch (error) {
    console.error("[lucy-pdf] puppeteer failed:", error?.message || error);
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

    const safeTitle = degradeEmojiForPdfKit(normalizeCurrencyForPdf(title));
    const safeText = degradeEmojiForPdfKit(normalizeCurrencyForPdf(text))
      .replace(/```lucy-widget[\s\S]*?```/g, "")
      .split(/\n/)
      .map(renderPlainMarkdownLine)
      .join("\n");

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
      engine: htmlPdf ? "puppeteer-html-widgets-table-chart-mermaid" : "pdfkit-unicode-safe-fallback",
      font: findFont() || "browser/system",
      message: "PDF hazırlandı.",
    };
  },
};
