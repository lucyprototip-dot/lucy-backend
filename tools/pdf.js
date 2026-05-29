const {
  normalizeText,
  renderPdfBuffer,
  renderPdfKitBuffer,
} = require("../core/render/pdfRenderEngine");

function toPdfBuffer(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === "string") return Buffer.from(value, "base64");
  if (value && typeof value === "object") {
    if (typeof value.base64 === "string") return Buffer.from(value.base64, "base64");
    if (typeof value.data === "string") return Buffer.from(value.data, "base64");
    if (Array.isArray(value.data)) return Buffer.from(value.data);
    if (value.buffer) return toPdfBuffer(value.buffer);
  }
  return null;
}

function slugFileName(value = "lucy-rapor", ext = "pdf") {
  const cleanExt = String(ext || "pdf").replace(/^\.+/, "").replace(/[^a-z0-9]+/gi, "").toLowerCase() || "pdf";
  const base = normalizeText(value || "lucy-rapor")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i")
    .replace(/\u0130/g, "I")
    .replace(/\u011f/g, "g")
    .replace(/\u011e/g, "G")
    .replace(/\u015f/g, "s")
    .replace(/\u015e/g, "S")
    .replace(/\u00fc/g, "u")
    .replace(/\u00dc/g, "U")
    .replace(/\u00f6/g, "o")
    .replace(/\u00d6/g, "O")
    .replace(/\u00e7/g, "c")
    .replace(/\u00c7/g, "C")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "lucy-rapor";
  return `${base}.${cleanExt}`;
}


module.exports = {
  name: "pdf",
  description: "Metin, markdown, tablo, grafik ve mermaid diyagramlarını profesyonel PDF raporuna dönüştürür.",

  async execute(input = {}) {
    const title = normalizeText(input.title || input.name || "LUCY Rapor") || "LUCY Rapor";
    const hasText = Boolean(normalizeText(input.text || input.content || input.value || input.markdown || ""));
    const hasRows = Array.isArray(input.rows || input.table?.rows) && (input.rows || input.table.rows).length > 0;
    const hasChart = Boolean(input.chart || input.chartData || input.data?.labels);
    const hasMermaid = Boolean(normalizeText(input.mermaid || input.mermaidCode || input.code || input.diagramCode || ""));
    const hasWidgets = Array.isArray(input.widgets) && input.widgets.length > 0;

    if (!hasText && !hasRows && !hasChart && !hasMermaid && !hasWidgets) {
      return { success: false, error: "content_required", message: "PDF üretmek için metin, tablo, grafik veya mermaid içeriği gerekli." };
    }

    let buffer = null;
    let engine = "puppeteer-unified-html-svg";
    try {
      buffer = toPdfBuffer(await renderPdfBuffer({ ...input, title }));
    } catch (error) {
      console.error("[lucy-pdf] unified renderer failed:", error?.message || error);
    }
    if (!buffer) {
      engine = "pdfkit-safe-fallback";
      buffer = toPdfBuffer(await renderPdfKitBuffer({ ...input, title }));
    }

    if (!buffer) {
      return {
        success: false,
        error: "pdf_buffer_failed",
        message: "PDF motoru çıktı üretemedi.",
      };
    }

    const filename = input.filename || slugFileName(title || "lucy-rapor", "pdf");
    return {
      success: true,
      type: "file",
      tool: "pdf",
      mimeType: "application/pdf",
      filename,
      base64: buffer.toString("base64"),
      engine,
      message: "PDF hazırlandı.",
    };
  },
};
