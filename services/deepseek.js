const { env, envNumber } = require("../core/env");
const { resolveMode } = require("../core/models");
const { buildSystemPrompt } = require("../core/prompt");
const { normalizeMessages, getRequestedMaxTokens } = require("../utils/messages");

const BASE_URL = env("DEEPSEEK_BASE_URL", "https://api.deepseek.com").replace(/\/$/, "");
const TIMEOUT_MS = envNumber("LUCY_REQUEST_TIMEOUT_MS", 120000);

function getApiKey() {
  const key = env("DEEPSEEK_API_KEY") || env("DEEPSEEK_API_KEY_ALT");
  if (!key) throw new Error("DEEPSEEK_API_KEY Render Environment içinde tanımlı değil.");
  return key;
}

function buildPayload(body = {}, stream = false) {
  const mode = resolveMode(body);
  const messages = normalizeMessages(body.messages).filter((message) => message.role !== "system");
  if (!messages.length) throw new Error("Gönderilecek geçerli kullanıcı mesajı yok.");

  const payload = {
    model: mode.model,
    messages: [{ role: "system", content: buildSystemPrompt(body) }, ...messages],
    thinking: { type: mode.thinking ? "enabled" : "disabled" },
    max_tokens: getRequestedMaxTokens(body, mode.defaultMaxTokens),
    stream
  };

  if (mode.thinking && mode.reasoningEffort) payload.reasoning_effort = mode.reasoningEffort;
  if (!mode.thinking) payload.temperature = 0.6;
  if (stream) payload.stream_options = { include_usage: true };
  return { mode, payload };
}

async function requestDeepSeek(payload, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener?.("abort", abort, { once: true });
  try {
    return await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: payload.stream ? "text/event-stream" : "application/json",
        Authorization: `Bearer ${getApiKey()}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", abort);
  }
}

async function apiError(response) {
  const raw = await response.text().catch(() => "");
  try { return JSON.parse(raw)?.error?.message || raw; } catch { return raw; }
}

async function askDeepSeek(body = {}, signal) {
  const { mode, payload } = buildPayload(body, false);
  const response = await requestDeepSeek(payload, signal);
  if (!response.ok) throw new Error((await apiError(response)) || `DeepSeek API hatası: ${response.status}`);
  const data = await response.json();
  const answer = String(data?.choices?.[0]?.message?.content || "").trim();
  if (!answer) throw new Error("DeepSeek boş cevap döndürdü.");
  return { answer, model: data?.model || mode.model, mode: mode.id, finishReason: data?.choices?.[0]?.finish_reason || null, usage: data?.usage || null };
}

function writeSse(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function streamDeepSeek(body = {}, res, signal) {
  const { mode, payload } = buildPayload(body, true);
  const response = await requestDeepSeek(payload, signal);
  if (!response.ok) throw new Error((await apiError(response)) || `DeepSeek API hatası: ${response.status}`);
  if (!response.body) throw new Error("DeepSeek stream gövdesi alınamadı.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  let finishReason = null;
  let usage = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const text = line.slice(5).trim();
      if (!text || text === "[DONE]") continue;
      try {
        const chunk = JSON.parse(text);
        usage = chunk?.usage || usage;
        finishReason = chunk?.choices?.[0]?.finish_reason || finishReason;
        const delta = chunk?.choices?.[0]?.delta?.content;
        if (delta) { answer += delta; writeSse(res, { delta }); }
      } catch {}
    }
  }

  writeSse(res, { done: true, answer, provider: "deepseek", model: mode.model, mode: mode.id, finishReason, usage });
}

module.exports = { askDeepSeek, streamDeepSeek, writeSse };
