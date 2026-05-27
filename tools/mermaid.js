function escapeXml(value = "") {
  return String(value || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function cleanMermaidLabel(value = "") {
  return String(value || "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[\[({]+|[\])}]+$/g, "")
    .replace(/^['"]|['"]$/g, "")
    .replace(/\\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64) || "Adım";
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

  if (!nodeLabels.size) ["Başla", "İşlem", "Bitti"].forEach((label, index) => nodeLabels.set(`N${index}`, label));
  return { ids: Array.from(nodeLabels.keys()).slice(0, 18), labels: nodeLabels, edges };
}

function buildMermaidSvg(code = "", title = "Mermaid Şema") {
  const parsed = parseMermaidFlow(code);
  const ids = parsed.ids;
  const width = 760;
  const nodeW = 440;
  const nodeH = 54;
  const gap = 34;
  const height = Math.max(180, 84 + ids.length * (nodeH + gap));
  const x = (width - nodeW) / 2;
  const yFor = (index) => 70 + index * (nodeH + gap);
  const indexById = new Map(ids.map((id, index) => [id, index]));
  const edgeSet = new Set(parsed.edges.map(([a, b]) => `${a}->${b}`));
  if (!edgeSet.size) for (let i = 0; i < ids.length - 1; i += 1) edgeSet.add(`${ids[i]}->${ids[i + 1]}`);

  const arrows = Array.from(edgeSet).map((key) => {
    const [from, to] = key.split("->");
    const a = indexById.get(from);
    const b = indexById.get(to);
    if (a === undefined || b === undefined || a === b) return "";
    const y1 = yFor(a) + nodeH;
    const y2 = yFor(b);
    const cx = width / 2;
    return `<path d="M ${cx} ${y1 + 4} C ${cx} ${y1 + 20}, ${cx} ${y2 - 20}, ${cx} ${y2 - 4}" fill="none" stroke="#64748b" stroke-width="2.5" marker-end="url(#arrow)"/>`;
  }).join("");

  const nodes = ids.map((id, index) => {
    const y = yFor(index);
    const fill = index === 0 ? "#111827" : "#ffffff";
    const stroke = index === 0 ? "#111827" : "#64748b";
    const color = index === 0 ? "#ffffff" : "#0f172a";
    const label = escapeXml(parsed.labels.get(id) || id);
    return `<rect x="${x}" y="${y}" width="${nodeW}" height="${nodeH}" rx="15" fill="${fill}" stroke="${stroke}" stroke-width="2"/><text x="${width / 2}" y="${y + 34}" text-anchor="middle" font-size="18" font-weight="800" fill="${color}">${label}</text>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="760" height="${height}" rx="18" fill="#f8fafc"/><text x="28" y="38" font-size="22" font-weight="900" fill="#111827">${escapeXml(title)}</text><defs><marker id="arrow" markerWidth="12" markerHeight="12" refX="9" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#64748b"/></marker></defs>${arrows}${nodes}</svg>`;
}

module.exports = {
  name: "mermaid",
  description: "Mermaid diyagram kodunu temizler, doğrular ve PDF/önizleme için SVG üretir",

  async execute(input = {}) {
    const code = String(input.code || input.mermaid || "").trim();

    if (!code) {
      return {
        success: false,
        error: "mermaid_code_required",
        message: "Mermaid kodu boş olamaz.",
      };
    }

    const cleaned = code
      .replace(/^```mermaid/i, "")
      .replace(/^```/i, "")
      .replace(/```$/i, "")
      .trim();

    const title = input.title || "Mermaid Şema";

    return {
      success: true,
      type: "mermaid",
      tool: "mermaid",
      title,
      code: cleaned,
      svg: buildMermaidSvg(cleaned, title),
      message: "Mermaid kodu temizlendi ve SVG önizleme hazırlandı.",
    };
  },
};
