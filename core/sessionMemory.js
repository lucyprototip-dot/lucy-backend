const { normalizeMessages } = require("../utils/text");

const SESSION_TTL_MS = 1000 * 60 * 60 * 6;
const MAX_MESSAGES = 14;
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

function withServerContext(req, body = {}) {
  const incoming = normalizeMessages(body.messages);
  const stored = getStored(req, body);
  const merged = compact([...stored, ...incoming]);
  return { ...body, messages: merged };
}

function rememberExchange(req, originalBody = {}, assistantText = "") {
  const stored = getStored(req, originalBody);
  const incoming = normalizeMessages(originalBody.messages);
  const lastUser = [...incoming].reverse().find((message) => message.role === "user");
  const add = [];
  if (lastUser) add.push(lastUser);
  if (assistantText) add.push({ role: "assistant", content: String(assistantText).slice(0, 4000) });
  save(req, originalBody, [...stored, ...add]);
}

module.exports = { withServerContext, rememberExchange };
