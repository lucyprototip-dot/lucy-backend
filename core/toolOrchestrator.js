const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const dotenv = require("dotenv");
const { normalizeToolIntentText, detectChartType, likelyToolIntent } = require("./intentNormalizer");
const { planToolCallsWithDeepSeek } = require("./toolPlanner");

dotenv.config();

let toolRegistry = null;
let lucyTools = {};
try {
  toolRegistry = require("../tools/toolRegistry");
  lucyTools = toolRegistry.loadTools();
} catch (error) {
  console.warn("Lucy tool registry yüklenemedi:", error.message);
}

function envValue(name) {
  const value = process.env[name];
  if (value === undefined || value === null) return "";
  return String(value).trim().replace(/^[\'\"]|[\'\"]$/g, "");
}

function numberEnv(name, fallback) {
  const raw = envValue(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const PORT = process.env.PORT || 5050;
const GENERATED_DIR = process.env.LUCY_GENERATED_DIR || path.resolve(__dirname, "..", "generated");
const GENERATED_PUBLIC_PATH = "/generated";

function ensureGeneratedDir() {
  if (!fs.existsSync(GENERATED_DIR)) {
    fs.mkdirSync(GENERATED_DIR, { recursive: true });
  }
}

function listLoadedTools() {
  if (toolRegistry?.listTools) return toolRegistry.listTools();
  return Object.values(lucyTools || {}).map((tool) => ({
    name: tool.name,
    description: tool.description || "",
  }));
}

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


function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function stripCodeFence(text = "") {
  return String(text)
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function extractBalancedJsonBlocks(text = "") {
  const source = String(text || "");
  const blocks = [];

  for (let i = 0; i < source.length; i += 1) {
    const startChar = source[i];
    if (startChar !== "{" && startChar !== "[") continue;

    const closeChar = startChar === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let j = i; j < source.length; j += 1) {
      const char = source[j];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === startChar) depth += 1;
      if (char === closeChar) depth -= 1;

      if (depth === 0) {
        blocks.push(source.slice(i, j + 1));
        i = j;
        break;
      }
    }
  }

  return blocks;
}

function normalizeToolCallShape(rawCall) {
  if (!rawCall || typeof rawCall !== "object") return null;

  const inner = rawCall.tool_call || rawCall.toolCall || rawCall.call || rawCall;
  if (!inner || typeof inner !== "object") return null;

  const tool = inner.tool || inner.name || inner.toolName;
  const input = inner.input || inner.args || inner.arguments || inner.parameters || {};

  if (!tool || typeof tool !== "string") return null;
  return { tool: tool.trim(), input: input && typeof input === "object" ? input : { value: input } };
}

function extractToolCallsFromAnswer(answer = "") {
  const text = String(answer || "");
  const candidates = [];

  const fencedJson = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)].map((m) => m[1]);
  const genericFences = [...text.matchAll(/```\s*([\s\S]*?)```/g)].map((m) => m[1]);
  candidates.push(...fencedJson, ...genericFences, ...extractBalancedJsonBlocks(text));

  const calls = [];
  for (const candidate of candidates) {
    const parsed = safeJsonParse(stripCodeFence(candidate));
    if (!parsed) continue;

    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of list) {
      if (item?.tool_calls && Array.isArray(item.tool_calls)) {
        item.tool_calls.forEach((entry) => {
          const call = normalizeToolCallShape(entry);
          if (call) calls.push(call);
        });
        continue;
      }

      if (item?.toolCalls && Array.isArray(item.toolCalls)) {
        item.toolCalls.forEach((entry) => {
          const call = normalizeToolCallShape(entry);
          if (call) calls.push(call);
        });
        continue;
      }

      const call = normalizeToolCallShape(item);
      if (call) calls.push(call);
    }
  }

  const unique = [];
  const seen = new Set();
  for (const call of calls) {
    const key = `${call.tool}:${JSON.stringify(call.input)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(call);
  }

  return unique.slice(0, 5);
}

function publicBaseUrl(req) {
  const configured = envValue("LUCY_PUBLIC_BASE_URL") || envValue("PUBLIC_BASE_URL") || envValue("RAILWAY_PUBLIC_DOMAIN");
  if (configured) {
    const withProtocol = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
    return withProtocol.replace(/\/$/, "");
  }

  const protocol = req.get?.("x-forwarded-proto") || req.protocol || "http";
  const host = req.get?.("host") || `localhost:${PORT}`;
  return `${protocol}://${host}`;
}

function safeFileName(name = "lucy-output.bin") {
  const parsed = path.parse(String(name || "lucy-output.bin"));
  const base = (parsed.name || "lucy-output")
    .replace(/[^a-zA-Z0-9ğüşöçıİĞÜŞÖÇ._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) || "lucy-output";
  const ext = (parsed.ext || ".bin").replace(/[^a-zA-Z0-9.]/g, "").slice(0, 12) || ".bin";
  const nonce = crypto.randomBytes(4).toString("hex");
  return `${Date.now()}-${nonce}-${base}${ext}`;
}

function persistToolFileResult(result = {}, req) {
  if (!result || !result.base64) return result;

  ensureGeneratedDir();
  const filename = safeFileName(result.filename || "lucy-output.bin");
  const filePath = path.join(GENERATED_DIR, filename);
  fs.writeFileSync(filePath, Buffer.from(String(result.base64), "base64"));

  const url = `${publicBaseUrl(req)}${GENERATED_PUBLIC_PATH}/${encodeURIComponent(filename)}`;
  const publicResult = {
    ...result,
    filename: result.filename || filename,
    storedFilename: filename,
    url,
    downloadUrl: url,
  };

  delete publicResult.base64;
  return publicResult;
}


function guessToolResultType(toolName, result = {}) {
  const tool = String(toolName || result.tool || "").toLowerCase();
  const mime = String(result.mimeType || result.contentType || "").toLowerCase();

  if (result.downloadUrl || result.url || result.storedFilename || result.filename || result.base64) {
    if (mime.includes("pdf") || String(result.filename || "").toLowerCase().endsWith(".pdf")) return "file-pdf";
    if (mime.includes("spreadsheet") || String(result.filename || "").match(/\.xlsx?$/i)) return "file-excel";
    if (mime.includes("zip") || String(result.filename || "").match(/\.zip$/i)) return "file-zip";
    if (mime.startsWith("image/") || String(result.filename || "").match(/\.(png|jpe?g|webp|gif|svg)$/i)) return "image";
    return "file";
  }

  if (tool === "chartdata" || result.chartType || result.data?.labels) return "chart";
  if (tool === "mermaid" || result.type === "mermaid" || result.code) return "mermaid";
  if (tool === "qr" || result.qr || result.svg || result.png) return "qr";
  if (tool === "filemanager" || result.type === "file-list" || Array.isArray(result.files)) return "file-list";
  if (tool === "calculator") return "calculation";
  if (tool === "textstats") return "text-stats";
  if (tool === "webfetch") return "web-fetch";
  if (tool === "time") return "time";
  if (tool === "mail") return "mail";
  return "tool";
}

function normalizeToolResultForUI(toolName, result = {}, input = {}) {
  const normalized = result && typeof result === "object" ? { ...result } : { value: result };
  const type = guessToolResultType(toolName, normalized);
  const title = normalized.title || input.title || input.subject || input.filename || input.name || `${toolName} sonucu`;

  return {
    type,
    tool: toolName,
    title,
    success: normalized.success !== false,
    url: normalized.downloadUrl || normalized.url || "",
    downloadUrl: normalized.downloadUrl || normalized.url || "",
    filename: normalized.filename || normalized.downloadName || normalized.storedFilename || "",
    storedFilename: normalized.storedFilename || "",
    mimeType: normalized.mimeType || normalized.contentType || "",
    chartType: normalized.chartType || input.chartType || "bar",
    data: normalized.data || normalized.chartData || null,
    code: normalized.code || normalized.mermaid || "",
    text: normalized.text || normalized.message || "",
    files: Array.isArray(normalized.files) ? normalized.files : undefined,
    headers: Array.isArray(normalized.headers) ? normalized.headers : (Array.isArray(input.headers) ? input.headers : undefined),
    previewRows: Array.isArray(normalized.previewRows) ? normalized.previewRows : undefined,
    rows: normalized.rows,
    columns: normalized.columns,
    entries: Array.isArray(normalized.entries) ? normalized.entries : undefined,
    count: normalized.count,
    raw: normalized,
  };
}

function widgetFence(payload) {
  return `\n\n\`\`\`lucy-widget\n${JSON.stringify(payload)}\n\`\`\``;
}

function summarizeToolResultLine(toolName, ui) {
  if (!ui.success) return `❌ ${toolName}: ${ui.text || ui.raw?.error || "Tool çalışmadı"}`;
  if (ui.downloadUrl) return `✅ ${toolName}: ${ui.downloadUrl}`;
  if (ui.type === "chart") return `✅ ${toolName}: Grafik verisi hazır.`;
  if (ui.type === "mermaid") return `✅ ${toolName}: Mermaid diyagramı hazır.`;
  if (ui.type === "file-list") return `✅ ${toolName}: ${ui.count || ui.files?.length || 0} dosya listelendi.`;
  if (ui.type === "mail") return `✅ ${toolName}: ${ui.text || "Mail işlemi tamamlandı."}`;
  return `✅ ${toolName}: İşlem tamamlandı.`;
}


function latestGeneratedFileFromDisk() {
  try {
    ensureGeneratedDir();
    const files = fs.readdirSync(GENERATED_DIR)
      .filter((name) => !name.startsWith("."))
      .map((name) => {
        const full = path.join(GENERATED_DIR, name);
        const stat = fs.statSync(full);
        return stat.isFile() ? { name, full, mtimeMs: stat.mtimeMs } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    return files[0] || null;
  } catch {
    return null;
  }
}

function extractGeneratedFileRefsFromText(text = "") {
  const source = String(text || "");
  const refs = [];

  for (const match of source.matchAll(/\/generated\/([^\s"')]+)(?:[\s"')]|$)/gi)) {
    try {
      const storedFilename = decodeURIComponent(match[1].replace(/[.,;]+$/g, ""));
      if (storedFilename) refs.push({ storedFilename, filename: storedFilename });
    } catch {
      const storedFilename = match[1].replace(/[.,;]+$/g, "");
      if (storedFilename) refs.push({ storedFilename, filename: storedFilename });
    }
  }

  for (const match of source.matchAll(/```lucy-widget\s*([\s\S]*?)```/gi)) {
    const widget = safeJsonParse(String(match[1] || "").trim());
    if (!widget || typeof widget !== "object") continue;
    const storedFilename = widget.storedFilename || widget.raw?.storedFilename;
    const filename = widget.filename || widget.raw?.filename || storedFilename;
    if (storedFilename || filename) refs.push({ storedFilename: storedFilename || filename, filename: filename || storedFilename });
  }

  return refs;
}

function collectConversationGeneratedFileRefs(req) {
  const messages = Array.isArray(req?.body?.messages) ? req.body.messages : [];
  const refs = [];
  for (const message of messages) {
    const content = typeof message?.content === "string" ? message.content : (message?.text || "");
    refs.push(...extractGeneratedFileRefsFromText(content));
  }
  return refs;
}

function enrichToolCallInput(call, req) {
  if (!call || typeof call !== "object") return call;
  const toolName = String(call.tool || "").toLowerCase();
  const input = call.input && typeof call.input === "object" ? { ...call.input } : {};
  const memory = hydrateMemoryFromRequest(req);
  const userText = latestUserIntentText(req);

  if (toolName === "excel" && !(Array.isArray(input.rows) && input.rows.length) && !String(input.text || input.content || input.value || "").trim()) {
    if (memory.lastTable?.rows?.length) {
      input.rows = memory.lastTable.rows;
      input.headers = memory.lastTable.headers;
      input.title = input.title || "LUCY Tablosu";
    } else if (memory.lastText) {
      input.text = memory.lastText;
    }
  }

  if (toolName === "pdf" && !String(input.text || input.content || input.value || "").trim()) {
    if (memory.lastTable?.rows?.length) input.text = tableToMarkdown(memory.lastTable);
    else if (memory.lastText) input.text = memory.lastText;
    else if (memory.lastChart?.data) input.text = JSON.stringify(memory.lastChart.data, null, 2);
  }

  if (toolName === "chartdata") {
    const labels = input.labels || input.data?.labels;
    const values = input.values || input.data?.datasets?.[0]?.data;
    if (!(Array.isArray(labels) && labels.length && Array.isArray(values) && values.length)) {
      const chartInput = tableToChartInput(memory.lastTable, userText);
      if (chartInput) Object.assign(input, chartInput);
    }
  }

  if (toolName === "mermaid" && !String(input.code || input.mermaid || "").trim() && memory.lastMermaid?.code) {
    input.code = memory.lastMermaid.code;
  }

  if (toolName === "qr" && !String(input.text || input.url || input.value || "").trim()) {
    input.text = memory.lastText || latestUserIntentText(req);
  }

  if (toolName === "textstats" && !String(input.text || "").trim()) {
    input.text = memory.lastText || tableToMarkdown(memory.lastTable) || latestUserIntentText(req);
  }

  if (toolName === "document" && !String(input.content || input.text || input.markdown || "").trim()) {
    input.content = memory.lastTable?.rows?.length ? tableToMarkdown(memory.lastTable) : memory.lastText;
  }

  if (toolName === "ocr") {
    const hasImageInput = input.base64 || input.imageBase64 || input.fileBase64 || input.dataUrl || input.imageDataUrl || input.storedFilename || input.generatedFile;
    if (!hasImageInput) {
      const requestImage = extractImageBase64FromRequest(req);
      if (requestImage?.base64) {
        input.base64 = requestImage.base64;
        input.mimeType = requestImage.mimeType || input.mimeType;
        input.filename = requestImage.filename || input.filename;
      } else {
        const img = lastImageFileFromMemory(memory);
        if (img?.storedFilename) {
          input.storedFilename = img.storedFilename;
          input.filename = img.filename || img.storedFilename;
          input.mimeType = img.mimeType || img.contentType || input.mimeType;
        }
      }
    }
    if (!input.lang && !input.language) input.lang = "tur+eng";
  }

  if (toolName === "zip") {
    const hasFiles = Array.isArray(input.files) && input.files.length > 0;
    if (!hasFiles) {
      const memoryFiles = [memory.lastFile, memory.lastPdf, memory.lastExcel]
        .filter(Boolean)
        .filter((file) => file?.storedFilename && !String(file.filename || file.storedFilename || "").toLowerCase().endsWith(".zip"));
      const fromMemory = memoryFiles[0];
      if (fromMemory?.storedFilename) {
        input.files = [{ storedFilename: fromMemory.storedFilename, filename: fromMemory.filename || fromMemory.storedFilename }];
      } else {
        const refs = collectConversationGeneratedFileRefs(req).filter((ref) => !String(ref.filename || ref.storedFilename || "").toLowerCase().endsWith(".zip"));
        const lastRef = refs[refs.length - 1];
        if (lastRef?.storedFilename) {
          input.files = [{
            storedFilename: lastRef.storedFilename,
            filename: lastRef.filename || lastRef.storedFilename,
          }];
        }
      }
    }
    if (!input.filename) input.filename = "lucy-dosyalari.zip";
  }

  return { ...call, input };
}


function latestUserIntentText(req) {
  const messages = Array.isArray(req?.body?.messages) ? req.body.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] || {};
    const role = String(message.role || message.sender || "").toLowerCase();
    if (role && role !== "user") continue;
    const text = String(message.content || message.text || message.message || "").trim();
    if (text) return text;
  }
  return String(req?.body?.prompt || req?.body?.message || req?.body?.text || "").trim();
}

function requestedToolWork(req) {
  return likelyToolIntent(latestUserIntentText(req));
}

function requestedMermaidWork(req) {
  const text = normalizeIntentText(latestUserIntentText(req));
  return /mermaid|diyagram|flowchart|akis|sema/.test(text);
}

function stripToolOnlyBlocks(answer = "") {
  return String(answer || "")
    .replace(/```json\s*[\s\S]*?```/gi, "")
    .replace(/```lucy-widget\s*[\s\S]*?```/gi, "")
    .replace(/```mermaid\s*[\s\S]*?```/gi, "")
    .replace(/\{\s*"tool_call"\s*:\s*\{[\s\S]*?\}\s*\}/gi, "")
    .trim();
}


function sanitizeNormalAnswer(answer = "", req = null) {
  let text = String(answer || "");

  // Normal sohbetlerde model bazen önceki tool JSON'undan kalan kapanış parantezlerini veya
  // yarım tool bloklarını döndürebiliyor. Kullanıcıya asla ham JSON/parantez göstermeyelim.
  text = text
    .replace(/```json\s*[\s\S]*?```/gi, "")
    .replace(/```lucy-widget\s*[\s\S]*?```/gi, "")
    .replace(/```mermaid\s*[\s\S]*?```/gi, requestedMermaidWork(req) ? "$&" : "")
    .replace(/\{\s*"tool_call"\s*:\s*\{[\s\S]*?\}\s*\}/gi, "")
    .replace(/"tool_call"\s*:\s*\{[\s\S]*?\}/gi, "")
    .replace(/^\s*[}\]]+\s*$/gm, "")
    .replace(/^\s*[,;]+\s*$/gm, "")
    .trim();

  // Sadece sembol/parantez kaldıysa normal cevap sayma.
  if (!/[A-Za-zÇĞİÖŞÜçğıöşü0-9]/.test(text)) return "";
  return text;
}

function extractMermaidBlocksFromAnswer(answer = "") {
  const blocks = [];
  const source = String(answer || "");
  for (const match of source.matchAll(/```mermaid\s*([\s\S]*?)```/gi)) {
    const code = String(match[1] || "").trim();
    if (code) blocks.push({ tool: "mermaid", input: { code, title: "Mermaid diyagram" } });
  }
  return blocks;
}

function isUsableToolCall(call = {}) {
  const tool = String(call.tool || "").toLowerCase();
  const input = call.input && typeof call.input === "object" ? call.input : {};
  if (!tool) return false;
  if (tool === "mermaid") return Boolean(String(input.code || input.mermaid || input.text || "").trim());
  if (tool === "chartdata") {
    const labels = input.labels || input.data?.labels;
    const values = input.values || input.data?.datasets?.[0]?.data;
    return Array.isArray(labels) && labels.length > 0 && Array.isArray(values) && values.length > 0;
  }
  if (tool === "excel") return Boolean((Array.isArray(input.rows) && input.rows.length) || String(input.text || input.content || input.value || "").trim() || (Array.isArray(input.labels) && input.labels.length));
  if (tool === "pdf") return Boolean(String(input.text || input.content || input.value || "").trim());
  if (tool === "qr") return Boolean(String(input.text || input.url || input.value || "").trim());
  if (tool === "ocr") return Boolean(String(input.base64 || input.imageBase64 || input.fileBase64 || input.dataUrl || input.imageDataUrl || input.storedFilename || input.generatedFile || "").trim());
  return true;
}


function validateToolInput(call = {}, req = null) {
  const tool = String(call.tool || "").toLowerCase();
  const input = call.input && typeof call.input === "object" ? call.input : {};
  const memory = hydrateMemoryFromRequest(req);
  const fail = (message, code = "invalid_tool_input") => ({ ok: false, code, message });

  if (!tool || !getLoadedTool(tool)) return fail(`Tool bulunamadı: ${tool || "boş"}`, "tool_not_found");

  if (tool === "zip") {
    const files = Array.isArray(input.files) ? input.files : [];
    const validFiles = files.filter((file) => file && typeof file === "object" && (file.storedFilename || file.generatedFile || file.base64 || String(file.content || file.text || "").trim()));
    if (!validFiles.length) return fail("ZIP oluşturabilmem için önce üretilmiş gerçek bir dosya gerekli aşkım.", "zip_source_required");
    const nestedZip = validFiles.find((file) => String(file.filename || file.name || file.storedFilename || file.generatedFile || "").toLowerCase().endsWith(".zip"));
    if (nestedZip && !input.allowNestedZip) return fail("ZIP dosyasını tekrar ZIP içine koymuyorum aşkım. Önce PDF/XLSX gibi gerçek bir dosya seçmeliyim.", "nested_zip_blocked");
  }

  if (tool === "chartdata") {
    const labels = input.labels || input.data?.labels;
    const values = input.values || input.data?.datasets?.[0]?.data;
    if (!(Array.isArray(labels) && labels.length && Array.isArray(values) && values.length)) {
      return fail("Grafik için önce sayısal tablo/veri gerekli aşkım.", "chart_source_required");
    }
  }

  if (tool === "mermaid") {
    if (!String(input.code || input.mermaid || "").trim()) return fail("Diyagram için akış kodu veya tablo kaynağı gerekli aşkım.", "mermaid_source_required");
  }

  if (tool === "excel") {
    const hasTable = Array.isArray(input.rows) && input.rows.length;
    const hasText = String(input.text || input.content || input.value || "").trim();
    if (!hasTable && !hasText && !memory.lastTable?.rows?.length) return fail("Excel için önce tablo/veri gerekli aşkım.", "excel_source_required");
  }

  if (tool === "pdf") {
    const hasText = String(input.text || input.content || input.value || "").trim();
    if (!hasText && !memory.lastTable?.rows?.length && !memory.lastText) return fail("PDF için önce metin, tablo veya rapor içeriği gerekli aşkım.", "pdf_source_required");
  }

  if (tool === "ocr") {
    const hasImage = input.base64 || input.imageBase64 || input.fileBase64 || input.dataUrl || input.imageDataUrl || input.storedFilename || input.generatedFile;
    if (!hasImage) return fail("OCR için önce bir görsel yüklemem gerekiyor aşkım.", "ocr_image_required");
  }

  return { ok: true };
}


function normalizeIntentText(value = "") {
  return normalizeToolIntentText(value);
}

function wantsPdfFromText(text = "") {
  const q = normalizeIntentText(text);
  return /\bpdf\b|pdf olarak|pdf yap|pdf yaz|pdf hazirla|pdf gonder|pdf indir|rapor pdf/.test(q);
}

function wantsExcelFromText(text = "") {
  const q = normalizeIntentText(text);
  return /\bexcel\b|\bxlsx\b|\bxls\b|e-tablo|spreadsheet|calisma kitabi|tabloyu excel|excel olarak|xlsx olarak/.test(q);
}

function wantsZipFromText(text = "") {
  const q = normalizeIntentText(text);
  return /\bzip\b|arsiv|arsivle|sikistir|zip olarak|zip yap|zip gonder|zip indir/.test(q);
}

function wantsChartFromText(text = "") {
  const q = normalizeIntentText(text);
  return /grafik|chart|pasta grafik|cizgi grafik|bar grafik|sutun grafik|doughnut|cizelge/.test(q);
}

function wantsDocumentFromText(text = "") {
  const q = normalizeIntentText(text);
  return /\b(document|belge|txt|markdown|md|csv|json|html|word|docx)\b|dosya yap|dosya olarak/.test(q) && !wantsPdfFromText(q) && !wantsExcelFromText(q) && !wantsZipFromText(q);
}

function wantsQrFromText(text = "") {
  const q = normalizeIntentText(text);
  return /\bqr\b|karekod|qr kod/.test(q);
}

function wantsOcrFromText(text = "") {
  const q = normalizeIntentText(text);
  return /\bocr\b|gorselden yazi|gorseldeki yazi|gorseldeki metin|resimdeki yazi|resimdeki metin|fotograftaki yazi|fotograftaki metin|goruntu metni|metni oku|yaziyi oku|yazıyı oku|resmi oku|gorseli oku/.test(q);
}

function wantsMermaidFromText(text = "") {
  const q = normalizeIntentText(text);
  return /mermaid|diyagram|flowchart|akış|akis|şema|sema/.test(q);
}

function wantsTextStatsFromText(text = "") {
  const q = normalizeIntentText(text);
  return /textstats|metin istatistik|kelime say|karakter say|satir say|satır say/.test(q);
}

function wantsCalculatorFromText(text = "") {
  const q = normalizeIntentText(text);
  return /\b(hesapla|hesap|calculator|matematik|topla|çarp|carp|böl|bol)\b/.test(q) || /^[0-9+\-*/().,%\s]+$/.test(q);
}

function wantsTimeFromText(text = "") {
  const q = normalizeIntentText(text);
  return /\b(saat|tarih|zaman|bugün|bugun)\b/.test(q);
}

function wantsWebFetchFromText(text = "") {
  const q = normalizeIntentText(text);
  return /webfetch|web fetch|siteyi oku|url oku|linki oku|sayfayi oku|sayfayı oku/.test(q) || /https?:\/\//i.test(String(text || ""));
}

function wantsMailFromText(text = "") {
  const q = normalizeIntentText(text);
  return /\b(mail|email|e-posta|eposta)\b/.test(q);
}

function wantsWhatsappFromText(text = "") {
  const q = normalizeIntentText(text);
  return /whatsapp|wp mesaj/.test(q);
}

function wantsTelegramFromText(text = "") {
  const q = normalizeIntentText(text);
  return /telegram/.test(q);
}

function isOnlyTransformCommand(text = "") {
  const q = normalizeIntentText(text).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!q) return false;
  const compact = q
    .replace(/\b(bunu|sunlari|sunlari|son|az onceki|onceki|yukardaki|yukaridaki|tabloyu|metni|icerigi|dosyayi|dosyaları|dosyalari|olarak|seklinde|lutfen|hadi|bana|gonder|hazirla|yap|yaz|ver|indir|cevir|donustur)\b/g, " ")
    .replace(/\s+/g, " ").trim();
  return /^(pdf|excel|xlsx|xls|zip|docx|word|csv|json)$/.test(compact) || q.length <= 42;
}

function stripToolNoise(text = "") {
  return String(text || "")
    .replace(/```json\s*[\s\S]*?```/gi, "")
    .replace(/```lucy-widget\s*[\s\S]*?```/gi, "")
    .replace(/\{\s*"tool_call"\s*:\s*\{[\s\S]*?\}\s*\}/gi, "")
    .trim();
}

// ============================================================
//  LUCY PROFESSIONAL TOOL MEMORY / ORCHESTRATOR CORE
//  ChatGPT benzeri "bunu excel/pdf/zip/grafik yap" zinciri.
// ============================================================
const TOOL_MEMORY_MAX = Number(process.env.LUCY_TOOL_MEMORY_MAX || 120);
const toolMemoryByChat = new Map();

function newToolMemory() {
  return {
    lastText: "",
    lastTable: null,
    lastChart: null,
    lastMermaid: null,
    lastFile: null,
    lastPdf: null,
    lastExcel: null,
    lastZip: null,
    lastQr: null,
    lastOcr: null,
    lastStats: null,
    lastCalc: null,
    lastWeb: null,
    updatedAt: Date.now(),
  };
}

function conversationKey(req) {
  const body = req?.body || {};
  return String(
    body.chatId || body.conversationId || body.threadId || body.sessionId ||
    body.activeChatId || body.activeChat?.id || body.currentChatId ||
    body.projectId || body.activeProject?.id || "default"
  );
}

function compactToolMemoryStore() {
  if (toolMemoryByChat.size <= TOOL_MEMORY_MAX) return;
  const entries = [...toolMemoryByChat.entries()].sort((a, b) => (a[1].updatedAt || 0) - (b[1].updatedAt || 0));
  entries.slice(0, Math.max(1, entries.length - TOOL_MEMORY_MAX)).forEach(([key]) => toolMemoryByChat.delete(key));
}

function getStoredToolMemory(req) {
  const key = conversationKey(req);
  if (!toolMemoryByChat.has(key)) toolMemoryByChat.set(key, newToolMemory());
  const memory = toolMemoryByChat.get(key);
  memory.updatedAt = Date.now();
  compactToolMemoryStore();
  return memory;
}

function splitMarkdownTableRow(line = "") {
  const cells = [];
  let current = "";
  let escaped = false;
  const source = String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "");
  for (const char of source) {
    if (escaped) { current += char; escaped = false; continue; }
    if (char === "\\") { escaped = true; continue; }
    if (char === "|") { cells.push(current.trim().replace(/^:+|:+$/g, "")); current = ""; continue; }
    current += char;
  }
  cells.push(current.trim().replace(/^:+|:+$/g, ""));
  return cells;
}

function markdownDividerLine(line = "") {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(String(line || ""));
}

function parseFirstMarkdownTableObject(text = "") {
  const lines = String(text || "").split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (!lines[i].includes("|") || !markdownDividerLine(lines[i + 1])) continue;
    const headers = splitMarkdownTableRow(lines[i]).map((h, idx) => h || `Sütun ${idx + 1}`);
    const rows = [];
    i += 2;
    while (i < lines.length && lines[i].includes("|") && !/^\s*$/.test(lines[i])) {
      if (!markdownDividerLine(lines[i])) {
        const cells = splitMarkdownTableRow(lines[i]);
        const row = {};
        headers.forEach((header, index) => { row[header] = cells[index] ?? ""; });
        if (Object.values(row).some((value) => String(value).trim())) rows.push(row);
      }
      i += 1;
    }
    if (headers.length && rows.length) return { headers, rows, source: "markdown" };
  }
  return null;
}

