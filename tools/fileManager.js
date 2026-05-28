const fs = require("fs");
const path = require("path");

const READABLE_EXTENSIONS = new Set([".txt", ".md", ".json", ".jsonl", ".csv", ".log", ".xml", ".yaml", ".yml", ".html", ".htm", ".css", ".js", ".jsx", ".ts", ".tsx", ".sql", ".sh", ".ps1"]);

function envBool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return ["1", "true", "yes", "on", "acik", "aktif"].includes(String(raw).trim().toLowerCase());
}

function generatedDir() {
  return process.env.LUCY_GENERATED_DIR || path.resolve(__dirname, "..", "generated");
}

function publicBase() {
  return String(process.env.LUCY_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || process.env.RAILWAY_PUBLIC_DOMAIN || "").replace(/\/$/, "");
}

function ensureDir() {
  fs.mkdirSync(generatedDir(), { recursive: true });
}

function safeResolve(name = "") {
  const clean = path.basename(String(name || ""));
  if (!clean) return null;
  const base = path.resolve(generatedDir());
  const full = path.resolve(base, clean);
  if (!full.startsWith(base)) return null;
  return full;
}


function cleanReadableText(text = "") {
  return String(text || "")
    .replace(/LUCY_FILE_REF\s+storedFilename=[^\n]+/gi, "")
    .replace(/```lucy-widget[\s\S]*?```/gi, "")
    .replace(/\{\s*"tool_call"\s*:\s*\{[\s\S]*?\}\s*\}/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toUrl(name) {
  const base = publicBase();
  if (!base) return `/generated/${encodeURIComponent(name)}`;
  const withProtocol = /^https?:\/\//i.test(base) ? base : `https://${base}`;
  return `${withProtocol}/generated/${encodeURIComponent(name)}`;
}

function listFiles() {
  ensureDir();
  return fs.readdirSync(generatedDir())
    .map((name) => {
      const full = path.join(generatedDir(), name);
      const stat = fs.statSync(full);
      if (!stat.isFile()) return null;
      return {
        name,
        storedFilename: name,
        size: stat.size,
        createdAt: stat.birthtime?.toISOString?.() || stat.mtime.toISOString(),
        updatedAt: stat.mtime.toISOString(),
        url: toUrl(name),
        downloadUrl: toUrl(name),
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

module.exports = {
  name: "fileManager",
  description: "Generated dosyalarını listeler, okur veya güvenli şekilde siler",

  async execute(input = {}) {
    const action = String(input.action || "list").toLowerCase();

    if (action === "list") {
      const files = listFiles();
      return { success: true, type: "file-list", count: files.length, files };
    }

    if (action === "read") {
      const full = safeResolve(input.filename || input.storedFilename || input.name);
      if (!full || !fs.existsSync(full)) return { success: false, error: "file_not_found", message: "Dosya bulunamadı." };
      const stat = fs.statSync(full);
      if (stat.size > 1024 * 1024) return { success: false, error: "file_too_large", message: "1MB üstü dosya sohbet içinde okunmaz; indirilebilir link kullan." };
      const ext = path.extname(full).toLowerCase();
      if (!READABLE_EXTENSIONS.has(ext)) {
        return {
          success: false,
          error: "binary_read_blocked",
          message: "Bu dosya tipi sohbet içinde metin gibi okunmaz. Lütfen indirme linkini kullan veya uygun dönüştürme tool'u çalıştır.",
          filename: path.basename(full),
        };
      }
      return { success: true, filename: path.basename(full), text: cleanReadableText(fs.readFileSync(full, "utf8")) };
    }

    if (action === "delete") {
      if (!envBool("LUCY_ENABLE_FILE_DELETE", false)) {
        return {
          success: false,
          error: "delete_disabled",
          message: "Güvenlik nedeniyle generated dosya silme kapalı. Açmak için LUCY_ENABLE_FILE_DELETE=true ayarlanmalı.",
        };
      }
      const full = safeResolve(input.filename || input.storedFilename || input.name);
      if (!full || !fs.existsSync(full)) return { success: false, error: "file_not_found", message: "Dosya bulunamadı." };
      fs.unlinkSync(full);
      return { success: true, deleted: path.basename(full) };
    }

    return { success: false, error: "unknown_action", message: "Geçerli action: list, read, delete." };
  },
};
