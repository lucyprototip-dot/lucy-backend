const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const PALETTE = ["#2563eb", "#16a34a", "#f97316", "#9333ea", "#dc2626", "#0891b2", "#ca8a04", "#475569", "#db2777", "#65a30d"];

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
    .replace(/[🧭🗺️]/g, "[Diyagram]")
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
    "C:/Windows/Fonts/segoeui.ttf",
    "C:/Windows/Fonts/seguiemj.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "C:/Windows/Fonts/calibri.ttf",
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

function numberFromCell(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const clean = String(value ?? "")
    .replace(/[%₺$€£]/g, "")
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(/,/g, ".");
  const num = Number(clean);
  return Number.isFinite(num) ? num : null;
}

function getChartSeries(widget = {}) {
  const data = widget.data || widget.raw?.data || {};
  const labels = Array.isArray(widget.labels) ? widget.labels : Array.isArray(data.labels) ? data.labels : [];
  const dataset = Array.isArray(data.datasets) && data.datasets[0] ? data.datasets[0] : {};
  const values = Array.isArray(widget.values) ? widget.values : Array.isArray(dataset.data) ? dataset.data : [];
  return labels.map((label, index) => ({
    label: String(label || `Veri ${index + 1}`),
    value: numberFromCell(values[index]) ?? 0,
  })).filter((item) => item.label && Number.isFinite(item.value));
}

function polarToCartesian(cx, cy, r, angleDeg) {
  const angleRad = (angleDeg - 90) * Math.PI / 180;
  return { x: cx + (r * Math.cos(angleRad)), y: cy + (r * Math.sin(angleRad)) };
}

function piePath(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return [`M ${cx} ${cy}`, `L ${start.x.toFixed(2)} ${start.y.toFixed(2)}`, `A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`, "Z"].join(" ");
}

