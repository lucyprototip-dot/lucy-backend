function statusForToolResult(result = {}) {
  if (!result || result.success !== false) return 200;
  if (result.error === "tool_not_found") return 404;
  if (["valid_url_required", "unsupported_protocol", "url_credentials_blocked", "private_url_blocked", "unsupported_content_type", "rows_required", "content_required"].includes(result.error)) return 400;
  if (["smtp_not_configured", "telegram_not_configured", "whatsapp_not_configured", "mail_config_required", "smtp_config_required", "telegram_config_required", "whatsapp_config_required"].includes(result.error)) return 424;
  return 422;
}

function registerToolRoutes(app, deps) {
  const { listLoadedTools, listToolLoadErrors, getLoadedTool, executeLucyTool, persistToolFileResult } = deps;

  app.get("/api/tools", (req, res) => {
    const tools = listLoadedTools();
    const loadErrors = typeof listToolLoadErrors === "function" ? listToolLoadErrors() : {};
    res.json({
      success: true,
      count: tools.length,
      tools,
      loadErrors,
    });
  });

  app.post("/api/tools/execute", async (req, res) => {
    try {
      const body = req.body || {};
      const name = body.name || body.tool || body.toolName;
      const input = body.input || body.args || body.parameters || {};
      const timeoutMs = Number(body.timeoutMs || 30000);
      const result = persistToolFileResult(await executeLucyTool(name, input, timeoutMs), req);
      res.status(statusForToolResult(result)).json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: "tool_execute_failed", message: error.message });
    }
  });

  app.post("/api/tools/:name", async (req, res) => {
    try {
      const timeoutMs = Number(req.body?.timeoutMs || 30000);
      const input = req.body?.input || req.body?.args || req.body || {};
      const result = persistToolFileResult(await executeLucyTool(req.params.name, input, timeoutMs), req);
      res.status(statusForToolResult(result)).json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: "tool_execute_failed", message: error.message });
    }
  });

  app.get("/api/tools/:name", (req, res) => {
    const tool = getLoadedTool(req.params.name);
    if (!tool) {
      return res.status(404).json({ success: false, error: "tool_not_found" });
    }

    res.json({
      success: true,
      name: tool.name || req.params.name,
      description: tool.description || "",
    });
  });
}

module.exports = registerToolRoutes;
