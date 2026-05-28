module.exports = {
  name: "textStats",
  description: "Metin için karakter, kelime ve satır istatistikleri çıkarır",

  async execute(input = {}) {
    const text = String(input.text || "");
    const words = text.trim() ? text.trim().split(/\s+/) : [];
    const lines = text ? text.split(/\r?\n/) : [];

    return {
      success: true,
      characters: text.length,
      words: words.length,
      lines: lines.length,
    };
  },
};
