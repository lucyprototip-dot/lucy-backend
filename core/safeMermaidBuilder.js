const { normalizeToolIntentText, detectColorPalette } = require('./intentNormalizer');

const DEFAULT_COLORS = ['#2563eb', '#16a34a', '#f97316', '#9333ea', '#dc2626', '#0891b2'];

function cleanLabel(value = '') {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\[\]{}<>|]/g, ' ')
    .replace(/["`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 72) || 'Değer';
}

function escapeNodeLabel(value = '') {
  return cleanLabel(value).replace(/\\/g, '\\\\');
}

function colorText(hex = '') {
  const h = String(hex || '').replace('#', '').trim();
  if (h.length !== 6) return '#ffffff';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b);
  return luminance > 180 ? '#111827' : '#ffffff';
}

function paletteFromText(userText = '') {
  const detected = detectColorPalette(userText);
  if (detected?.requested && Array.isArray(detected.colors) && detected.colors.length) return detected.colors;
  return DEFAULT_COLORS;
}

function removeInvalidMermaidLines(code = '') {
  return String(code || '')
    .replace(/^```mermaid\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      // Model bazen açıklama/JSON veya geçersiz renk isimleri basıyor; bunları diagramdan çıkar.
      if (/^\{/.test(t) || /^"?(type|tool|raw|success|code)"?\s*:/.test(t)) return false;
      if (/fill\s*:\s*(rainbow|colorful|renkli|random)/i.test(t)) return false;
      if (/stroke\s*:\s*(rainbow|colorful|renkli|random)/i.test(t)) return false;
      return true;
    })
    .join('\n')
    .trim();
}

function normalizeMermaidHeader(code = '') {
  const clean = removeInvalidMermaidLines(code);
  if (!clean) return '';
  if (/^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie)\b/i.test(clean.trim())) return clean;
  return `flowchart TD\n${clean}`;
}

function applyPaletteToFlowchart(code = '', userText = '') {
  const normalized = normalizeMermaidHeader(code);
  if (!normalized || !/^(flowchart|graph)\b/i.test(normalized.trim())) return normalized;

  const text = normalizeToolIntentText(userText);
  const wantsStyle = /renk|renkli|sari|lacivert|beyaz|siyah|neon|premium|modern|tema|style/.test(text);
  if (!wantsStyle && /classDef\s+/i.test(normalized)) return normalized;

  const colors = paletteFromText(userText);
  const lines = normalized.split(/\r?\n/);
  const hasClassDefs = lines.some((line) => /^\s*classDef\s+/i.test(line));
  if (hasClassDefs) return normalized;

  const classDefs = colors.slice(0, 6).map((color, index) => (
    `classDef lucy${index + 1} fill:${color},stroke:#111827,stroke-width:2px,color:${colorText(color)}`
  ));

  // Mermaid class atamalarını sade tutuyoruz. Yanlış node yakalarsa diagram bozulmasın diye sadece classDef ekliyoruz.
  return [lines[0], ...classDefs, ...lines.slice(1)].join('\n');
}

function buildFlowchartFromPairs({ title = 'LUCY Şeması', labels = [], values = [], userText = '' } = {}) {
  const colors = paletteFromText(userText);
  const rootColor = colors[0] || '#2563eb';
  const lines = [
    'flowchart TD',
    `classDef root fill:${rootColor},stroke:#111827,stroke-width:3px,color:${colorText(rootColor)}`,
  ];

  colors.slice(0, 6).forEach((color, index) => {
    lines.push(`classDef lucy${index + 1} fill:${color},stroke:#111827,stroke-width:2px,color:${colorText(color)}`);
  });

  lines.push(`A["${escapeNodeLabel(title)}"]:::root`);
  labels.slice(0, 14).forEach((label, index) => {
    const value = values[index];
    const body = value === undefined || value === null || value === ''
      ? escapeNodeLabel(label)
      : `${escapeNodeLabel(label)}\\n${escapeNodeLabel(value)}`;
    lines.push(`A --> N${index + 1}["${body}"]:::lucy${(index % Math.min(colors.length, 6)) + 1}`);
  });
  return lines.join('\n');
}

function buildPieMermaid({ title = 'Dağılım', labels = [], values = [] } = {}) {
  const safeTitle = cleanLabel(title);
  const lines = [`pie title ${safeTitle}`];
  labels.slice(0, 16).forEach((label, index) => {
    const num = Number(values[index]);
    if (!Number.isFinite(num)) return;
    lines.push(`  "${cleanLabel(label)}" : ${num}`);
  });
  return lines.join('\n');
}

function sanitizeMermaidCode(code = '', userText = '') {
  const text = normalizeToolIntentText(userText);
  let clean = normalizeMermaidHeader(code);
  if (!clean) return '';

  // “mermaid pasta” niyetinde flowchart yerine pie kodu geldiyse dokunma; pie zaten Mermaid tarafından desteklenir.
  if (/^pie\b/i.test(clean.trim())) return clean;

  clean = applyPaletteToFlowchart(clean, userText);

  // Çok uzun/ham model çıktısı diagramı bozmasın.
  const maxLines = /detay|ayrinti|ayrıntı|genis|geniş/i.test(text) ? 120 : 80;
  return clean.split(/\r?\n/).slice(0, maxLines).join('\n').trim();
}

module.exports = {
  cleanLabel,
  sanitizeMermaidCode,
  buildFlowchartFromPairs,
  buildPieMermaid,
  paletteFromText,
};
