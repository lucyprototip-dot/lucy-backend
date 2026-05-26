const fs = require("fs");
const path = require("path");

const tools = {};

function loadTools() {
  const toolsPath = __dirname;
  const files = fs
    .readdirSync(toolsPath)
    .filter((file) => file.endsWith(".js") && file !== "toolRegistry.js");

  for (const file of files) {
    const tool = require(path.join(toolsPath, file));
    const toolName = tool.name || file.replace(".js", "");
    tools[toolName] = tool;
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
  tools,
  loadTools,
  getTool,
  listTools,
};
