const { sanitizeMermaidCode } = require("../core/safeMermaidBuilder");

module.exports = {
  name: "mermaid",
  description: "Mermaid diyagram kodunu güvenli şekilde temizler ve UI için standart döndürür",

  async execute(input = {}) {
    const raw = String(input.code || input.mermaid || input.text || "").trim();

    if (!raw) {
      return {
        success: false,
        error: "mermaid_code_required",
        message: "Mermaid kodu boş olamaz.",
      };
    }

    const cleaned = sanitizeMermaidCode(raw, input.userText || input.prompt || input.title || "");

    if (!cleaned) {
      return {
        success: false,
        error: "mermaid_code_invalid",
        message: "Mermaid kodu güvenli diyagrama çevrilemedi.",
      };
    }

    return {
      success: true,
      type: "mermaid",
      title: input.title || "Mermaid diyagram",
      code: cleaned,
    };
  },
};
