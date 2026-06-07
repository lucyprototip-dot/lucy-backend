const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const { pickDeepSeekModel, modelList } = require("./core/models");
const { withWebOffHint } = require("./core/prompt");
const { fastMaxTokens } = require("./utils/text");
const { askDeepSeek, askDeepSeekStream, writeSse } = require("./services/deepseek");
const { isWebMode, needsWebForFreshData, answerLiveWebIfNeeded, buildLiveWebBody } = require("./services/web");
const { speak } = require("./services/voice");
const { withServerContext, rememberExchange } = require("./core/sessionMemory");

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const PORT = process.env.PORT || 5050;
const TRACE = String(process.env.LUCY_TRACE || "").toLowerCase() === "true";
function trace(label, data = {}) { if (TRACE) { try { console.log(`[LUCY_TRACE] ${label}`, JSON.stringify(data).slice(0, 4000)); } catch {} } }
const WEB_OFF_MESSAGE = "WEB arama kapalı aşkım. Açarsan canlı veriye bakabilirim.";

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

    const webOn = isWebMode(originalBody);

    if (webOn) {
      const liveAnswer = await answerLiveWebIfNeeded({ ...body, webSearch: true, max_tokens: fastMaxTokens({ ...body, webSearch: true }, 8000) });
      if (liveAnswer) {
        rememberExchange(req, originalBody, liveAnswer, { web: true });
        return res.json({ success: true, provider: "live-web", model: "google-duckduckgo-deepseek", answer: liveAnswer });
      }
    }

    if (!webOn && needsWebForFreshData(body)) {
      rememberExchange(req, originalBody, WEB_OFF_MESSAGE, { webPending: true });
      return res.json({ success: true, provider: "deepseek", model: pickDeepSeekModel(body), answer: WEB_OFF_MESSAGE });
    }

    const finalBody = webOn
      ? { ...body, systemHint: `${body.systemHint || ""}
Normal sohbet modu. WEB_CONTEXT yoksa kaynak listesi yazma. Kaynak uydurma.`.trim(), max_tokens: fastMaxTokens({ ...body, webSearch: false }) }
      : withWebOffHint(body);
    const answer = await askDeepSeek(finalBody);
    rememberExchange(req, originalBody, answer);
    return res.json({ success: true, provider: "deepseek", model: pickDeepSeekModel(finalBody), answer });
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

    const webOn = isWebMode(originalBody);

    if (webOn) {
      const liveAnswer = await answerLiveWebIfNeeded({ ...body, webSearch: true, max_tokens: fastMaxTokens({ ...body, webSearch: true }, 8000) });
      if (liveAnswer) {
        writeSse(res, { delta: liveAnswer });
        writeSse(res, { done: true, answer: liveAnswer, provider: "live-web" });
        rememberExchange(req, originalBody, liveAnswer, { web: true });
        return res.end();
      }
    }

    if (!webOn && needsWebForFreshData(body)) {
      writeSse(res, { delta: WEB_OFF_MESSAGE });
      writeSse(res, { done: true, answer: WEB_OFF_MESSAGE });
      rememberExchange(req, originalBody, WEB_OFF_MESSAGE, { webPending: true });
      return res.end();
    }

    const finalBody = webOn
      ? { ...body, systemHint: `${body.systemHint || ""}
Normal sohbet modu. WEB_CONTEXT yoksa kaynak listesi yazma. Kaynak uydurma.`.trim(), max_tokens: fastMaxTokens({ ...body, webSearch: false }) }
      : withWebOffHint(body);
    const answer = await askDeepSeekStream(finalBody, res);
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
