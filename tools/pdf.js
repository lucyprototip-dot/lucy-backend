const {
  normalizeText,
  slugFileName,
  renderPdfBuffer,
  renderPdfKitBuffer,
} = require("../core/render/pdfRenderEngine");

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
      buffer = await renderPdfBuffer({ ...input, title });
    } catch (error) {
      console.error("[lucy-pdf] unified renderer failed:", error?.message || error);
    }
    if (!buffer) {
      engine = "pdfkit-safe-fallback";
      buffer = await renderPdfKitBuffer({ ...input, title });
    }

    const filename = input.filename || slugFileName(title || "lucy-rapor", "pdf");
    return {
      success: true,
      type: "file",
      tool: "pdf",
      mimeType: "application/pdf",
      filename,
      base64: Buffer.from(buffer).toString("base64"),
      engine,
      message: "PDF hazırlandı.",
    };
  },
};
