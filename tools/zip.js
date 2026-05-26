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
    const normalized = [];
    const directFiles = Array.isArray(input.files) ? input.files : [];
    directFiles.forEach((file) => normalized.push(file));

    const fileUrls = Array.isArray(input.fileUrls) ? input.fileUrls : [];
    fileUrls.forEach((url, index) => {
      normalized.push({ url, filename: (Array.isArray(input.files) && input.files[index]) || undefined });
    });

    const files = normalized;
    if (!files.length) {
      return { success: false, error: "files_required", message: "ZIP oluşturmak için files dizisi gerekli." };
    }

    const chunks = [];
    if (typeof createArchiver !== "function") {
      return { success: false, error: "archiver_unavailable", message: "archiver modülü fonksiyon olarak yüklenemedi." };
    }

    const archive = createArchiver("zip", { zlib: { level: 9 } });
    let appended = 0;

    function storedNameFromUrl(value = "") {
      try {
        const parsed = new URL(String(value));
        const marker = "/generated/";
        const index = parsed.pathname.indexOf(marker);
        if (index >= 0) return decodeURIComponent(parsed.pathname.slice(index + marker.length));
      } catch {}
      const match = String(value || "").match(/\/generated\/([^?#\s"')]+)/i);
      return match ? decodeURIComponent(match[1]) : "";
    }

    return await new Promise((resolve) => {
      archive.on("data", (chunk) => chunks.push(chunk));
      archive.on("error", (error) => resolve({ success: false, error: "zip_failed", message: error.message }));
      archive.on("end", () => {
        if (!appended) {
          resolve({ success: false, error: "no_valid_files", message: "ZIP için geçerli dosya bulunamadı." });
          return;
        }
        const buffer = Buffer.concat(chunks);
        resolve({
          success: true,
          type: "file",
          tool: "zip",
          mimeType: "application/zip",
          filename: input.filename || "lucy-files.zip",
          base64: buffer.toString("base64"),
          count: appended,
        });
      });

      files.forEach((file, index) => {
        if (!file) return;
        const objectFile = typeof file === "object" ? file : { filename: String(file), storedFilename: String(file) };
        let filename = safeName(objectFile.filename || objectFile.name || `lucy-file-${index + 1}.txt`);

        const possibleStored = objectFile.storedFilename || objectFile.generatedFile || storedNameFromUrl(objectFile.url || objectFile.downloadUrl || objectFile.fileUrl || "");
        if (possibleStored) {
          const full = safeResolveGenerated(possibleStored);
          if (full && fs.existsSync(full) && fs.statSync(full).isFile()) {
            if (!objectFile.filename && !objectFile.name) filename = path.basename(full).replace(/^\d+-/, "") || path.basename(full);
            archive.file(full, { name: safeName(filename || path.basename(full)) });
            appended += 1;
          }
          return;
        }

        if (objectFile.base64) {
          archive.append(Buffer.from(String(objectFile.base64), "base64"), { name: filename });
          appended += 1;
          return;
        }

        const content = objectFile.content ?? objectFile.text;
        if (content !== undefined && content !== null && String(content).length) {
          archive.append(String(content), { name: filename });
          appended += 1;
        }
      });

      archive.finalize();
    });
  },
};
