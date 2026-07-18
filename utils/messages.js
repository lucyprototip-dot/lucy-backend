function normalizeText(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map((message) => {
    const role = ["system", "user", "assistant"].includes(message?.role) ? message.role : "user";
    const content = normalizeText(typeof message?.content === "string" ? message.content : message?.text);
    return content ? { role, content } : null;
  }).filter(Boolean);
}

function getRequestedMaxTokens(body, fallback) {
  const value = Number(body?.options?.max_tokens ?? body?.max_tokens);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(128, Math.min(384000, Math.round(value)));
}

module.exports = { normalizeText, normalizeMessages, getRequestedMaxTokens };
