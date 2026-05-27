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

      if (isWebMode(body)) {
        const liveWeb = await buildLiveWebBody(body);
        if (liveWeb.instantAnswer) {
          writeSse(res, { delta: liveWeb.instantAnswer });
          writeSse(res, { done: true, answer: liveWeb.instantAnswer, provider: "live-web" });
          return res.end();
        }

        await askDeepSeekStream(liveWeb.requestBody, res, req);
        return res.end();
      }

      const liveAnswer = await answerLiveWebIfNeeded(body);
      if (liveAnswer) {
        writeSse(res, { delta: liveAnswer });
        writeSse(res, { done: true, answer: liveAnswer, provider: "live-web" });
        return res.end();
      }

      await askDeepSeekStream(body, res, req);
      return res.end();
    } catch (error) {
      writeSse(res, { error: error.message || "Stream hatası" });
      return res.end();
    }
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const liveAnswer = await answerLiveWebIfNeeded(req.body || {});
      if (liveAnswer) {
        return res.json({ success: true, provider: "live-web", model: "google-duckduckgo-deepseek", answer: liveAnswer });
      }

      const answer = await askDeepSeek(req.body || {});
      const toolPayload = await executeToolCallsFromAnswer(answer, req);
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
