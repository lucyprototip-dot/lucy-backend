const { normalizeText, renderPdfBuffer } = require('../core/render/pdfRenderEngine');

module.exports = {
  name: 'pdf',
  description: 'Markdown, tablo, grafik, Mermaid, emoji ve sohbet içeriğinden profesyonel PDF üretir',

  async execute(input = {}) {
    const title = normalizeText(input.title || input.name || input.filename || 'LUCY Rapor');
    const rendered = await renderPdfBuffer({ ...input, title });

    if (rendered.error || !rendered.buffer) {
      return {
        success: false,
        error: rendered.error || 'pdf_render_failed',
        message: 'PDF üretmek için text/content/markdown, tablo, grafik veya mermaid içeriği gerekli.',
      };
    }

    return {
      success: true,
      type: 'file',
      tool: 'pdf',
      mimeType: 'application/pdf',
      filename: input.filename || `${title.replace(/[^a-z0-9ğüşöçıİĞÜŞÖÇ-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'lucy-rapor'}.pdf`,
      base64: Buffer.from(rendered.buffer).toString('base64'),
      engine: rendered.engine,
      font: rendered.font,
      message: 'PDF hazırlandı.',
    };
  },
};
