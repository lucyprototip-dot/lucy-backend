const { normalizeMessages } = require("../utils/text");

const SESSION_TTL_MS = 1000 * 60 * 60 * 6;
const MAX_MESSAGES = 8;
const sessions = new Map();

function sessionKey(req, body = {}) {
  return String(
    body.sessionId ||
    body.conversationId ||
    body.chatId ||
    body.threadId ||
    req.headers["x-lucy-session"] ||
    req.headers["x-session-id"] ||
    req.ip ||
    "default"
  );
}

function compact(messages = []) {
  const out = [];
  for (const message of normalizeMessages(messages)) {
    const last = out[out.length - 1];
    if (last && last.role === message.role && last.content === message.content) continue;
    out.push(message);
  }
  return out.slice(-MAX_MESSAGES);
}

function getStored(req, body = {}) {
  const key = sessionKey(req, body);
  const item = sessions.get(key);
  if (!item) return [];
  if (Date.now() - item.updatedAt > SESSION_TTL_MS) {
    sessions.delete(key);
    return [];
  }
  return item.messages || [];
}

function save(req, body = {}, messages = []) {
  const key = sessionKey(req, body);
  sessions.set(key, { updatedAt: Date.now(), messages: compact(messages) });
}

function shouldIgnoreStoredForThisMessage(messages = []) {
  const incoming = normalizeMessages(messages);
  const lastUser = [...incoming].reverse().find((message) => message.role === "user")?.content || "";
  const value = String(lastUser || "").toLowerCase().trim();
  if (!value) return false;
  return /^(aşkım|askim|nasılsın|nasilsin|merhaba|selam|tamam|ok|boşver|bosver|sohbet edelim|seni özledim|seni ozledim|sikişken|arsız)/i.test(value);
}

function withServerContext(req, body = {}) {
  const incoming = normalizeMessages(body.messages);
  if (shouldIgnoreStoredForThisMessage(incoming)) {
    return { ...body, messages: incoming };
  }
  const stored = getStored(req, body);
  const merged = compact([...stored, ...incoming]);
  return { ...body, messages: merged };
}

function cleanAssistantMemory(text = "") {
  let value = String(text || "").trim();
  value = value.replace(/\n\s*Kaynaklar\s*:[\s\S]*$/i, "").trim();
  value = value.replace(/\n\s*Kaynak URL'?leri\s*:[\s\S]*$/i, "").trim();
  value = value.replace(/https?:\/\/\S+/gi, "").trim();
  return value.slice(0, 1200);
}

function rememberExchange(req, originalBody = {}, assistantText = "", options = {}) {
  const stored = getStored(req, originalBody);
  const incoming = normalizeMessages(originalBody.messages);
  const lastUser = [...incoming].reverse().find((message) => message.role === "user");
  const add = [];
  if (lastUser) add.push(lastUser);

  // Web cevapları kaynak/context taşır. Normal sohbet hafızasına web kaynaklarını sokma.
  if (!options.web && assistantText) {
    const clean = cleanAssistantMemory(assistantText);
    if (clean) add.push({ role: "assistant", content: clean });
  }

  save(req, originalBody, [...stored, ...add]);
}

module.exports = { withServerContext, rememberExchange };
