const { envValue } = require("./env");
const { DEEPSEEK_MODEL_FAST } = require("./models");
const { normalizeMessages, normalizeText, getLastUserText, clampMaxTokens, fastMaxTokens } = require("../utils/text");

function safeJson(raw = "") {
  try {
    return JSON.parse(raw);
  } catch {}
  try {
    const match = String(raw || "").match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
}

async function planWithDeepSeek(body = {}) {
  const apiKey = envValue("DEEPSEEK_API_KEY") || envValue("DEEPSEEK_API_KEY_ALT");
  const messages = normalizeMessages(body.messages).slice(-12);
  const fallback = getLastUserText(messages);

  if (!apiKey || !messages.length) {
    return { needs_web: false, query: "", resolved_request: fallback, max_tokens: fastMaxTokens(body) };
  }

  const payload = {
    model: DEEPSEEK_MODEL_FAST,
    temperature: 0,
    max_tokens: 260,
    stream: false,
    messages: [
      {
        role: "system",
        content: [
          "Sen Lucy'nin tek beyin karar katmanısın.",
          "Kullanıcının son mesajını mutlaka önceki konuşma bağlamıyla yorumla.",
          "Son mesaj tek başına anlamsız bir devam mesajıysa, önceki somut isteğe bağla.",
          "Web gerekiyorsa needs_web true yap ve arama motoruna uygun kısa query üret.",
          "Web gerekmiyorsa needs_web false yap.",
          "Son mesajı aynen çeviri/sözlük sorgusu gibi arama; gerçek kullanıcı niyetini çöz.",
          "Yazım hatalarını bağlama göre düzelt.",
          "Cevap sadece JSON olsun.",
          "Şema: {\"needs_web\":true,\"query\":\"...\",\"resolved_request\":\"...\",\"max_tokens\":1024}",
          "max_tokens kısa sohbet için 512, normal için 1024, detaylı için 4000-8000, çok uzun yazı için 16000 olabilir."
        ].join(" ")
      },
      {
        role: "user",
        content: JSON.stringify({ conversation: messages })
      }
    ]
  };

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    const raw = data?.choices?.[0]?.message?.content || "";
    const parsed = safeJson(raw) || {};
    const query = normalizeText(parsed.query || "");
    const resolved = normalizeText(parsed.resolved_request || query || fallback);
    const needsWeb = parsed.needs_web === true || parsed.needs_web === "true";
    return {
      needs_web: needsWeb,
      query: needsWeb ? (query || resolved || fallback) : "",
      resolved_request: resolved || fallback,
      max_tokens: clampMaxTokens(parsed.max_tokens || fastMaxTokens(body), fastMaxTokens(body)),
    };
  } catch {
    return { needs_web: false, query: "", resolved_request: fallback, max_tokens: fastMaxTokens(body) };
  }
}

module.exports = { planWithDeepSeek };