function renderChartSvg(widget = {}) {
  const title = widget.title || widget.raw?.title || "Grafik";
  const chartType = String(widget.chartType || widget.raw?.chartType || "bar").toLowerCase();
  const rows = getChartSeries(widget).slice(0, 12);
  if (!rows.length) return `<div class="chart-empty">Grafik verisi bulunamadı.</div>`;

  if (chartType.includes("pie") || chartType.includes("pasta")) {
    const total = rows.reduce((sum, item) => sum + Math.max(0, item.value), 0) || 1;
    let cursor = 0;
    const slices = rows.map((row, index) => {
      const angle = (Math.max(0, row.value) / total) * 360;
      const path = piePath(120, 120, 95, cursor, cursor + angle);
      cursor += angle;
      return `<path d="${path}" fill="${PALETTE[index % PALETTE.length]}" stroke="#ffffff" stroke-width="3"></path>`;
    }).join("");
    return `<section class="chart-card page-avoid"><h2>📊 ${escapeHtml(title)}</h2><div class="pie-layout"><svg class="chart-svg" width="240" height="240" viewBox="0 0 240 240" role="img">${slices}<circle cx="120" cy="120" r="42" fill="#ffffff" opacity=".94"></circle></svg><div class="legend">${rows.map((row, index) => `<div class="legend-row"><span class="swatch" style="background:${PALETTE[index % PALETTE.length]}"></span><span>${escapeHtml(row.label)}</span><strong>${escapeHtml(String(row.value))}</strong></div>`).join("")}</div></div></section>`;
  }

  if (chartType.includes("line") || chartType.includes("çizgi")) {
    const width = 760;
    const height = 320;
    const pad = { left: 54, right: 24, top: 24, bottom: 54 };
    const values = rows.map((r) => r.value);
    const min = Math.min(0, ...values);
    const max = Math.max(1, ...values);
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const points = rows.map((row, index) => {
      const x = pad.left + (rows.length === 1 ? plotW / 2 : (index / (rows.length - 1)) * plotW);
      const y = pad.top + plotH - ((row.value - min) / (max - min || 1)) * plotH;
      return { x, y, row };
    });
    const polyline = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    return `<section class="chart-card page-avoid"><h2>📈 ${escapeHtml(title)}</h2><svg class="chart-svg wide" viewBox="0 0 ${width} ${height}" role="img"><line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}" stroke="#94a3b8"/><line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="#94a3b8"/><polyline points="${polyline}" fill="none" stroke="#2563eb" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>${points.map((p, i) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="6" fill="${PALETTE[i % PALETTE.length]}" stroke="#fff" stroke-width="2"/><text x="${p.x.toFixed(1)}" y="${(height - 24)}" text-anchor="middle" font-size="16" fill="#334155">${escapeHtml(p.row.label.slice(0, 11))}</text><text x="${p.x.toFixed(1)}" y="${(p.y - 12).toFixed(1)}" text-anchor="middle" font-size="16" font-weight="800" fill="#0f172a">${escapeHtml(String(p.row.value))}</text>`).join("")}</svg></section>`;
  }

  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  return `<section class="chart-card page-avoid"><h2>📊 ${escapeHtml(title)}</h2><div class="bar-chart">${rows.map((row, index) => {
    const width = Math.max(4, Math.round((Math.abs(row.value) / max) * 100));
    return `<div class="bar-row"><div class="bar-label">${escapeHtml(row.label)}</div><div class="bar-track"><div class="bar-fill" style="width:${width}%;background:${PALETTE[index % PALETTE.length]}"></div></div><div class="bar-value">${escapeHtml(String(row.value))}</div></div>`;
  }).join("")}</div></section>`;
}

function cleanMermaidLabel(value = "") {
  return stripMarkdown(String(value || "")
    .replace(/^([A-Za-z0-9_]+)\s*$/, "$1")
    .replace(/^[\[({]+|[\])}]+$/g, "")
    .replace(/^['"]|['"]$/g, "")
    .replace(/\\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim()).slice(0, 64) || "Adım";
}

function parseMermaidFlow(code = "") {
  const nodeLabels = new Map();
  const edges = [];
  const cleanNodeId = (value = "") => String(value || "").replace(/[^A-Za-z0-9_]/g, "").trim();
  const rememberNode = (token = "") => {
    const raw = String(token || "").trim();
    const idMatch = raw.match(/^([A-Za-z0-9_]+)/);
    const id = cleanNodeId(idMatch?.[1] || raw);
    if (!id) return null;
    const labelMatch = raw.match(/(?:\["?([^\]"]+)"?\]|\{"?([^}"]+)"?\}|\("?([^")]+)"?\))/);
    if (labelMatch) nodeLabels.set(id, cleanMermaidLabel(labelMatch[1] || labelMatch[2] || labelMatch[3]));
    else if (!nodeLabels.has(id)) nodeLabels.set(id, id);
    return id;
  };

  String(code || "").split(/\r?\n/).forEach((line) => {
    const source = line.trim();
    if (!source || /^%%/.test(source) || /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram)/i.test(source)) return;
    const edgeParts = source.split(/-->|---|==>|-.->/);
    if (edgeParts.length >= 2) {
      for (let i = 0; i < edgeParts.length - 1; i += 1) {
        const from = rememberNode(edgeParts[i]);
        const to = rememberNode(edgeParts[i + 1]);
        if (from && to) edges.push([from, to]);
      }
    } else {
      rememberNode(source);
    }
  });

  const ids = Array.from(nodeLabels.keys()).slice(0, 18);
  if (!ids.length) ["Başla", "İşlem", "Bitti"].forEach((label, index) => nodeLabels.set(`N${index}`, label));
  return { ids: Array.from(nodeLabels.keys()).slice(0, 18), labels: nodeLabels, edges };
}

function renderMermaidSvg(code = "", title = "Mermaid Şema") {
  const parsed = parseMermaidFlow(code);
  const ids = parsed.ids;
  const width = 760;
  const nodeW = 440;
  const nodeH = 54;
  const gap = 34;
  const height = Math.max(170, 70 + ids.length * (nodeH + gap));
  const x = (width - nodeW) / 2;
  const yFor = (index) => 42 + index * (nodeH + gap);
  const indexById = new Map(ids.map((id, index) => [id, index]));
  const edgeSet = new Set(parsed.edges.map(([a, b]) => `${a}->${b}`));
  if (!edgeSet.size) {
    for (let i = 0; i < ids.length - 1; i += 1) edgeSet.add(`${ids[i]}->${ids[i + 1]}`);
  }
  const arrows = Array.from(edgeSet).map((key) => {
    const [from, to] = key.split("->");
    const a = indexById.get(from);
    const b = indexById.get(to);
    if (a === undefined || b === undefined || a === b) return "";
    const y1 = yFor(a) + nodeH;
    const y2 = yFor(b);
    const cx = width / 2;
    return `<path d="M ${cx} ${y1 + 4} C ${cx} ${y1 + 20}, ${cx} ${y2 - 20}, ${cx} ${y2 - 4}" fill="none" stroke="#64748b" stroke-width="2.5" marker-end="url(#arrow)"></path>`;
  }).join("");
  const nodes = ids.map((id, index) => {
    const y = yFor(index);
    const fill = index === 0 ? "#111827" : "#ffffff";
    const stroke = index === 0 ? "#111827" : "#64748b";
    const color = index === 0 ? "#ffffff" : "#0f172a";
    const label = escapeHtml(parsed.labels.get(id) || id);
    return `<rect x="${x}" y="${y}" width="${nodeW}" height="${nodeH}" rx="15" fill="${fill}" stroke="${stroke}" stroke-width="2"></rect><text x="${width / 2}" y="${y + 34}" text-anchor="middle" font-size="18" font-weight="800" fill="${color}">${label}</text>`;
  }).join("");
  return `<section class="diagram-card page-avoid"><h2>🧭 ${escapeHtml(title)}</h2><svg class="diagram-svg" viewBox="0 0 ${width} ${height}" role="img"><defs><marker id="arrow" markerWidth="12" markerHeight="12" refX="9" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#64748b"></path></marker></defs>${arrows}${nodes}</svg></section>`;
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
  if (type.includes("chart") || tool === "chartdata") return renderChartSvg(widget);
  if (type.includes("mermaid") || tool === "mermaid") return renderMermaidSvg(widget.code || widget.raw?.code || "", widget.title || "Mermaid Şema");
  if (type.includes("file") || widget.url || widget.downloadUrl || widget.filename) return renderFileWidgetHtml(widget);
  return "";
}

