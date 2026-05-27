// LUCY Tool Render Guard
// Amaç: Aynı tool sonucunun aynı cevapta iki kere basılmasını, raw JSON/code sızıntısını
// ve boş/yanlış widget tekrarlarını engellemek.
// SRC / PDF / Lucy Exporter'a dokunmaz.

function stableString(value) {
  try {
    return JSON.stringify(value, Object.keys(value || {}).sort());
  } catch {
    return String(value || "");
  }
}

function compactText(text = "") {
  return String(text || "")
    .replace(/```lucy-widget\s*[\s\S]*?```/gi, "")
    .replace(/```json\s*[\s\S]*?```/gi, "")
    .replace(/```mermaid\s*[\s\S]*?```/gi, "")
    .replace(/\{\s*"(?:type|tool|success|raw|code|data)"\s*:[\s\S]*?\}/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderKeyForUi(ui = {}) {
  const type = String(ui.type || ui.tool || "tool").toLowerCase();
  const title = String(ui.title || "").trim().toLowerCase();

  if (ui.downloadUrl || ui.url || ui.filename || ui.storedFilename) {
    return `file:${ui.downloadUrl || ui.url || ui.filename || ui.storedFilename}`;
  }

  if (type === "chart") {
    const chartType = String(ui.chartType || "bar").toLowerCase();
    const labels = ui.data?.labels || ui.raw?.data?.labels || ui.raw?.chartData?.labels || [];
    const values = ui.data?.datasets?.[0]?.data || ui.raw?.values || [];
    const palette = ui.palette || ui.style?.palette || stableString(ui.colors || []);
    return `chart:${chartType}:${title}:${stableString({ labels, values, palette })}`;
  }

  if (type === "mermaid") {
    const code = String(ui.code || ui.raw?.code || ui.raw?.mermaid || "").replace(/\s+/g, " ").trim();
    return `mermaid:${title}:${code.slice(0, 1200)}`;
  }

  return `${type}:${title}:${stableString({ text: ui.text, data: ui.data, code: ui.code }).slice(0, 1200)}`;
}

function shouldRenderUi(ui = {}, seen = new Set()) {
  if (!ui || typeof ui !== "object") return false;
  const key = renderKeyForUi(ui);
  if (!key || seen.has(key)) return false;
  seen.add(key);
  return true;
}

function cleanSummaryLine(line = "") {
  const clean = compactText(line);
  if (!clean) return "";
  // Sadece raw mermaid/json kalıntısı varsa kullanıcıya basma.
  if (/^\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|pie\s+title)\b/i.test(clean)) return "";
  if (/^\s*[{}\[\],:]+\s*$/.test(clean)) return "";
  return clean;
}

module.exports = {
  compactText,
  renderKeyForUi,
  shouldRenderUi,
  cleanSummaryLine,
};
