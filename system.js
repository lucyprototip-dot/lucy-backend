const express = require("express");
const cors = require("cors");
const { env, envNumber } = require("./core/env");
const { publicModelList } = require("./core/models");
const { askDeepSeek, streamDeepSeek, writeSse } = require("./services/deepseek");

const app = express();
const PORT = envNumber("PORT", 5050);
const startedAt = Date.now();

app.disable("x-powered-by");
app.set("trust proxy", 1);

const allowedOrigins = env("ALLOWED_ORIGINS")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Bu origin Lucy V2 için izinli değil."));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Lucy-Session"]
}));
app.use(express.json({ limit: "5mb" }));

app.get("/", (req, res) => {
  res.json({
    success: true,
    service: "Lucy Backend V2",
    version: "2.0.0",
    brain: "DeepSeek V4",
    status: "ready",
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    modes: publicModelList(),
    features: { chat: true, streaming: true, web: false, tools: false, serverMemory: false }
  });
});

app.get("/api/health", (req, res) => res.redirect(307, "/"));
app.get("/api/models", (req, res) => res.json({ success: true, models: publicModelList() }));

app.post("/api/chat", async (req, res) => {
  const controller = new AbortController();
  req.on("close", () => controller.abort());
  try {
    const result = await askDeepSeek(req.body || {}, controller.signal);
    return res.json({ success: true, provider: "deepseek", ...result });
  } catch (error) {
    const status = error?.name === "AbortError" ? 499 : 500;
    return res.status(status).json({ success: false, error: error?.message || "Lucy V2 chat hatası." });
  }
});

app.post("/api/chat-stream", async (req, res) => {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const controller = new AbortController();
  req.on("close", () => controller.abort());

  try {
    await streamDeepSeek(req.body || {}, res, controller.signal);
  } catch (error) {
    if (!res.writableEnded) writeSse(res, { error: error?.message || "Lucy V2 stream hatası." });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  return res.status(400).json({ success: false, error: error?.message || "Geçersiz istek." });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Lucy Backend V2 hazır: http://0.0.0.0:${PORT}`);
});
