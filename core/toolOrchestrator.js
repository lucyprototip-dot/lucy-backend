const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const dotenv = require("dotenv");
const { normalizeToolIntentText, detectChartType, detectVisualStyle, detectColorPalette, likelyToolIntent } = require("./intentNormalizer");
const { planToolCallsWithDeepSeek } = require("./toolPlanner");
const {
  normalizeIntentText,
  wantsPdfFromText,
  wantsExcelFromText,
  wantsZipFromText,
  wantsChartFromText,
  wantsDocumentFromText,
  wantsQrFromText,
  wantsOcrFromText,
  wantsMermaidFromText,
  wantsTextStatsFromText,
  wantsCalculatorFromText,
  wantsTimeFromText,
  wantsWebFetchFromText,
  wantsMailFromText,
  wantsWhatsappFromText,
  wantsTelegramFromText,
  isOnlyTransformCommand,
  stripToolNoise,
} = require("./toolIntentDetector");
const {
  listLoadedTools,
  getLoadedTool,
  executeLucyTool,
} = require("./toolExecutor");
const {
  normalizeToolResultForUI,
  widgetFence,
  summarizeToolResultLine,
} = require("./toolResponseAdapter");
const {
  numberFromCell,
  tableToChartInput,
  chartToChartInput,
  tableToMermaidCode,
  chartToMermaidCode,
  chartUiFromMemory,
  mermaidUiFromMemory,
} = require("./chartMermaidEngine");

dotenv.config();

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


