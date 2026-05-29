const {
  readLucyStore,
  writeLucyStore,
  normalizeUserId,
  DEFAULT_USER_ID,
} = require("../services/lucyStoreService");

function requestUserId(req) {
  return normalizeUserId(
    req?.headers?.["x-lucy-user-id"] ||
    req?.headers?.["x-user-id"] ||
    req?.query?.userId ||
    req?.query?.user ||
    req?.body?.userId ||
    req?.body?.user ||
    DEFAULT_USER_ID
  );
}

function requestChatId(body = {}) {
  return String(
    body.chatId ||
    body.activeChatId ||
    body.currentChatId ||
    body.conversationId ||
    body.threadId ||
    body.activeChat?.id ||
    ""
  ).trim();
}

function messageText(message = {}) {
  return String(message.content || message.text || message.message || "").trim();
}

function normalizeRole(role = "") {
  const value = String(role || "").toLowerCase();
  if (value === "assistant" || value === "system") return value;
  return "user";
}

function toApiMessage(message = {}) {
  const content = messageText(message);
  if (!content) return null;
  return { role: normalizeRole(message.role || message.sender), content };
}

function appendUniqueMessage(target = [], message = null, seen = new Set()) {
  if (!message?.content) return;
  const key = `${message.role}:${message.content}`;
  if (seen.has(key)) return;
  seen.add(key);
  target.push(message);
}

