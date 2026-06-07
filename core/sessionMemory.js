const { normalizeMessages, cleanAssistantContext } = require("../utils/text");

const SESSION_TTL_MS = 1000 * 60 * 60 * 6;
const MAX_MESSAGES = 10;
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

function emptyItem() {
  return { updatedAt: Date.now(), chatMessages: [], webMessages: [] };
}

function getItem(req, body = {}) {
  const key = sessionKey(req, body);
  const item = sessions.get(key);
  if (!item) return emptyItem();
  if (Date.now() - item.updatedAt > SESSION_TTL_MS) {
    sessions.delete(key);
    return emptyItem();
  }
  return {
    updatedAt: item.updatedAt,
    chatMessages: item.chatMessages || item.messages || [],
    webMessages: item.webMessages || [],
  };
}

function saveItem(req, body = {}, item = emptyItem()) {
  const key = sessionKey(req, body);
  sessions.set(key, {
    updatedAt: Date.now(),
    chatMessages: compact(item.chatMessages || []),
    webMessages: compact(item.webMessages || []),
  });
}

function lastUserText(messages = []) {
  return [...normalizeMessages(messages)].reverse().find((m) => m.role === "user")?.content || "";
}

function isCasualReset(text = "") {
  const value = String(text || "").toLowerCase().trim();
  if (!value) return false;
  return /^(aşkım|askim|nasılsın|nasilsin|merhaba|selam|boşver|bosver|siktiret|sohbet edelim|sohbete devam|seni özledim|seni ozledim|sikişken|arsız)/i.test(value);
}

function withServerContext(req, body = {}) {
  const incoming = normalizeMessages(body.messages);
  const item = getItem(req, body);
  const webOn = body.webSearch === true || body.webSearch === "true" || body.webSearch === 1 || body.webSearch === "1";
  const lastUser = lastUserText(incoming);

  if (webOn) {
    // Web açıkken sadece web takip bağlamı + gelen mesajlar. Normal sohbet kaynakları karışmaz.
    return { ...body, messages: compact([...item.webMessages, ...incoming]) };
  }

  if (isCasualReset(lastUser)) {
    // Normal sohbet anında web bağlamını tamamen dışarıda bırak.
    return { ...body, messages: incoming };
  }

  return { ...body, messages: compact([...item.chatMessages, ...incoming]) };
}

function cleanAssistantMemory(text = "") {
  return cleanAssistantContext(text).slice(0, 1200);
}

function rememberExchange(req, originalBody = {}, assistantText = "", options = {}) {
  const item = getItem(req, originalBody);
  const incoming = normalizeMessages(originalBody.messages);
  const lastUser = [...incoming].reverse().find((message) => message.role === "user");
  const lastText = lastUser?.content || "";

  if (options.web || options.webPending) {
    const add = [];
    if (lastUser) add.push(lastUser);
    // Web assistant cevabını normal sohbete sokma; sadece kısa, kaynak temizli web takip bağlamında tut.
    if (options.web && assistantText) {
      const clean = cleanAssistantMemory(assistantText);
      if (clean) add.push({ role: "assistant", content: clean });
    }
    saveItem(req, originalBody, { ...item, webMessages: compact([...item.webMessages, ...add]) });
    return;
  }

  // Sohbete dönüşte web bağlamını sıfırla.
  const clearWeb = isCasualReset(lastText);
  const add = [];
  if (lastUser) add.push(lastUser);
  if (assistantText) {
    const clean = cleanAssistantMemory(assistantText);
    if (clean) add.push({ role: "assistant", content: clean });
  }
  saveItem(req, originalBody, {
    chatMessages: compact([...item.chatMessages, ...add]),
    webMessages: clearWeb ? [] : item.webMessages,
  });
}

module.exports = { withServerContext, rememberExchange };
