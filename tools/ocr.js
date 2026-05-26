const tesseract = require("tesseract.js");

module.exports = {
  name: "ocr",
  description: "Base64 görselden OCR metni çıkarmayı dener",

  async execute(input = {}) {
    const base64 = String(input.base64 || "").trim();
    const lang = input.lang || "eng";

    if (!base64) {
      return {
        success: false,
        error: "base64_required",
        message: "OCR için base64 görsel gerekli.",
      };
    }

    try {
      const buffer = Buffer.from(base64, "base64");
      const result = await tesseract.recognize(buffer, lang);

      return {
        success: true,
        text: result.data.text,
        confidence: result.data.confidence,
      };
    } catch (error) {
      return {
        success: false,
        error: "ocr_failed",
        message: error.message,
      };
    }
  },
};
