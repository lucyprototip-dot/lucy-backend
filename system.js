const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const { pickDeepSeekModel, modelList } = require("./core/models");
const { withWebOffHint } = require("./core/prompt");
const { fastMaxTokens, normalizeMessages } = require("./utils/text");
const { askDeepSeek, askDeepSeekStream, writeSse } = require("./services/deepseek");
const { isWebMode, isLiveMarketQuery, shouldUseLiveWebRequest, answerLiveWebIfNeeded, buildLiveWebBody } = require("./services/web");
const { speak } = require("./services/voice");
const { withServerContext, rememberExchange } = require("./core/sessionMemory");

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const PORT = process.env.PORT || 5050;
const TRACE = String(process.env.LUCY_TRACE || "").toLowerCase() === "true";
const WEB_OFF_LIVE_DATA_MESSAGE = "WEB arama kapalı aşkım. Açarsan canlı veriye bakabilirim.";
const WEB_OFF_LIVE_DATA_FOLLOWUPS = new Set([
  "açtım",
  "actim",
  "açtım aşkım",
  "actim askim",
  "şimdi açtım",
  "simdi actim",
  "şimdi açtım aşkım",
  "simdi actim askim",
  "evet",
  "evet aşkım",
  "evet askim",
  "söyle",
  "soyle",
  "söyle aşkım",
  "soyle askim",
  "tamam söyle",
  "tamam soyle",
  "şimdi söyle",
  "simdi soyle",
  "bak",
  "bak aşkım",
  "bak askim",
  "hadi bak",
  "bakabilir misin",
  "devam",
  "tamam",
]);
function trace(label, data = {}) { if (TRACE) { try { console.log(`[LUCY_TRACE] ${label}`, JSON.stringify(data).slice(0, 4000)); } catch {} } }

function isLiveDataIntentText(text = "") {
  const value = String(text || "").toLowerCase();
  return isLiveMarketQuery(value) || /\b(haber|son dakika|güncel haber|guncel haber)\b/i.test(value);
}

function foldTurkishText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/\u0131/g, "i")
    .replace(/\u011f/g, "g")
    .replace(/\u00fc/g, "u")
    .replace(/\u015f/g, "s")
    .replace(/\u00f6/g, "o")
    .replace(/\u00e7/g, "c")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.!?…]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isWebOffLiveDataGuardAnswer(text = "") {
  const value = foldTurkishText(text);
  return value.includes("web arama kapali");
}

function isWebOffLiveDataFollowup(text = "") {
  const value = foldTurkishText(text);
  if (WEB_OFF_LIVE_DATA_FOLLOWUPS.has(text) || WEB_OFF_LIVE_DATA_FOLLOWUPS.has(value)) return true;
  if (/^(actim|simdi actim|aa acmis olmam lazim|evet|soyle|bak|arastir|bul|arastir bul soyle|tamam|devam)$/.test(value)) return true;
  return value.length <= 80 && /\b(acmis|actim|arastir|bul|soyle|bak)\b/.test(value);
}

function shouldBlockWebOffLiveDataRequest(messages = []) {
  const normalized = normalizeMessages(messages);
  const users = normalized.filter((message) => message.role === "user");
  const last = users[users.length - 1]?.content || "";
  if (!last) return false;
  if (isLiveDataIntentText(last)) return true;
  if (!isWebOffLiveDataFollowup(last)) return false;
  if (normalized.slice(0, -1).reverse().slice(0, 12).some((message) => message.role === "assistant" && isWebOffLiveDataGuardAnswer(message.content))) return true;
  return users.slice(0, -1).reverse().slice(0, 8).some((message) => isLiveDataIntentText(message.content));
}

function isSourceFollowupText(text = "") {
  const value = foldTurkishText(text);
  return /^(nereden buldun|nerden buldun|bunu nereden buldun|bunu nerden buldun|kaynak ne|kaynagin ne|kaynaklar ne|kaynak goster|kaynaklari goster)$/.test(value);
}

