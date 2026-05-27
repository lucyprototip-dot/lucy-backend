const fs = require("fs");
const path = require("path");

function normalizeText(value = "") {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "  ")
    .trim();
}

function escapeHtml(value = "") {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function normalizeCurrency(value = "") {
  return String(value ?? "").replace(/₺/g, "TL");
}

function slugFileName(value = "lucy-rapor", ext = "pdf") {
  const stem = String(value || "lucy-rapor")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9ğüşöçıİĞÜŞÖÇ_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "lucy-rapor";
  return stem.toLowerCase().endsWith(`.${ext}`) ? stem : `${stem}.${ext}`;
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

function parseMarkdownTable(text = "") {
  const lines = String(text || "").split(/\n/);
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (!lines[i].includes("|") || !isMarkdownDivider(lines[i + 1])) continue;
    const headers = splitMarkdownRow(lines[i]).map((h, idx) => h || `Sütun ${idx + 1}`);
    const rows = [];
    i += 2;
    while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
      if (!isMarkdownDivider(lines[i])) {
        const cells = splitMarkdownRow(lines[i]);
        const row = {};
        headers.forEach((header, index) => { row[header] = cells[index] ?? ""; });
        if (Object.values(row).some((value) => String(value).trim())) rows.push(row);
      }
      i += 1;
    }
    if (headers.length && rows.length) return { headers, rows };
  }
  return null;
}

function normalizeRows(rows = [], headers = null) {
  if (!Array.isArray(rows) || !rows.length) return null;
  if (Array.isArray(rows[0])) {
    const head = Array.isArray(headers) && headers.length ? headers : rows[0].map((_, i) => `Sütun ${i + 1}`);
    const dataRows = Array.isArray(headers) && headers.length ? rows : rows.slice(1);
    const objects = dataRows.map((row) => {
      const out = {};
      head.forEach((header, index) => { out[header || `Sütun ${index + 1}`] = row?.[index] ?? ""; });
      return out;
    }).filter((row) => Object.values(row).some((value) => String(value).trim()));
    return objects.length ? { headers: head, rows: objects } : null;
  }
  const objects = rows.filter((row) => row && typeof row === "object");
  const head = Array.isArray(headers) && headers.length
    ? headers
    : Array.from(objects.reduce((set, row) => { Object.keys(row).forEach((key) => set.add(key)); return set; }, new Set()));
  return head.length && objects.length ? { headers: head, rows: objects } : null;
}

function parseLucyWidget(source = "") {
  const raw = String(source || "").trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {}
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(raw.slice(first, last + 1)); } catch {}
  }
  return null;
}

function inlineMarkdownToHtml(value = "") {
  return escapeHtml(normalizeCurrency(value))
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
}

