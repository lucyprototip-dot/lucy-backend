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

function crc32(buffer) {
  let crc = ~0;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: dosDate };
}

function u16(value) { const b = Buffer.alloc(2); b.writeUInt16LE(value & 0xffff, 0); return b; }
function u32(value) { const b = Buffer.alloc(4); b.writeUInt32LE(value >>> 0, 0); return b; }

function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const now = dosDateTime();

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data || ""), "utf8");
    const crc = crc32(data);

    const localHeader = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(now.time), u16(now.date),
      u32(crc), u32(data.length), u32(data.length), u16(nameBuffer.length), u16(0), nameBuffer,
    ]);
    localParts.push(localHeader, data);

    const centralHeader = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(now.time), u16(now.date),
      u32(crc), u32(data.length), u32(data.length), u16(nameBuffer.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), nameBuffer,
    ]);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const central = Buffer.concat(centralParts);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(central.length), u32(offset), u16(0),
  ]);
  return Buffer.concat([...localParts, central, end]);
}

module.exports = {
  name: "zip",
  description: "Metin/base64/generate edilmiş dosyalardan ZIP arşivi oluşturur",

  async execute(input = {}) {
    const files = Array.isArray(input.files) ? input.files : [];
    if (!files.length) {
      return { success: false, error: "files_required", message: "ZIP oluşturmak için files dizisi gerekli." };
    }

    const entries = [];
    files.forEach((file, index) => {
      if (!file || typeof file !== "object") return;
      const filename = safeName(file.filename || file.name || `lucy-file-${index + 1}.txt`);

      if (file.storedFilename || file.generatedFile) {
        const full = safeResolveGenerated(file.storedFilename || file.generatedFile);
        if (full && fs.existsSync(full) && fs.statSync(full).isFile()) {
          entries.push({ name: filename || path.basename(full), data: fs.readFileSync(full) });
        }
        return;
      }

      if (file.base64) {
        entries.push({ name: filename, data: Buffer.from(String(file.base64), "base64") });
        return;
      }

      entries.push({ name: filename, data: String(file.content || file.text || "") });
    });

    if (!entries.length) {
      return { success: false, error: "zip_empty", message: "ZIP için geçerli dosya bulunamadı." };
    }

    const buffer = createZip(entries);
    return {
      success: true,
      type: "file",
      tool: "zip",
      mimeType: "application/zip",
      filename: input.filename || "lucy-dosyalari.zip",
      base64: buffer.toString("base64"),
      count: entries.length,
    };
  },
};
