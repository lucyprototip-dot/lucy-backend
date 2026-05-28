const fs = require("fs");
const path = require("path");

const tools = {};
const loadErrors = {};
let loaded = false;

function loadTools({ force = false } = {}) {
  if (loaded && !force) return tools;

  Object.keys(tools).forEach((key) => delete tools[key]);
  Object.keys(loadErrors).forEach((key) => delete loadErrors[key]);

  const toolsPath = __dirname;
  const files = fs
    .readdirSync(toolsPath)
    .filter((file) => file.endsWith(".js") && file !== "toolRegistry.js")
    .sort();

  for (const file of files) {
    const fullPath = path.join(toolsPath, file);

    try {
      const resolvedPath = require.resolve(fullPath);
      delete require.cache[resolvedPath];

      const tool = require(fullPath);
      const toolName = tool.name || file.replace(/\.js$/i, "");

      if (!toolName || typeof tool.execute !== "function") {
        loadErrors[file] = "execute() yok";
        console.warn(`⚠️ Tool atlandı: ${file} execute() yok`);
        continue;
      }

      tools[toolName] = tool;
      console.log(`✅ Tool yüklendi: ${toolName}`);
    } catch (error) {
      loadErrors[file] = error?.message || String(error);
      console.warn(`⚠️ Tool yüklenemedi: ${file} - ${loadErrors[file]}`);
    }
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

function listToolLoadErrors() {
  if (!loaded) loadTools();
  return { ...loadErrors };
}

loadTools();

module.exports = {
  tools,
  loadErrors,
  loadTools,
  getTool,
  listTools,
  listToolLoadErrors,
};