function normalizeRowsForMemory(rows = [], headers = null) {
  if (!Array.isArray(rows) || !rows.length) return null;
  if (Array.isArray(rows[0])) {
    const head = Array.isArray(headers) && headers.length ? headers : rows[0].map((_, i) => `Sütun ${i + 1}`);
    const dataRows = headers ? rows : rows.slice(1);
    const normalizedRows = dataRows.map((r) => {
      const out = {};
      head.forEach((h, i) => { out[h || `Sütun ${i + 1}`] = r?.[i] ?? ""; });
      return out;
    }).filter((row) => Object.values(row).some((value) => String(value).trim()));
    return normalizedRows.length ? { headers: head, rows: normalizedRows, source: "rows" } : null;
  }
  const normalizedRows = rows.filter((row) => row && typeof row === "object");
  const head = Array.from(normalizedRows.reduce((set, row) => { Object.keys(row).forEach((k) => set.add(k)); return set; }, new Set()));
  return head.length ? { headers: head, rows: normalizedRows, source: "rows" } : null;
}

function tableToMarkdown(table) {
  if (!table?.headers?.length || !table?.rows?.length) return "";
  const headers = table.headers;
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...table.rows.map((row) => `| ${headers.map((header) => String(row?.[header] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`),
  ];
  return lines.join("\n");
}

