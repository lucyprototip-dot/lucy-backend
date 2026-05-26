const qr = require("qr-image");

module.exports = {
  name: "qr",
  description: "Metin veya URL için QR kod PNG üretir",

  async execute(input = {}) {
    const text = String(input.text || input.url || "").trim();

    if (!text) {
      return {
        success: false,
        error: "text_required",
        message: "QR üretmek için text veya url gerekli.",
      };
    }

    const png = qr.imageSync(text, { type: "png", margin: 2, size: 8 });

    return {
      success: true,
      mimeType: "image/png",
      filename: input.filename || "lucy-qr.png",
      base64: png.toString("base64"),
    };
  },
};
