const TOOL_NAME_ALIASES = {
  chartdata: "chartData",
  chart_data: "chartData",
  "chart-data": "chartData",
  chart: "chartData",
  grafik: "chartData",
  textstats: "textStats",
  text_stats: "textStats",
  "text-stats": "textStats",
  webfetch: "webFetch",
  web_fetch: "webFetch",
  "web-fetch": "webFetch",
  filemanager: "fileManager",
  file_manager: "fileManager",
  "file-manager": "fileManager",
};

let toolRegistry = null;
let lucyTools = {};
try {
  toolRegistry = require("../tools/toolRegistry");
  lucyTools = toolRegistry.loadTools();
} catch (error) {
  console.warn("Lucy tool registry yüklenemedi:", error.message);
}

function listLoadedTools() {
  if (toolRegistry?.listTools) return toolRegistry.listTools();
  return Object.values(lucyTools || {}).map((tool) => ({
    name: tool.name,
    description: tool.description || "",
  }));
}

function listToolLoadErrors() {
  if (toolRegistry?.listToolLoadErrors) return toolRegistry.listToolLoadErrors();
  return {};
}

function canonicalToolName(name) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  const compact = raw.replace(/\s+/g, "");
  const lower = compact.toLowerCase();
  return TOOL_NAME_ALIASES[lower] || TOOL_NAME_ALIASES[compact] || compact;
}

function getLoadedTool(name) {
  const cleanName = String(name || "").trim();
  if (!cleanName) return null;
  const canonicalName = canonicalToolName(cleanName);
  return (
    toolRegistry?.getTool?.(canonicalName) ||
    toolRegistry?.getTool?.(cleanName) ||
    lucyTools?.[canonicalName] ||
    lucyTools?.[cleanName] ||
    null
  );
}

function withTimeout(promise, ms = 30000) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tool timeout: ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function executeLucyTool(toolName, input = {}, timeoutMs = 30000) {
  const canonicalName = canonicalToolName(toolName);
  const tool = getLoadedTool(canonicalName);
  if (!tool || typeof tool.execute !== "function") {
    return {
      success: false,
      error: "tool_not_found",
      message: `Tool bulunamadı: ${toolName}`,
    };
  }

  try {
    return await withTimeout(Promise.resolve(tool.execute(input || {})), timeoutMs);
  } catch (error) {
    return {
      success: false,
      error: "tool_execute_failed",
      message: error.message,
    };
  }
}

module.exports = {
  TOOL_NAME_ALIASES,
  canonicalToolName,
  listLoadedTools,
  listToolLoadErrors,
  getLoadedTool,
  executeLucyTool,
};