function tableToMermaidCode(table, title = "LUCY Tablosu") {
  if (!table?.headers?.length || !table?.rows?.length) return "";
  const headers = table.headers;
  const labelKey = headers[0];
  const valueKey = headers.find((header) => table.rows.some((row) => numberFromCell(row?.[header]) !== null)) || headers[1] || headers[0];
  const cleanNode = (value = "") => String(value || "")
    .replace(/[\[\]{}()<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 52) || "Değer";
  const root = cleanNode(title);
  const lines = ["flowchart TD", `A["${root}"]`];
  table.rows.slice(0, 16).forEach((row, index) => {
    const label = cleanNode(row?.[labelKey] ?? `Satır ${index + 1}`);
    const value = cleanNode(row?.[valueKey] ?? "");
    lines.push(`A --> N${index + 1}["${label}${value ? `\\n${value}` : ""}"]`);
  });
  return lines.join("\n");
}

function numberFromCell(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const clean = String(value ?? "")
    .replace(/[%₺$€£]/g, "")
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(/,/g, ".");
  const num = Number(clean);
  return Number.isFinite(num) ? num : null;
}

function tableToChartInput(table, userText = "") {
  if (!table?.headers?.length || !table?.rows?.length) return null;
  const headers = table.headers;
  const sampleRows = table.rows.slice(0, 20);
  let labelKey = headers.find((header) => sampleRows.some((row) => String(row?.[header] ?? "").trim() && numberFromCell(row?.[header]) === null)) || headers[0];
  let valueKey = headers.find((header) => sampleRows.some((row) => numberFromCell(row?.[header]) !== null));
  let values;
  if (valueKey) {
    values = sampleRows.map((row) => numberFromCell(row?.[valueKey]) ?? 0);
  } else {
    valueKey = "Adet";
    values = sampleRows.map(() => 1);
  }
  const labels = sampleRows.map((row, index) => String(row?.[labelKey] ?? `Satır ${index + 1}`).trim() || `Satır ${index + 1}`);
  const chartType = detectChartType(userText);
  return { labels, values, chartType, label: valueKey || "Veri" };
}

function rememberText(memory, text = "") {
  const clean = stripToolNoise(text);
  if (!clean || clean.length < 2) return memory;
  memory.lastText = clean;
  const table = parseFirstMarkdownTableObject(clean);
  if (table) memory.lastTable = table;
  const mermaid = [...String(clean).matchAll(/```mermaid\s*([\s\S]*?)```/gi)].map((m) => String(m[1] || "").trim()).find(Boolean);
  if (mermaid) memory.lastMermaid = { code: mermaid };
  memory.updatedAt = Date.now();
  return memory;
}

function rememberFile(memory, result = {}, toolName = "") {
  const storedFilename = result.storedFilename || result.filename;
  const filename = result.filename || result.storedFilename;
  if (!storedFilename && !result.url && !result.downloadUrl) return memory;
  const file = {
    tool: toolName,
    filename,
    storedFilename,
    url: result.url || result.downloadUrl || "",
    downloadUrl: result.downloadUrl || result.url || "",
    mimeType: result.mimeType || result.contentType || "",
    updatedAt: Date.now(),
  };
  memory.lastFile = file;
  const lower = String(filename || storedFilename || "").toLowerCase();
  if (toolName === "pdf" || lower.endsWith(".pdf")) memory.lastPdf = file;
  if (toolName === "excel" || /\.xlsx?$/.test(lower)) memory.lastExcel = file;
  if (toolName === "zip" || lower.endsWith(".zip")) memory.lastZip = file;
  return memory;
}

function rememberToolResult(req, call = {}, result = {}) {
  const memory = getStoredToolMemory(req);
  const toolName = String(call.tool || result.tool || "").toLowerCase();
  const input = call.input || {};

  if (toolName === "excel") {
    const table = normalizeRowsForMemory(input.rows || result.previewRows, input.headers || result.headers);
    if (table) memory.lastTable = table;
    rememberFile(memory, result, toolName);
  } else if (toolName === "chartdata") {
    memory.lastChart = {
      chartType: result.chartType || input.chartType || "bar",
      data: result.data || input.data || { labels: input.labels || [], datasets: [{ label: input.label || "Veri", data: input.values || [] }] },
    };
  } else if (toolName === "mermaid") {
    memory.lastMermaid = { code: result.code || input.code || input.mermaid || "" };
  } else if (["pdf", "zip", "document", "qr"].includes(toolName)) {
    rememberFile(memory, result, toolName);
    if (toolName === "qr") memory.lastQr = result;
  } else if (toolName === "ocr") {
    memory.lastOcr = result;
    rememberText(memory, result.text || result.message || "");
  } else if (toolName === "textstats") {
    memory.lastStats = result;
  } else if (toolName === "calculator") {
    memory.lastCalc = result;
    memory.lastText = `${result.expression || input.expression || "Hesap"} = ${result.result ?? result.value ?? ""}`;
  } else if (toolName === "webfetch") {
    memory.lastWeb = result;
    rememberText(memory, [result.title, result.text].filter(Boolean).join("\n\n"));
  } else if (["mail", "telegram", "whatsapp", "time", "filemanager"].includes(toolName)) {
    rememberText(memory, result.text || result.message || result.time || "");
  }

  memory.updatedAt = Date.now();
  return memory;
}

function hydrateMemoryFromRequest(req) {
  const memory = getStoredToolMemory(req);
  const messages = Array.isArray(req?.body?.messages) ? req.body.messages : [];
  for (const message of messages.slice(-24)) {
    const text = messageText(message);
    const role = String(message?.role || message?.sender || "").toLowerCase();
    const userInlineContent = role === "user" && (String(text).length > 90 || /\n/.test(text) || hasMarkdownTable(text));
    if (text && (role !== "user" || userInlineContent) && !isOnlyTransformCommand(text)) rememberText(memory, text);
    const refs = extractGeneratedFileRefsFromText(text);
    const lastRef = refs[refs.length - 1];
    if (lastRef?.storedFilename) rememberFile(memory, lastRef, "file");
    const toolResults = Array.isArray(message?.toolResults) ? message.toolResults : [];
    for (const item of toolResults) {
      const result = item?.result || item?.ui?.raw || item?.ui || item;
      rememberToolResult(req, { tool: item?.tool || item?.ui?.tool || result?.tool }, result || {});
    }
  }
  return memory;
}

function sourceFromMemory(req, answer = "") {
  const memory = hydrateMemoryFromRequest(req);
  const answerText = stripToolNoise(answer);
  if (answerText && answerText.length > 30) return answerText;
  if (memory.lastTable?.rows?.length) return tableToMarkdown(memory.lastTable);
  if (memory.lastText) return memory.lastText;
  return latestUsefulConversationContent(req, answer);
}

function missingToolContextMessage(req) {
  const userText = latestUserIntentText(req);
  if (wantsChartFromText(userText)) return "Grafik çizebilmem için önce sayısal veri veya tablo gerekli aşkım. Önce tablo/veri yaz ya da hangi verinin grafiğini çizeceğimi söyle.";
  if (wantsExcelFromText(userText)) return "Excel oluşturabilmem için önce tablo, veri veya dönüştürülebilir metin gerekli aşkım.";
  if (wantsPdfFromText(userText)) return "PDF hazırlayabilmem için önce metin, tablo, rapor içeriği veya dosya gerekli aşkım.";
  if (wantsZipFromText(userText)) return "ZIP oluşturabilmem için önce üretilmiş bir dosya gerekli aşkım.";
  if (wantsQrFromText(userText)) return "QR oluşturabilmem için metin veya link gerekli aşkım.";
  if (wantsMermaidFromText(userText)) return "Diyagram çizebilmem için süreç, akış veya yapı bilgisi gerekli aşkım.";
  return "Bunu yapabilmem için önce kullanacağım içerik veya veri gerekli aşkım.";
}

function messageText(message = {}) {
  return String(message?.content || message?.text || message?.message || "").trim();
}

function latestAssistantContent(req) {
  const messages = Array.isArray(req?.body?.messages) ? req.body.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] || {};
    const role = String(message.role || message.sender || "").toLowerCase();
    if (role === "assistant") {
      const text = stripToolNoise(messageText(message));
      if (text) return text;
    }
  }
  return "";
}