function rowsToMarkdownTable(rows = [], explicitHeaders = []) {
  if (!Array.isArray(rows) || !rows.length) return "";
  const normalized = rows.filter((row) => row && typeof row === "object");
  if (!normalized.length) return "";
  const headers = explicitHeaders.length ? explicitHeaders : Array.from(normalized.reduce((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set()));
  const clean = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [
    `| ${headers.map(clean).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...normalized.slice(0, 80).map((row) => `| ${headers.map((header) => clean(row[header])).join(" | ")} |`),
  ].join("\n");
}

function buildPdfMarkdown(input = {}) {
  const parts = [];
  const text = normalizePdfText(input.text || input.content || input.value || input.markdown || "");
  if (text) parts.push(text);

  const rows = Array.isArray(input.rows) ? input.rows : Array.isArray(input.previewRows) ? input.previewRows : [];
  const table = rowsToMarkdownTable(rows, Array.isArray(input.headers) ? input.headers : []);
  if (table && !text.includes("|")) parts.push(`## Tablo\n${table}`);

  if (input.data?.labels?.length && input.data?.datasets?.[0]?.data?.length) {
    parts.push(`\n\`\`\`lucy-widget\n${JSON.stringify({ type: "chart", tool: "chartData", title: input.title || "Grafik", chartType: input.chartType || "bar", data: input.data })}\n\`\`\``);
  }

  if (input.code || input.mermaid) {
    parts.push(`\n\`\`\`mermaid\n${String(input.code || input.mermaid).trim()}\n\`\`\``);
  }

  return parts.join("\n\n").trim();
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
      html.push(renderMermaidSvg(code, "Mermaid Şema"));
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
      html.push('<table class="data-table"><thead><tr>');
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
    browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=none"] });
    const page = await browser.newPage();
    const body = markdownToHtml(text);
    const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>
      @page{size:A4;margin:36px}
      *{box-sizing:border-box}html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
      body{font-family:'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji','Noto Emoji','DejaVu Sans','Noto Sans',Arial,sans-serif;color:#111827;font-size:14px;line-height:1.55;margin:0;background:#fff}
      h1{font-size:25px;margin:0 0 22px;font-weight:850;letter-spacing:-.02em;color:#050505;border-bottom:2px solid #111827;padding-bottom:10px}
      h2{font-size:18px;margin:0 0 12px;font-weight:850}h3{font-size:16px;margin:16px 0 6px}p{margin:7px 0;white-space:pre-wrap}.spacer{height:8px}
      ul{margin:8px 0 12px 20px;padding:0}li{margin:4px 0}code{font-family:Consolas,monospace;background:#f3f4f6;padding:1px 4px;border-radius:4px}pre{background:#111827;color:#f9fafb;border-radius:10px;padding:12px;white-space:pre-wrap;overflow-wrap:anywhere}
      .data-table{border-collapse:separate;border-spacing:0;width:100%;margin:14px 0 18px;font-size:12.2px;page-break-inside:auto;border:1px solid #94a3b8;border-radius:12px;overflow:hidden}
      tr{page-break-inside:avoid;page-break-after:auto}th,td{border-right:1px solid #cbd5e1;border-bottom:1px solid #cbd5e1;padding:8px 9px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th:last-child,td:last-child{border-right:none}tr:last-child td{border-bottom:none}th{background:#111827;color:#fff;font-weight:800}tbody tr:nth-child(even) td{background:#f8fafc}
      a{color:#075985;text-decoration:none}.footer{margin-top:28px;font-size:10px;color:#64748b;border-top:1px solid #e5e7eb;padding-top:8px}
      .page-avoid{break-inside:avoid;page-break-inside:avoid}.chart-card,.diagram-card,.file-card{border:1px solid #cbd5e1;border-radius:16px;padding:16px 18px;margin:16px 0 20px;background:#f8fafc;box-shadow:0 8px 20px rgba(15,23,42,.07)}
      .bar-chart{display:flex;flex-direction:column;gap:9px}.bar-row{display:grid;grid-template-columns:140px 1fr 76px;align-items:center;gap:10px}.bar-label{font-weight:750;overflow-wrap:anywhere}.bar-track{height:14px;background:#e2e8f0;border-radius:999px;overflow:hidden}.bar-fill{height:100%;border-radius:999px}.bar-value{font-weight:850;text-align:right;color:#0f172a}
      .pie-layout{display:grid;grid-template-columns:250px 1fr;gap:20px;align-items:center}.chart-svg{display:block;max-width:100%;height:auto}.chart-svg.wide{width:100%;height:auto}.legend{display:flex;flex-direction:column;gap:8px}.legend-row{display:grid;grid-template-columns:16px 1fr 76px;gap:8px;align-items:center}.swatch{width:14px;height:14px;border-radius:4px}.legend-row strong{text-align:right}.chart-empty{padding:18px;border:1px dashed #94a3b8;border-radius:12px;background:#fff;color:#64748b}
      .diagram-svg{width:100%;height:auto;display:block;background:#fff;border-radius:13px}.file-card{display:flex;align-items:center;gap:12px}.file-icon{width:44px;height:44px;border-radius:12px;background:#111827;color:#fff;display:flex;align-items:center;justify-content:center;font-size:23px}.file-card p{margin:2px 0 0;color:#64748b}
    </style></head><body><h1>${escapeHtml(normalizePdfText(normalizeCurrencyForPdf(title)))}</h1><main>${body}</main><div class="footer">LUCY tarafından hazırlandı</div></body></html>`;
    await page.setContent(html, { waitUntil: "networkidle0" });
    return await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, margin: { top: "36px", right: "36px", bottom: "36px", left: "36px" } });
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
  description: "Markdown, tablo, grafik, pasta grafik, mermaid diyagram ve emojili metinden profesyonel Türkçe PDF raporu üretir",

  async execute(input = {}) {
    const title = normalizePdfText(input.title || input.name || "LUCY Rapor");
    const text = buildPdfMarkdown(input);

    if (!text) return { success: false, error: "text_required", message: "PDF üretmek için text, rows, chart data veya mermaid code gerekli." };

    const htmlPdf = await puppeteerPdf({ title, text });
    const buffer = htmlPdf || await pdfkitPdf({ title, text });

    return {
      success: true,
      type: "file",
      tool: "pdf",
      mimeType: "application/pdf",
      filename: input.filename || "lucy-rapor.pdf",
      base64: Buffer.from(buffer).toString("base64"),
      engine: htmlPdf ? "puppeteer-html-inline-svg-table-chart-mermaid-emoji" : "pdfkit-unicode-safe-fallback",
      font: findFont() || "browser/system",
      message: "PDF hazırlandı.",
    };
  },
};
