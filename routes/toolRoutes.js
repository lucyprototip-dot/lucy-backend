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
    const body = req.body || {};
    const name = body.name || body.tool || body.toolName;
    const input = body.input || body.args || body.parameters || {};
    const timeoutMs = Number(body.timeoutMs || 30000);
    const result = persistToolFileResult(await executeLucyTool(name, input, timeoutMs), req);
    const status = result.success === false && result.error === "tool_not_found" ? 404 : 200;
    res.status(status).json(result);
  });

  app.post("/api/tools/:name", async (req, res) => {
    const timeoutMs = Number(req.body?.timeoutMs || 30000);
    const input = req.body?.input || req.body?.args || req.body || {};
    const result = persistToolFileResult(await executeLucyTool(req.params.name, input, timeoutMs), req);
    const status = result.success === false && result.error === "tool_not_found" ? 404 : 200;
    res.status(status).json(result);
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
