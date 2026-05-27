const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

function normalizeText(value = '') {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function escapeAttr(value = '') { return escapeHtml(value).replace(/`/g, '&#96;'); }

function stripMarkdown(value = '') {
  return String(value ?? '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

function normalizeCurrency(value = '') { return String(value ?? '').replace(/₺/g, 'TL'); }

function inlineMarkdownToHtml(value = '') {
  return escapeHtml(normalizeCurrency(value))
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
}

function parseMaybeJson(raw = '') {
  const text = normalizeText(raw);
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(text.slice(first, last + 1)); } catch {}
  }
  return null;
}

function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const normalized = raw
    .replace(/[^0-9,.-]/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function getChartSeries(widget = {}) {
  const data = widget.data || widget.chartData || widget.raw?.data || {};
  const labels = Array.isArray(widget.labels) ? widget.labels : (Array.isArray(data.labels) ? data.labels : []);
  const dataset = Array.isArray(data.datasets) && data.datasets[0] ? data.datasets[0] : {};
  const values = Array.isArray(widget.values) ? widget.values : (Array.isArray(dataset.data) ? dataset.data : []);
  if (labels.length && values.length) {
    return labels.slice(0, 24).map((label, index) => ({
      label: String(label || `Veri ${index + 1}`),
      value: parseNumber(values[index]),
    })).filter((item) => item.label);
  }
  const rows = Array.isArray(widget.rows) ? widget.rows : [];
  if (rows.length) {
    const headers = Array.isArray(widget.headers) && widget.headers.length
      ? widget.headers
      : Object.keys(rows.find((row) => row && typeof row === 'object') || {});
    const labelKey = headers[0];
    const valueKey = headers.find((key) => rows.some((row) => Number.isFinite(parseNumber(row?.[key])) && String(row?.[key] ?? '').trim() !== '')) || headers[1];
    return rows.slice(0, 24).map((row, index) => ({
      label: String(row?.[labelKey] ?? `Satır ${index + 1}`),
      value: parseNumber(row?.[valueKey]),
    }));
  }
  return [];
}

const CHART_COLORS = ['#2563eb', '#16a34a', '#f97316', '#9333ea', '#dc2626', '#0891b2', '#ca8a04', '#475569', '#db2777', '#65a30d'];

function polar(cx, cy, r, angleDeg) {
  const angle = (angleDeg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

function piePath(cx, cy, r, start, end) {
  const s = polar(cx, cy, r, start);
  const e = polar(cx, cy, r, end);
  const large = end - start > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)} Z`;
}

function renderChartSvg(widget = {}) {
  const rows = getChartSeries(widget);
  const title = widget.title || widget.raw?.title || 'Grafik';
  const chartType = String(widget.chartType || widget.raw?.chartType || 'bar').toLowerCase();
  if (!rows.length) return `<section class="chart-card"><h2>📊 ${escapeHtml(title)}</h2><p>Grafik verisi bulunamadı.</p></section>`;

  if (chartType.includes('pie') || chartType.includes('pasta') || chartType.includes('doughnut')) {
    const total = rows.reduce((sum, row) => sum + Math.max(0, row.value), 0) || 1;
    let cursor = 0;
    const slices = rows.map((row, index) => {
      const start = cursor;
      const end = cursor + (Math.max(0, row.value) / total) * 360;
      cursor = end;
      return `<path d="${piePath(150, 150, 118, start, end)}" fill="${CHART_COLORS[index % CHART_COLORS.length]}"/>`;
    }).join('');
    const legend = rows.map((row, index) => `<div class="legend-row"><span class="swatch" style="background:${CHART_COLORS[index % CHART_COLORS.length]}"></span><span>${escapeHtml(row.label)}</span><strong>${escapeHtml(String(row.value))}</strong></div>`).join('');
    return `<section class="chart-card page-avoid"><h2>📊 ${escapeHtml(title)}</h2><div class="chart-grid"><svg class="chart-svg pie-svg" viewBox="0 0 300 300" role="img" aria-label="${escapeAttr(title)}">${slices}<circle cx="150" cy="150" r="55" fill="#fff" opacity="0.92"/></svg><div class="legend">${legend}</div></div></section>`;
  }

  if (chartType.includes('line') || chartType.includes('çizgi')) {
    const width = 760; const height = 320; const pad = 42;
    const max = Math.max(...rows.map((r) => r.value), 1);
    const min = Math.min(...rows.map((r) => r.value), 0);
    const span = max - min || 1;
    const points = rows.map((row, index) => {
      const x = pad + (index * ((width - pad * 2) / Math.max(rows.length - 1, 1)));
      const y = height - pad - ((row.value - min) / span) * (height - pad * 2);
      return { x, y, row };
    });
    const poly = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const dots = points.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5" fill="#2563eb"/><text x="${p.x.toFixed(1)}" y="${(p.y - 10).toFixed(1)}" text-anchor="middle" class="svg-value">${escapeHtml(String(p.row.value))}</text>`).join('');
    return `<section class="chart-card page-avoid"><h2>📈 ${escapeHtml(title)}</h2><svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeAttr(title)}"><line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" class="axis"/><line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" class="axis"/><polyline points="${poly}" fill="none" stroke="#2563eb" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>${dots}</svg></section>`;
  }

  const width = 760; const barH = 28; const gap = 13; const left = 170; const right = 80;
  const height = Math.max(210, 70 + rows.length * (barH + gap));
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  const bars = rows.map((row, index) => {
    const y = 44 + index * (barH + gap);
    const w = Math.max(6, (Math.abs(row.value) / max) * (width - left - right));
    const color = CHART_COLORS[index % CHART_COLORS.length];
    return `<text x="20" y="${y + 19}" class="svg-label">${escapeHtml(row.label)}</text><rect x="${left}" y="${y}" width="${w.toFixed(1)}" height="${barH}" rx="8" fill="${color}"/><text x="${left + w + 10}" y="${y + 19}" class="svg-value">${escapeHtml(String(row.value))}</text>`;
  }).join('');
  return `<section class="chart-card page-avoid"><h2>📊 ${escapeHtml(title)}</h2><svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeAttr(title)}">${bars}</svg></section>`;
}

function cleanMermaidCode(code = '') {
  return normalizeText(code)
    .replace(/^```\s*mermaid\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function extractMermaidNodes(code = '') {
  const text = cleanMermaidCode(code);
  const nodes = new Map();
  const edges = [];
  const subgraphs = new Map();
  let currentSubgraph = null;
  let auto = 0;

  function addNode(id, label) {
    const safeId = String(id || `N${++auto}`).trim();
    if (!safeId || /^(flowchart|graph|subgraph|end|style|classDef|class|linkStyle)$/i.test(safeId)) return null;
    const cleanLabel = stripMarkdown(String(label || safeId)
      .replace(/^['"]|['"]$/g, '')
      .replace(/<br\s*\/?>/gi, ' ')
      .trim());
    if (!nodes.has(safeId)) nodes.set(safeId, { id: safeId, label: cleanLabel || safeId, group: currentSubgraph });
    else if (cleanLabel && nodes.get(safeId).label === safeId) nodes.get(safeId).label = cleanLabel;
    if (currentSubgraph && safeId) {
      if (!subgraphs.has(currentSubgraph)) subgraphs.set(currentSubgraph, []);
      if (!subgraphs.get(currentSubgraph).includes(safeId)) subgraphs.get(currentSubgraph).push(safeId);
    }
    return safeId;
  }

  function parseNode(token = '') {
    const t = token.trim().replace(/[;,]+$/g, '');
    if (!t) return null;
    const match = t.match(/^([A-Za-z0-9_:-]+)\s*(?:\[([^\]]+)\]|\(([^)]+)\)|\{([^}]+)\})?/);
    if (!match) return null;
    return addNode(match[1], match[2] || match[3] || match[4] || match[1]);
  }

  text.split('\n').forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || /^%%/.test(line) || /^(flowchart|graph)\b/i.test(line)) return;
    const sub = line.match(/^subgraph\s+([A-Za-z0-9_:-]+)?\s*(?:\[([^\]]+)\]|\(([^)]+)\)|\{([^}]+)\}|(.+))?$/i);
    if (sub) {
      currentSubgraph = sub[1] || `G${subgraphs.size + 1}`;
      addNode(currentSubgraph, sub[2] || sub[3] || sub[4] || sub[5] || currentSubgraph);
      subgraphs.set(currentSubgraph, []);
      return;
    }
    if (/^end\b/i.test(line)) { currentSubgraph = null; return; }
    if (/^(style|classDef|class|linkStyle)\b/i.test(line)) return;

    const parts = line.split(/\s*(?:-->|---|==>|-.->|--[^-]*-->)\s*/).filter(Boolean);
    if (parts.length >= 2) {
      let previous = parseNode(parts[0]);
      for (let i = 1; i < parts.length; i += 1) {
        const next = parseNode(parts[i]);
        if (previous && next) edges.push([previous, next]);
        previous = next;
      }
    } else parseNode(line);
  });

  if (!nodes.size) {
    ['Başla', 'İşlem', 'Bitti'].forEach((label, index) => addNode(`N${index + 1}`, label));
    edges.push(['N1', 'N2'], ['N2', 'N3']);
  }
  return { nodes: [...nodes.values()].slice(0, 36), edges: edges.slice(0, 60) };
}

function renderMermaidSvg(code = '', title = 'Mermaid diyagram') {
  const parsed = extractMermaidNodes(code);
  const nodes = parsed.nodes;
  const edges = parsed.edges;
  const cols = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(nodes.length))));
  const nodeW = 210; const nodeH = 58; const gapX = 48; const gapY = 52;
  const width = cols * nodeW + (cols - 1) * gapX + 70;
  const rows = Math.ceil(nodes.length / cols);
  const height = rows * nodeH + (rows - 1) * gapY + 80;
  const pos = new Map();
  nodes.forEach((node, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    pos.set(node.id, { x: 35 + col * (nodeW + gapX), y: 42 + row * (nodeH + gapY) });
  });
  const edgeSvg = edges.map(([from, to]) => {
    const a = pos.get(from); const b = pos.get(to);
    if (!a || !b) return '';
    const x1 = a.x + nodeW / 2; const y1 = a.y + nodeH;
    const x2 = b.x + nodeW / 2; const y2 = b.y;
    const midY = (y1 + y2) / 2;
    return `<path d="M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}" class="edge" marker-end="url(#arrow)"/>`;
  }).join('');
  const nodeSvg = nodes.map((node, index) => {
    const p = pos.get(node.id);
    const isStart = index === 0 || /başla|start|6 söz|sevgi/i.test(node.label);
    const label = escapeHtml(node.label.length > 45 ? `${node.label.slice(0, 42)}…` : node.label);
    return `<g><rect x="${p.x}" y="${p.y}" width="${nodeW}" height="${nodeH}" rx="14" class="node ${isStart ? 'start' : ''}"/><text x="${p.x + nodeW / 2}" y="${p.y + 33}" text-anchor="middle" class="node-text ${isStart ? 'start-text' : ''}">${label}</text></g>`;
  }).join('');
  return `<section class="diagram-card page-avoid"><h2>🧭 ${escapeHtml(title)}</h2><svg class="mermaid-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeAttr(title)}"><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="#64748b"/></marker></defs>${edgeSvg}${nodeSvg}</svg></section>`;
}

function splitMarkdownRow(line = '') {
  const cells = [];
  let current = ''; let escaped = false;
  const source = String(line || '').trim().replace(/^\|/, '').replace(/\|$/, '');
  for (const char of source) {
    if (escaped) { current += char; escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (char === '|') { cells.push(current.trim()); current = ''; continue; }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function isMarkdownDivider(line = '') {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(String(line || ''));
}

function renderTable(headers = [], rows = [], title = '') {
  const head = headers.length ? headers : Object.keys(rows.find((row) => row && typeof row === 'object') || {});
  const normalizedRows = rows.map((row) => Array.isArray(row) ? row : head.map((key) => row?.[key] ?? ''));
  return `<section class="table-card page-avoid">${title ? `<h2>📋 ${escapeHtml(title)}</h2>` : ''}<table><thead><tr>${head.map((cell) => `<th>${inlineMarkdownToHtml(cell)}</th>`).join('')}</tr></thead><tbody>${normalizedRows.map((row) => `<tr>${head.map((_, index) => `<td>${inlineMarkdownToHtml(row[index] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`;
}

function renderWidget(widget = {}) {
  const type = String(widget.type || widget.tool || widget.raw?.type || widget.raw?.tool || '').toLowerCase();
  const tool = String(widget.tool || widget.raw?.tool || '').toLowerCase();
  if (type.includes('chart') || tool === 'chartdata' || widget.data?.labels) return renderChartSvg(widget);
  if (type.includes('mermaid') || tool === 'mermaid' || widget.code) return renderMermaidSvg(widget.code || widget.mermaid || widget.raw?.code || '', widget.title || 'Mermaid diyagram');
  if (Array.isArray(widget.rows) || Array.isArray(widget.previewRows)) return renderTable(widget.headers || widget.columns || [], widget.rows || widget.previewRows || [], widget.title || 'Tablo');
  if (type.includes('file') || widget.url || widget.downloadUrl || widget.filename) {
    const title = widget.title || widget.filename || 'Dosya';
    return `<section class="file-card page-avoid"><div class="file-icon">📎</div><div><strong>${escapeHtml(title)}</strong><p>Dosya hazırlandı.</p></div></section>`;
  }
  return '';
}

function markdownToHtml(markdown = '') {
  const lines = normalizeText(markdown).split('\n');
  const html = [];
  let listOpen = false; let codeOpen = false; let codeBuffer = []; let codeLang = '';
  const closeList = () => { if (listOpen) { html.push('</ul>'); listOpen = false; } };
  const closeCode = () => {
    if (!codeOpen) return;
    const code = codeBuffer.join('\n');
    const lang = String(codeLang || '').toLowerCase().trim();
    if (lang === 'lucy-widget' || lang === 'json') {
      const widget = parseMaybeJson(code);
      const rendered = widget ? renderWidget(widget) : '';
      html.push(rendered || `<pre><code>${escapeHtml(code)}</code></pre>`);
    } else if (lang === 'mermaid') html.push(renderMermaidSvg(code, 'Mermaid diyagram'));
    else html.push(`<pre><code>${escapeHtml(code)}</code></pre>`);
    codeOpen = false; codeBuffer = []; codeLang = '';
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trim();
    const fence = line.match(/^```\s*([^`]*)\s*$/);
    if (fence) {
      if (codeOpen) closeCode();
      else { closeList(); codeOpen = true; codeBuffer = []; codeLang = fence[1] || ''; }
      continue;
    }
    if (codeOpen) { codeBuffer.push(raw); continue; }
    if (!line) { closeList(); html.push('<div class="spacer"></div>'); continue; }

    const maybeWidget = line.startsWith('{') ? parseMaybeJson(line) : null;
    if (maybeWidget) { const rendered = renderWidget(maybeWidget); if (rendered) { closeList(); html.push(rendered); continue; } }

    if (line.includes('|') && i + 1 < lines.length && isMarkdownDivider(lines[i + 1])) {
      closeList();
      const headers = splitMarkdownRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) { rows.push(splitMarkdownRow(lines[i])); i += 1; }
      i -= 1;
      html.push(renderTable(headers, rows));
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { closeList(); const level = Math.min(3, heading[1].length + 1); html.push(`<h${level}>${inlineMarkdownToHtml(heading[2])}</h${level}>`); continue; }
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet) { if (!listOpen) { html.push('<ul>'); listOpen = true; } html.push(`<li>${inlineMarkdownToHtml(bullet[1])}</li>`); continue; }
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) { if (!listOpen) { html.push('<ul>'); listOpen = true; } html.push(`<li>${inlineMarkdownToHtml(ordered[1])}</li>`); continue; }
    closeList();
    // Skip noisy generated-file raw internals in exported conversations.
    if (/^LUCYFILEREF\b/i.test(line)) continue;
    html.push(`<p>${inlineMarkdownToHtml(raw)}</p>`);
  }
  closeCode(); closeList();
  return html.join('\n');
}

function buildDocumentMarkdown(input = {}) {
  const chunks = [];
  const text = input.text || input.content || input.value || input.markdown || input.body || '';
  if (text) chunks.push(normalizeText(text));
  if (Array.isArray(input.rows) || Array.isArray(input.previewRows)) {
    const headers = input.headers || input.columns || [];
    const rows = input.rows || input.previewRows || [];
    chunks.push(`\n\n\`\`\`lucy-widget\n${JSON.stringify({ type: 'table', title: input.title || 'Tablo', headers, rows })}\n\`\`\``);
  }
  if (input.data?.labels || input.chartData?.labels || input.labels) {
    chunks.push(`\n\n\`\`\`lucy-widget\n${JSON.stringify({ type: 'chart', title: input.title || input.label || 'Grafik', chartType: input.chartType || 'bar', data: input.data || input.chartData, labels: input.labels, values: input.values })}\n\`\`\``);
  }
  if (input.code || input.mermaid) chunks.push(`\n\n\`\`\`mermaid\n${cleanMermaidCode(input.code || input.mermaid)}\n\`\`\``);
  return normalizeText(chunks.join('\n'));
}

function getCss() {
  return `@page{size:A4;margin:34px}*{box-sizing:border-box}body{font-family:'Segoe UI Emoji','Noto Color Emoji','Apple Color Emoji','DejaVu Sans','Noto Sans',Arial,sans-serif;color:#111827;font-size:14px;line-height:1.58;margin:0;background:#fff}h1{font-size:25px;margin:0 0 20px;font-weight:850;letter-spacing:-.02em;color:#050505;border-bottom:2px solid #111827;padding-bottom:10px}h2{font-size:18px;margin:0 0 12px;font-weight:850}h3{font-size:16px;margin:16px 0 6px}p{margin:7px 0;white-space:pre-wrap}.spacer{height:7px}ul{margin:8px 0 12px 20px;padding:0}li{margin:4px 0}code{font-family:Consolas,monospace;background:#f3f4f6;padding:1px 4px;border-radius:4px}pre{background:#111827;color:#f9fafb;border-radius:10px;padding:12px;white-space:pre-wrap;overflow-wrap:anywhere}table{border-collapse:separate;border-spacing:0;width:100%;margin:10px 0 8px;font-size:12.5px;border:1px solid #94a3b8;border-radius:12px;overflow:hidden}tr{page-break-inside:avoid;page-break-after:auto}th,td{border-right:1px solid #94a3b8;border-bottom:1px solid #94a3b8;padding:8px 9px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th:last-child,td:last-child{border-right:0}tbody tr:last-child td{border-bottom:0}th{background:#111827;color:#fff;font-weight:800}tbody tr:nth-child(even) td{background:#f8fafc}a{color:#075985;text-decoration:none}.footer{margin-top:28px;font-size:10px;color:#64748b;border-top:1px solid #e5e7eb;padding-top:8px}.page-avoid{break-inside:avoid;page-break-inside:avoid}.chart-card,.diagram-card,.file-card,.table-card{border:1px solid #cbd5e1;border-radius:16px;padding:16px 18px;margin:16px 0 20px;background:#f8fafc;box-shadow:0 8px 20px rgba(15,23,42,.07)}.chart-grid{display:grid;grid-template-columns:260px 1fr;gap:18px;align-items:center}.chart-svg{width:100%;height:auto;background:#fff;border:1px solid #e2e8f0;border-radius:14px}.pie-svg{max-width:260px}.legend{display:flex;flex-direction:column;gap:8px}.legend-row{display:grid;grid-template-columns:16px 1fr 76px;gap:8px;align-items:center}.swatch{width:14px;height:14px;border-radius:4px}.legend-row strong{text-align:right}.svg-label{font:700 14px 'DejaVu Sans',Arial,sans-serif;fill:#0f172a}.svg-value{font:800 13px 'DejaVu Sans',Arial,sans-serif;fill:#0f172a}.axis{stroke:#94a3b8;stroke-width:2}.mermaid-svg{width:100%;height:auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px}.edge{fill:none;stroke:#64748b;stroke-width:2.2}.node{fill:#ffffff;stroke:#64748b;stroke-width:2}.node.start{fill:#111827;stroke:#111827}.node-text{font:800 13px 'Segoe UI Emoji','Noto Color Emoji','DejaVu Sans',Arial,sans-serif;fill:#111827}.start-text{fill:#fff}.file-card{display:flex;align-items:center;gap:12px}.file-icon{width:44px;height:44px;border-radius:12px;background:#111827;color:#fff;display:flex;align-items:center;justify-content:center;font-size:23px}.file-card p{margin:2px 0 0;color:#64748b}`;
}

function buildHtml({ title, markdown }) {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>${getCss()}</style></head><body><h1>${escapeHtml(normalizeCurrency(normalizeText(title || 'LUCY Rapor')))}</h1><main>${markdownToHtml(markdown)}</main><div class="footer">LUCY tarafından hazırlandı</div></body></html>`;
}

async function renderWithPuppeteer({ title, markdown }) {
  let puppeteer;
  try { puppeteer = require('puppeteer'); } catch { return null; }
  let browser = null;
  try {
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'] });
    const page = await browser.newPage();
    await page.setContent(buildHtml({ title, markdown }), { waitUntil: 'networkidle0' });
    await page.emulateMediaType('print');
    return await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: '34px', right: '34px', bottom: '34px', left: '34px' } });
  } catch (error) {
    console.error('[lucy-pdf-render-engine] puppeteer failed:', error?.message || error);
    return null;
  } finally { try { await browser?.close(); } catch {} }
}

function findFont() {
  const candidates = [
    process.env.LUCY_PDF_FONT,
    path.resolve(__dirname, '..', '..', 'fonts', 'DejaVuSans.ttf'),
    path.resolve(__dirname, '..', '..', 'fonts', 'NotoSans-Regular.ttf'),
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
    'C:/Windows/Fonts/segoeui.ttf',
    'C:/Windows/Fonts/arial.ttf',
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  ].filter(Boolean);
  return candidates.find((candidate) => { try { return fs.existsSync(candidate) && fs.statSync(candidate).isFile(); } catch { return false; } });
}

function degradeEmoji(value = '') {
  return normalizeText(value)
    .replace(/❤️‍🔥|❤‍🔥/g, '♥')
    .replace(/[❤♥]/g, '♥')
    .replace(/[🔥💥]/g, '*')
    .replace(/[✅]/g, '✓')
    .replace(/[❌]/g, '×')
    .replace(/[📊📈📉]/g, '[Grafik]')
    .replace(/[📄📝📃]/g, '[Belge]')
    .replace(/[🗜️]/g, '[ZIP]')
    .replace(/[➡️→]/g, '→')
    .replace(/[\u200d\ufe0f]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '•');
}

function renderWithPdfKit({ title, markdown }) {
  return new Promise((resolve) => {
    const chunks = [];
    const doc = new PDFDocument({ margin: 50, size: 'A4', info: { Title: title, Creator: 'LUCY' } });
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    const font = findFont();
    if (font) { doc.registerFont('LucyUnicode', font); doc.font('LucyUnicode'); } else doc.font('Helvetica');
    doc.fontSize(20).text(degradeEmoji(title), { underline: true });
    doc.moveDown(1.2);
    const plain = degradeEmoji(markdown)
      .replace(/```lucy-widget[\s\S]*?```/g, '[Görsel blok PDF motoru için hazırlandı]')
      .replace(/```mermaid[\s\S]*?```/g, '[Mermaid diyagram PDF motoru için hazırlandı]')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/`([^`]+)`/g, '$1');
    doc.fontSize(12).text(plain, { align: 'left', lineGap: 4 });
    doc.end();
  });
}

async function renderPdfBuffer(input = {}) {
  const title = normalizeText(input.title || input.name || input.filename || 'LUCY Rapor');
  const markdown = buildDocumentMarkdown(input);
  if (!markdown) return { error: 'text_required' };
  const htmlBuffer = await renderWithPuppeteer({ title, markdown });
  if (htmlBuffer) return { buffer: htmlBuffer, engine: 'lucy-unified-render-engine-puppeteer', font: 'browser/system emoji fallback' };
  const fallback = await renderWithPdfKit({ title, markdown });
  return { buffer: fallback, engine: 'lucy-unified-render-engine-pdfkit-fallback', font: findFont() || 'Helvetica fallback' };
}

module.exports = {
  normalizeText,
  buildDocumentMarkdown,
  buildHtml,
  markdownToHtml,
  renderPdfBuffer,
  renderChartSvg,
  renderMermaidSvg,
  renderTable,
  extractMermaidNodes,
};
