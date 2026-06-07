const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const {
  listLoadedTools: listAllLoadedTools,
  listToolLoadErrors,
  getLoadedTool,
  executeLucyTool: executeLucyToolRaw,
  canonicalToolName,
} = require("./toolExecutor");

const {
  normalizeToolResultForUI,
  summarizeToolResultLine,
} = require("./toolResponseAdapter");

const GENERATED_DIR = process.env.LUCY_GENERATED_DIR || path.resolve(__dirname, "..", "generated");
const GENERATED_PUBLIC_PATH = "/generated";

function envValue(name, fallback = "") {
  const value = process.env[name];
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).trim().replace(/^[\'\"]|[\'\"]$/g, "");
}

function envBool(name, fallback = false) {
  const value = envValue(name);
  if (!value) return fallback;
  return ["1", "true", "yes", "on", "aktif", "acik", "açık"].includes(value.toLowerCase());
}

function publicBaseUrl(req) {
  const explicit = envValue("LUCY_PUBLIC_BASE_URL") || envValue("PUBLIC_BASE_URL") || envValue("RAILWAY_PUBLIC_DOMAIN");
  if (explicit) {
    if (/^https?:\/\//i.test(explicit)) return explicit.replace(/\/+$/g, "");
    return `https://${explicit.replace(/\/+$/g, "")}`;
  }

  const proto = String(req?.headers?.["x-forwarded-proto"] || req?.protocol || "http").split(",")[0].trim() || "http";
  const host = String(req?.headers?.["x-forwarded-host"] || req?.headers?.host || "localhost:5050").split(",")[0].trim();
  return `${proto}://${host}`.replace(/\/+$/g, "");
}

function safeFileName(value = "lucy-file.bin") {
  const clean = String(value || "lucy-file.bin")
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9ğüşöçıİĞÜŞÖÇ._ -]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
  return clean || "lucy-file.bin";
}

function ensureGeneratedDir() {
  if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });
}

function decodeBase64ToBuffer(base64 = "") {
  const text = String(base64 || "").trim();
  if (!text) return null;
  const clean = text.includes(",") ? text.split(",").pop() : text;
  try {
    return Buffer.from(clean, "base64");
  } catch {
    return null;
  }
}

function persistToolFileResult(result = {}, req = null) {
  if (!result || typeof result !== "object") return result;
  if (!result.base64) return result;

  const buffer = decodeBase64ToBuffer(result.base64);
  if (!buffer || !buffer.length) return result;

  ensureGeneratedDir();
  const originalName = safeFileName(result.filename || result.downloadName || `${result.tool || "lucy"}-file.bin`);
  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext).slice(0, 70) || "lucy-file";
  const suffix = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const storedFilename = safeFileName(`${base}-${suffix}${ext || ""}`);
  const filePath = path.join(GENERATED_DIR, storedFilename);
  fs.writeFileSync(filePath, buffer);

  const url = `${publicBaseUrl(req)}${GENERATED_PUBLIC_PATH}/${encodeURIComponent(storedFilename)}`;
  const next = {
    ...result,
    storedFilename,
    url,
    downloadUrl: url,
    size: buffer.length,
  };
  delete next.base64;
  return next;
}

function csvSet(value = "") {
  return new Set(String(value || "")
    .split(/[;,\s]+/g)
    .map((x) => canonicalToolName(x).toLowerCase())
    .filter(Boolean));
}

function enabledChatToolSet() {
  return csvSet(envValue("LUCY_ENABLED_CHAT_TOOLS", ""));
}

function isChatToolExecutionEnabled(toolName = "") {
  if (!envBool("LUCY_CHAT_TOOLS_ENABLED", false)) return false;
  const canonical = canonicalToolName(toolName).toLowerCase();
  const enabled = enabledChatToolSet();
  if (!enabled.size) return true;
  return enabled.has(canonical);
}

function listLoadedTools() {
  const allTools = listAllLoadedTools();
  // Sistem promptunu ve /api/tools listesini şişirmemek için chat tool listesi sadece açıkken görünür.
  if (!envBool("LUCY_CHAT_TOOLS_ENABLED", false)) return [];
  const enabled = enabledChatToolSet();
  if (!enabled.size) return allTools;
  return allTools.filter((tool) => enabled.has(canonicalToolName(tool.name).toLowerCase()));
}

async function executeLucyTool(toolName, input = {}, timeoutMs = 30000) {
  // Direkt /api/tools ve dosya okuma/OCR gibi sistem işleri etkilenmesin diye burada kapatma yok.
  return executeLucyToolRaw(toolName, input, timeoutMs);
}

