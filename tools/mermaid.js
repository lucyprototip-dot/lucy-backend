let sanitizeMermaidCode;
try {
  ({ sanitizeMermaidCode } = require("../core/safeMermaidBuilder"));
} catch {
  sanitizeMermaidCode = null;
}

function fallbackSanitizeMermaid(raw = "") {
  let code = String(raw || "")
    .replace(/^```mermaid\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  // En azından Mermaid başlangıcı yoksa flowchart içine alma.
  if (code && !/^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie)\b/i.test(code)) {
    const safe = code.replace(/[\[\]{}<>|]/g, " ").replace(/\s+/g, " ").slice(0, 80) || "LUCY";
    code = `flowchart TD\n A["${safe}"]`;
  }
  return code;
}

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

    const cleaned = typeof sanitizeMermaidCode === "function"
      ? sanitizeMermaidCode(raw, input.userText || input.prompt || input.title || "")
      : fallbackSanitizeMermaid(raw);

    if (!String(cleaned || "").trim()) {
      return {
        success: false,
        error: "mermaid_code_invalid",
        message: "Mermaid kodu güvenli diyagrama çevrilemedi.",
      };
    }

    return {
      success: true,
      type: "mermaid",
      tool: "mermaid",
      title: input.title || "Mermaid diyagram",
      code: cleaned,
    };
  },
};
