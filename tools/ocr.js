const fs = require("fs");
const path = require("path");
const tesseract = require("tesseract.js");

function generatedDir() {
  return process.env.LUCY_GENERATED_DIR || path.resolve(__dirname, "..", "generated");
}

function safeResolveGenerated(name = "") {
  const clean = path.basename(String(name || ""));
  if (!clean) return null;
  const base = path.resolve(generatedDir());
  const full = path.resolve(base, clean);
  if (!full.startsWith(base)) return null;
  return full;
}

function stripDataUrl(value = "") {
  const text = String(value || "").trim();
  const match = text.match(/^data:([^;]+);base64,(.+)$/i);
  return match ? { mimeType: match[1], base64: match[2] } : { mimeType: "", base64: text };
}

function normalizeLang(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return process.env.LUCY_OCR_LANG || "tur+eng";
  if (["tr", "tur", "turkish", "türkçe", "turkce"].includes(raw)) return "tur+eng";
  if (["en", "eng", "english", "ingilizce"].includes(raw)) return "eng";
  return raw.replace(/[^a-z+_-]/g, "") || "tur+eng";
}

function inputToBuffer(input = {}) {
  const dataUrl = input.dataUrl || input.imageDataUrl;
  if (dataUrl) {
    const parsed = stripDataUrl(dataUrl);
    return { buffer: Buffer.from(parsed.base64, "base64"), mimeType: parsed.mimeType };
  }

  const base64 = input.base64 || input.imageBase64 || input.fileBase64;
  if (base64) {
    const parsed = stripDataUrl(base64);
    return { buffer: Buffer.from(parsed.base64, "base64"), mimeType: input.mimeType || parsed.mimeType || "image/png" };
  }

  const storedName = input.storedFilename || input.generatedFile;
  if (storedName) {
    const full = safeResolveGenerated(storedName);
    if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
      const error = new Error("OCR için generated içinde geçerli dosya bulunamadı.");
      error.code = "file_not_found";
      throw error;
    }
    return { buffer: fs.readFileSync(full), mimeType: input.mimeType || "image/png", filename: path.basename(full) };
  }

  const error = new Error("OCR için base64/dataUrl veya generated dosya gerekli.");
  error.code = "base64_required";
  throw error;
}

module.exports = {
  name: "ocr",
  description: "Base64/generate edilmiş görselden OCR metni çıkarır (Tesseract Worker API)",

  async execute(input = {}) {
    let worker = null;
    try {
      const { buffer, mimeType, filename } = inputToBuffer(input);
      if (!buffer?.length) {
        return { success: false, error: "empty_image", message: "OCR için görsel verisi boş." };
      }

      const lang = normalizeLang(input.lang || input.language);
      worker = await tesseract.createWorker(lang);
      const result = await worker.recognize(buffer);
      const text = String(result?.data?.text || "").trim();

      return {
        success: true,
        tool: "ocr",
        type: "text",
        text,
        confidence: result?.data?.confidence ?? null,
        lang,
        mimeType,
        filename,
        message: text ? "OCR metni çıkarıldı." : "OCR tamamlandı ama okunabilir metin bulunamadı.",
      };
    } catch (error) {
      return {
        success: false,
        error: error.code || "ocr_failed",
        message: error.message || "OCR çalıştırılamadı.",
      };
    } finally {
      try { await worker?.terminate?.(); } catch {}
    }
  },
};
