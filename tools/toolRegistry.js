const fs = require("fs");
const path = require("path");

const tools = {};

function loadTools() {
  const toolsPath = __dirname;

  if (!fs.existsSync(toolsPath)) return tools;

  const files = fs
    .readdirSync(toolsPath)
    .filter((file) => file.endsWith(".js") && file !== "toolRegistry.js");

  for (const file of files) {
    const fullPath = path.join(toolsPath, file);
    const loadedTool = require(fullPath);
    const toolName = loadedTool.name || file.replace(/\.js$/, "");

    if (!loadedTool || typeof loadedTool.execute !== "function") {
      console.warn(`⚠️ Tool atlandı: ${file} execute() yok`);
      continue;
    }

    tools[toolName] = loadedTool;
    console.log(`✅ Tool yüklendi: ${toolName}`);
  }

  return tools;
}

function getTool(name) {
  return tools[name];
}

function listTools() {
  return Object.values(tools).map((tool) => ({
    name: tool.name,
    description: tool.description || "",
  }));
}

module.exports = {
  loadTools,
  getTool,
  listTools,
};
