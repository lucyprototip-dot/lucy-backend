const { Parser } = require("json2csv");
const { sanitizeHtmlDocument } = require("../core/securityGuards");

function safeExt(format = "md") {
  const clean = String(format || "md").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["md", "txt", "json", "csv", "html", "docx"].includes(clean)) return clean;
  if (clean === "word" || clean === "doc") return "docx";
  return "md";
}

function mimeFor(format) {
  return {
    md: "text/markdown; charset=utf-8",
    txt: "text/plain; charset=utf-8",
    json: "application/json; charset=utf-8",
    csv: "text/csv; charset=utf-8",
    html: "text/html; charset=utf-8",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }[format] || "text/plain; charset=utf-8";
}

function safeName(name = "lucy-document") {
  return String(name || "lucy-document")
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9ğüşöçıİĞÜŞÖÇ._ -]+/g, "")
    .trim()
    .slice(0, 80) || "lucy-document";
}


function xmlEscape(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function crc32(buffer) {
  let crc = ~0;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

function u16(value) { const b = Buffer.alloc(2); b.writeUInt16LE(value & 0xffff, 0); return b; }
function u32(value) { const b = Buffer.alloc(4); b.writeUInt32LE(value >>> 0, 0); return b; }

function simpleZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data || ""), "utf8");
    const crc = crc32(data);
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data]);
    localParts.push(local);
    const central = Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]);
    centralParts.push(central);
    offset += local.length;
  }
  const central = Buffer.concat(centralParts);
  const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(central.length), u32(offset), u16(0)]);
  return Buffer.concat([...localParts, central, end]);
}

function renderDocxBuffer(input = {}, content = "") {
  const title = xmlEscape(input.title || "LUCY Belgesi");
  const paragraphs = String(content || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(line.replace(/^#{1,6}\s*/, ""))}</w:t></w:r></w:p>`)
    .join("") || `<w:p><w:r><w:t>${title}</w:t></w:r></w:p>`;
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${title}</w:t></w:r></w:p>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  return simpleZip([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: "word/document.xml", data: documentXml },
  ]);
}

function renderContent(input, format) {
  if (format === "json") {
    const value = input.data !== undefined ? input.data : input.content;
    return typeof value === "string" ? value : JSON.stringify(value ?? {}, null, 2);
  }

  if (format === "csv") {
    const rows = Array.isArray(input.rows) ? input.rows : Array.isArray(input.data) ? input.data : [];
    if (!rows.length) return String(input.content || "");
    return new Parser().parse(rows);
  }

  if (format === "docx") {
    return String(input.content || input.text || input.markdown || input.html || "");
  }

  if (format === "html") {
    const title = String(input.title || "LUCY Belgesi")
      .replace(/[<>]/g, "")
      .slice(0, 120);
    const body = sanitizeHtmlDocument(String(input.html || input.content || input.text || ""));
    if (/<!doctype|<html/i.test(body)) return body;
    return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline';"><title>${title}</title></head><body>${body}</body></html>`;
  }

  return String(input.content || input.text || input.markdown || "");
}

module.exports = {
  name: "document",
  description: "Markdown, TXT, JSON, CSV, HTML veya DOCX dosyası oluşturur",

  async execute(input = {}) {
    const format = safeExt(input.format || input.ext || "md");
    const content = renderContent(input, format);
    if (!content.trim()) {
      return { success: false, error: "content_required", message: "Dosya oluşturmak için content/text/data gerekli." };
    }

    const baseName = safeName(input.filename || input.name || "lucy-document").replace(/\.[a-z0-9]+$/i, "");
    return {
      success: true,
      type: "file",
      tool: "document",
      mimeType: mimeFor(format),
      filename: `${baseName}.${format}`,
      base64: (format === "docx" ? renderDocxBuffer(input, content) : Buffer.from(content, "utf8")).toString("base64"),
    };
  },
};
