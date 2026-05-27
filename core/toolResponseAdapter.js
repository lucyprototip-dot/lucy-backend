function guessToolResultType(toolName, result = {}) {
  const tool = String(toolName || result.tool || "").toLowerCase();
  const mime = String(result.mimeType || result.contentType || "").toLowerCase();

  if (result.downloadUrl || result.url || result.storedFilename || result.filename || result.base64) {
    if (mime.includes("pdf") || String(result.filename || "").toLowerCase().endsWith(".pdf")) return "file-pdf";
    if (mime.includes("spreadsheet") || String(result.filename || "").match(/\.xlsx?$/i)) return "file-excel";
    if (mime.includes("zip") || String(result.filename || "").match(/\.zip$/i)) return "file-zip";
    if (mime.startsWith("image/") || String(result.filename || "").match(/\.(png|jpe?g|webp|gif|svg)$/i)) return "image";
    return "file";
  }

  if (tool === "chartdata" || result.chartType || result.data?.labels) return "chart";
  if (tool === "mermaid" || result.type === "mermaid" || result.code) return "mermaid";
  if (tool === "qr" || result.qr || result.svg || result.png) return "qr";
  if (tool === "filemanager" || result.type === "file-list" || Array.isArray(result.files)) return "file-list";
  if (tool === "calculator") return "calculation";
  if (tool === "textstats") return "text-stats";
  if (tool === "webfetch") return "web-fetch";
  if (tool === "time") return "time";
  if (tool === "mail") return "mail";
  return "tool";
}

function normalizeToolResultForUI(toolName, result = {}, input = {}) {
  const normalized = result && typeof result === "object" ? { ...result } : { value: result };
  const type = guessToolResultType(toolName, normalized);
  const title = normalized.title || input.title || input.subject || input.filename || input.name || `${toolName} sonucu`;

  return {
    type,
    tool: toolName,
    title,
    success: normalized.success !== false,
    url: normalized.downloadUrl || normalized.url || "",
    downloadUrl: normalized.downloadUrl || normalized.url || "",
    filename: normalized.filename || normalized.downloadName || normalized.storedFilename || "",
    storedFilename: normalized.storedFilename || "",
    mimeType: normalized.mimeType || normalized.contentType || "",
    chartType: normalized.chartType || input.chartType || "bar",
    data: normalized.data || normalized.chartData || null,
    labels: Array.isArray(normalized.labels) ? normalized.labels : undefined,
    values: Array.isArray(normalized.values) ? normalized.values : undefined,
    code: normalized.code || normalized.mermaid || "",
    svg: normalized.svg || "",
    text: normalized.text || normalized.message || "",
    files: Array.isArray(normalized.files) ? normalized.files : undefined,
    headers: Array.isArray(normalized.headers) ? normalized.headers : (Array.isArray(input.headers) ? input.headers : undefined),
    previewRows: Array.isArray(normalized.previewRows) ? normalized.previewRows : undefined,
    rows: normalized.rows,
    columns: normalized.columns,
    entries: Array.isArray(normalized.entries) ? normalized.entries : undefined,
    count: normalized.count,
    raw: normalized,
  };
}

function widgetFence(payload) {
  return `\n\n\`\`\`lucy-widget\n${JSON.stringify(payload)}\n\`\`\``;
}

function summarizeToolResultLine(toolName, ui) {
  if (!ui.success) return `❌ ${toolName}: ${ui.text || ui.raw?.error || "Tool çalışmadı"}`;
  if (ui.downloadUrl) return `✅ ${toolName}: ${ui.downloadUrl}`;
  if (ui.type === "chart") return `✅ ${toolName}: Grafik verisi hazır.`;
  if (ui.type === "mermaid") return `✅ ${toolName}: Mermaid diyagramı hazır.`;
  if (ui.type === "file-list") return `✅ ${toolName}: ${ui.count || ui.files?.length || 0} dosya listelendi.`;
  if (ui.type === "mail") return `✅ ${toolName}: ${ui.text || "Mail işlemi tamamlandı."}`;
  return `✅ ${toolName}: İşlem tamamlandı.`;
}

module.exports = {
  guessToolResultType,
  normalizeToolResultForUI,
  widgetFence,
  summarizeToolResultLine,
};
