const { normalizeToolOutput } = require("./toolOutputContract");

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
  const contracted = normalizeToolOutput(toolName, normalized, input);
  const guessedType = guessToolResultType(toolName, normalized);
  const type = /^file(?:-|$)/.test(guessedType) ? guessedType : (contracted.type === "chart" || contracted.type === "mermaid" ? contracted.type : guessedType);
  const title = contracted.title || normalized.title || input.title || input.subject || input.filename || input.name || `${toolName} sonucu`;

  return {
    type,
    tool: toolName,
    title,
    success: contracted.success !== false,
    url: contracted.downloadUrl || contracted.url || normalized.downloadUrl || normalized.url || "",
    downloadUrl: contracted.downloadUrl || contracted.url || normalized.downloadUrl || normalized.url || "",
    filename: contracted.filename || normalized.filename || normalized.downloadName || normalized.storedFilename || "",
    storedFilename: contracted.storedFilename || normalized.storedFilename || "",
    mimeType: contracted.mimeType || normalized.mimeType || normalized.contentType || "",
    chartType: contracted.chartType || normalized.chartType || input.chartType || "bar",
    data: contracted.data || normalized.data || normalized.chartData || null,
    code: contracted.code || normalized.code || normalized.mermaid || "",
    text: contracted.text || normalized.text || normalized.message || "",
    time: contracted.time || normalized.time || normalized.datetime || normalized.dateTime || "",
    date: contracted.date || normalized.date || "",
    timeZone: contracted.timeZone || normalized.timeZone || input.timeZone || "",
    locale: contracted.locale || normalized.locale || input.locale || "",
    confidence: contracted.confidence ?? normalized.confidence,
    lang: contracted.lang || normalized.lang || input.lang || input.language || "",
    colors: contracted.colors || normalized.colors || normalized.palette || normalized.style?.colors || [],
    palette: contracted.palette || normalized.paletteName || normalized.palette || normalized.style?.palette || "default",
    style: contracted.style || normalized.style || {},
    files: Array.isArray(normalized.files) ? normalized.files : undefined,
    headers: Array.isArray(normalized.headers) ? normalized.headers : (Array.isArray(input.headers) ? input.headers : undefined),
    previewRows: Array.isArray(normalized.previewRows) ? normalized.previewRows : undefined,
    rows: normalized.rows,
    columns: normalized.columns,
    entries: Array.isArray(normalized.entries) ? normalized.entries : undefined,
    count: normalized.count,
    // raw saklanır ama UI'nın raw JSON'u metin gibi basmaması için güvenli kontrat da eklenir.
    raw: { ...normalized, __contracted: contracted },
  };
}

function widgetFence(payload) {
  return `\n\n\`\`\`lucy-widget\n${JSON.stringify(payload)}\n\`\`\``;
}

function summarizeToolResultLine(toolName, ui) {
  if (!ui.success) return `❌ ${toolName}: ${ui.text || ui.raw?.error || "Tool çalışmadı"}`;
  if (ui.downloadUrl) return `✅ ${toolName}: ${ui.downloadUrl}`;
  if (ui.type === "chart") return `✅ ${ui.title || toolName}: Grafik hazır.`;
  if (ui.type === "mermaid") return `✅ ${ui.title || toolName}: Mermaid diyagramı hazır.`;
  if (ui.type === "file-list") return `✅ ${toolName}: ${ui.count || ui.files?.length || 0} dosya listelendi.`;
  if (ui.type === "time") return `✅ ${toolName}: ${ui.text || ui.time || "Saat bilgisi hazır."}`;
  if (ui.type === "ocr") return `✅ ${toolName}: ${ui.text || "OCR tamamlandı."}`;
  if (ui.type === "mail") return `✅ ${toolName}: ${ui.text || "Mail işlemi tamamlandı."}`;
  return `✅ ${toolName}: İşlem tamamlandı.`;
}

module.exports = {
  guessToolResultType,
  normalizeToolResultForUI,
  widgetFence,
  summarizeToolResultLine,
};