function stripCodeFence(text = "") {
  return String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function safeJsonParse(text = "") {
  try { return JSON.parse(text); } catch { return null; }
}

function extractJsonObject(text = "") {
  const clean = stripCodeFence(text);
  const direct = safeJsonParse(clean);
  if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct;

  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const sliced = clean.slice(start, end + 1);
    const parsed = safeJsonParse(sliced);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  }
  return null;
}

function asBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "1", "yes", "evet", "on"].includes(v)) return true;
    if (["false", "0", "no", "hayir", "hayır", "off"].includes(v)) return false;
  }
  return fallback;
}

function normalizeIntentContract(answer = "") {
  const parsed = extractJsonObject(answer);
  if (!parsed) return null;

  const tool = canonicalToolName(parsed.tool || parsed.tool_name || parsed.toolName || parsed.selected_tool || "");
  const input = parsed.tool_input || parsed.toolInput || parsed.input || parsed.args || parsed.parameters || {};
  const reply = String(parsed.reply || parsed.answer || parsed.message || "").trim();

  return {
    reply,
    intent: String(parsed.intent || parsed.user_intent || parsed.action || "chat").trim() || "chat",
    needs_tool: asBoolean(parsed.needs_tool ?? parsed.needsTool ?? parsed.run_tool ?? parsed.runTool, false),
    tool,
    tool_input: input && typeof input === "object" && !Array.isArray(input) ? input : {},
    confidence: Number(parsed.confidence ?? parsed.score ?? 0) || 0,
    raw: parsed,
  };
}

function fallbackCleanAnswer(answer = "") {
  return stripCodeFence(answer).trim() || "Aşkım cevap üretemedim.";
}

function disabledToolMessage(contract = {}) {
  const tool = contract.tool || "tool";
  const reply = contract.reply || "Aşkım ne istediğini anladım.";
  return `${reply}\n\n⚠️ Tool çalıştırmadım. Şu an chat içinde tool yürütme kapalı. Açmak için Railway/.env içinde LUCY_CHAT_TOOLS_ENABLED=true ve LUCY_ENABLED_CHAT_TOOLS=${tool} yap.`;
}

async function executeToolCallsFromAnswer(answer = "", req = null) {
  const text = String(answer || "").trim();
  if (!text) {
    return { finalAnswer: "", toolCalls: [], toolResults: [] };
  }

  const contract = normalizeIntentContract(text);
  if (!contract) {
    return { finalAnswer: fallbackCleanAnswer(text), toolCalls: [], toolResults: [] };
  }

  if (!contract.needs_tool) {
    return {
      finalAnswer: contract.reply || fallbackCleanAnswer(text),
      toolCalls: [],
      toolResults: [],
      intent: contract.intent,
      confidence: contract.confidence,
    };
  }

  if (!contract.tool) {
    return {
      finalAnswer: contract.reply || "Aşkım tool gerektiğini anladım ama hangi tool olduğunu net alamadım.",
      toolCalls: [],
      toolResults: [],
      intent: contract.intent,
      confidence: contract.confidence,
    };
  }

  const toolCall = {
    tool: contract.tool,
    input: contract.tool_input,
    intent: contract.intent,
    confidence: contract.confidence,
    source: "deepseek_intent_contract",
  };

  if (!isChatToolExecutionEnabled(contract.tool)) {
    return {
      finalAnswer: disabledToolMessage(contract),
      toolCalls: [toolCall],
      toolResults: [],
      intent: contract.intent,
      confidence: contract.confidence,
    };
  }

  const timeoutMs = Number(envValue("LUCY_CHAT_TOOL_TIMEOUT_MS", "45000")) || 45000;
  const rawResult = await executeLucyToolRaw(contract.tool, contract.tool_input, timeoutMs);
  const persisted = persistToolFileResult(rawResult, req);
  const ui = normalizeToolResultForUI(contract.tool, persisted, contract.tool_input);
  const line = summarizeToolResultLine(contract.tool, ui);
  const finalAnswer = [contract.reply, line].filter(Boolean).join("\n\n");

  return {
    finalAnswer,
    toolCalls: [toolCall],
    toolResults: [ui],
    intent: contract.intent,
    confidence: contract.confidence,
  };
}

module.exports = {
  publicBaseUrl,
  listLoadedTools,
  listToolLoadErrors,
  getLoadedTool,
  executeLucyTool,
  persistToolFileResult,
  executeToolCallsFromAnswer,
  normalizeIntentContract,
  isChatToolExecutionEnabled,
};
