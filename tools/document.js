const { Parser } = require("json2csv");

function safeExt(format = "md") {
  const clean = String(format || "md").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["md", "txt", "json", "csv", "html"].includes(clean)) return clean;
  return "md";
}

function mimeFor(format) {
  return {
    md: "text/markdown; charset=utf-8",
    txt: "text/plain; charset=utf-8",
    json: "application/json; charset=utf-8",
    csv: "text/csv; charset=utf-8",
    html: "text/html; charset=utf-8",
  }[format] || "text/plain; charset=utf-8";
}

function safeName(name = "lucy-document") {
  return String(name || "lucy-document")
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9ğüşöçıİĞÜŞÖÇ._ -]+/g, "")
    .trim()
    .slice(0, 80) || "lucy-document";
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

  if (format === "html") {
    const title = String(input.title || "LUCY Belgesi");
    const body = String(input.html || input.content || input.text || "");
    if (/<!doctype|<html/i.test(body)) return body;
    return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
  }

  return String(input.content || input.text || input.markdown || "");
}

module.exports = {
  name: "document",
  description: "Markdown, TXT, JSON, CSV veya HTML dosyası oluşturur",

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
      base64: Buffer.from(content, "utf8").toString("base64"),
    };
  },
};
