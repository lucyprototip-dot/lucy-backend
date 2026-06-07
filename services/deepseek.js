const { envValue } = require("../core/env");
const { buildSystemPrompt } = require("../core/prompt");
const { pickDeepSeekModel, wantsDeepSeekThinking } = require("../core/models");
const {
  normalizeMessages,
  sanitizeLucyAnswer,
  createLucyStreamSanitizer,
  clampMaxTokens,
} = require("../utils/text");

async function callDeepSeek(payload, apiKey) {
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}


function looksLikeInternalAnswer(text = "") {
  const value = String(text || "").toLowerCase();
  if (!value.trim()) return true;
  return (
    value.includes("kullanıcı ") && value.includes("sormuş") ||
    value.includes("yanıt verirken") ||
    value.includes("cevap verirken") ||
    value.includes("web arama kapalı ama açık") ||
    value.includes("hadi bakalım") && value.includes("doğru ve güncel")
  );
}

async function retryFinalAnswer(basePayload, apiKey) {
  const retryPayload = {
    ...basePayload,
    stream: false,
    max_tokens: Math.min(Number(basePayload.max_tokens || 1024), 1200),
    messages: [
      ...basePayload.messages,
      { role: "user", content: "Önceki yanıtın iç analiz gibi oldu. Sadece kullanıcıya verilecek nihai cevabı kısa, net ve Türkçe yaz. İç plan, analiz, gerekçe yazma." }
    ]
  };
  const { response, data } = await callDeepSeek(retryPayload, apiKey);
  if (!response.ok) return "";
  return sanitizeLucyAnswer(data?.choices?.[0]?.message?.content || "");
}

async function askDeepSeek(body = {}) {
  const deepSeekKey = envValue("DEEPSEEK_API_KEY") || envValue("DEEPSEEK_API_KEY_ALT");
  if (!deepSeekKey) throw new Error("DEEPSEEK_API_KEY Railway Variables içinde yok.");

  const cleanMessages = normalizeMessages(body.messages);
  if (!cleanMessages.length) throw new Error("DeepSeek'e gönderilecek geçerli mesaj yok");

  const model = pickDeepSeekModel(body);
  const thinkingEnabled = wantsDeepSeekThinking(body);
  const temperature = Number(body.options?.temperature ?? (thinkingEnabled ? 0.55 : 0.45));
  const maxTokens = clampMaxTokens(body.options?.max_tokens || body.max_tokens || body._lucyPlan?.max_tokens, 1024);

  const finalMessages = [{ role: "system", content: buildSystemPrompt(body) }, ...cleanMessages];
  const basePayload = { model, messages: finalMessages, temperature, max_tokens: maxTokens, stream: false };
  const payload = thinkingEnabled ? { ...basePayload, thinking: { type: "enabled" }, enable_thinking: true } : basePayload;

  let { response, data } = await callDeepSeek(payload, deepSeekKey);
  if (!response.ok && thinkingEnabled) {
    const message = String(data?.error?.message || data?.message || "").toLowerCase();
    if (response.status === 400 || message.includes("thinking") || message.includes("enable_thinking")) {
      ({ response, data } = await callDeepSeek(basePayload, deepSeekKey));
    }
  }

  if (!response.ok) throw new Error(data?.error?.message || data?.message || `DeepSeek API hatası: ${response.status}`);
  const choiceMessage = data?.choices?.[0]?.message || {};
  let answer = sanitizeLucyAnswer(choiceMessage.content || "");
  if (looksLikeInternalAnswer(answer)) {
    const retry = await retryFinalAnswer(basePayload, deepSeekKey);
    if (retry && !looksLikeInternalAnswer(retry)) answer = retry;
  }
  return answer || "Cevap üretemedim.";
}

function extractDeepSeekStreamDelta(data = {}) {
  const choice = data?.choices?.[0] || {};
  const delta = choice.delta || {};
  const message = choice.message || {};
  return delta.content || message.content || "";
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function askDeepSeekStream(body = {}, res) {
  const deepSeekKey = envValue("DEEPSEEK_API_KEY") || envValue("DEEPSEEK_API_KEY_ALT");
  if (!deepSeekKey) throw new Error("DEEPSEEK_API_KEY Railway Variables içinde yok.");

  const cleanMessages = normalizeMessages(body.messages);
  if (!cleanMessages.length) throw new Error("DeepSeek'e gönderilecek geçerli mesaj yok");

  const thinkingEnabled = wantsDeepSeekThinking(body);
  const model = pickDeepSeekModel(body);
  const temperature = Number(body.options?.temperature ?? (thinkingEnabled ? 0.55 : 0.42));
  const maxTokens = clampMaxTokens(body.options?.max_tokens || body.max_tokens || body._lucyPlan?.max_tokens, 1024);
  const finalMessages = [{ role: "system", content: buildSystemPrompt(body) }, ...cleanMessages];

  const basePayload = { model, messages: finalMessages, temperature, max_tokens: maxTokens, stream: true };
  const payload = thinkingEnabled ? { ...basePayload, thinking: { type: "enabled" }, enable_thinking: true } : basePayload;

  async function callStream(requestPayload) {
    return fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${deepSeekKey}` },
      body: JSON.stringify(requestPayload),
    });
  }

  let response = await callStream(payload);
  if (!response.ok && thinkingEnabled) response = await callStream(basePayload);
  if (!response.ok) {
    const errorData = await response.json().catch(async () => ({ message: await response.text().catch(() => "") }));
    throw new Error(errorData?.error?.message || errorData?.message || `DeepSeek stream API hatası: ${response.status}`);
  }

  const reader = response.body?.getReader?.();
  if (!reader) throw new Error("DeepSeek stream gövdesi okunamadı.");

  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let fullAnswer = "";
  const sanitizeDelta = createLucyStreamSanitizer();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith(":")) continue;
      if (!line.startsWith("data:")) continue;
      const payloadText = line.replace(/^data:\s*/, "");
      if (payloadText === "[DONE]") {
        writeSse(res, { done: true, answer: fullAnswer });
        return fullAnswer;
      }
      try {
        const json = JSON.parse(payloadText);
        const delta = extractDeepSeekStreamDelta(json);
        const cleanDelta = sanitizeDelta(delta);
        if (cleanDelta) {
          fullAnswer += cleanDelta;
          writeSse(res, { delta: cleanDelta });
        }
      } catch {}
    }
  }

  writeSse(res, { done: true, answer: fullAnswer });
  return fullAnswer;
}

module.exports = { askDeepSeek, askDeepSeekStream, writeSse };
