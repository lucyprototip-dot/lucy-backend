function normalizeText(text) {
  return String(text || "").replace(/\r\n/g, "\n").replace(/\t/g, "  ").trim();
}

function limitText(text, maxLength = 120000) {
  const clean = normalizeText(text);
  if (clean.length <= maxLength) return clean;
  return clean.slice(0, maxLength) + "\n\n[NOT: Metin çok uzun olduğu için ilk bölüm alındı.]";
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .map((message) => {
      const role = message?.role === "assistant" || message?.role === "system" ? message.role : "user";
      const rawContent = typeof message?.content === "string"
        ? message.content
        : typeof message?.text === "string"
          ? message.text
          : "";
      const content = normalizeText(rawContent);
      if (!content) return null;
      return { role, content };
    })
    .filter(Boolean);
}

function sanitizeLucyAnswer(text = "") {
  return String(text || "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function createLucyStreamSanitizer() {
  return function sanitizeDelta(delta = "") {
    return String(delta || "");
  };
}

function getLastUserText(messages = []) {
  const normalized = normalizeMessages(messages);
  for (let i = normalized.length - 1; i >= 0; i -= 1) {
    if (normalized[i].role === "user") return normalized[i].content;
  }
  return "";
}

function getRecentUserTexts(messages = [], limit = 8) {
  return normalizeMessages(messages)
    .filter((message) => message.role === "user")
    .slice(-limit)
    .map((message) => message.content);
}

function clampMaxTokens(value, fallback = 1024) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(256, Math.min(16000, Math.round(n)));
}

function fastMaxTokens(body = {}, fallback = 1024) {
  const explicit = body.options?.max_tokens || body.max_tokens;
  if (explicit) return clampMaxTokens(explicit, fallback);

  const last = getLastUserText(body.messages);
  const len = last.length;
  const lower = last.toLowerCase();
  const webOn = body.webSearch === true;

  if (!webOn && len <= 35) return 512;
  if (!webOn && len <= 160) return 1200;

  if (/20\s*sayfa|roman|kitap|senaryo|uzun\s+hikaye|çok\s+uzun|cok\s+uzun/i.test(lower)) return 16000;
  if (/detaylı|detayli|uzun\s+yaz|ayrıntılı|ayrintili|tablo|rapor|listele|analiz/i.test(lower)) return webOn ? 12000 : 8000;

  if (webOn) return 9000;
  if (len <= 500) return 2500;
  return 5000;
}

module.exports = {
  normalizeText,
  limitText,
  normalizeMessages,
  sanitizeLucyAnswer,
  createLucyStreamSanitizer,
  getLastUserText,
  getRecentUserTexts,
  clampMaxTokens,
  fastMaxTokens,
};