function decodeHtmlEntities(value = "") {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#x22;/gi, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtmlToolButtons(text = "") {
  return String(text || "")
    .replace(/<button\b[^>]*\bdata-tool\s*=\s*(?:"[^"]*"|'[^']*')[\s\S]*?<\/button>/gi, "")
    .replace(/<button\b[^>]*\bdata-tool\s*=\s*(?:"[^"]*"|'[^']*')[^>]*\/?>/gi, "")
    .replace(/<lucy-tool\b[\s\S]*?<\/lucy-tool>/gi, "")
    .replace(/<lucy-widget\b[\s\S]*?<\/lucy-widget>/gi, "");
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


function extractToolCallsFromHtmlButtons(answer = "") {
  const source = String(answer || "");
  const calls = [];
  const buttonRegex = /<button\b([^>]*)\bdata-tool\s*=\s*("[^"]*"|'[^']*')([^>]*)>(?:[\s\S]*?<\/button>)?/gi;

  for (const match of source.matchAll(buttonRegex)) {
    const attrs = `${match[1] || ""} data-tool=${match[2] || ""} ${match[3] || ""}`;
    const toolRaw = decodeHtmlEntities(String(match[2] || "").replace(/^['"]|['"]$/g, "")).trim();
    if (!toolRaw) continue;

    let input = {};
    const paramsMatch = attrs.match(/\bdata-params\s*=\s*("[\s\S]*?"|'[\s\S]*?')/i);
    const inputMatch = attrs.match(/\bdata-input\s*=\s*("[\s\S]*?"|'[\s\S]*?')/i);
    const rawParams = paramsMatch?.[1] || inputMatch?.[1] || "";
    if (rawParams) {
      const decoded = decodeHtmlEntities(String(rawParams).replace(/^['"]|['"]$/g, "")).trim();
      const parsed = safeJsonParse(decoded);
      if (parsed && typeof parsed === "object") input = parsed;
    }

    calls.push({ tool: toolRaw, input });
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
    const style = { ...(input.style || {}), ...detectVisualStyle(userText) };
    const palette = detectColorPalette(userText);
    if (palette.requested) {
      style.colorful = true;
      style.palette = palette.name;
      style.colors = palette.colors;
      input.colors = palette.colors;
    }
    input.style = style;
    input.chartType = detectChartType(userText) || input.chartType || input.type || "bar";

    if (!(Array.isArray(labels) && labels.length && Array.isArray(values) && values.length)) {
      const selectedChart = chartFromHistory(memory, userText);
      const selectedTable = tableFromHistory(memory, userText) || memory.lastTable;
      const preferExistingChart = userSpecificallyReferencesChart(userText) && selectedChart?.data;
      const chartInput = preferExistingChart
        ? chartToChartInput(selectedChart, userText)
        : selectedTable?.rows?.length
          ? tableToChartInput(selectedTable, userText)
          : chartToChartInput(selectedChart || memory.lastChart, userText);
      if (chartInput) Object.assign(input, chartInput, { style: { ...(chartInput.style || {}), ...style }, colors: input.colors || chartInput.colors });
    }
  }

  if (toolName === "mermaid" && !String(input.code || input.mermaid || "").trim()) {
    const selectedTable = tableFromHistory(memory, userText) || memory.lastTable;
    const selectedChart = chartFromHistory(memory, userText) || memory.lastChart;
    const generated = selectedTable?.rows?.length
      ? tableToMermaidCode(selectedTable, input.title || "LUCY Diyagramı", userText)
      : selectedChart?.data
        ? chartToMermaidCode(selectedChart, input.title || selectedChart.title || "LUCY Grafiği", userText)
        : "";
    if (generated) input.code = generated;
    else if (memory.lastMermaid?.code) input.code = memory.lastMermaid.code;
    input.userText = userText;
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
  return /mermaid|diyagram|flowchart|akis|sema|kutular|baglantili|bagla|akisi/.test(text);
}

function stripToolOnlyBlocks(answer = "") {
  return stripHtmlToolButtons(String(answer || ""))
    .replace(/```json\s*[\s\S]*?```/gi, "")
    .replace(/```lucy-widget\s*[\s\S]*?```/gi, "")
    .replace(/```mermaid\s*[\s\S]*?```/gi, "")
    .replace(/\{\s*"tool_call"\s*:\s*\{[\s\S]*?\}\s*\}/gi, "")
    .trim();
}


function sanitizeNormalAnswer(answer = "", req = null) {
  let text = stripHtmlToolButtons(String(answer || ""));

  // Normal sohbetlerde model bazen önceki tool JSON'undan kalan kapanış parantezlerini veya
  // yarım tool bloklarını döndürebiliyor. Kullanıcıya asla ham JSON/parantez göstermeyelim.
  text = text
    .replace(/```json\s*[\s\S]*?```/gi, "")
    .replace(/```lucy-widget\s*[\s\S]*?```/gi, "")
    .replace(/```mermaid\s*[\s\S]*?```/gi, "")
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


// ============================================================
//  LUCY PROFESSIONAL TOOL MEMORY / ORCHESTRATOR CORE
//  ChatGPT benzeri "bunu excel/pdf/zip/grafik yap" zinciri.
// ============================================================
const TOOL_MEMORY_MAX = Number(process.env.LUCY_TOOL_MEMORY_MAX || 120);
const CONTENT_HISTORY_MAX = Number(process.env.LUCY_CONTENT_HISTORY_MAX || 260);
const HYDRATE_MESSAGE_MAX = Number(process.env.LUCY_HYDRATE_MESSAGE_MAX || 240);
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
    activeContent: null,
    contentHistory: [],
    index: { tables: [], charts: [], mermaids: [], texts: [], files: [] },
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

function cloneJsonSafe(value) {
  if (value === undefined || value === null) return value;
  try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
}

function contentFingerprint(content = {}) {
  const type = String(content.type || "");
  if (type === "table") {
    const table = content.table || {};
    return `table:${JSON.stringify({ headers: table.headers || [], first: table.rows?.[0] || null, rows: table.rows?.length || 0 })}`;
  }
  if (type === "chart") {
    const data = content.chart?.data || content.ui?.data || content.data || {};
    return `chart:${JSON.stringify({ labels: data.labels || [], values: data.datasets?.[0]?.data || [], title: content.title || "" })}`;
  }
  if (type === "mermaid") return `mermaid:${String(content.code || content.mermaid || content.ui?.code || "").replace(/\s+/g, " ").slice(0, 900)}`;
  if (type === "file") return `file:${content.file?.storedFilename || content.file?.filename || content.storedFilename || content.filename || ""}`;
  return `${type}:${String(content.text || content.title || "").replace(/\s+/g, " ").slice(0, 900)}`;
}

function ensureConversationIndex(memory) {
  if (!memory.index || typeof memory.index !== "object") memory.index = {};
  for (const key of ["tables", "charts", "mermaids", "texts", "files"]) {
    if (!Array.isArray(memory.index[key])) memory.index[key] = [];
  }
  return memory.index;
}

function pushIndexed(memory, bucket, item = {}) {
  const index = ensureConversationIndex(memory);
  const list = index[bucket];
  const fingerprint = item.fingerprint || contentFingerprint(item);
  if (!fingerprint) return;
  if (list.some((entry) => entry.fingerprint === fingerprint)) return;
  list.push({ ...cloneJsonSafe(item), fingerprint, order: list.length + 1, rememberedAt: Date.now() });
  if (list.length > CONTENT_HISTORY_MAX) list.splice(0, list.length - CONTENT_HISTORY_MAX);
}

function pushContentHistory(memory, content) {
  if (!memory || !content) return memory;
  if (!Array.isArray(memory.contentHistory)) memory.contentHistory = [];
  const clean = cloneJsonSafe(content);
  const fingerprint = contentFingerprint(clean);
  if (!fingerprint) return memory;

  if (!memory.contentHistory.some((entry) => entry.fingerprint === fingerprint)) {
    memory.contentHistory.push({ ...clean, fingerprint, rememberedAt: Date.now() });
    if (memory.contentHistory.length > CONTENT_HISTORY_MAX) memory.contentHistory = memory.contentHistory.slice(-CONTENT_HISTORY_MAX);
  }

  if (clean.type === "table" && clean.table?.rows?.length) pushIndexed(memory, "tables", clean);
  else if (clean.type === "chart" && (clean.chart?.data || clean.ui?.data)) pushIndexed(memory, "charts", clean);
  else if (clean.type === "mermaid" && String(clean.code || clean.mermaid || clean.ui?.code || "").trim()) pushIndexed(memory, "mermaids", clean);
  else if (clean.type === "file" || clean.file || clean.storedFilename || clean.filename) pushIndexed(memory, "files", clean);
  else if (clean.type === "text" && String(clean.text || "").trim()) pushIndexed(memory, "texts", clean);

  return memory;
}

function setActiveContent(memory, content = {}) {
  if (!memory || !content || typeof content !== "object") return memory;
  const type = String(content.type || "").trim();
  if (!type) return memory;
  const clean = {
    ...cloneJsonSafe(content),
    type,
    updatedAt: Date.now(),
  };
  memory.activeContent = clean;
  pushContentHistory(memory, clean);
  memory.updatedAt = Date.now();
  return memory;
}

function activeContentTable(content = {}) {
  if (!content || typeof content !== "object") return null;
  if (content.type === "table" && content.table?.rows?.length) return content.table;
  if (content.table?.rows?.length) return content.table;
  if (content.text) return parseFirstMarkdownTableObject(content.text);
  return null;
}

function activeContentToText(content = {}, fallback = "") {
  if (!content || typeof content !== "object") return fallback || "";
  if (content.type === "table" && content.table?.rows?.length) return tableToMarkdown(content.table);
  if (content.type === "text" && String(content.text || "").trim()) return content.text;
  if (content.type === "chart") {
    const ui = content.ui || chartUiFromMemory(content.chart || content, content.title || "Grafik");
    return ui ? widgetFence(ui) : (content.text || fallback || "");
  }
  if (content.type === "mermaid") {
    const code = content.code || content.mermaid || content.ui?.code || "";
    const ui = content.ui || mermaidUiFromMemory({ code, title: content.title }, content.title || "Mermaid diyagram");
    return ui ? widgetFence(ui) : (fallback || "");
  }
  if (content.type === "file" && content.file) return content.file.url || content.file.filename || fallback || "";
  return String(content.text || fallback || "").trim();
}

function resolveActiveContent(req, answer = "") {
  const memory = hydrateMemoryFromRequest(req);
  const userText = latestUserIntentText(req);
  const answerText = stripToolNoise(answer);

  // Aynı mesajda uzun içerik/metin verildiyse öncelik kullanıcının son içeriği.
  if (!isOnlyTransformCommand(userText) && (String(userText).length > 90 || /\n/.test(userText) || hasMarkdownTable(userText))) {
    const table = parseFirstMarkdownTableObject(userText);
    return table
      ? { type: "table", table, text: tableToMarkdown(table), title: contentTitleFromText(userText, "LUCY Tablosu"), source: "user-inline" }
      : { type: "text", text: stripToolNoise(userText), title: contentTitleFromText(userText, "LUCY İçeriği"), source: "user-inline" };
  }

  // Model bu turda gerçek içerik ürettiyse onu kullan.
  if (answerText && answerText.length > 30 && !/^tamam|tabii|olur|hazir/i.test(normalizeIntentText(answerText))) {
    const table = parseFirstMarkdownTableObject(answerText);
    return table
      ? { type: "table", table, text: tableToMarkdown(table), title: contentTitleFromText(answerText, "LUCY Tablosu"), source: "assistant-answer" }
      : { type: "text", text: answerText, title: contentTitleFromText(answerText, "LUCY İçeriği"), source: "assistant-answer" };
  }

  if (memory.activeContent) return memory.activeContent;
  if (memory.lastTable?.rows?.length) return { type: "table", table: memory.lastTable, text: tableToMarkdown(memory.lastTable), title: "LUCY Tablosu", source: "lastTable" };
  if (memory.lastChart?.data) return { type: "chart", chart: memory.lastChart, ui: chartUiFromMemory(memory.lastChart, "Grafik"), title: "Grafik", source: "lastChart" };
  if (memory.lastMermaid?.code) return { type: "mermaid", code: memory.lastMermaid.code, ui: mermaidUiFromMemory(memory.lastMermaid, "Mermaid diyagram"), title: "Mermaid diyagram", source: "lastMermaid" };
  if (memory.lastText) return { type: "text", text: memory.lastText, title: contentTitleFromText(memory.lastText, "LUCY İçeriği"), source: "lastText" };
  return null;
}

function rememberLucyWidget(memory, widget = {}) {
  if (!memory || !widget || typeof widget !== "object") return memory;
  const type = String(widget.type || widget.raw?.type || widget.tool || "").toLowerCase();
  const tool = String(widget.tool || widget.raw?.tool || "").toLowerCase();

  if (type.includes("chart") || tool === "chartdata") {
    const chart = {
      chartType: widget.chartType || widget.raw?.chartType || "bar",
      data: widget.data || widget.raw?.data || null,
      title: widget.title || widget.raw?.title || "Grafik",
      style: widget.style || widget.raw?.style || {},
      colors: widget.colors || widget.palette || widget.raw?.colors || widget.raw?.palette || widget.style?.colors || [],
      palette: widget.palette || widget.colors || widget.raw?.palette || widget.raw?.colors || widget.style?.colors || [],
    };
    if (chart.data?.labels?.length) {
      memory.lastChart = chart;
      setActiveContent(memory, { type: "chart", chart, ui: widget, title: chart.title, source: "widget" });
    }
  } else if (type.includes("mermaid") || tool === "mermaid") {
    const code = widget.code || widget.raw?.code || "";
    if (String(code || "").trim()) {
      memory.lastMermaid = { code, title: widget.title || "Mermaid diyagram" };
      setActiveContent(memory, { type: "mermaid", code, ui: widget, title: widget.title || "Mermaid diyagram", source: "widget" });
    }
  } else if (type.includes("file") || widget.url || widget.downloadUrl || widget.filename || widget.storedFilename) {
    rememberFile(memory, widget, widget.tool || "file");
  }
  return memory;
}

function extractLucyWidgetsFromText(text = "") {
  const source = String(text || "");
  const widgets = [];
  for (const match of source.matchAll(/```lucy-widget\s*([\s\S]*?)```/gi)) {
    const widget = safeJsonParse(String(match[1] || "").trim());
    if (widget && typeof widget === "object") widgets.push(widget);
  }
  return widgets;
}

function isGeneratedStatusOnlyText(text = "") {
  const clean = normalizeIntentText(stripToolNoise(text));
  if (!clean) return false;
  if (hasMarkdownTable(text)) return false;
  if (/```(?:lucy-widget|mermaid)/i.test(String(text || ""))) return false;
  return clean.length < 180 && /(indirme hazirlandi|asagidan indirebilirsin|dosya hazirlandi|pdf hazirlandi|excel.*hazir|xlsx.*hazir|zip.*hazir|grafik hazirlandi|diyagram hazirlandi)/.test(clean);
}

function rememberText(memory, text = "") {
  const clean = stripToolNoise(text);
  if (!clean || clean.length < 2) return memory;
  if (isGeneratedStatusOnlyText(text)) return memory;
  memory.lastText = clean;
  const table = parseFirstMarkdownTableObject(clean);
  if (table) {
    memory.lastTable = table;
    setActiveContent(memory, { type: "table", table, text: tableToMarkdown(table), title: contentTitleFromText(clean, "LUCY Tablosu"), source: "text" });
  } else {
    setActiveContent(memory, { type: "text", text: clean, title: contentTitleFromText(clean, "LUCY İçeriği"), source: "text" });
  }
  const mermaid = [...String(clean).matchAll(/```mermaid\s*([\s\S]*?)```/gi)].map((m) => String(m[1] || "").trim()).find(Boolean);
  if (mermaid) {
    memory.lastMermaid = { code: mermaid };
    setActiveContent(memory, { type: "mermaid", code: mermaid, title: "Mermaid diyagram", source: "text" });
  }
  extractLucyWidgetsFromText(clean).forEach((widget) => rememberLucyWidget(memory, widget));
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
    if (table) {
      memory.lastTable = table;
      setActiveContent(memory, { type: "table", table, text: tableToMarkdown(table), title: input.title || result.title || "LUCY Tablosu", source: "excel" });
    }
    rememberFile(memory, result, toolName);
  } else if (toolName === "chartdata") {
    const chart = {
      chartType: result.chartType || input.chartType || "bar",
      data: result.data || input.data || { labels: input.labels || [], datasets: [{ label: input.label || "Veri", data: input.values || [] }] },
      title: result.title || input.title || input.label || "Grafik",
      style: result.style || input.style || {},
      colors: result.colors || result.palette || input.colors || input.palette || result.style?.colors || input.style?.colors || [],
      palette: result.palette || result.colors || input.palette || input.colors || result.style?.colors || input.style?.colors || [],
    };
    memory.lastChart = chart;
    setActiveContent(memory, { type: "chart", chart, ui: chartUiFromMemory(chart, chart.title), title: chart.title, source: "chartData" });
  } else if (toolName === "mermaid") {
    const code = result.code || input.code || input.mermaid || "";
    memory.lastMermaid = { code, title: result.title || input.title || "Mermaid diyagram" };
    if (String(code || "").trim()) setActiveContent(memory, { type: "mermaid", code, ui: mermaidUiFromMemory({ code, title: result.title || input.title }, result.title || input.title || "Mermaid diyagram"), title: result.title || input.title || "Mermaid diyagram", source: "mermaid" });
  } else if (["pdf", "zip", "document", "qr"].includes(toolName)) {
    rememberFile(memory, result, toolName);
    if (toolName === "qr") memory.lastQr = result;
    // Dosya üretmek aktif kaynak içeriğini ezmesin: "bunu pdf yap" sonrası "bunu excel yap" hâlâ aynı tablo/metni kullanmalı.
    if (toolName === "document" && String(input.content || input.text || "").trim()) {
      const text = String(input.content || input.text || "");
      const table = parseFirstMarkdownTableObject(text);
      if (table) setActiveContent(memory, { type: "table", table, text: tableToMarkdown(table), title: input.title || result.title || "LUCY Belgesi", source: "document" });
      else setActiveContent(memory, { type: "text", text, title: input.title || result.title || "LUCY Belgesi", source: "document" });
    }
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
  for (const message of messages.slice(-HYDRATE_MESSAGE_MAX)) {
    const text = messageText(message);
    const role = String(message?.role || message?.sender || "").toLowerCase();
    const userInlineContent = role === "user" && (String(text).length > 90 || /\n/.test(text) || hasMarkdownTable(text));
    if (text && (role !== "user" || userInlineContent) && !isOnlyTransformCommand(text)) rememberText(memory, text);
    extractLucyWidgetsFromText(text).forEach((widget) => rememberLucyWidget(memory, widget));
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
  const active = resolveActiveContent(req, answer);
  const activeText = activeContentToText(active, "");
  if (activeText) return activeText;

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


function userExplicitlyReferencesChart(userText = "") {
  const q = normalizeIntentText(userText);
  return /\b(grafik|chart|pasta|pie|yuvarlak|daire|dilim|donut|halka|trend|cizgi|line|bar|cubuk|sutun|ilk yaptigin grafik|onceki grafik|son grafik)\b/.test(q);
}

function userStyleOnlyMutation(userText = "") {
  const q = normalizeIntentText(userText);
  const hasStyle = /renk|renkli|rengarenk|rengini|renklerini|renkleri|tema|style|stil|neon|premium|siyah beyaz|sari|lacivert|beyaz|canli|farkli ton/.test(q);
  const hasStructural = /tablo|excel|pdf|zip|dosya|yeni|ekle|cikar|çıkar|sil|hesapla/.test(q);
  return hasStyle && !hasStructural;
}

function userSpecificallyReferencesChart(userText = "") {
  const q = normalizeIntentText(userText);
  // "renklerini değiştir", "renkli yap", "pasta olsun" gibi komutlar
  // çoğunlukla son grafiğin stil/tip mutasyonudur. Tablo açıkça isteniyorsa tablo kaynağına döneriz.
  if (/\b(tablo|excel|xlsx|satir|sutun)\b/.test(q) && !userExplicitlyReferencesChart(userText)) return false;
  return userExplicitlyReferencesChart(userText) || /\b(renk|renkli|rengarenk|rengini|renklerini|renkleri|tema|style|stil|neon|premium|siyah beyaz|sari|lacivert|beyaz|bunu|bu|onceki|son|aynisi)\b/.test(q);
}

function userExplicitlyWantsMermaidOnly(userText = "") {
  const q = normalizeIntentText(userText);
  return /mermaid|diyagram|diagram|flowchart|akis|akış|sema|şema|kutular|baglantili|bagla|node|blok sema/.test(q);
}

function shouldRouteStyleMutationToMermaid(userText = "", activeContent = null, memory = {}) {
  return userStyleOnlyMutation(userText)
    && !userExplicitlyReferencesChart(userText)
    && (activeContent?.type === "mermaid" || Boolean(memory.lastMermaid?.code));
}

function referencedHistoryIndex(userText = "") {
  const q = normalizeIntentText(userText);
  if (/\b(ilk|birinci|en bastaki|en baştaki)\b/.test(q)) return "first";
  if (/\b(ikinci|2\.|2inci)\b/.test(q)) return 1;
  if (/\b(ucuncu|üçüncü|3\.|3uncu)\b/.test(q)) return 2;
  if (/\b(onceki|bir onceki|az onceki|sondan bir onceki)\b/.test(q)) return "previous";
  if (/\b(son|bunu|yukaridaki|ustteki|mevcut)\b/.test(q)) return "last";
  return "last";
}

function tableFromHistory(memory = {}, userText = "") {
  const tables = [];
  ensureConversationIndex(memory);
  if (Array.isArray(memory.index?.tables)) {
    for (const item of memory.index.tables) {
      const table = activeContentTable(item);
      if (table?.rows?.length) tables.push(table);
    }
  }
  if (Array.isArray(memory.contentHistory)) {
    for (const item of memory.contentHistory) {
      const table = activeContentTable(item);
      if (table?.rows?.length) tables.push(table);
    }
  }
  if (memory.lastTable?.rows?.length) tables.push(memory.lastTable);
  const unique = [];
  const seen = new Set();
  for (const table of tables) {
    const key = JSON.stringify({ headers: table.headers, first: table.rows?.[0], rows: table.rows?.length });
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(table);
  }
  if (!unique.length) return null;
  const ref = referencedHistoryIndex(userText);
  if (ref === "first") return unique[0];
  if (ref === "previous") return unique[Math.max(0, unique.length - 2)] || unique[unique.length - 1];
  if (typeof ref === "number") return unique[ref] || unique[unique.length - 1];
  return unique[unique.length - 1];
}

function chartFromHistory(memory = {}, userText = "") {
  const charts = [];
  ensureConversationIndex(memory);
  if (Array.isArray(memory.index?.charts)) {
    for (const item of memory.index.charts) {
      if (item?.type === "chart" && (item.chart?.data || item.ui?.data)) charts.push(item.chart || item.ui || item);
    }
  }
  if (Array.isArray(memory.contentHistory)) {
    for (const item of memory.contentHistory) {
      if (item?.type === "chart" && (item.chart?.data || item.ui?.data)) charts.push(item.chart || item.ui || item);
    }
  }
  if (memory.lastChart?.data) charts.push(memory.lastChart);
  const unique = [];
  const seen = new Set();
  for (const chart of charts) {
    const data = chart.data || chart.raw?.data;
    const key = JSON.stringify({ labels: data?.labels, values: data?.datasets?.[0]?.data, title: chart.title });
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(chart);
  }
  if (!unique.length) return null;
  const ref = referencedHistoryIndex(userText);
  if (ref === "first") return unique[0];
  if (ref === "previous") return unique[Math.max(0, unique.length - 2)] || unique[unique.length - 1];
  if (typeof ref === "number") return unique[ref] || unique[unique.length - 1];
  return unique[unique.length - 1];
}

function userWantsChartRestyleOnly(userText = "") {
  const q = normalizeIntentText(userText);
  return /\b(renkli|rengarenk|yuvarlak|pasta|pie|donut|halka|trend|cizgi|cubuk|bar|sutun)\b/.test(q)
    && !/\b(ekle|cikar|çıkar|degistir|sil|yeni tablo|tablo yaz)\b/.test(q);
}

function buildImplicitToolCalls(answer = "", req) {
  const userText = latestUserIntentText(req);
  const memory = hydrateMemoryFromRequest(req);
  const activeContent = resolveActiveContent(req, answer);
  const source = activeContentToText(activeContent, sourceFromMemory(req, answer));
  const inlineTable = parseFirstMarkdownTableObject(source);
  const activeTable = activeContentTable(activeContent) || inlineTable || memory.lastTable;
  const title = activeContent?.title || contentTitleFromText(source, activeTable ? "LUCY Tablosu" : "LUCY Çıktısı");
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

  if (wantsChartFromText(userText) && !userExplicitlyWantsMermaidOnly(userText) && !shouldRouteStyleMutationToMermaid(userText, activeContent, memory)) {
    const selectedChart = chartFromHistory(memory, userText);
    const selectedTable = tableFromHistory(memory, userText) || activeTable;
    const preferExistingChart = userSpecificallyReferencesChart(userText) && selectedChart?.data;
    const chartInput = preferExistingChart
      ? chartToChartInput(selectedChart, userText)
      : selectedTable?.rows?.length
        ? tableToChartInput(selectedTable, userText)
        : chartToChartInput(selectedChart || memory.lastChart, userText);
    if (chartInput) {
      const chartTitle = chartTitleFromPlan(userText, chartInput, title || "Grafik");
      calls.push({ tool: "chartData", input: { ...chartInput, title: chartTitle } });
    }
  }

  if (wantsMermaidFromText(userText) || shouldRouteStyleMutationToMermaid(userText, activeContent, memory)) {
    const selectedTable = tableFromHistory(memory, userText) || activeTable;
    const selectedChart = chartFromHistory(memory, userText) || memory.lastChart;
    if (memory.lastMermaid?.code && /daha\s+(karmasik|detayli|genis|buyuk)|gelistir|ayrintili|renkli/.test(normalizeIntentText(userText)) && !selectedTable?.rows?.length && !selectedChart?.data) {
      calls.push({ tool: "mermaid", input: { code: memory.lastMermaid.code, title, userText } });
    } else if (selectedTable?.rows?.length) {
      const code = tableToMermaidCode(selectedTable, title || "LUCY Diyagramı", userText);
      if (code) calls.push({ tool: "mermaid", input: { code, title: title || "LUCY Diyagramı", userText } });
    } else if (selectedChart?.data) {
      const code = chartToMermaidCode(selectedChart, selectedChart.title || title || "LUCY Grafiği", userText);
      if (code) calls.push({ tool: "mermaid", input: { code, title: selectedChart.title || title || "LUCY Grafiği", userText } });
    } else if (source) {
      const code = String(source).match(/```mermaid\s*([\s\S]*?)```/i)?.[1]?.trim();
      if (code) calls.push({ tool: "mermaid", input: { code, title, userText } });
    }
  }

  if (wantsExcelFromText(userText)) {
    const activeChartData = activeContent?.type === "chart" ? (activeContent.chart?.data || activeContent.ui?.data || null) : null;
    const excelInput = activeTable?.rows?.length
      ? { title, sheetName: title.slice(0, 31), rows: activeTable.rows, headers: activeTable.headers, filename: `${stem || "lucy-tablo"}.xlsx` }
      : activeChartData?.labels?.length
        ? { title, sheetName: title.slice(0, 31), data: activeChartData, filename: `${stem || "lucy-tablo"}.xlsx` }
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
      lines.push("✅ İndirme hazırlandı. Aşağıdan indirebilirsin.");
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
  const explicitCalls = [
    ...extractToolCallsFromAnswer(answer),
    ...extractToolCallsFromHtmlButtons(answer),
  ];
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
