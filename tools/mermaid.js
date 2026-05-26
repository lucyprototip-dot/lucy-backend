module.exports = {
  name: "mermaid",
  description: "Mermaid diyagram kodunu temizler ve doğrulanabilir metin olarak döndürür",

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

    return {
      success: true,
      type: "mermaid",
      code: cleaned,
    };
  },
};