function clampText(value = "", max = 30000) {
  const text = String(value || "");
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 160)).trim()}\n\n[Kalıcı hafıza bağlamı çok uzun olduğu için bu turda ilk bölüm kısaltıldı. Tam kayıt backend store içinde korunuyor.]`;
}

function chatUpdatedAt(chat = {}) {
  return Number(chat.updatedAt || chat.createdAt || 0);
}

function buildPersistentArchiveContext(store = {}, activeChatId = "") {
  const maxChars = Number(process.env.LUCY_PERSISTENT_CONTEXT_MAX_CHARS || 30000);
  const chats = Array.isArray(store.chats) ? [...store.chats] : [];
  if (!chats.length) return "";

  const ordered = chats
    .sort((a, b) => chatUpdatedAt(a) - chatUpdatedAt(b))
    .map((chat, index) => {
      const title = String(chat?.title || `Sohbet ${index + 1}`).trim();
      const prefix = chat?.id === activeChatId ? "AKTIF SOHBET" : `SOHBET ${index + 1}`;
      const lines = Array.isArray(chat?.messages) ? chat.messages
        .map(toApiMessage)
        .filter(Boolean)
        .map((message) => `${message.role === "assistant" ? "LUCY" : message.role === "system" ? "SISTEM" : "KULLANICI"}: ${message.content}`)
        : [];
      return [`[${prefix}: ${title}]`, ...lines].join("\n");
    })
    .join("\n\n---\n\n");

  return clampText(ordered, maxChars);
}

function augmentRequestWithPersistentMemory(req) {
  const body = req.body || {};
  if (body.__lucyPersistentAugmented) return;

  try {
    const userId = requestUserId(req);
    const chatId = requestChatId(body);
    const store = readLucyStore(userId);
    const chats = Array.isArray(store.chats) ? store.chats : [];
    const activeChat = chats.find((chat) => String(chat?.id || "") === chatId);
    const seen = new Set();
    const mergedMessages = [];

    for (const message of activeChat?.messages || []) appendUniqueMessage(mergedMessages, toApiMessage(message), seen);
    for (const message of body.messages || []) appendUniqueMessage(mergedMessages, toApiMessage(message), seen);
    if (mergedMessages.length) body.messages = mergedMessages;

    const archiveContext = buildPersistentArchiveContext(store, chatId);
    const existingSystemHint = String(body.systemHint || "").trim();
    const globalMemory = String(body.memory?.global || body.globalMemory || "").trim();
    const storedMemory = String(store.memory || "").trim();
    body.memory = {
      ...(body.memory && typeof body.memory === "object" ? body.memory : {}),
      global: [globalMemory, storedMemory].filter(Boolean).join("\n\n"),
    };
    body.__lucyPersistentToolMessages = chats
      .flatMap((chat) => Array.isArray(chat?.messages) ? chat.messages : [])
      .slice(-Number(process.env.LUCY_PERSISTENT_TOOL_MESSAGE_MAX || 1000));

    if (archiveContext) {
      body.systemHint = [
        existingSystemHint,
        "KALICI LUCY HAFIZA AKTIF: Aşağıdaki arşiv aynı kullanıcının sohbet geçmişidir. Aktif sohbeti ve eski sohbetleri bağlam olarak kullan. Tool çıktıları, dosya referansları ve önceki kararlar dahil unutma. Çelişki varsa en yeni tarihli/aktif sohbet bilgisini önceliklendir.",
        archiveContext,
      ].filter(Boolean).join("\n\n");
    }

    body.__lucyPersistentUserId = userId;
    body.__lucyPersistentChatId = chatId;
    body.__lucyPersistentAugmented = true;
    req.body = body;
  } catch (error) {
    console.warn("Lucy kalıcı hafıza okunamadı:", error.message);
  }
}

function persistChatTurn(req, answer = "", toolPayload = {}) {
  try {
    const body = req.body || {};
    const userId = body.__lucyPersistentUserId || requestUserId(req);
    const chatId = body.__lucyPersistentChatId || requestChatId(body) || `chat-${Date.now()}`;
    const store = readLucyStore(userId);
    const now = Date.now();
    const chats = Array.isArray(store.chats) ? [...store.chats] : [];
    const index = chats.findIndex((chat) => String(chat?.id || "") === chatId);
    const existing = index >= 0 ? chats[index] : { id: chatId, title: body.chatTitle || "Lucy sohbet", messages: [], createdAt: now };
    const seen = new Set();
    const messages = [];
    const addStoredMessage = (message = {}) => {
      const apiMessage = toApiMessage(message);
      if (!apiMessage?.content) return;
      const key = `${apiMessage.role}:${apiMessage.content}`;
      if (seen.has(key)) return;
      seen.add(key);
      messages.push({
        ...message,
        role: apiMessage.role,
        content: apiMessage.content,
        text: message.text || apiMessage.content,
      });
    };

    for (const message of existing.messages || []) addStoredMessage(message);
    for (const message of body.messages || []) addStoredMessage(message);

    const assistantMessage = {
      role: "assistant",
      content: String(answer || "").trim(),
      text: String(answer || "").trim(),
      toolCalls: Array.isArray(toolPayload.toolCalls) ? toolPayload.toolCalls : [],
      toolResults: Array.isArray(toolPayload.toolResults) ? toolPayload.toolResults : [],
      createdAt: now,
    };
    addStoredMessage(assistantMessage);

    const savedChat = {
      ...existing,
      id: chatId,
      title: existing.title || body.chatTitle || "Lucy sohbet",
      updatedAt: now,
      messages,
    };

    if (index >= 0) chats[index] = savedChat;
    else chats.unshift(savedChat);
    writeLucyStore({ ...store, chats, activeChatId: chatId }, userId);
  } catch (error) {
    console.warn("Lucy kalıcı hafıza yazılamadı:", error.message);
  }
}

function registerChatRoutes(app, deps) {
  const {
    isWebMode,
    buildLiveWebBody,
    writeSse,
    askDeepSeekStream,
    answerLiveWebIfNeeded,
    askDeepSeek,
    executeToolCallsFromAnswer,
    pickDeepSeekModel,
  } = deps;

  app.post("/api/chat-stream", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    try {
      const body = req.body || {};
      augmentRequestWithPersistentMemory(req);

      if (isWebMode(req.body || {})) {
        // Web açıkken bile kullanıcı PDF/TXT/ZIP/Excel/QR gibi gerçek tool işi istiyorsa
        // live-web cevap motoruna gitmeden deterministic tool engine çalışsın.
        // Böylece ham tool_call JSON görünmez ve son dosya hafızası ezilmez.
        const directToolPayload = await executeToolCallsFromAnswer("", req);
        if (directToolPayload.toolCalls?.length) {
          persistChatTurn(req, directToolPayload.finalAnswer, directToolPayload);
          if (directToolPayload.finalAnswer) writeSse(res, { delta: directToolPayload.finalAnswer });
          writeSse(res, {
            done: true,
            answer: directToolPayload.finalAnswer,
            toolCalls: directToolPayload.toolCalls,
            toolResults: directToolPayload.toolResults,
            provider: "tool-engine",
          });
          return res.end();
        }

        const liveWeb = await buildLiveWebBody(req.body || {});
        if (liveWeb.instantAnswer) {
          persistChatTurn(req, liveWeb.instantAnswer, {});
          writeSse(res, { delta: liveWeb.instantAnswer });
          writeSse(res, { done: true, answer: liveWeb.instantAnswer, provider: "live-web" });
          return res.end();
        }

        await askDeepSeekStream(liveWeb.requestBody, res, req);
        return res.end();
      }

      const liveAnswer = await answerLiveWebIfNeeded(req.body || {});
      if (liveAnswer) {
        persistChatTurn(req, liveAnswer, {});
        writeSse(res, { delta: liveAnswer });
        writeSse(res, { done: true, answer: liveAnswer, provider: "live-web" });
        return res.end();
      }

      const streamedAnswer = await askDeepSeekStream(req.body || {}, res, req);
      persistChatTurn(req, streamedAnswer, req.__lucyLastToolPayload || {});
      return res.end();
    } catch (error) {
      writeSse(res, { error: error.message || "Stream hatası" });
      return res.end();
    }
  });

  app.post("/api/chat", async (req, res) => {
    try {
      augmentRequestWithPersistentMemory(req);
      if (isWebMode(req.body || {})) {
        const directToolPayload = await executeToolCallsFromAnswer("", req);
        if (directToolPayload.toolCalls?.length) {
          persistChatTurn(req, directToolPayload.finalAnswer, directToolPayload);
          return res.json({
            success: true,
            provider: "tool-engine",
            answer: directToolPayload.finalAnswer,
            toolCalls: directToolPayload.toolCalls,
            toolResults: directToolPayload.toolResults,
          });
        }
      }

      const liveAnswer = await answerLiveWebIfNeeded(req.body || {});
      if (liveAnswer) {
        persistChatTurn(req, liveAnswer, {});
        return res.json({ success: true, provider: "live-web", model: "google-duckduckgo-deepseek", answer: liveAnswer });
      }

      const answer = await askDeepSeek(req.body || {});
      const toolPayload = await executeToolCallsFromAnswer(answer, req);
      persistChatTurn(req, toolPayload.finalAnswer, toolPayload);
      res.json({
        success: true,
        provider: "deepseek",
        model: pickDeepSeekModel(req.body || {}),
        answer: toolPayload.finalAnswer,
        toolCalls: toolPayload.toolCalls,
        toolResults: toolPayload.toolResults,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

module.exports = registerChatRoutes;