function extractSourceFollowupAnswer(messages = []) {
  const normalized = normalizeMessages(messages);
  const lastUser = [...normalized].reverse().find((message) => message.role === "user")?.content || "";
  if (!isSourceFollowupText(lastUser)) return "";

  const previousAssistant = normalized.slice(0, -1).reverse().find((message) => message.role === "assistant")?.content || "";
  if (!previousAssistant) return "";

  const folded = foldTurkishText(previousAssistant);
  if (
    folded.includes("guvenilir canli kripto verisi bulamadim") ||
    folded.includes("guvenilir kaynak bulamadim") ||
    folded.includes("kaynak yoksa fiyat soyleyemem") ||
    folded.includes("guvenilir okunabilir veri cekemedim")
  ) {
    return "Kaynak yoktu aşkım; güvenilir okunabilir kaynak bulamadığım için fiyat ya da sayı vermedim.";
  }

  const urls = Array.from(new Set(String(previousAssistant).match(/https?:\/\/[^\s`)\]}>'"]+/gi) || []))
    .map((url) => url.replace(/[.,;:!?]+$/, ""))
    .slice(0, 5);
  const timeLines = String(previousAssistant)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /okunma zaman|tarih|saat/i.test(line))
    .slice(0, 3);

  if (urls.length) {
    const lines = ["Bunu şu kaynaklardan aldım aşkım:"];
    urls.forEach((url) => lines.push(`- ${url}`));
    timeLines.forEach((line) => lines.push(`- ${line}`));
    return lines.join("\n");
  }

  return "Son cevabımda tam kaynak URL görünmüyor aşkım. Kaynak net değilse bunu güvenilir canlı veri saymam; web açıkken yeniden kontrol edebilirim.";
}

app.get("/", (req, res) => {
  res.json({ success: true, message: "LUCY Core backend çalışıyor", brain: "DeepSeek", modes: ["fast", "think", "pro_fast", "pro_think"], webSearch: true, elevenLabs: true, port: PORT });
});

app.get("/api/models", (req, res) => {
  res.json({ success: true, models: modelList() });
});

app.post("/api/chat", async (req, res) => {
  try {
    const originalBody = req.body || {};
    const body = withServerContext(req, originalBody);
    trace("chat.request", { webSearch: originalBody.webSearch, mode: originalBody.mode, modeId: originalBody.modeId, messageCount: Array.isArray(body.messages) ? body.messages.length : 0 });

    const sourceFollowupAnswer = extractSourceFollowupAnswer(body.messages);
    if (sourceFollowupAnswer) {
      rememberExchange(req, originalBody, sourceFollowupAnswer);
      return res.json({ success: true, provider: "source-followup", model: null, answer: sourceFollowupAnswer });
    }

    if (isWebMode(originalBody) && shouldUseLiveWebRequest(body)) {
      const webPlan = { needs_web: true, max_tokens: fastMaxTokens(body, 8000) };
      const liveAnswer = await answerLiveWebIfNeeded({ ...body, max_tokens: webPlan.max_tokens }, webPlan);
      rememberExchange(req, originalBody, liveAnswer);
      return res.json({ success: true, provider: "live-web", model: "google-duckduckgo-deepseek", answer: liveAnswer });
    }

    if (!isWebMode(originalBody) && shouldBlockWebOffLiveDataRequest(body.messages)) {
      rememberExchange(req, originalBody, WEB_OFF_LIVE_DATA_MESSAGE);
      return res.json({ success: true, provider: "web-off-guard", model: null, answer: WEB_OFF_LIVE_DATA_MESSAGE });
    }

    const fastBody = isWebMode(originalBody) ? body : withWebOffHint(body);
    const answer = await askDeepSeek(fastBody);
    rememberExchange(req, originalBody, answer);
    return res.json({ success: true, provider: "deepseek", model: pickDeepSeekModel(fastBody), answer });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/chat-stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  try {
    const originalBody = req.body || {};
    const body = withServerContext(req, originalBody);
    trace("chat.request", { webSearch: originalBody.webSearch, mode: originalBody.mode, modeId: originalBody.modeId, messageCount: Array.isArray(body.messages) ? body.messages.length : 0 });

    const sourceFollowupAnswer = extractSourceFollowupAnswer(body.messages);
    if (sourceFollowupAnswer) {
      writeSse(res, { delta: sourceFollowupAnswer });
      writeSse(res, { done: true, answer: sourceFollowupAnswer, provider: "source-followup" });
      rememberExchange(req, originalBody, sourceFollowupAnswer);
      return res.end();
    }

    if (isWebMode(originalBody) && shouldUseLiveWebRequest(body)) {
      const webPlan = { needs_web: true, max_tokens: fastMaxTokens(body, 8000) };
      const liveWeb = await buildLiveWebBody({ ...body, max_tokens: webPlan.max_tokens }, webPlan);
      if (liveWeb.instantAnswer) {
        writeSse(res, { delta: liveWeb.instantAnswer });
        writeSse(res, { done: true, answer: liveWeb.instantAnswer, provider: "live-web" });
        rememberExchange(req, originalBody, liveWeb.instantAnswer);
        return res.end();
      }
      const answer = await askDeepSeekStream(liveWeb.requestBody, res);
      rememberExchange(req, originalBody, answer);
      return res.end();
    }

    if (!isWebMode(originalBody) && shouldBlockWebOffLiveDataRequest(body.messages)) {
      writeSse(res, { delta: WEB_OFF_LIVE_DATA_MESSAGE });
      writeSse(res, { done: true, answer: WEB_OFF_LIVE_DATA_MESSAGE, provider: "web-off-guard" });
      rememberExchange(req, originalBody, WEB_OFF_LIVE_DATA_MESSAGE);
      return res.end();
    }

    const streamBody = isWebMode(originalBody) ? body : withWebOffHint(body);
    const answer = await askDeepSeekStream(streamBody, res);
    rememberExchange(req, originalBody, answer);
    return res.end();
  } catch (error) {
    writeSse(res, { error: error.message || "Stream hatası" });
    return res.end();
  }
});

app.post("/api/speak", async (req, res) => {
  try {
    return await speak(req, res);
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`LUCY Core backend aktif: http://localhost:${PORT}`);
});