function stripMarkdown(value = "") {
  return String(value || "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

function tableToHtml(table = {}, title = "Tablo") {
  const normalized = normalizeRows(table.rows || [], table.headers || null);
  if (!normalized) return "";
  const { headers, rows } = normalized;
  return `<section class="block table-card page-avoid"><h2>📋 ${escapeHtml(title)}</h2><table><thead><tr>${headers.map((h) => `<th>${inlineMarkdownToHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((h) => `<td>${inlineMarkdownToHtml(row?.[h] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></section>`;
}

function numberFromCell(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const clean = String(value ?? "")
    .replace(/[%₺$€£]/g, "")
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(/,/g, ".");
  const number = Number(clean);
  return Number.isFinite(number) ? number : null;
}

function chartRowsFromInput(input = {}) {
  const data = input.data || input.chartData || input.chart?.data || input.raw?.data || {};
  const labels = input.labels || data.labels || [];
  const values = input.values || data.values || data.datasets?.[0]?.data || [];
  if (Array.isArray(labels) && labels.length && Array.isArray(values) && values.length) {
    return labels.map((label, index) => ({
      label: String(label || `Veri ${index + 1}`),
      value: numberFromCell(values[index]) ?? 0,
    })).filter((row) => row.label && Number.isFinite(row.value));
  }

  const table = normalizeRows(input.rows || [], input.headers || null);
  if (!table) return [];
  const labelKey = table.headers.find((header) => table.rows.some((row) => String(row?.[header] ?? "").trim() && numberFromCell(row?.[header]) === null)) || table.headers[0];
  const valueKey = table.headers.find((header) => table.rows.some((row) => numberFromCell(row?.[header]) !== null));
  return table.rows.slice(0, 24).map((row, index) => ({
    label: String(row?.[labelKey] ?? `Satır ${index + 1}`).trim() || `Satır ${index + 1}`,
    value: valueKey ? (numberFromCell(row?.[valueKey]) ?? 0) : 1,
  }));
}

const CHART_COLORS = ["#2563eb", "#16a34a", "#f97316", "#9333ea", "#dc2626", "#0891b2", "#ca8a04", "#475569", "#db2777", "#65a30d"];

function polar(cx, cy, r, angle) {
  const rad = (angle - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx, cy, r, startAngle, endAngle) {
  const start = polar(cx, cy, r, endAngle);
  const end = polar(cx, cy, r, startAngle);
  const large = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${cx} ${cy} L ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${large} 0 ${end.x.toFixed(2)} ${end.y.toFixed(2)} Z`;
}

function renderPieSvg(rows = []) {
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.value), 0) || 1;
  let cursor = 0;
  const slices = rows.map((row, index) => {
    const angle = (Math.max(0, row.value) / total) * 360;
    const path = arcPath(120, 120, 95, cursor, cursor + angle);
    cursor += angle;
    return `<path d="${path}" fill="${CHART_COLORS[index % CHART_COLORS.length]}" stroke="#ffffff" stroke-width="2"/>`;
  }).join("");
  const legend = rows.map((row, index) => `<div class="legend-row"><span class="swatch" style="background:${CHART_COLORS[index % CHART_COLORS.length]}"></span><span>${escapeHtml(row.label)}</span><strong>${escapeHtml(String(row.value))}</strong></div>`).join("");
  return `<div class="pie-layout"><svg class="chart-svg" viewBox="0 0 240 240" role="img">${slices}<circle cx="120" cy="120" r="42" fill="#fff" opacity=".96"/></svg><div class="legend">${legend}</div></div>`;
}

function renderBarSvg(rows = [], type = "bar") {
  const width = 720;
  const height = Math.max(240, rows.length * 38 + 40);
  const left = 150;
  const right = 70;
  const max = Math.max(...rows.map((row) => Math.abs(row.value)), 1);
  if (String(type).includes("line")) {
    const chartW = width - left - right;
    const chartH = height - 70;
    const points = rows.map((row, index) => {
      const x = left + (rows.length === 1 ? chartW / 2 : (index / (rows.length - 1)) * chartW);
      const y = 25 + chartH - (Math.max(0, row.value) / max) * chartH;
      return { x, y, row };
    });
    const poly = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    return `<svg class="wide-svg" viewBox="0 0 ${width} ${height}" role="img"><line x1="${left}" y1="${height - 45}" x2="${width - right}" y2="${height - 45}" stroke="#94a3b8"/><line x1="${left}" y1="25" x2="${left}" y2="${height - 45}" stroke="#94a3b8"/><polyline points="${poly}" fill="none" stroke="#2563eb" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>${points.map((p, i) => `<circle cx="${p.x}" cy="${p.y}" r="5" fill="${CHART_COLORS[i % CHART_COLORS.length]}"/><text x="${p.x}" y="${height - 25}" text-anchor="middle" font-size="12" fill="#334155">${escapeHtml(String(p.row.label).slice(0, 12))}</text><text x="${p.x}" y="${p.y - 9}" text-anchor="middle" font-size="12" font-weight="700" fill="#0f172a">${escapeHtml(String(p.row.value))}</text>`).join("")}</svg>`;
  }
  return `<svg class="wide-svg" viewBox="0 0 ${width} ${height}" role="img">${rows.map((row, index) => {
    const y = 24 + index * 38;
    const barW = Math.max(4, ((Math.abs(row.value) / max) * (width - left - right)));
    return `<text x="14" y="${y + 20}" font-size="13" font-weight="700" fill="#0f172a">${escapeHtml(String(row.label).slice(0, 28))}</text><rect x="${left}" y="${y}" width="${barW.toFixed(1)}" height="22" rx="8" fill="${CHART_COLORS[index % CHART_COLORS.length]}"/><text x="${left + barW + 8}" y="${y + 16}" font-size="13" font-weight="800" fill="#0f172a">${escapeHtml(String(row.value))}</text>`;
  }).join("")}</svg>`;
}

function chartToHtml(input = {}, title = "Grafik") {
  const rows = chartRowsFromInput(input);
  if (!rows.length) return "";
  const chartType = String(input.chartType || input.type || input.raw?.chartType || "bar").toLowerCase();
  const svg = chartType.includes("pie") || chartType.includes("pasta")
    ? renderPieSvg(rows)
    : renderBarSvg(rows, chartType);
  return `<section class="block chart-card page-avoid"><h2>📊 ${escapeHtml(input.title || title || "Grafik")}</h2>${svg}</section>`;
}

function cleanMermaidLabel(value = "") {
  return stripMarkdown(String(value || "")
    .replace(/\\n/g, " — ")
    .replace(/[<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()).slice(0, 90);
}

function parseMermaidNodes(code = "") {
  const source = String(code || "");
  const nodes = new Map();
  const edges = [];
  const ignored = /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|style|classDef|class\s|linkStyle|end\b|subgraph\b)/i;
  const addNode = (id, label = "") => {
    const cleanId = String(id || "").trim();
    if (!cleanId) return;
    const cleanLabel = cleanMermaidLabel(label || cleanId);
    if (!nodes.has(cleanId)) nodes.set(cleanId, { id: cleanId, label: cleanLabel });
    else if (label && nodes.get(cleanId).label === cleanId) nodes.get(cleanId).label = cleanLabel;
  };

  for (const rawLine of source.split(/\n/)) {
    const line = rawLine.trim();
    if (!line || ignored.test(line)) {
      const sub = line.match(/^subgraph\s+([A-Za-z0-9_:-]+)(?:\[([^\]]+)\])?/i);
      if (sub) addNode(sub[1], sub[2] || sub[1]);
      continue;
    }
    const nodePattern = /([A-Za-z0-9_:-]+)\s*(?:\["?([^\]"]+)"?\]|\("?([^)"]+)"?\)|\{"?([^}"]+)"?\})?/g;
    const found = [...line.matchAll(nodePattern)].filter((match) => !/^(style|class|fill|stroke|color)$/i.test(match[1]));
    found.forEach((match) => addNode(match[1], match[2] || match[3] || match[4] || ""));
    const edge = line.match(/([A-Za-z0-9_:-]+).*?(?:-->|---|==>|-.->).*?([A-Za-z0-9_:-]+)/);
    if (edge) edges.push([edge[1], edge[2]]);
  }

  if (!nodes.size) {
    source.split(/-->|---|==>|-.->/).map(cleanMermaidLabel).filter(Boolean).slice(0, 12).forEach((label, index) => addNode(`N${index + 1}`, label));
  }
  return { nodes: [...nodes.values()].slice(0, 18), edges };
}

function mermaidToHtml(code = "", title = "Mermaid diyagram") {
  const { nodes, edges } = parseMermaidNodes(code);
  if (!nodes.length) return "";
  const width = Math.max(760, nodes.length * 130);
  const height = 280;
  const root = nodes[0];
  const children = nodes.slice(1);
  const rootX = width / 2;
  const childY = 176;
  const rootY = 42;
  const childGap = children.length > 1 ? (width - 120) / (children.length - 1) : 0;
  const positions = new Map([[root.id, { x: rootX, y: rootY }]]);
  children.forEach((node, index) => positions.set(node.id, { x: children.length === 1 ? rootX : 60 + index * childGap, y: childY }));
  const edgeLines = [];
  const usefulEdges = edges.length ? edges : children.map((child) => [root.id, child.id]);
  usefulEdges.slice(0, 24).forEach(([from, to]) => {
    const a = positions.get(from) || positions.get(root.id);
    const b = positions.get(to);
    if (!a || !b) return;
    edgeLines.push(`<path d="M ${a.x} ${a.y + 34} C ${a.x} ${a.y + 90}, ${b.x} ${b.y - 56}, ${b.x} ${b.y - 12}" fill="none" stroke="#64748b" stroke-width="2"/>`);
  });
  const nodeSvg = nodes.map((node, index) => {
    const pos = positions.get(node.id);
    const isRoot = index === 0;
    const w = isRoot ? 240 : 135;
    const h = isRoot ? 58 : 54;
    const x = pos.x - w / 2;
    const y = pos.y;
    const fill = isRoot ? "#ff4500" : "#ff69b4";
    const stroke = isRoot ? "#ff1493" : "#db2777";
    const label = escapeHtml(node.label || node.id);
    return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="3"/><foreignObject x="${x + 8}" y="${y + 8}" width="${w - 16}" height="${h - 16}"><div xmlns="http://www.w3.org/1999/xhtml" class="mermaid-label ${isRoot ? "root" : ""}">${label}</div></foreignObject></g>`;
  }).join("");
  return `<section class="block diagram-card page-avoid"><h2>🧭 ${escapeHtml(title || "Mermaid diyagram")}</h2><div class="svg-scroll"><svg class="mermaid-svg" viewBox="0 0 ${width} ${height}" role="img">${edgeLines.join("")}${nodeSvg}</svg></div></section>`;
}

function fileWidgetToHtml(widget = {}) {
  const title = widget.title || widget.filename || widget.raw?.filename || "Dosya";
  const type = String(widget.type || widget.raw?.type || widget.tool || "file").toLowerCase();
  const icon = type.includes("pdf") ? "📄" : type.includes("excel") ? "📊" : type.includes("zip") ? "🗜️" : "📎";
  return `<section class="block file-card page-avoid"><div class="file-icon">${icon}</div><div><strong>${escapeHtml(title)}</strong><p>Dosya hazırlandı.</p></div></section>`;
}

function widgetToHtml(widget = {}) {
  const type = String(widget.type || widget.raw?.type || widget.tool || "").toLowerCase();
  const tool = String(widget.tool || widget.raw?.tool || "").toLowerCase();
  if (type.includes("chart") || tool === "chartdata") return chartToHtml(widget, widget.title || "Grafik");
  if (type.includes("mermaid") || tool === "mermaid") return mermaidToHtml(widget.code || widget.raw?.code || widget.mermaid || "", widget.title || "Mermaid diyagram");
  if (type.includes("file") || widget.url || widget.downloadUrl || widget.filename) return fileWidgetToHtml(widget);
  return "";
}

function markdownToHtml(markdown = "") {
  const text = normalizeText(markdown);
  const lines = text.split(/\n/);
  const html = [];
  let listOpen = false;
  let codeOpen = false;
  let codeLang = "";
  let codeBuffer = [];

  const closeList = () => { if (listOpen) { html.push("</ul>"); listOpen = false; } };
  const closeCode = () => {
    if (!codeOpen) return;
    const code = codeBuffer.join("\n");
    const lang = String(codeLang || "").toLowerCase().trim();
    if (lang === "lucy-widget") {
      const widget = parseLucyWidget(code);
      const rendered = widget ? widgetToHtml(widget) : "";
      if (rendered) html.push(rendered);
    } else if (lang === "mermaid") {
      const rendered = mermaidToHtml(code, "Mermaid diyagram");
      if (rendered) html.push(rendered);
    } else {
      html.push(`<pre><code>${escapeHtml(code)}</code></pre>`);
    }
    codeOpen = false;
    codeLang = "";
    codeBuffer = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trim();
    const fence = line.match(/^```\s*([^`]*)\s*$/);
    if (fence) {
      if (codeOpen) closeCode();
      else { closeList(); codeOpen = true; codeLang = fence[1] || ""; codeBuffer = []; }
      continue;
    }
    if (codeOpen) { codeBuffer.push(raw); continue; }

    if (/^\s*\{\s*"type"\s*:\s*"(?:chart|mermaid|file|file-pdf|file-excel)/i.test(line)) {
      const widget = parseLucyWidget(line);
      const rendered = widget ? widgetToHtml(widget) : "";
      if (rendered) { html.push(rendered); continue; }
    }

    if (!line) { closeList(); html.push('<div class="spacer"></div>'); continue; }

    if (line.includes("|") && i + 1 < lines.length && isMarkdownDivider(lines[i + 1])) {
      closeList();
      const headers = splitMarkdownRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        if (!isMarkdownDivider(lines[i])) rows.push(splitMarkdownRow(lines[i]));
        i += 1;
      }
      i -= 1;
      html.push(`<table><thead><tr>${headers.map((cell) => `<th>${inlineMarkdownToHtml(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((_, index) => `<td>${inlineMarkdownToHtml(row[index] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = Math.min(3, heading[1].length + 1);
      html.push(`<h${level}>${inlineMarkdownToHtml(heading[2])}</h${level}>`);
      continue;
    }

    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (ordered || bullet) {
      if (!listOpen) { html.push("<ul>"); listOpen = true; }
      html.push(`<li>${inlineMarkdownToHtml((ordered || bullet)[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${inlineMarkdownToHtml(raw)}</p>`);
  }

  closeCode();
  closeList();
  return html.join("\n");
}

function buildPdfBodyHtml(input = {}) {
  const blocks = [];
  const text = normalizeText(input.text || input.content || input.value || input.markdown || "");
  if (text) blocks.push(markdownToHtml(text));

  const table = normalizeRows(input.rows || input.table?.rows || [], input.headers || input.table?.headers || null) || parseMarkdownTable(text);
  if (table && !/\|\s*---/.test(text)) blocks.push(tableToHtml(table, input.tableTitle || input.title || "Tablo"));

  const chartInput = input.chart || input.chartData || (input.data?.labels ? { data: input.data } : null);
  if (chartInput) blocks.push(chartToHtml({ ...chartInput, title: chartInput.title || input.chartTitle || input.title }, chartInput.title || input.chartTitle || "Grafik"));

  const mermaidCode = input.mermaid || input.mermaidCode || input.code || input.diagramCode;
  if (String(mermaidCode || "").trim() && !/```mermaid/i.test(text)) blocks.push(mermaidToHtml(mermaidCode, input.mermaidTitle || input.title || "Mermaid diyagram"));

  if (Array.isArray(input.widgets)) {
    input.widgets.forEach((widget) => {
      const rendered = widgetToHtml(widget);
      if (rendered) blocks.push(rendered);
    });
  }

  return blocks.filter(Boolean).join("\n");
}

function findFont() {
  const candidates = [
    process.env.LUCY_PDF_FONT,
    path.resolve(__dirname, "..", "..", "fonts", "DejaVuSans.ttf"),
    path.resolve(__dirname, "..", "..", "fonts", "NotoSans-Regular.ttf"),
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "C:/Windows/Fonts/segoeui.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "C:/Windows/Fonts/calibri.ttf",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
  ].filter(Boolean);
  return candidates.find((candidate) => {
    try { return fs.existsSync(candidate) && fs.statSync(candidate).isFile(); } catch { return false; }
  });
}

function buildPdfHtml(input = {}) {
  const title = normalizeText(input.title || input.name || "LUCY Rapor") || "LUCY Rapor";
  const body = buildPdfBodyHtml(input);
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>
    @page{size:A4;margin:34px} *{box-sizing:border-box}
    body{font-family:"Segoe UI","Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji","DejaVu Sans","Noto Sans",Arial,sans-serif;color:#111827;font-size:14px;line-height:1.55;margin:0;background:#fff}
    h1{font-size:25px;margin:0 0 20px;font-weight:850;letter-spacing:-.02em;color:#050505;border-bottom:2px solid #111827;padding-bottom:10px}
    h2{font-size:18px;margin:0 0 12px;font-weight:850} h3{font-size:16px;margin:16px 0 6px} p{margin:7px 0;white-space:pre-wrap}.spacer{height:8px}
    ul{margin:8px 0 12px 20px;padding:0} li{margin:4px 0} code{font-family:Consolas,monospace;background:#f3f4f6;padding:1px 4px;border-radius:4px} pre{background:#111827;color:#f9fafb;border-radius:10px;padding:12px;white-space:pre-wrap;overflow-wrap:anywhere}
    table{border-collapse:collapse;width:100%;margin:14px 0 18px;font-size:12.5px;page-break-inside:auto;border:1px solid #94a3b8;border-radius:10px;overflow:hidden} tr{page-break-inside:avoid;page-break-after:auto} th,td{border:1px solid #94a3b8;padding:8px 9px;text-align:left;vertical-align:top;overflow-wrap:anywhere} th{background:#111827;color:#fff;font-weight:800} tbody tr:nth-child(even) td{background:#f8fafc}
    a{color:#075985;text-decoration:none}.footer{margin-top:28px;font-size:10px;color:#64748b;border-top:1px solid #e5e7eb;padding-top:8px}.page-avoid{break-inside:avoid;page-break-inside:avoid}
    .block{border:1px solid #cbd5e1;border-radius:16px;padding:16px 18px;margin:16px 0 20px;background:#f8fafc;box-shadow:0 8px 20px rgba(15,23,42,.07)} .table-card table{margin-bottom:0;background:#fff}.chart-svg{width:240px;height:240px}.wide-svg{width:100%;max-width:720px;height:auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px}.pie-layout{display:grid;grid-template-columns:250px 1fr;gap:18px;align-items:center}.legend{display:flex;flex-direction:column;gap:8px}.legend-row{display:grid;grid-template-columns:16px 1fr 70px;gap:8px;align-items:center}.swatch{width:14px;height:14px;border-radius:4px}.legend-row strong{text-align:right}.svg-scroll{width:100%;overflow:hidden}.mermaid-svg{width:100%;height:auto;background:#1f2937;border-radius:14px}.mermaid-label{height:100%;width:100%;display:flex;align-items:center;justify-content:center;text-align:center;font-size:12px;font-weight:800;color:#fff;line-height:1.2;overflow:hidden}.mermaid-label.root{font-size:13px;color:#fff}.file-card{display:flex;align-items:center;gap:12px}.file-icon{width:44px;height:44px;border-radius:12px;background:#111827;color:#fff;display:flex;align-items:center;justify-content:center;font-size:23px}.file-card p{margin:2px 0 0;color:#64748b}
  </style></head><body><h1>${escapeHtml(title)}</h1><main>${body || "<p>PDF içeriği hazırlanamadı.</p>"}</main><div class="footer">LUCY tarafından hazırlandı</div></body></html>`;
}

async function renderPdfBuffer(input = {}) {
  let puppeteer;
  try { puppeteer = require("puppeteer"); } catch { return null; }
  let browser = null;
  try {
    browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=medium"] });
    const page = await browser.newPage();
    await page.setContent(buildPdfHtml(input), { waitUntil: "networkidle0" });
    return await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, margin: { top: "34px", right: "34px", bottom: "34px", left: "34px" } });
  } finally {
    try { await browser?.close(); } catch {}
  }
}

function pdfKitSafeText(value = "") {
  return normalizeText(normalizeCurrency(value))
    .replace(/❤️‍🔥|❤‍🔥/g, "♥")
    .replace(/[❤♥]/g, "♥")
    .replace(/[✅]/g, "✓")
    .replace(/[❌]/g, "×")
    .replace(/[➡️→]/g, "→")
    .replace(/[🔥📄📝📃📊📈📉🗜️💙💎⚙️]/gu, "•")
    .replace(/[\u200d\ufe0f]/g, "")
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, "•");
}

async function renderPdfKitBuffer(input = {}) {
  const PDFDocument = require("pdfkit");
  return await new Promise((resolve) => {
    const chunks = [];
    const title = pdfKitSafeText(input.title || input.name || "LUCY Rapor");
    const text = pdfKitSafeText(input.text || input.content || input.value || input.markdown || "");
    const doc = new PDFDocument({ margin: 50, size: "A4", info: { Title: title, Creator: "LUCY" } });
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    const fontPath = findFont();
    if (fontPath) { doc.registerFont("LucyUnicode", fontPath); doc.font("LucyUnicode"); } else doc.font("Helvetica");
    doc.fontSize(20).text(title, { underline: true });
    doc.moveDown(1.2);
    doc.fontSize(12).text(text.replace(/```lucy-widget[\s\S]*?```/g, ""), { align: "left", lineGap: 4 });
    doc.end();
  });
}

module.exports = {
  normalizeText,
  escapeHtml,
  slugFileName,
  normalizeRows,
  parseMarkdownTable,
  markdownToHtml,
  tableToHtml,
  chartToHtml,
  mermaidToHtml,
  buildPdfHtml,
  renderPdfBuffer,
  renderPdfKitBuffer,
};
