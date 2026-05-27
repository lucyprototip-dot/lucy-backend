const { normalizeText, renderMermaidSvg } = require('../core/render/pdfRenderEngine');

function cleanMermaid(code = '') {
  return normalizeText(code)
    .replace(/^```\s*mermaid\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

module.exports = {
  name: 'mermaid',
  description: 'Mermaid diyagram kodunu temizler, doğrular ve PDF uyumlu SVG önizleme üretir',

  async execute(input = {}) {
    const code = cleanMermaid(input.code || input.mermaid || input.text || '');

    if (!code) {
      return {
        success: false,
        error: 'mermaid_code_required',
        message: 'Mermaid kodu boş olamaz.',
      };
    }

    return {
      success: true,
      type: 'mermaid',
      tool: 'mermaid',
      title: input.title || 'Mermaid diyagram',
      code,
      svg: renderMermaidSvg(code, input.title || 'Mermaid diyagram'),
      message: 'Mermaid diyagram hazırlandı.',
    };
  },
};