function latestUsefulConversationContent(req, answer = "") {
  const userText = latestUserIntentText(req);
  const answerText = stripToolNoise(answer);
  const previousAssistant = latestAssistantContent(req);

  // Kullanıcı aynı mesajda içerik verdiyse onu önceliklendir: "şunu pdf yap: ..."
  const userHasInlineContent = String(userText || "").length > 90 || /\n/.test(userText) || /\|.+\|/.test(userText);
  if (userHasInlineContent && !isOnlyTransformCommand(userText)) return stripToolNoise(userText);

  // Model bir tablo/metin ürettiyse ve dosya isteniyorsa onu kullan.
  if (answerText && answerText.length > 30 && !/^tamam|tabii|olur|hazir/i.test(normalizeIntentText(answerText))) return answerText;

  // "bunu pdf/excel/zip yap" gibi komutlarda son gerçek assistant içeriğini kullan.
  if (previousAssistant) return previousAssistant;
  if (answerText) return answerText;
  return stripToolNoise(userText);
}

function hasMarkdownTable(text = "") {
  const lines = String(text || "").split(/\r?\n/);
  return lines.some((line, index) => line.includes("|") && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1] || ""));
}

function contentTitleFromText(text = "", fallback = "LUCY Çıktısı") {
  const firstHeading = String(text || "").split(/\r?\n/).map((line) => line.trim()).find((line) => /^#{1,4}\s+/.test(line));
  if (firstHeading) return firstHeading.replace(/^#{1,4}\s+/, "").slice(0, 70);
  const firstLine = String(text || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (firstLine && !firstLine.includes("|")) return firstLine.replace(/[*_`#]/g, "").slice(0, 70);
  return fallback;
}

function safeOutputStem(value = "lucy-cikti") {
  return String(value || "lucy-cikti")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ıİ]/g, "i")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[şŞ]/g, "s")
    .replace(/[öÖ]/g, "o")
    .replace(/[çÇ]/g, "c")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 54) || "lucy-cikti";
}


function isImageFileName(name = "") {
  return /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(String(name || ""));
}

function extractImageBase64FromRequest(req) {
  const body = req?.body || {};
  const direct = body.base64 || body.imageBase64 || body.fileBase64 || body.dataUrl || body.imageDataUrl;
  if (direct) return { base64: direct, mimeType: body.mimeType || body.contentType || "image/png" };

  const candidates = [];
  if (Array.isArray(body.files)) candidates.push(...body.files);
  if (Array.isArray(body.attachments)) candidates.push(...body.attachments);
  if (body.file && typeof body.file === "object") candidates.push(body.file);
  if (body.image && typeof body.image === "object") candidates.push(body.image);

  for (const file of candidates) {
    const raw = file?.base64 || file?.imageBase64 || file?.dataUrl || file?.content;
    const mime = String(file?.mimeType || file?.type || file?.contentType || "");
    const name = String(file?.name || file?.filename || file?.originalName || "");
    if (raw && (mime.startsWith("image/") || isImageFileName(name))) {
      return { base64: raw, mimeType: mime || "image/png", filename: name };
    }
  }

  return null;
}

function lastImageFileFromMemory(memory = {}) {
  const candidates = [memory.lastFile, memory.lastQr, memory.lastPdf, memory.lastExcel].filter(Boolean);
  return candidates.find((file) => isImageFileName(file?.storedFilename || file?.filename || "")) || null;
}

function buildImplicitToolCalls(answer = "", req) {
  const userText = latestUserIntentText(req);
  const memory = hydrateMemoryFromRequest(req);
  const source = sourceFromMemory(req, answer);
  const inlineTable = parseFirstMarkdownTableObject(source);
  const activeTable = inlineTable || memory.lastTable;
  const title = contentTitleFromText(source, activeTable ? "LUCY Tablosu" : "LUCY Çıktısı");
  const stem = safeOutputStem(title);
  const calls = [];

  if (wantsCalculatorFromText(userText) && !wantsExcelFromText(userText) && !wantsPdfFromText(userText)) {
    const expression = String(userText || "").replace(/hesapla|hesap|calculator/gi, "").trim();
    if (/[0-9]/.test(expression)) calls.push({ tool: "calculator", input: { expression } });
  }

  if (wantsTimeFromText(userText) && !calls.length) {
    calls.push({ tool: "time", input: { locale: "tr-TR", timeZone: "Europe/Istanbul" } });
  }

  if (wantsWebFetchFromText(userText)) {
    const url = String(userText).match(/https?:\/\/\S+/i)?.[0]?.replace(/[),.;]+$/g, "");
    if (url) calls.push({ tool: "webFetch", input: { url } });
  }

  if (wantsOcrFromText(userText)) {
    const requestImage = extractImageBase64FromRequest(req);
    if (requestImage?.base64) {
      calls.push({ tool: "ocr", input: { base64: requestImage.base64, mimeType: requestImage.mimeType, filename: requestImage.filename, lang: "tur+eng" } });
    } else {
      const img = lastImageFileFromMemory(memory);
      if (img?.storedFilename) calls.push({ tool: "ocr", input: { storedFilename: img.storedFilename, filename: img.filename || img.storedFilename, lang: "tur+eng" } });
    }
  }

  if (wantsChartFromText(userText)) {
    const chartInput = tableToChartInput(activeTable, userText);
    if (chartInput) calls.push({ tool: "chartData", input: { ...chartInput, title } });
  }

  if (wantsMermaidFromText(userText)) {
    if (memory.lastMermaid?.code && /daha\s+(karmasik|detayli|genis|buyuk)|gelistir|ayrintili/.test(normalizeIntentText(userText))) {
      calls.push({ tool: "mermaid", input: { code: memory.lastMermaid.code, title } });
    } else if (activeTable?.rows?.length) {
      const code = tableToMermaidCode(activeTable, title || "LUCY Diyagramı");
      if (code) calls.push({ tool: "mermaid", input: { code, title: title || "LUCY Diyagramı" } });
    } else if (source) {
      const code = String(source).match(/```mermaid\s*([\s\S]*?)```/i)?.[1]?.trim();
      if (code) calls.push({ tool: "mermaid", input: { code, title } });
    }
  }

  if (wantsExcelFromText(userText)) {
    const excelInput = activeTable?.rows?.length
      ? { title, sheetName: title.slice(0, 31), rows: activeTable.rows, headers: activeTable.headers, filename: `${stem || "lucy-tablo"}.xlsx` }
      : { title, sheetName: title.slice(0, 31), text: source, filename: `${stem || "lucy-tablo"}.xlsx` };
    calls.push({ tool: "excel", input: excelInput });
  }

  if (wantsPdfFromText(userText)) {
    const pdfText = activeTable?.rows?.length && isOnlyTransformCommand(userText) ? tableToMarkdown(activeTable) : source;
    calls.push({ tool: "pdf", input: { title, text: pdfText, filename: `${stem || "lucy-rapor"}.pdf` } });
  }

  if (wantsQrFromText(userText)) {
    const url = String(userText).match(/https?:\/\/\S+/i)?.[0]?.replace(/[),.;]+$/g, "");
    const text = url || (!isOnlyTransformCommand(userText) ? userText : memory.lastText || source);
    if (String(text || "").trim()) calls.push({ tool: "qr", input: { text, filename: `${stem || "lucy-qr"}.png` } });
  }

  if (wantsTextStatsFromText(userText)) {
    const text = !isOnlyTransformCommand(userText) && String(userText).length > 40 ? userText : memory.lastText || source;
    if (String(text || "").trim()) calls.push({ tool: "textStats", input: { text } });
  }

  if (wantsDocumentFromText(userText)) {
    const q = normalizeIntentText(userText);
    const format = q.includes("csv") ? "csv" : q.includes("json") ? "json" : q.includes("html") ? "html" : q.includes("txt") ? "txt" : "md";
    const content = activeTable?.rows?.length && format !== "json" && format !== "csv" ? tableToMarkdown(activeTable) : source;
    if (String(content || "").trim()) calls.push({ tool: "document", input: { title, content, rows: activeTable?.rows, format, filename: `${stem || "lucy-belge"}.${format}` } });
  }

  if (wantsZipFromText(userText)) {
    const fileCandidates = [memory.lastFile, memory.lastPdf, memory.lastExcel, memory.lastDocument]
      .filter(Boolean)
      .filter((file) => file?.storedFilename && !String(file.filename || file.storedFilename || "").toLowerCase().endsWith(".zip"));
    const last = fileCandidates[0];
    const refs = collectConversationGeneratedFileRefs(req)
      .filter((ref) => ref?.storedFilename && !String(ref.filename || ref.storedFilename || "").toLowerCase().endsWith(".zip"));
    const ref = refs[refs.length - 1];
    const chosen = last || ref || null;
    const files = chosen?.storedFilename ? [{ storedFilename: chosen.storedFilename, filename: chosen.filename || chosen.storedFilename }] : undefined;
    calls.push({ tool: "zip", input: { filename: `${stem || "lucy-dosyalari"}.zip`, ...(files ? { files } : {}) } });
  }

  return calls.map((call) => enrichToolCallInput(call, req)).filter(isUsableToolCall).slice(0, 5);
}

function deepSeekPlannerEnabled() {
  return /^(1|true|yes|on)$/i.test(envValue("LUCY_DS_TOOL_PLANNER_ENABLED"));
}

async function buildDeepSeekPlannerToolCalls(answer = "", req) {
  // DS planner artık ana sürücü değil; yalnızca isteğe bağlı fallback.
  // Stabil ve hızlı path: normalize -> direct intent -> validate -> tool.
  if (!deepSeekPlannerEnabled()) return [];

  const userText = latestUserIntentText(req);
  const memory = hydrateMemoryFromRequest(req);

  try {
    const planned = await planToolCallsWithDeepSeek({
      userText,
      memory,
      availableTools: listLoadedTools().map((tool) => tool.name || tool),
    });

    if (!Array.isArray(planned) || !planned.length) return [];

    return planned
      .map((call) => enrichToolCallInput(call, req))
      .filter(isUsableToolCall)
      .slice(0, 5);
  } catch (error) {
    console.warn("Lucy DS tool planner fallback devre dışı:", error.message);
    return [];
  }
}


function buildToolFinalAnswer(toolResults = []) {
  const lines = [];
  const widgets = [];

  for (const item of toolResults || []) {
    const ui = item?.ui || normalizeToolResultForUI(item?.tool, item?.result || {}, item?.input || {});
    const tool = String(item?.tool || ui.tool || "tool");

    if (!ui.success) {
      lines.push(`❌ ${ui.title || tool}: ${ui.text || ui.raw?.message || ui.raw?.error || "Tool çalışmadı."}`);
      widgets.push(widgetFence(ui));
      continue;
    }

    if (ui.downloadUrl) {
      const fileName = ui.filename || ui.title || "dosya";
      lines.push(`✅ ${fileName} hazırlandı. [Dosya: ${fileName}](${ui.downloadUrl})`);
      widgets.push(widgetFence(ui));
      continue;
    }

    if (ui.type === "chart") {
      lines.push(`✅ ${ui.title || "Grafik"} hazırlandı.`);
      widgets.push(widgetFence(ui));
      continue;
    }

    if (ui.type === "mermaid") {
      lines.push(`✅ ${ui.title || "Diyagram"} hazırlandı.`);
      if (ui.code) lines.push(`\n\`\`\`mermaid\n${ui.code}\n\`\`\``);
      widgets.push(widgetFence(ui));
      continue;
    }

    if (ui.text) {
      lines.push(ui.text);
      widgets.push(widgetFence(ui));
      continue;
    }

    lines.push(summarizeToolResultLine(tool, ui));
    widgets.push(widgetFence(ui));
  }

  const cleanLines = lines.filter(Boolean).join("\n").trim();
  const cleanWidgets = widgets.filter(Boolean).join("");
  return `${cleanLines}${cleanWidgets}`.trim();
}

async function executeToolCallsFromAnswer(answer = "", req) {
  hydrateMemoryFromRequest(req);
  const explicitCalls = extractToolCallsFromAnswer(answer);
  const allowMermaid = requestedMermaidWork(req);
  const allowAnyTool = requestedToolWork(req);
  const mermaidCalls = explicitCalls.length || !allowMermaid ? [] : extractMermaidBlocksFromAnswer(answer);
  const rawToolCalls = [...explicitCalls, ...mermaidCalls];

  // Öncelik: explicit model tool_call -> kod tabanlı direct intent -> opsiyonel DS fallback.
  let toolCalls = rawToolCalls.map((call) => enrichToolCallInput(call, req)).filter(isUsableToolCall);

  if (!toolCalls.length && allowAnyTool) {
    const implicitCalls = buildImplicitToolCalls(answer, req);
    if (implicitCalls.length) toolCalls = implicitCalls;
  }

  if (!toolCalls.length && allowAnyTool && deepSeekPlannerEnabled()) {
    const plannerCalls = await buildDeepSeekPlannerToolCalls(answer, req);
    if (plannerCalls.length) toolCalls = plannerCalls;
  }

  if (!toolCalls.length) {
    const cleaned = sanitizeNormalAnswer(answer, req);
    if (cleaned) rememberText(getStoredToolMemory(req), cleaned);
    return {
      toolCalls: [],
      toolResults: [],
      finalAnswer: cleaned || (allowAnyTool ? missingToolContextMessage(req) : "Tamam aşkım, buradayım. Ne istersen birlikte yaparız. 💙"),
    };
  }

  const toolResults = [];

  for (const call of toolCalls) {
    const validation = validateToolInput(call, req);
    if (!validation.ok) {
      const failed = { success: false, error: validation.code, message: validation.message };
      const ui = normalizeToolResultForUI(call.tool, failed, call.input);
      toolResults.push({ tool: call.tool, input: call.input, result: failed, ui });
      continue;
    }

    const rawResult = await executeLucyTool(call.tool, call.input, numberEnv("LUCY_TOOL_TIMEOUT_MS", 30000));
    const persistedResult = persistToolFileResult(rawResult, req);
    rememberToolResult(req, call, persistedResult);
    const ui = normalizeToolResultForUI(call.tool, persistedResult, call.input);

    toolResults.push({
      tool: call.tool,
      input: call.input,
      result: persistedResult,
      ui,
    });
  }

  const finalAnswer = buildToolFinalAnswer(toolResults);
  return { toolCalls, toolResults, finalAnswer };
}

module.exports = {
  publicBaseUrl,
  listLoadedTools,
  getLoadedTool,
  executeLucyTool,
  persistToolFileResult,
  executeToolCallsFromAnswer,
};
