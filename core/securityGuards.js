const dns = require("dns").promises;
const net = require("net");

function envBool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function envInt(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isPrivateIpv4(ip) {
  const parts = String(ip).split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIpv6(ip) {
  const value = String(ip).toLowerCase();
  if (value === "::1" || value === "::") return true;
  if (value.startsWith("fc") || value.startsWith("fd")) return true;
  if (value.startsWith("fe80:")) return true;
  if (value.startsWith("ff")) return true;
  return false;
}

function isPrivateIp(ip) {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateIpv4(ip);
  if (version === 6) return isPrivateIpv6(ip);
  return true;
}

function isDangerousHostname(hostname = "") {
  const host = String(hostname || "").trim().toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "metadata.google.internal") return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (net.isIP(host)) return isPrivateIp(host);
  return false;
}

async function assertPublicHttpUrl(rawUrl = "") {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || "").trim());
  } catch {
    const error = new Error("Geçerli http/https URL gerekli.");
    error.code = "valid_url_required";
    throw error;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    const error = new Error("Sadece http/https URL kullanılabilir.");
    error.code = "unsupported_protocol";
    throw error;
  }

  if (parsed.username || parsed.password) {
    const error = new Error("URL içinde kullanıcı adı/şifre kabul edilmez.");
    error.code = "url_credentials_blocked";
    throw error;
  }

  if (isDangerousHostname(parsed.hostname)) {
    const error = new Error("Güvenlik nedeniyle private/local hedeflere istek yapılamaz.");
    error.code = "private_url_blocked";
    throw error;
  }

  const records = await dns.lookup(parsed.hostname, { all: true, verbatim: true });
  if (!records.length || records.some((record) => isPrivateIp(record.address))) {
    const error = new Error("URL public IP adresine çözülmüyor.");
    error.code = "private_url_blocked";
    throw error;
  }

  return parsed.toString();
}

function sanitizeGeneratedName(name = "") {
  const clean = String(name || "").replace(/[\\/]+/g, "").replace(/^\.+/, "").trim();
  if (!clean || clean.length > 180) return null;
  return clean;
}

function generatedContentDisposition(filename = "lucy-output.bin") {
  const safe = sanitizeGeneratedName(filename) || "lucy-output.bin";
  const lower = safe.toLowerCase();
  const inlineSafe = /\.(png|jpe?g|webp|gif|pdf|txt|md|csv|json)$/i.test(lower);
  // HTML, SVG/XML ve JS benzeri dosyalar inline açılmasın; download olarak gelsin.
  // SVG tarayıcıda script/event payload taşıyabildiği için image gibi inline servis edilmez.
  if (/\.(html?|xhtml|xml|svg|svgz|js|mjs)$/i.test(lower)) return `attachment; filename="${safe.replace(/"/g, "")}"`;
  return `${inlineSafe ? "inline" : "attachment"}; filename="${safe.replace(/"/g, "")}"`;
}

function uploadStatusForError(error) {
  if (!error) return 500;
  if (error.code === "LIMIT_FILE_SIZE") return 413;
  if (error.code && String(error.code).startsWith("LIMIT_")) return 400;
  if (error.code === "unsupported_file_type") return 415;
  return 400;
}

function isAllowedUploadMime(mime = "", originalName = "") {
  const type = String(mime || "").toLowerCase();
  const name = String(originalName || "").toLowerCase();
  if (type.startsWith("image/") || type.startsWith("text/")) return true;
  const allowed = new Set([
    "application/pdf",
    "application/json",
    "application/xml",
    "application/zip",
    "application/x-zip-compressed",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/msword",
    "application/vnd.ms-excel",
    "text/csv",
    "text/markdown",
  ]);
  if (allowed.has(type)) return true;
  return /\.(txt|md|csv|json|jsonl|pdf|docx?|xlsx?|png|jpe?g|webp|gif|bmp|tiff?|zip)$/i.test(name);
}

function sanitizeHtmlDocument(html = "") {
  return String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object\b[\s\S]*?<\/object>/gi, "")
    .replace(/<embed\b[\s\S]*?<\/embed>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript\s*:/gi, "");
}

module.exports = {
  envBool,
  envInt,
  assertPublicHttpUrl,
  generatedContentDisposition,
  isAllowedUploadMime,
  uploadStatusForError,
  sanitizeGeneratedName,
  sanitizeHtmlDocument,
};
