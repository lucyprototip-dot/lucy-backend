const { envValue } = require("../core/env");
const { buildSystemPrompt } = require("../core/prompt");
const { pickDeepSeekModel, wantsDeepSeekThinking } = require("../core/models");
const { buildDebugMetadata, logPromptDebug } = require("../core/payloadDebug");
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
    value.includes("hadi bakalım") && value.includes("doğru ve güncel") ||
    value.startsWith("merhaba, kullanıcı") ||
    value.includes("kullanıcıya") && value.includes("söylemeliyim") ||
    value.includes("yanıtımda") && value.includes("kaynak")
  );
}

async function retryFinalAnswer(basePayload, apiKey, debugContext = {}) {
  const retryPayload = {
    ...basePayload,
    stream: false,
    max_tokens: Math.min(Number(basePayload.max_tokens || 1024), 1200),
    messages: [
      ...basePayload.messages,
      { role: "user", content: "Önceki yanıtın iç analiz gibi oldu. Sadece kullanıcıya verilecek nihai cevabı kısa, net ve Türkçe yaz. İç plan, analiz, gerekçe yazma." }
    ]
  };
  logPromptDebug(buildDebugMetadata({
    ...debugContext,
    payload: retryPayload,
    stream: false,
    event: "deepseek.retry_payload",
    extra: { retryFinalAnswer: true },
  }));
  const { response, data } = await callDeepSeek(retryPayload, apiKey);
  if (!response.ok) return "";
  return sanitizeLucyAnswer(data?.choices?.[0]?.message?.content || "");
}

const LENGTH_CONTINUE_LIMIT = Math.max(0, Math.min(Number(process.env.LUCY_LENGTH_CONTINUE_LIMIT || 2), 4));

function buildDeepSeekPayload({ model, messages, temperature, maxTokens, stream }) {
  const payload = { model, messages, max_tokens: maxTokens, stream };
  if (!String(model || "").toLowerCase().includes("reasoner")) payload.temperature = temperature;
  return payload;
}

function getFinishReason(data = {}) {
  return data?.choices?.[0]?.finish_reason || data?.choices?.[0]?.finishReason || "";
}

function buildLengthContinuationMessages(messages = [], answer = "") {
  return [
    ...messages,
    { role: "assistant", content: String(answer || "").slice(-12000) },
    { role: "user", content: "Cevabın token sınırında kesildi. Kaldığın yerden devam et; tekrar başa dönme." },
  ];
}

async function continueAnswerIfLength(basePayload, apiKey, firstAnswer = "", firstFinishReason = "", debugContext = {}) {
  let answer = firstAnswer;
  let finishReason = firstFinishReason;

  for (let i = 0; i < LENGTH_CONTINUE_LIMIT && finishReason === "length"; i += 1) {
    const continuationPayload = {
      ...basePayload,
      stream: false,
      messages: buildLengthContinuationMessages(basePayload.messages, answer),
    };
    logPromptDebug(buildDebugMetadata({
      ...debugContext,
      payload: continuationPayload,
      stream: false,
      event: "deepseek.length_continue_payload",
      extra: {
        lengthContinueAttempt: i + 1,
        lengthContinueSystemPreserved: continuationPayload.messages?.[0]?.role === "system",
      },
    }));
    const { response, data } = await callDeepSeek(continuationPayload, apiKey);
    if (!response.ok) break;
    const next = sanitizeLucyAnswer(data?.choices?.[0]?.message?.content || "");
    if (!next) break;
    answer = `${answer}\n\n${next}`.trim();
    finishReason = getFinishReason(data);
  }

  return answer;
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
  const basePayload = buildDeepSeekPayload({ model, messages: finalMessages, temperature, maxTokens, stream: false });
  const debugContext = {
    body,
    route: body._lucyRouteDebug?.route || "chat",
    provider: body._lucyRouteDebug?.provider || "deepseek",
    model,
  };
  logPromptDebug(buildDebugMetadata({
    ...debugContext,
    payload: basePayload,
    stream: false,
    event: "deepseek.payload",
    extra: {
      lengthContinueConfigured: LENGTH_CONTINUE_LIMIT,
      lengthContinueSystemPreservedIfTriggered: basePayload.messages?.[0]?.role === "system",
    },
  }));

  let { response, data } = await callDeepSeek(basePayload, deepSeekKey);

  if (!response.ok) throw new Error(data?.error?.message || data?.message || `DeepSeek API hatası: ${response.status}`);
  const choiceMessage = data?.choices?.[0]?.message || {};
  let answer = sanitizeLucyAnswer(choiceMessage.content || "");
  answer = await continueAnswerIfLength(basePayload, deepSeekKey, answer, getFinishReason(data), debugContext);
  if (looksLikeInternalAnswer(answer)) {
    const retry = await retryFinalAnswer(basePayload, deepSeekKey, debugContext);
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

  const basePayload = buildDeepSeekPayload({ model, messages: finalMessages, temperature, maxTokens, stream: true });
  const debugContext = {
    body,
    route: body._lucyRouteDebug?.route || "chat-stream",
    provider: body._lucyRouteDebug?.provider || "deepseek",
    model,
  };
  logPromptDebug(buildDebugMetadata({
    ...debugContext,
    payload: basePayload,
    stream: true,
    event: "deepseek.stream_payload",
    extra: {
      lengthContinueConfigured: LENGTH_CONTINUE_LIMIT,
      lengthContinueSystemPreservedIfTriggered: basePayload.messages?.[0]?.role === "system",
    },
  }));

  async function callStream(requestPayload) {
    return fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${deepSeekKey}` },
      body: JSON.stringify(requestPayload),
    });
  }

  const decoder = new TextDecoder("utf-8");
  let fullAnswer = "";
  let requestPayload = basePayload;

  for (let continueCount = 0; continueCount <= LENGTH_CONTINUE_LIMIT; continueCount += 1) {
    let response = await callStream(requestPayload);
    if (!response.ok) {
      const errorData = await response.json().catch(async () => ({ message: await response.text().catch(() => "") }));
      throw new Error(errorData?.error?.message || errorData?.message || `DeepSeek stream API hatası: ${response.status}`);
    }

    const reader = response.body?.getReader?.();
    if (!reader) throw new Error("DeepSeek stream gövdesi okunamadı.");

    let buffer = "";
    let finishReason = "";
    let sawDone = false;
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
          sawDone = true;
          break;
        }
        try {
          const json = JSON.parse(payloadText);
          finishReason = json?.choices?.[0]?.finish_reason || finishReason;
          const delta = extractDeepSeekStreamDelta(json);
          const cleanDelta = sanitizeDelta(delta);
          if (cleanDelta) {
            fullAnswer += cleanDelta;
            writeSse(res, { delta: cleanDelta });
          }
        } catch {}
      }
      if (sawDone) break;
    }

    if (finishReason !== "length" || continueCount >= LENGTH_CONTINUE_LIMIT) break;
    requestPayload = {
      ...basePayload,
      messages: buildLengthContinuationMessages(basePayload.messages, fullAnswer),
      stream: true,
    };
    logPromptDebug(buildDebugMetadata({
      ...debugContext,
      payload: requestPayload,
      stream: true,
      event: "deepseek.stream_length_continue_payload",
      extra: {
        lengthContinueAttempt: continueCount + 1,
        lengthContinueSystemPreserved: requestPayload.messages?.[0]?.role === "system",
      },
    }));
  }

  writeSse(res, { done: true, answer: fullAnswer });
  return fullAnswer;
}

module.exports = { askDeepSeek, askDeepSeekStream, writeSse };
