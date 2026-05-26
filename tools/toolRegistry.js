const fs = require("fs");
const path = require("path");

const tools = {};
let loaded = false;

function loadTools({ force = false } = {}) {
  if (loaded && !force) return tools;

  Object.keys(tools).forEach((key) => delete tools[key]);
  const toolsPath = __dirname;
  const files = fs
    .readdirSync(toolsPath)
    .filter((file) => file.endsWith(".js") && file !== "toolRegistry.js")
    .sort();

  for (const file of files) {
    const fullPath = path.join(toolsPath, file);
    delete require.cache[require.resolve(fullPath)];
    const tool = require(fullPath);
    const toolName = tool.name || file.replace(/\.js$/i, "");

    if (!toolName || typeof tool.execute !== "function") {
      console.warn(`⚠️ Tool atlandı: ${file} execute() yok`);
      continue;
    }

    tools[toolName] = tool;
    console.log(`✅ Tool yüklendi: ${toolName}`);
  }

  loaded = true;
  return tools;
}

function getTool(name) {
  if (!loaded) loadTools();
  return tools[String(name || "").trim()];
}

function listTools() {
  if (!loaded) loadTools();
  return Object.values(tools).map((tool) => ({
    name: tool.name,
    description: tool.description || "",
  }));
}

loadTools();

module.exports = {
  tools,
  loadTools,
  getTool,
  listTools,
};
