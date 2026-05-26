const archiverModule = require("archiver");
const createArchiver = typeof archiverModule === "function" ? archiverModule : (archiverModule.default || archiverModule.archiver);
const fs = require("fs");
const path = require("path");

function generatedDir() {
  return process.env.LUCY_GENERATED_DIR || path.resolve(__dirname, "..", "generated");
}

function safeName(name = "lucy-file.txt") {
  const clean = String(name || "lucy-file.txt")
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9ğüşöçıİĞÜŞÖÇ._ -]+/g, "")
    .trim()
    .slice(0, 120);
  return clean || "lucy-file.txt";
}

function safeResolveGenerated(name = "") {
  const clean = path.basename(String(name || ""));
  if (!clean) return null;
  const base = path.resolve(generatedDir());
  const full = path.resolve(base, clean);
  if (!full.startsWith(base)) return null;
  return full;
}

module.exports = {
  name: "zip",
  description: "Metin/base64/generate edilmiş dosyalardan ZIP arşivi oluşturur",

  async execute(input = {}) {
    const files = Array.isArray(input.files) ? input.files : [];
    if (!files.length) {
      return { success: false, error: "files_required", message: "ZIP oluşturmak için files dizisi gerekli." };
    }

    const validFiles = [];
    files.forEach((file, index) => {
      if (!file || typeof file !== "object") return;
      const filename = safeName(file.filename || file.name || file.storedFilename || `lucy-file-${index + 1}.txt`);

      if (file.storedFilename || file.generatedFile) {
        const full = safeResolveGenerated(file.storedFilename || file.generatedFile);
        if (full && fs.existsSync(full) && fs.statSync(full).isFile()) {
          validFiles.push({ kind: "path", full, filename: filename || path.basename(full) });
        }
        return;
      }

      if (file.base64) {
        validFiles.push({ kind: "buffer", buffer: Buffer.from(String(file.base64), "base64"), filename });
        return;
      }

      const content = String(file.content || file.text || "");
      if (content) validFiles.push({ kind: "buffer", buffer: Buffer.from(content, "utf8"), filename });
    });

    if (!validFiles.length) {
      return { success: false, error: "no_valid_files", message: "ZIP için geçerli dosya bulunamadı." };
    }

    const chunks = [];
    if (typeof createArchiver !== "function") {
      return { success: false, error: "archiver_unavailable", message: "archiver modülü fonksiyon olarak yüklenemedi." };
    }

    const archive = createArchiver("zip", { zlib: { level: 9 } });

    return await new Promise((resolve) => {
      archive.on("data", (chunk) => chunks.push(chunk));
      archive.on("error", (error) => resolve({ success: false, error: "zip_failed", message: error.message }));
      archive.on("end", () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          success: true,
          type: "file",
          tool: "zip",
          mimeType: "application/zip",
          filename: input.filename || "lucy-files.zip",
          base64: buffer.toString("base64"),
          count: validFiles.length,
        });
      });

      validFiles.forEach((file) => {
        if (file.kind === "path") archive.file(file.full, { name: file.filename || path.basename(file.full) });
        else archive.append(file.buffer, { name: file.filename });
      });

      archive.finalize();
    });
  },
};
