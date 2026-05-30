const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const dotenv = require("dotenv");
const { normalizeToolIntentText, detectChartType, detectVisualStyle, detectColorPalette, likelyToolIntent } = require("./intentNormalizer");
const { planToolCallsWithDeepSeek, planLucyActionWithDeepSeek, aiPlannerEnabled } = require("./toolPlanner");
const {
  normalizeIntentText,
  classifySemanticIntent,
  wantsPdfFromText,
  wantsExcelFromText,
  wantsZipFromText,
  wantsChartFromText,
  wantsDocumentFromText,
  wantsQrFromText,
  wantsOcrFromText,
  wantsMermaidFromText,
  wantsTextStatsFromText,
  wantsFileManagerFromText,
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
  shouldBlockToolForConversation,
  explicitToolAction,
  normalizeToolName,
  rankAndDedupeToolCalls,
  isHardToolRequest,
} = require("./toolBrainRouter");
const {
  listLoadedTools,
  listToolLoadErrors,
  getLoadedTool,
  executeLucyTool,
} = require("./toolExecutor");
const {
  normalizeToolResultForUI,
  widgetFence,
  summarizeToolResultLine,
} = require("./toolResponseAdapter");
const {
  compactText,
  shouldRenderUi,
  cleanSummaryLine,
} = require("./toolRenderGuard");
const {
  numberFromCell,
  tableToChartInput,
  chartToChartInput,
  tableToMermaidCode,
  chartToMermaidCode,
  chartUiFromMemory,
  mermaidUiFromMemory,
} = require("./chartMermaidEngine");
const { buildUnderstandingFrame, frameSuggestedToolPermission } = require("./understandingFrame");

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
    const active = resolveActiveContent(req);
    const activeText = activeContentToText(active, "");
    const activeTable = chartableTableFromContent(active);
    const selectedTable = rankedSubsetTableForIntent(activeTable || (shouldBlockStaleArtifactFallback(memory, userText) ? null : memory.lastTable), userText);
    if (selectedTable?.rows?.length) {
      input.rows = selectedTable.rows;
      input.headers = selectedTable.headers;
      input.title = input.title || "LUCY Tablosu";
    } else if (activeText) {
      input.text = activeText;
    } else if (memory.lastText) {
      input.text = memory.lastText;
    }
  }

  if (toolName === "pdf" && !String(input.text || input.content || input.value || "").trim()) {
    const active = resolveActiveContent(req);
    const activeText = activeContentToText(active, "");
    if (active?.type === "chart" && active.chart) input.chart = active.chart;
    else if (active?.type === "mermaid" && active.code) input.mermaid = active.code;
    else if (activeText) input.text = activeText;
    else if (memory.lastTable?.rows?.length) input.text = tableToMarkdown(rankedSubsetTableForIntent(memory.lastTable, userText));
    else if (memory.lastText) input.text = memory.lastText;
    else if (memory.lastChart?.data) input.text = JSON.stringify(memory.lastChart.data, null, 2);
  }

  if (toolName === "chartdata") {
    const inlineTable = parseInlineTableObject(userText);
    const blockStaleArtifactFallback = shouldBlockStaleArtifactFallback(memory, userText);
    const active = resolveActiveContent(req);
    const activeTable = chartableTableFromContent(active);
    const styleOnly = userStyleMutationOnly(userText) && !inlineTable;
    const selectedChart = blockStaleArtifactFallback ? null : (chartFromHistory(memory, userText) || memory.lastChart);

    const style = { ...(input.style || {}), ...detectVisualStyle(userText) };
    const palette = detectColorPalette(userText);
    if (palette.requested) {
      style.colorful = true;
      style.palette = palette.name;
      style.colors = palette.colors;
      input.colors = palette.colors;
    }

    // Style-only chart requests must never re-plan the data or chart type.
    // “Bunu X renkte yap” önce X'in stil/renk olduğunu anlar; chart tipi korunur.
    if (styleOnly && selectedChart?.data) {
      const chartInput = chartToChartInput(selectedChart, userText);
      if (chartInput) {
        Object.assign(input, applyStyleToChartInput(chartInput, userText, selectedChart));
      }
      return { ...call, input };
    }

    const labels = input.labels || input.data?.labels;
    const values = input.values || input.data?.datasets?.[0]?.data;
    input.style = style;
    input.chartType = explicitChartTypeFromText(userText) || input.chartType || input.type || "bar";

    const sourceHint = String(input.source || "").toLowerCase();
    const shouldRecomputeTableChart = Boolean(inlineTable || activeTable?.rows?.length || (!blockStaleArtifactFallback && /lasttable|table|tablo/.test(sourceHint) && (memory.lastTable?.rows?.length || tableFromHistory(memory, userText)?.rows?.length)));
    if (shouldRecomputeTableChart) {
      const selectedTableRaw = rankedSubsetTableForIntent(inlineTable || activeTable || (blockStaleArtifactFallback ? null : memory.lastTable) || (blockStaleArtifactFallback ? null : tableFromHistory(memory, userText)), userText);
      const tablePalette = paletteFromTable(selectedTableRaw);
      const chartInput = selectedTableRaw?.rows?.length ? tableToChartInput(selectedTableRaw, userText) : null;
      if (chartInput) {
        const merged = applyStyleToChartInput({ ...chartInput, title: input.title || chartInput.title }, userText, chartInput);
        if (tablePalette?.colors?.length && !palette.requested) {
          merged.colors = tablePalette.colors;
          merged.style = { ...(merged.style || {}), colorful: true, palette: tablePalette.name, colors: tablePalette.colors };
        }
        Object.assign(input, merged);
      }
      return { ...call, input };
    }

    if (!(Array.isArray(labels) && labels.length && Array.isArray(values) && values.length)) {
      const selectedTableRaw = rankedSubsetTableForIntent(inlineTable || activeTable || (blockStaleArtifactFallback ? null : memory.lastTable) || (blockStaleArtifactFallback ? null : tableFromHistory(memory, userText)), userText);
      const tablePalette = paletteFromTable(selectedTableRaw);
      const selectedTable = tablePalette && selectedChart?.data ? null : selectedTableRaw;
      const activeIsChart = active?.type === "chart" && (active.chart?.data || active.ui?.data);
      const preferExistingChart = !selectedTable?.rows?.length
        && !inlineTable
        && selectedChart?.data
        && (activeIsChart || explicitHistoricalArtifactReference(userText) || tablePalette || isStyleOnlyChartModify(userText, memory));
      const chartInput = preferExistingChart
        ? chartToChartInput(selectedChart, userText)
        : selectedTable?.rows?.length
          ? tableToChartInput(selectedTable, userText)
          : (selectedChart || (!blockStaleArtifactFallback && memory.lastChart))
            ? chartToChartInput(selectedChart || memory.lastChart, userText)
            : null;
      if (chartInput) {
        const merged = applyStyleToChartInput(chartInput, userText, preferExistingChart ? selectedChart : chartInput);
        if (tablePalette?.colors?.length && !palette.requested) {
          merged.colors = tablePalette.colors;
          merged.style = { ...(merged.style || {}), colorful: true, palette: tablePalette.name, colors: tablePalette.colors };
        }
        Object.assign(input, merged);
      }
    }
  }

  if (toolName === "mermaid" && !String(input.code || input.mermaid || "").trim()) {
    const selectedTable = rankedSubsetTableForIntent(tableFromHistory(memory, userText) || memory.lastTable, userText);
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
    input.text = memory.lastText || tableToMarkdown(rankedSubsetTableForIntent(memory.lastTable, userText)) || latestUserIntentText(req);
  }

  if (toolName === "document" && !String(input.content || input.text || input.markdown || "").trim()) {
    const selectedTable = rankedSubsetTableForIntent(memory.lastTable, userText);
    input.content = selectedTable?.rows?.length ? tableToMarkdown(selectedTable) : memory.lastText;
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
      const chosen = selectGeneratedFileFromMemory(userText, memory, req, { allowZip: false });
      if (chosen?.storedFilename) {
        input.files = [{ storedFilename: chosen.storedFilename, filename: chosen.filename || chosen.storedFilename }];
      }
    }
    if (!input.filename) input.filename = "lucy-dosyalari.zip";
  }

  return { ...call, input };
}


function latestUserIntentText(req) {
  if (req && typeof req.__lucyEffectiveUserText === "string" && req.__lucyEffectiveUserText.trim()) {
    return req.__lucyEffectiveUserText.trim();
  }
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
  const userText = latestUserIntentText(req);
  if (classifySemanticIntent(userText, hydrateMemoryFromRequest(req)) === "search_research") return false;
  if (wantsTimeFromText(userText)) return true;
  return isHardToolRequest(userText) && likelyToolIntent(userText);
}

function requestedMermaidWork(req) {
  const text = normalizeIntentText(latestUserIntentText(req));
  return /mermaid|diyagram|flowchart|akis|sema|kutular|baglantili|bagla|akisi/.test(text);
}


function styleMutationText(userText = "") {
  const q = normalizeIntentText(userText);
  return /\b(renk|renkli|renklerini|renkleri|renkte|renklerde|renklere|renklendir|renklendirir|boya|palet|palette|tema|stil|sari|lacivert|beyaz|siyah|neon|pastel|premium|modern|canli|farkli ton|farkli renk|ayri renk|ayrı renk|tonlarda)\b/.test(q)
    || /\b\d+\s*(farkli|farklı|ayri|ayrı)?\s*renk(?:te|li|le|lerle|lerde)?\b/.test(q)
    || /\b(her|tum|tüm)\s+(dilim|parca|parça|seri|bar|sutun|sütun)\w*\s+(farkli|farklı|ayri|ayrı)?\s*renk/.test(q);
}

function explicitChartTypeFromText(userText = "") {
  const q = normalizeIntentText(userText);
  if (/\b(pasta|pie|dilim|daire|yuvarlak|doughnut|donut|halka)\b/.test(q)) return "pie";
  if (/\b(cizgi|line|trend|zaman|aylik|gelisim|degisim)\b/.test(q)) return "line";
  if (/\b(cubuk|bar|sutun|kolon|normal grafik|karsilastir)\b/.test(q)) return "bar";
  return "";
}

function userSpecificallyReferencesChart(userText = "") {
  const q = normalizeIntentText(userText);
  return /grafik|chart|pasta|pie|trend|cizgi|line|cubuk|bar|sutun|yuvarlak|daire|dilim|donut|dagilim|renkli pasta|renklerini degistir|renkleri degistir|renkte|renklendir|palet|tema|stil/.test(q)
    && !wantsMermaidFromText(q);
}

function userStyleMutationOnly(userText = "") {
  const q = normalizeIntentText(userText);
  if (!styleMutationText(q)) return false;
  if (wantsPdfFromText(q) || wantsExcelFromText(q) || wantsZipFromText(q) || wantsMermaidFromText(q)) return false;
  return !/\b(tablo|excel|pdf|zip|dosya|metin|yazi|yazı)\b/.test(q);
}


function classifyBunuXIntent(userText = "") {
  const q = normalizeIntentText(userText);
  if (wantsPdfFromText(q) || wantsExcelFromText(q) || wantsZipFromText(q) || wantsDocumentFromText(q)) return "file_format";
  if (/\btablo\b.*\b(yap|goster|göster|cevir|çevir|donustur|dönüştür)\b|\btablo yap\b/.test(q)) return "output_table";
  if (wantsChartFromText(q) || explicitChartTypeFromText(q)) return "output_chart";
  if (styleMutationText(q)) return "style_change";
  if (/\b(profesyonel|premium|modern|daha iyi|duzenle|düzenle|iyilestir|iyileştir)\b/.test(q)) return "quality_change";
  return "unknown";
}

function isStyleOnlyChartModify(userText = "", memory = {}) {
  if (!memory?.lastChart?.data) return false;
  if (classifyBunuXIntent(userText) !== "style_change") return false;
  const q = normalizeIntentText(userText);
  if (wantsPdfFromText(q) || wantsExcelFromText(q) || wantsZipFromText(q) || wantsDocumentFromText(q) || wantsMermaidFromText(q)) return false;
  if (/\b(tablo|excel|pdf|zip|dosya|metin|yazi|yazı|word|docx)\b/.test(q)) return false;
  return true;
}

function isColorPaletteTable(table = null) {
  if (!table || !Array.isArray(table.rows) || !table.rows.length) return false;
  const headers = (Array.isArray(table.headers) ? table.headers : []).map((h) => normalizeIntentText(h));
  if (headers.some((h) => /\brenk|color|palet|palette\b/.test(h))) return true;
  const text = table.rows.slice(0, 8).map((row) => Object.values(row || {}).join(" ")).join(" ");
  const palette = detectColorPalette(text);
  return Boolean(palette.requested && palette.colors?.length && /\b(sari|sarı|lacivert|beyaz|siyah|kirmizi|kırmızı|mavi|mor|pembe|gri|yesil|yeşil|turuncu|renk)\b/.test(normalizeIntentText(text)));
}

function paletteFromTable(table = null) {
  if (!isColorPaletteTable(table)) return null;
  const text = table.rows.map((row) => Object.values(row || {}).join(" ")).join(" ");
  const palette = detectColorPalette(text);
  return palette.requested && palette.colors?.length ? palette : null;
}

function applyStyleToChartInput(chartInput = {}, userText = "", baseChart = {}) {
  const palette = detectColorPalette(userText);
  const style = { ...(chartInput.style || {}), ...(baseChart.style || {}), ...detectVisualStyle(userText) };
  if (palette.requested) {
    style.colorful = true;
    style.palette = palette.name;
    style.colors = palette.colors;
  }
  return {
    ...chartInput,
    chartType: baseChart.chartType || baseChart.type || chartInput.chartType || explicitChartTypeFromText(userText) || "bar",
    title: chartTitleForStyleMutation(userText, baseChart.title || chartInput.title || "Grafik", baseChart.chartType || chartInput.chartType),
    label: chartInput.label || baseChart.label || baseChart.title || chartInput.title || "Veri",
    style,
    colors: palette.requested ? palette.colors : (chartInput.colors || baseChart.colors || style.colors || []),
    palette: palette.requested ? palette.name : (baseChart.palette || chartInput.palette),
  };
}

function chartTitleForStyleMutation(userText = "", currentTitle = "Grafik", chartType = "") {
  const q = normalizeIntentText(userText);
  const typeLabel = (chartType === "pie" || /\bpasta|pie\b/.test(q)) ? "Pasta Grafik" : chartType === "line" ? "Çizgi Grafik" : chartType === "bar" ? "Grafik" : "Grafik";
  const cleanCurrent = String(currentTitle || "").replace(/\b(Renkli\s*){2,}/gi, "Renkli ").replace(/✅/g, "").trim();
  if (/\bdaha koyu pastel|koyu pastel\b/.test(q)) return cleanCurrent.replace(/Neon[^-–—()]*/i, "Koyu Pastel").replace(/Pasta Grafik.*/i, typeLabel) || `Koyu Pastel ${typeLabel}`;
  if (/\bpastel\b/.test(q)) return cleanCurrent.replace(/Neon[^-–—()]*/i, "Pastel").replace(/Pasta Grafik.*/i, typeLabel) || `Pastel ${typeLabel}`;
  if (/\bsiyah beyaz|monokrom|gri ton\b/.test(q)) return cleanCurrent.replace(/Neon[^-–—()]*/i, "Siyah Beyaz").replace(/Pasta Grafik.*/i, typeLabel) || `Siyah Beyaz ${typeLabel}`;
  const palette = detectColorPalette(userText);
  if (palette.requested && palette.name !== "default") return cleanCurrent.replace(/Neon[^-–—()]*/i, "Renkli").replace(/Pasta Grafik.*/i, typeLabel) || `Renkli ${typeLabel}`;
  return cleanCurrent || typeLabel;
}

function hasFreshInlineChartData(userText = "") {
  return Boolean(parseInlineTableObject(userText));
}

function isChartExportOnlyRequest(userText = "") {
  const q = normalizeIntentText(userText);
  if (isMultiStepCommandText(userText) && /\b(grafik|chart|pasta|pie|cizgi|çizgi|bar|sutun|sütun|cubuk|çubuk)\b.*\b(yap|olustur|oluştur|ciz|çiz|hazirla|hazırla|goster|göster)\b/.test(q)) return false;
  if (/\b(tablo|tabloyu|veri|dataset|liste)\b.*\b(graf|chart|pasta|pie|cizgi|Ã§izgi|bar|sutun|sÃ¼tun|cubuk|Ã§ubuk)\b.*\b(yap|olustur|oluÅŸtur|ciz|Ã§iz|hazirla|hazÄ±rla|goster|gÃ¶ster|cevir|Ã§evir|donustur|dÃ¶nÃ¼ÅŸtÃ¼r)\b/.test(q)
    || /\b(tablo|tabloyu|veri|dataset|liste)\b.*\b(cevir|Ã§evir|donustur|dÃ¶nÃ¼ÅŸtÃ¼r)\b.*\b(graf|chart|pasta|pie|cizgi|Ã§izgi|bar|sutun|sÃ¼tun|cubuk|Ã§ubuk)\b/.test(q)) return false;
  return wantsPdfFromText(q)
    && userSpecificallyReferencesChart(q)
    && !hasFreshInlineChartData(userText)
    && !/\b(yeni|olustur|oluştur|ciz|çiz|hazirla|hazırla)\b.*\b(grafik|chart|pasta|pie|cizgi|çizgi|bar|sutun|sütun)\b/.test(q);
}

function shouldForceChartRenderer(req) {
  const userText = latestUserIntentText(req);
  const memory = hydrateMemoryFromRequest(req);
  if (!memory.lastChart?.data) return false;
  if (wantsMermaidFromText(userText)) return false;
  return userSpecificallyReferencesChart(userText) || userStyleMutationOnly(userText);
}

function chartTitleFromPlan(userText = "", chartInput = {}, fallback = "Grafik") {
  const q = normalizeIntentText(userText);
  const type = chartInput.chartType || explicitChartTypeFromText(userText) || detectChartType(userText);
  const base = String(chartInput.title || fallback || "Grafik").replace(/\s*\((Renkli|Pasta|Trend|Grafik)\)\s*$/i, "").trim() || "Grafik";
  const prefix = /renk|renkli|renklendir|palet|tema|stil|sari|lacivert|beyaz|neon|premium/.test(q) ? "Renkli " : "";
  if (type === "pie") return `${base.includes("Pasta") ? base : `${prefix}${base} (Pasta Grafiği)`}`.replace(/^Renkli Renkli /, "Renkli ");
  if (type === "line") return `${base.includes("Trend") ? base : `${prefix}${base} (Trend Grafiği)`}`.replace(/^Renkli Renkli /, "Renkli ");
  return `${prefix}${base}`.trim() || "Grafik";
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
  if (tool === "pdf") return Boolean(
    String(input.text || input.content || input.value || "").trim()
    || input.chart || input.chartData || input.data?.labels
    || input.mermaid || input.code
    || (Array.isArray(input.rows) && input.rows.length)
  );
  if (tool === "qr") return Boolean(String(input.text || input.url || input.value || "").trim());
  if (tool === "ocr") return Boolean(String(input.base64 || input.imageBase64 || input.fileBase64 || input.dataUrl || input.imageDataUrl || input.storedFilename || input.generatedFile || "").trim());
  return true;
}

function legacyToolCallAllowedByCurrentIntent(call = {}, req = null) {
  const tool = normalizeToolName(call.tool || "");
  const userText = latestUserIntentText(req);
  const memory = hydrateMemoryFromRequest(req);
  const semanticIntent = classifySemanticIntent(userText, memory);

  const brainBlock = shouldBlockToolForConversation(userText, tool);
  if (brainBlock?.block) return false;

  if (semanticIntent === "search_research" && ["pdf", "excel", "document", "zip", "chartdata", "qr", "mermaid", "ocr"].includes(tool)) {
    return false;
  }

  // File read/list commands are deterministic and always own the "oku/listele" intent.
  if (wantsFileManagerFromText(userText)) return tool === "filemanager";

  // Every tool must match the current user intent. This blocks hallucinated model tool_call output.
  if (tool === "calculator") return wantsCalculatorFromText(userText) && !wantsDocumentFromText(userText) && !wantsExcelFromText(userText) && !wantsPdfFromText(userText) && !wantsZipFromText(userText);
  if (tool === "time") return wantsTimeFromText(userText);
  if (tool === "webfetch") return wantsWebFetchFromText(userText);
  if (tool === "ocr") return wantsOcrFromText(userText);
  if (tool === "chartdata") {
    if (shouldBlockStaleArtifactFallback(memory, userText) && !parseInlineTableObject(userText) && !chartableTableFromContent(memory.activeContent)?.rows?.length) return false;
    return (wantsChartFromText(userText) || isStyleOnlyChartModify(userText, memory)) && !isChartExportOnlyRequest(userText);
  }
  if (tool === "mermaid") return wantsMermaidFromText(userText);
  if (tool === "excel") return wantsExcelFromText(userText);
  if (tool === "pdf") return wantsPdfFromText(userText);
  if (tool === "document") return wantsDocumentFromText(userText);
  if (tool === "qr") return wantsQrFromText(userText);
  if (tool === "zip") return wantsZipFromText(userText);
  if (tool === "textstats") return wantsTextStatsFromText(userText);
  if (tool === "mail") return wantsMailFromText(userText);
  if (tool === "telegram") return wantsTelegramFromText(userText);
  if (tool === "whatsapp") return wantsWhatsappFromText(userText);
  if (tool === "filemanager") return wantsFileManagerFromText(userText);

  return explicitToolAction(userText, tool);
}

function recordPermissionFrameDebug(call = {}, req = null, oldPermissionDecision = false) {
  if (!req || typeof req !== "object") return;
  const tool = normalizeToolName(call.tool || "");
  const frame = req.__lucyUnderstandingFrame || buildUnderstandingFrame(req, {});
  req.__lucyUnderstandingFrame = frame;
  const suggested = frameSuggestedToolPermission(frame, tool);
  const oldDecision = Boolean(oldPermissionDecision);
  const frameDecision = Boolean(suggested.allow);
  const mismatch = oldDecision !== frameDecision;
  if (!Array.isArray(req.__lucyPermissionDebug)) req.__lucyPermissionDebug = [];
  req.__lucyPermissionDebug.push({
    tool,
    oldPermissionDecision: oldDecision,
    frameSuggestedPermission: frameDecision,
    mismatch,
    mismatchReason: mismatch
      ? `legacy_${oldDecision ? "allowed" : "blocked"}__frame_${frameDecision ? "allowed" : "blocked"}__${suggested.reason || "no_reason"}`
      : "",
    frameReason: suggested.reason || "",
    frameIntent: frame.primaryIntent,
    frameUtteranceType: frame.utteranceType,
    frameOutputTargets: frame.outputTargets || [],
    frameSourceRequirement: frame.sourceRequirement,
  });
}

function isToolCallAllowedByCurrentIntent(call = {}, req = null) {
  const oldPermissionDecision = legacyToolCallAllowedByCurrentIntent(call, req);
  recordPermissionFrameDebug(call, req, oldPermissionDecision);
  return oldPermissionDecision;
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

  // Mesajlaşma araçları için konfigürasyon kontrolü
  if (tool === "mail") {
    const hasSmtp = Boolean(
      (process.env.SMTP_HOST || process.env.MAIL_HOST) &&
      (process.env.SMTP_USER || process.env.MAIL_USER) &&
      (process.env.SMTP_PASS || process.env.MAIL_PASS)
    );
    if (!hasSmtp) return fail(
      "Mail gönderebilmem için Railway/ortam değişkenlerinde SMTP_HOST, SMTP_USER ve SMTP_PASS ayarlanmalı. Şu an mail yapılandırması yok.",
      "mail_config_required"
    );
    const to = String(input.to || input.recipient || "").trim();
    if (!to) return fail("Mail için alıcı adresi (to) gerekli.", "mail_to_required");
  }

  if (tool === "whatsapp") {
    const hasConfig = Boolean(
      (process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN) &&
      process.env.WHATSAPP_PHONE_NUMBER_ID
    );
    if (!hasConfig) return fail(
      "WhatsApp mesajı gönderebilmem için WHATSAPP_TOKEN ve WHATSAPP_PHONE_NUMBER_ID ortam değişkenleri gerekli.",
      "whatsapp_config_required"
    );
  }

  if (tool === "telegram") {
    const hasConfig = Boolean(process.env.TELEGRAM_BOT_TOKEN);
    if (!hasConfig) return fail(
      "Telegram mesajı gönderebilmem için TELEGRAM_BOT_TOKEN ortam değişkeni gerekli.",
      "telegram_config_required"
    );
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
    firstTable: null,
    firstChart: null,
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
    pendingClarification: null,
    lastUserIntent: "",
    updatedAt: Date.now(),
  };
}

function conversationKey(req) {
  const body = req?.body || {};
  const explicit = (
    body.chatId || body.conversationId || body.threadId || body.sessionId ||
    body.activeChatId || body.activeChat?.id || body.currentChatId ||
    body.projectId || body.activeProject?.id || body.userId || body.user?.id
  );
  if (explicit) return String(explicit);

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const fingerprintSource = messages.slice(-8).map((message) => ({
    role: message?.role || message?.sender || "",
    text: messageText(message).slice(0, 2000),
  }));
  if (fingerprintSource.length) {
    const hash = crypto
      .createHash("sha1")
      .update(JSON.stringify(fingerprintSource))
      .digest("hex")
      .slice(0, 16);
    return `transient:${hash}`;
  }

  return `transient:${req?.ip || req?.socket?.remoteAddress || "anonymous"}`;
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



function splitCsvLikeLine(line = "") {
  return String(line || "")
    .split(/\s*,\s*/)
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
}

function parseCsvLikeTableObject(text = "") {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return null;

  for (let i = 0; i < lines.length - 1; i += 1) {
    const headerCells = splitCsvLikeLine(lines[i]);
    if (headerCells.length < 2 || headerCells.length > 10) continue;
    if (headerCells.some((cell) => /^https?:\/\//i.test(cell))) continue;
    if (headerCells.some((cell) => /^bu\s+tablo|grafik\s+yap|pasta\s+grafik/i.test(cell))) continue;

    const rows = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j];
      const q = normalizeIntentText(line);
      if (/\b(bu|bunu|bundan|tablodan|grafik|pasta|chart|yap|hazirla|hazırla|cevir|çevir)\b/.test(q) && !line.includes(",")) break;
      const cells = splitCsvLikeLine(line);
      if (cells.length < headerCells.length) continue;
      if (cells.length > headerCells.length + 2) continue;
      const row = {};
      headerCells.forEach((header, index) => {
        if (index === headerCells.length - 1) row[header] = cells.slice(index).join(", ");
        else row[header] = cells[index] ?? "";
      });
      if (Object.values(row).some((value) => String(value).trim())) rows.push(row);
    }

    if (rows.length) {
      const numericColumns = headerCells.filter((header) => rows.some((row) => /-?\d/.test(String(row?.[header] ?? ""))));
      if (numericColumns.length) return { headers: headerCells, rows, source: "csv-inline" };
    }
  }

  return null;
}



function parseInlineKeyValueTableObject(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return null;
  if (isMultiStepCommandText(raw)) return null;

  // "Ocak 12000, Şubat 18000, Mart 9000" gibi doğrudan veri girilen grafik/tablo istekleri.
  // Bu parser komut ezberi değildir; etiket+sayı çiftlerini güvenli şekilde çıkarır.
  const work = raw
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b(verilerinden|verileriyle|verilerle|degerlerinden|değerlerinden|masraflarini|masraflarını|masraf|grafik|chart|pasta|cizgi|çizgi|bar|sutun|sütun|tablo|rapor|pdf|excel|zip|yap|hazirla|hazırla|olustur|oluştur|goster|göster|neon|pastel|renkli|mor|mavi|kirmizi|kırmızı|siyah|beyaz|tonlarda|tonlari|tonları)\b/gi, " ");

  const pairs = [];
  const seen = new Set();
  const regex = /(^|[,;\n])\s*([\p{L}][\p{L}0-9 ._\-/]{0,42}?)\s+(-?\d+(?:[.,]\d+)?(?:\.\d{3})*)\b/gu;
  let match;
  while ((match = regex.exec(work))) {
    let label = String(match[2] || "").replace(/^[\s,;:-]+|[\s,;:-]+$/g, "").trim();
    let value = String(match[3] || "").trim();
    if (!label || !value) continue;
    label = label.split(/\s+/).slice(-4).join(" ").trim();
    const key = `${label.toLowerCase()}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ label, value });
  }

  if (pairs.length < 2) return null;
  const headers = ["Etiket", "Değer"];
  const rows = pairs.slice(0, 30).map((p) => ({ Etiket: p.label, "Değer": p.value }));
  return { headers, rows, source: "inline-key-value" };
}

function commandLikeLine(text = "") {
  const q = normalizeIntentText(text);
  if (!q) return false;
  return /\b(yap|olustur|oluştur|hazirla|hazırla|uret|üret|ver|indir|kaydet|donustur|dönüştür|cevir|çevir|cikar|çıkar|gonder|gönder|at|ilet|oku|listele|hesapla|ciz|çiz|goster|göster|arsivle|arşivle|sikistir|sıkıştır|bul|filtrele|sirala|sırala)\b/.test(q)
    || /\b(en\s+(pahali|pahalı|ucuz|yuksek|yüksek|dusuk|düşük|buyuk|büyük|kucuk|küçük|fazla)|top\s+\d+|ilk\s+\d+|\d+\s+(urun|ürün|kalem|satir|satır|kayit|kayıt|tanesi|tane))\b/.test(q)
    || /\b(pdf|excel|xlsx|xls|word|docx|zip|grafik|chart|pasta|tablo)\b.*\b(yap|olustur|oluştur|hazirla|hazırla|ver|indir|kaydet|cevir|çevir|donustur|dönüştür|ciz|çiz|goster|göster)\b/.test(q);
}

function isMultiStepCommandText(text = "") {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 3) return false;
  if (hasMarkdownTable(text)) return false;
  const commandLines = lines.filter(commandLikeLine).length;
  return commandLines >= 2 && commandLines / lines.length >= 0.6;
}

function numericFactIntentText(value = "") {
  return normalizeIntentText(value)
    .replace(/[ıİ]/g, "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[çÇ]/g, "c")
    .replace(/[ğĞ]/g, "g")
    .replace(/[öÖ]/g, "o")
    .replace(/[şŞ]/g, "s")
    .replace(/[üÜ]/g, "u")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumericFactTableObject(text = "") {
  const raw = String(text || "").trim();
  if (!raw || isMultiStepCommandText(raw)) return null;
  const normalized = numericFactIntentText(raw);
  if (!/\b(nufus(?:u)?|population)\b/.test(normalized)) return null;

  const rows = [];
  const seen = new Set();
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines.length ? lines : [raw]) {
    const q = numericFactIntentText(line);
    const match = q.match(/([a-z0-9 .'-]{2,80}?)\s+nufus(?:u)?\s+(?:yaklasik|ortalama|tahmini)?\s*(-?\d+(?:[.,]\d+)?)(?:\s*(milyon|bin|k|m))?/);
    if (!match) continue;
    const subject = String(match[1] || "").replace(/\b(bana|bir|bu|su|şu)\b/g, " ").replace(/\s+/g, " ").trim();
    const value = [match[2], match[3]].filter(Boolean).join(" ");
    if (!subject || !value) continue;
    const key = `${subject}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ Etiket: `${subject} nufusu`, "DeÄŸer": value });
  }

  return rows.length ? { headers: ["Etiket", "DeÄŸer"], rows, source: "numeric-fact" } : null;
}

function parseInlineTableObject(text = "") {
  const source = String(text || "");
  const table = parseFirstMarkdownTableObject(source) || parseCsvLikeTableObject(source) || parseLooseInlineTableObject(source);
  if (table) return table;
  if (isMultiStepCommandText(source)) return null;
  return parseInlineKeyValueTableObject(source) || parseNumericFactTableObject(source);
}

function explicitHistoricalArtifactReference(userText = "") {
  const q = normalizeIntentText(userText);
  return /\b(ilk|birinci|onceki|bir onceki|az onceki|son)\b.*\b(tablo|tabloyu|grafik|grafigi|chart|dosya|dosyayi|metin|yazi)\b/.test(q)
    || /\b(son tablo|son grafik|son dosya|ilk tablo|ilk grafik|onceki tablo|onceki grafik)\b/.test(q);
}

function genericArtifactFollowUpText(text = "") {
  const raw = String(text || "").trim();
  if (!raw || /\n/.test(raw) || explicitHistoricalArtifactReference(raw)) return false;
  if (parseInlineTableObject(raw)) return false;
  return isOnlyTransformCommand(raw)
    || /^(bunu|sunu|onu)?\s*(pdf|excel|xlsx|xls|zip|word|docx|csv|json|html|grafik|chart)\s*(yap|olustur|hazirla|ver|indir|kaydet|cevir|donustur|ciz|goster)?$/.test(normalizeIntentText(raw));
}

function bareChartFollowUpText(text = "") {
  const raw = String(text || "").trim();
  if (!raw || /\n/.test(raw)) return false;
  const q = normalizeIntentText(raw).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!wantsChartFromText(q)) return false;
  if (parseInlineTableObject(raw)) return false;
  if (/\b(bu|bunu|bunun|buna|bundan|onu|onun|ona|son|onceki|ilk|tablo|tabloyu|veri|dataset|liste|mevcut|yukaridaki|ustteki)\b/.test(q)) return false;
  return /^(pasta|pie|cubuk|bar|sutun|cizgi|trend|renkli)?\s*grafik\s*(yap|olustur|hazirla|ciz|goster)?$/.test(q)
    || /^(pasta|pie|cubuk|bar|sutun|cizgi|trend)\s*(yap|olustur|hazirla|ciz|goster)$/.test(q);
}

function chartableTableFromContent(content = {}) {
  if (!content || typeof content !== "object") return null;
  const table = activeContentTable(content);
  if (table?.rows?.length) return table;
  if (content.type === "text" && String(content.text || "").trim()) return parseInlineTableObject(content.text);
  return null;
}

function shouldBlockStaleArtifactFallback(memory = {}, userText = "") {
  if (!memory?.activeContent || memory.activeContent.type !== "text") return false;
  return genericArtifactFollowUpText(userText) || bareChartFollowUpText(userText);
}

function syncRankedSubsetActiveTable(memory = {}, baseTable = null, activeTable = null, title = "LUCY Tablosu") {
  if (!memory || !baseTable?.rows?.length || !activeTable?.rows?.length || !activeTable.filter) return;
  if (!memory.firstTable) memory.firstTable = cloneJsonSafe(baseTable);
  memory.lastTable = cloneJsonSafe(activeTable);
  setActiveContent(memory, {
    type: "table",
    table: activeTable,
    text: tableToMarkdown(activeTable),
    title: title || "LUCY Tablosu",
    source: "ranked-subset",
  });
}

function parseLooseInlineTableObject(text = "") {
  const raw = String(text || "").trim();
  const q = normalizeIntentText(raw);
  if (!/tablo/.test(q) || !raw.includes(":")) return null;

  const before = raw.split(":")[0] || "";
  const after = raw.split(":").slice(1).join(":").trim();
  if (!after) return null;

  let headerPart = before
    .replace(/.*?([A-Za-zÇĞİÖŞÜçğıöşü0-9_\s,;|\/.-]+)\s+tablos[uuıi]?.*/i, "$1")
    .replace(/\b(tablo|tablosu|yap|olustur|oluştur|hazirla|hazırla|bana|bir)\b/gi, "")
    .trim();

  let headers = headerPart
    .split(/[,;|/]+/)
    .map((h) => h.trim())
    .filter(Boolean);

  if (headers.length < 2) {
    const guessed = before.match(/([A-Za-zÇĞİÖŞÜçğıöşü]+)\s*,\s*([A-Za-zÇĞİÖŞÜçğıöşü]+)(?:\s*,\s*([A-Za-zÇĞİÖŞÜçğıöşü]+))?/);
    headers = guessed ? guessed.slice(1).filter(Boolean).map((h) => h.trim()) : [];
  }

  if (headers.length < 2) return null;
  headers = headers.slice(0, 8).map((h, i) => h || `Sütun ${i + 1}`);

  const chunks = after
    .replace(/\b(bunu|bunlari|bunları|sonra|ardindan|ardından|hem|ayrica|ayrıca)\b.*$/i, "")
    .split(/\s*[,;\n]+\s*/)
    .map((x) => x.trim())
    .filter(Boolean);

  const rows = [];
  for (const chunk of chunks) {
    const tokens = chunk.split(/\s+/).filter(Boolean);
    if (tokens.length < headers.length) continue;
    const row = {};
    if (headers.length >= 2) {
      const valueCount = headers.length - 1;
      const values = tokens.slice(-valueCount);
      const label = tokens.slice(0, tokens.length - valueCount).join(" ").trim();
      row[headers[0]] = label || tokens[0];
      headers.slice(1).forEach((h, idx) => { row[h] = values[idx] ?? ""; });
    }
    if (Object.values(row).some((v) => String(v).trim())) rows.push(row);
  }

  return rows.length ? { headers, rows, source: "loose-inline" } : null;
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
  if (type === "table" && clean.table?.rows?.length && !memory.firstTable) {
    memory.firstTable = cloneJsonSafe(clean.table);
  }
  if (type === "chart" && (clean.chart?.data || clean.ui?.data) && !memory.firstChart) {
    memory.firstChart = cloneJsonSafe(clean.chart || clean.ui || clean);
  }
  pushContentHistory(memory, clean);
  memory.updatedAt = Date.now();
  return memory;
}

function activeContentTable(content = {}) {
  if (!content || typeof content !== "object") return null;
  if (content.type === "table" && content.table?.rows?.length) return content.table;
  if (content.table?.rows?.length) return content.table;
  if (content.text) return parseFirstMarkdownTableObject(content.text) || parseCsvLikeTableObject(content.text) || parseNumericFactTableObject(content.text);
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

function inlineContentFromToolRequest(userText = "") {
  const raw = String(userText || "").trim();
  if (!raw) return "";
  if (isMultiStepCommandText(raw)) return "";

  const colonIndex = raw.indexOf(":");
  if (colonIndex > 0) {
    const before = raw.slice(0, colonIndex);
    const after = raw.slice(colonIndex + 1).trim();
    if (after && currentUserHasClearAction(before)) return stripToolNoise(after);
  }

  const quoted = raw.match(/[“"']([^“"']{2,4000})[”"']/);
  if (quoted?.[1] && currentUserHasClearAction(raw.replace(quoted[0], ""))) {
    return stripToolNoise(quoted[1].trim());
  }

  return "";
}

function resolveActiveContent(req, answer = "") {
  const memory = hydrateMemoryFromRequest(req);
  const userText = latestUserIntentText(req);
  const answerText = stripToolNoise(answer);
  const blockStaleArtifactFallback = shouldBlockStaleArtifactFallback(memory, userText);

  const inlineContent = inlineContentFromToolRequest(userText);
  if (inlineContent) {
    const table = parseFirstMarkdownTableObject(inlineContent) || parseCsvLikeTableObject(inlineContent) || parseLooseInlineTableObject(inlineContent);
    return table
      ? { type: "table", table, text: tableToMarkdown(table), title: contentTitleFromText(inlineContent, "LUCY Tablosu"), source: "user-inline" }
      : { type: "text", text: inlineContent, title: contentTitleFromText(inlineContent, "LUCY İçeriği"), source: "user-inline" };
  }

  // Aynı mesajda uzun içerik/metin verildiyse öncelik kullanıcının son içeriği.
  if (!isOnlyTransformCommand(userText) && !isMultiStepCommandText(userText) && (String(userText).length > 90 || /\n/.test(userText) || hasMarkdownTable(userText))) {
    const table = parseFirstMarkdownTableObject(userText) || parseCsvLikeTableObject(userText) || parseLooseInlineTableObject(userText);
    return table
      ? { type: "table", table, text: tableToMarkdown(table), title: contentTitleFromText(userText, "LUCY Tablosu"), source: "user-inline" }
      : { type: "text", text: stripToolNoise(userText), title: contentTitleFromText(userText, "LUCY İçeriği"), source: "user-inline" };
  }

  // Model bu turda gerçek içerik ürettiyse onu kullan.
  if (answerText && answerText.length > 30 && !/^tamam|tabii|olur|hazir/i.test(normalizeIntentText(answerText))) {
    const table = parseFirstMarkdownTableObject(answerText) || parseCsvLikeTableObject(answerText) || parseNumericFactTableObject(answerText);
    return table
      ? { type: "table", table, text: tableToMarkdown(table), title: contentTitleFromText(answerText, "LUCY Tablosu"), source: "assistant-answer" }
      : { type: "text", text: answerText, title: contentTitleFromText(answerText, "LUCY İçeriği"), source: "assistant-answer" };
  }

  const preferred = transformPrefersTypedSource(userText);
  const typed = blockStaleArtifactFallback ? null : typedContentFromMemory(memory, preferred);
  if (typed) return typed;

  // "bunu pdf/docx/txt yap" gibi genel dönüşümlerde en son gerçek asistan metni
  // aktif tool tablosundan daha değerlidir. Bu, textStats çıktısının şiiri ezmesini engeller.
  if (memory.activeContent && ["chart", "mermaid", "file"].includes(String(memory.activeContent.type || "").toLowerCase())) {
    return memory.activeContent;
  }

  const latestAssistant = latestAssistantContentObject(req);
  if (latestAssistant && (isOnlyTransformCommand(userText) || wantsPdfFromText(userText) || wantsExcelFromText(userText) || wantsZipFromText(userText) || wantsDocumentFromText(userText) || wantsTextStatsFromText(userText))) {
    return latestAssistant;
  }

  if (memory.activeContent && !isToolGeneratedAnswerText(activeContentToText(memory.activeContent, ""))) return memory.activeContent;
  if (blockStaleArtifactFallback) return null;
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


function isToolGeneratedAnswerText(text = "") {
  const raw = String(text || "");
  const clean = normalizeIntentText(stripToolNoise(raw));
  if (!clean) return false;
  if (isGeneratedStatusOnlyText(raw)) return true;

  // Tool sonuçları aktif içerik olarak ezmesin. Örn. şiir yazıldıktan sonra
  // "bunu pdf yap" denince eski textStats tablosu değil şiir PDF olmalı.
  const statsLike = /\b(iste metnin istatistikleri|metnin istatistikleri|olcut deger|kelime sayisi|karakter sayisi|satir sayisi|textstats)\b/.test(clean);
  if (statsLike) return true;

  const generatedRefLike = /\b(lucyfileref|storedfilename|downloadurl|generated\/|indirme hazirlandi|asagidan indirebilirsin)\b/.test(clean);
  if (generatedRefLike) return true;

  const rawMermaidLike = /^\s*(flowchart|graph)\s+(td|lr|bt|rl)\b/i.test(raw) || /\bclassdef\b/i.test(raw);
  if (rawMermaidLike) return true;

  return false;
}

function transformPrefersTypedSource(userText = "") {
  const q = normalizeIntentText(userText);
  if (/\b(son tablo|ilk tablo|onceki tablo|tabloyu|bu tablo|tablo)\b/.test(q)) return "table";
  if (/\b(son grafik|ilk grafik|onceki grafik|bu grafik|grafigi|chart)\b/.test(q) && !wantsMermaidFromText(q)) return "chart";
  if (/\b(son diyagram|diyagram|mermaid|akis|akış|sema|şema|flowchart)\b/.test(q)) return "mermaid";
  if (/\b(son dosya|onceki dosya|dosyayi|dosyayı|pdfi|exceli|zipi)\b/.test(q)) return "file";
  return "text";
}

function latestAssistantContentObject(req) {
  const messages = Array.isArray(req?.body?.messages) ? req.body.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] || {};
    const role = String(message.role || message.sender || "").toLowerCase();
    if (role !== "assistant") continue;
    const text = stripToolNoise(messageText(message));
    if (!text || isToolGeneratedAnswerText(text)) continue;
    const table = parseFirstMarkdownTableObject(text) || parseCsvLikeTableObject(text) || parseLooseInlineTableObject(text) || parseNumericFactTableObject(text);
    if (table?.rows?.length) return { type: "table", table, text: tableToMarkdown(table), title: contentTitleFromText(text, "LUCY Tablosu"), source: "latest-assistant" };
    return { type: "text", text, title: contentTitleFromText(text, "LUCY İçeriği"), source: "latest-assistant" };
  }
  return null;
}

function typedContentFromMemory(memory = {}, preferred = "text") {
  if (preferred === "table" && memory.lastTable?.rows?.length) {
    return { type: "table", table: memory.lastTable, text: tableToMarkdown(memory.lastTable), title: "LUCY Tablosu", source: "typed-lastTable" };
  }
  if (preferred === "chart" && memory.lastChart?.data) {
    return { type: "chart", chart: memory.lastChart, ui: chartUiFromMemory(memory.lastChart, memory.lastChart.title || "Grafik"), title: memory.lastChart.title || "Grafik", source: "typed-lastChart" };
  }
  if (preferred === "mermaid" && memory.lastMermaid?.code) {
    return { type: "mermaid", code: memory.lastMermaid.code, ui: mermaidUiFromMemory(memory.lastMermaid, memory.lastMermaid.title || "Mermaid diyagram"), title: memory.lastMermaid.title || "Mermaid diyagram", source: "typed-lastMermaid" };
  }
  if (preferred === "file" && memory.lastFile) {
    return { type: "file", file: memory.lastFile, title: memory.lastFile.filename || "LUCY Dosyası", source: "typed-lastFile" };
  }
  return null;
}

function rememberText(memory, text = "") {
  const clean = stripToolNoise(text);
  if (!clean || clean.length < 2) return memory;
  if (isGeneratedStatusOnlyText(text) || isToolGeneratedAnswerText(text)) return memory;
  memory.lastText = clean;
  const table = parseFirstMarkdownTableObject(clean) || parseCsvLikeTableObject(clean) || parseLooseInlineTableObject(clean) || parseNumericFactTableObject(clean);
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
  if (toolName === "document" || /\.(txt|md|json|csv|html)$/i.test(lower)) memory.lastDocument = file;
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
      colors: result.colors || result.palette || input.colors || input.style?.colors || [],
      palette: result.palette || result.colors || input.colors || input.style?.colors || [],
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
      const table = parseFirstMarkdownTableObject(text) || parseCsvLikeTableObject(text) || parseNumericFactTableObject(text);
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
  const requestMessages = Array.isArray(req?.body?.messages) ? req.body.messages : [];
  const persistentMessages = Array.isArray(req?.body?.__lucyPersistentToolMessages) ? req.body.__lucyPersistentToolMessages : [];
  const messages = [...persistentMessages, ...requestMessages];
  const seenMessages = new Set();
  for (const message of messages.slice(-Math.max(HYDRATE_MESSAGE_MAX, persistentMessages.length || 0))) {
    const text = messageText(message);
    const role = String(message?.role || message?.sender || "").toLowerCase();
    const key = `${role}:${text}`;
    if (seenMessages.has(key)) continue;
    seenMessages.add(key);
    const userInlineContent = role === "user" && !isMultiStepCommandText(text) && (String(text).length > 90 || /\n/.test(text) || hasMarkdownTable(text));
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
  return latestAssistantContentObject(req)?.text || "";
}

function latestUsefulConversationContent(req, answer = "") {
  const userText = latestUserIntentText(req);
  const answerText = stripToolNoise(answer);
  const previousAssistant = latestAssistantContent(req);

  const inlineContent = inlineContentFromToolRequest(userText);
  if (inlineContent) return inlineContent;

  // Kullanıcı aynı mesajda içerik verdiyse onu önceliklendir: "şunu pdf yap: ..."
  const userHasInlineContent = String(userText || "").length > 90 || /\n/.test(userText) || /\|.+\|/.test(userText);
  if (userHasInlineContent && !isOnlyTransformCommand(userText) && !isMultiStepCommandText(userText)) return stripToolNoise(userText);

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
  if (memory.firstTable?.rows?.length) tables.push(memory.firstTable);
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

function rankedSubsetSpecFromText(userText = "") {
  const q = normalizeIntentText(userText);
  const match = q.match(/\b(?:en\s+(?:pahali|yuksek|buyuk|fazla|ucuz|dusuk|kucuk)|top)\s+(\d{1,2})\b/)
    || q.match(/\b(\d{1,2})\s+(?:urun|kalem|satir|kayit)\b.*\b(?:en\s+)?(?:pahali|yuksek|buyuk|fazla|ucuz|dusuk|kucuk|top)\b/);
  if (!match) return null;
  const limit = Math.max(1, Math.min(50, Number(match[1]) || 0));
  if (!limit) return null;
  const direction = /\b(ucuz|dusuk|kucuk|az)\b/.test(q) ? "asc" : "desc";
  return { limit, direction };
}

function scoreRankedSubsetHeader(header = "", userText = "") {
  const h = normalizeIntentText(header);
  const q = normalizeIntentText(userText);
  let score = 0;
  if (/^#|^no$|^id$|sira/.test(h)) score -= 100;
  if (/pahali|ucuz|fiyat|price/.test(q)) {
    if (/birim fiyat|tahmini fiyat|fiyat|price/.test(h)) score += 160;
    if (/toplam|total|tutar|amount|bedel/.test(h)) score += 120;
  }
  if (/toplam|tutar|gelir|satis|ciro|deger|value|amount|total/.test(q)) {
    if (/toplam|total|tutar|amount|bedel|gelir|satis|ciro|deger|value/.test(h)) score += 160;
  }
  if (/toplam|total/.test(h)) score += 80;
  if (/tutar|amount|bedel/.test(h)) score += 70;
  if (/fiyat|price/.test(h)) score += 65;
  if (/gelir|satis|ciro|revenue|sales/.test(h)) score += 55;
  if (/deger|value/.test(h)) score += 35;
  if (/miktar|adet|quantity|count/.test(h)) score += 8;
  return score;
}

function rankedSubsetTableForIntent(table = null, userText = "") {
  const spec = rankedSubsetSpecFromText(userText);
  if (!spec || !table?.headers?.length || !table?.rows?.length) return table;
  const numericHeaders = table.headers.filter((header) => table.rows.some((row) => numberFromCell(row?.[header]) !== null));
  if (!numericHeaders.length) return table;
  const valueHeader = numericHeaders
    .map((header, index) => ({ header, score: scoreRankedSubsetHeader(header, userText) + (numericHeaders.length - index) * 0.01 }))
    .sort((a, b) => b.score - a.score)[0]?.header || numericHeaders[0];
  const rankedRows = table.rows
    .map((row, index) => ({ row, index, value: numberFromCell(row?.[valueHeader]) }))
    .filter((item) => item.value !== null)
    .sort((a, b) => spec.direction === "asc" ? (a.value - b.value || a.index - b.index) : (b.value - a.value || a.index - b.index))
    .slice(0, spec.limit)
    .map((item) => item.row);
  if (!rankedRows.length) return table;
  return {
    ...table,
    rows: rankedRows,
    headers: table.headers,
    derivedFrom: table.derivedFrom || "ranked-subset",
    filter: { type: "ranked-subset", limit: spec.limit, direction: spec.direction, valueHeader },
  };
}

function chartFromHistory(memory = {}, userText = "") {
  const charts = [];
  ensureConversationIndex(memory);
  if (memory.firstChart?.data) charts.push(memory.firstChart);
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


function calculatorExpressionFromText(userText = "") {
  let expression = normalizeIntentText(userText)
    .replace(/\b(hesaplayin|hesapla|calculator|matematik|kac eder|sonucu ne|toplami ne|toplami|carpimi ne|carpimi|bolumu ne|bolumu|sonuc ne)\b/g, " ")
    .replace(/\bbolu\b/g, " / ")
    .replace(/\bcarpi\b|\bkere\b|\bkat\b/g, " * ")
    .replace(/\barti\b|\btopla\b/g, " + ")
    .replace(/\beksi\b|\bcikar\b/g, " - ")
    .replace(/\bx\b/gi, " * ")
    .replace(/,/g, ".")
    .replace(/[^0-9+\-*/.()%,\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[+*/.]+|[+\-*/.]+$/g, "")
    .trim();
  // MathJS "5 / 2" kabul eder; yan yana sayıları ise reddetmeden önce düzeltmeye çalışma.
  return expression;
}

function documentFormatFromText(userText = "") {
  const q = normalizeIntentText(userText);
  if (/\bcsv\b/.test(q)) return "csv";
  if (/\bjson\b/.test(q)) return "json";
  if (/\bhtml\b/.test(q)) return "html";
  if (/\b(word|docx|doc)\b/.test(q)) return "docx";
  if (/\btxt\b|metin dosyasi|text dosyasi/.test(q)) return "txt";
  return "md";
}

function documentInlineContentFromText(userText = "") {
  let text = String(userText || "").trim();
  // "Not: ... Bunu txt dosyası yap" gibi doğrudan içerik verilen komutlarda aktif eski içeriğe değil bu metne öncelik ver.
  text = text
    .replace(/\b(bunu|sunlari|şunları|sunları|metni|aynı notu|ayni notu)\b\s*/gi, "")
    .replace(/\b(txt|markdown|md|json|csv|html|word|docx)\s+dosyas[ıi]\s+(yap|olustur|hazirla|kaydet|ver|indir)\b/gi, "")
    .replace(/\b(dosya olarak|dosyas[ıi] olarak)\s+(kaydet|ver|indir)\b/gi, "")
    .replace(/\b(yap|olustur|hazirla|kaydet|ver|indir|cevir|donustur)\s*$/gi, "")
    .trim();
  // Kısa transform komutları içerik sayılmasın.
  if (!text || normalizeIntentText(text).length < 18) return "";
  if (isOnlyTransformCommand(text)) return "";
  return text;
}


function messagePayloadFromText(userText = "", platform = "message") {
  const raw = String(userText || "").trim();
  const q = normalizeIntentText(raw);
  const afterColon = raw.includes(":") ? raw.split(":").slice(1).join(":").trim() : "";
  let text = afterColon || raw;

  text = text
    .replace(/^[^:]{0,120}\b(mail|email|eposta|e posta|telegram|whatsapp|wp)\b[^:]{0,120}\b(gonder|gönder|at|ilet)\b\s*/i, "")
    .replace(/\b(mail|email|eposta|e posta|telegram|whatsapp|wp)\b\s*/gi, "")
    .replace(/\b(gonder|gönder|at|ilet)\b\s*/gi, "")
    .trim();

  if (!text || normalizeIntentText(text) === q) text = afterColon || "LUCY mesajı";
  return text;
}

function extractEmailFromText(userText = "") {
  return String(userText || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
}

function extractPhoneFromText(userText = "") {
  const explicit = String(userText || "").match(/(?:\+?\d[\d\s().-]{7,}\d)/);
  if (!explicit) return "";
  return explicit[0].replace(/[^0-9]/g, "");
}

function mailSubjectFromText(userText = "") {
  const match = String(userText || "").match(/\b(?:konu|subject)\s*[:=]\s*([^\n:]{2,90})/i);
  return (match?.[1] || "LUCY Mesajı").trim();
}

function normalizeFileKindRequest(userText = "") {
  const q = normalizeIntentText(userText);
  if (/\b(excel|xlsx|xls|e tablo|spreadsheet)\b/.test(q)) return "excel";
  if (/\b(pdf)\b/.test(q)) return "pdf";
  if (/\b(zip|arsiv|arşiv)\b/.test(q)) return "zip";
  if (/\b(qr|karekod|png|resim|gorsel|görsel|image)\b/.test(q)) return "image";
  if (/\b(txt|markdown|md|json|csv|html|belge|document|word|docx)\b/.test(q)) return "document";
  return "last";
}

function cleanGeneratedFileCandidate(file = null) {
  if (!file || typeof file !== "object") return null;
  const storedFilename = file.storedFilename || file.generatedFile || file.name || file.filename;
  if (!storedFilename) return null;
  return {
    ...file,
    storedFilename,
    filename: file.filename || file.name || storedFilename,
  };
}

function selectGeneratedFileFromMemory(userText = "", memory = {}, req = null, options = {}) {
  const kind = normalizeFileKindRequest(userText);
  const allowZip = options.allowZip !== false;
  const refs = collectConversationGeneratedFileRefs(req || {}).map(cleanGeneratedFileCandidate).filter(Boolean);

  const typed = {
    excel: [memory.lastExcel],
    pdf: [memory.lastPdf],
    zip: [memory.lastZip],
    image: [memory.lastQr, memory.lastFile],
    document: [memory.lastDocument, memory.lastFile],
    last: [memory.lastFile, memory.lastPdf, memory.lastExcel, memory.lastDocument, memory.lastQr, memory.lastZip],
  };

  const candidates = [
    ...(typed[kind] || []),
    ...(kind !== "last" ? (typed.last || []) : []),
    ...refs.slice().reverse(),
  ].map(cleanGeneratedFileCandidate).filter(Boolean);

  for (const candidate of candidates) {
    const name = String(candidate.filename || candidate.storedFilename || "").toLowerCase();
    if (!allowZip && name.endsWith(".zip")) continue;
    if (kind === "excel" && !/\.(xlsx|xls|csv)$/i.test(name)) continue;
    if (kind === "pdf" && !/\.pdf$/i.test(name)) continue;
    if (kind === "zip" && !/\.zip$/i.test(name)) continue;
    if (kind === "image" && !/\.(png|jpe?g|webp|gif|bmp|tiff?|svg)$/i.test(name)) continue;
    if (kind === "document" && !/\.(txt|md|json|jsonl|csv|html?|xml|docx?)$/i.test(name)) continue;
    return candidate;
  }

  return candidates.find((candidate) => allowZip || !String(candidate.filename || candidate.storedFilename || "").toLowerCase().endsWith(".zip")) || null;
}

function fileManagerInputFromText(userText = "", memory = {}, req = null) {
  const q = normalizeIntentText(userText);
  if (/listele|listesi|dosyalari|dosyaları|generated/.test(q) && !/oku|sil|delete/.test(q)) {
    return { action: "list" };
  }
  if (/sil|delete|kaldir|kaldır/.test(q)) {
    const file = selectGeneratedFileFromMemory(userText, memory, req, { allowZip: true });
    if (file?.storedFilename) return { action: "delete", storedFilename: file.storedFilename, filename: file.filename || file.storedFilename };
    return { action: "delete" };
  }
  if (/oku|icerik|içerik|ac|aç/.test(q)) {
    const file = selectGeneratedFileFromMemory(userText, memory, req, { allowZip: true });
    if (file?.storedFilename) return { action: "read", storedFilename: file.storedFilename, filename: file.filename || file.storedFilename };
    return { action: "read" };
  }
  return { action: "list" };
}


function canonicalChainToolName(tool = "") {
  const compact = String(tool || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const aliases = {
    chart: "chartData",
    chartdata: "chartData",
    filemanager: "fileManager",
    webfetch: "webFetch",
    textstats: "textStats",
  };
  return aliases[compact] || String(tool || "").trim();
}

function chainPriority(tool = "") {
  const t = String(canonicalChainToolName(tool)).toLowerCase();
  // ZIP her zaman en son çalışmalı; aynı turda üretilen dosyaları içine alabilsin.
  const priority = {
    calculator: 10,
    time: 12,
    webfetch: 15,
    ocr: 20,
    chartdata: 30,
    mermaid: 32,
    excel: 40,
    document: 42,
    pdf: 44,
    qr: 46,
    textstats: 50,
    mail: 60,
    whatsapp: 61,
    telegram: 62,
    filemanager: 70,
    zip: 100,
  };
  return priority[t] ?? 55;
}

function orderToolCallsForChaining(calls = [], userText = "") {
  return rankAndDedupeToolCalls(calls, userText)
    .map((call, index) => ({ ...call, tool: canonicalChainToolName(call.tool), __chainIndex: index }))
    .sort((a, b) => {
      const pa = chainPriority(a.tool);
      const pb = chainPriority(b.tool);
      if (pa !== pb) return pa - pb;
      return (a.__chainIndex || 0) - (b.__chainIndex || 0);
    })
    .map(({ __chainIndex, ...call }) => call);
}

function producedFileCandidate(tool = "", result = {}) {
  if (!result || result.success === false) return null;
  const filename = result.filename || result.storedFilename;
  const storedFilename = result.storedFilename || result.generatedFile || result.filename;
  if (!filename && !storedFilename) return null;
  const lower = String(filename || storedFilename || "").toLowerCase();
  // Aynı turda üretilen ZIP'i başka ZIP içine koyma.
  if (lower.endsWith(".zip")) return null;
  if (!["excel", "pdf", "document", "qr"].includes(String(tool || "").toLowerCase())) return null;
  return {
    tool,
    filename: filename || storedFilename,
    storedFilename: storedFilename || filename,
    mimeType: result.mimeType || result.contentType || "",
    url: result.url || result.downloadUrl || "",
  };
}

function hasZipFiles(input = {}) {
  return Array.isArray(input.files) && input.files.some((file) => file && (file.storedFilename || file.generatedFile || file.base64 || String(file.content || file.text || "").trim()));
}

function fillZipInputFromProducedFiles(call = {}, producedFiles = [], options = {}) {
  const tool = String(call.tool || "").toLowerCase();
  if (tool !== "zip") return call;
  const input = call.input && typeof call.input === "object" ? { ...call.input } : {};
  const produced = producedFiles
    .filter(Boolean)
    .filter((file) => file.storedFilename && !String(file.filename || file.storedFilename || "").toLowerCase().endsWith(".zip"))
    .map((file) => ({ storedFilename: file.storedFilename, filename: file.filename || file.storedFilename }));

  if (!produced.length) return { ...call, input };

  if (options.preferProduced || !hasZipFiles(input)) {
    return { ...call, input: { ...input, files: produced, filename: input.filename || "lucy-coklu-cikti.zip" } };
  }

  const existing = Array.isArray(input.files) ? input.files : [];
  const seen = new Set();
  const files = [...existing, ...produced].filter((file) => {
    const key = String(file?.storedFilename || file?.generatedFile || file?.filename || "");
    if (!key || key.toLowerCase().endsWith(".zip") || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { ...call, input: { ...input, files, filename: input.filename || "lucy-coklu-cikti.zip" } };
}

function fillPdfInputFromProducedContent(call = {}, producedContents = [], userText = "") {
  const tool = String(call.tool || "").toLowerCase();
  if (tool !== "pdf") return call;
  const input = call.input && typeof call.input === "object" ? { ...call.input } : {};
  const q = normalizeIntentText(userText);
  const latestChart = [...producedContents].reverse().find((item) => item?.type === "chart" && item.chart);
  const latestMermaid = [...producedContents].reverse().find((item) => item?.type === "mermaid" && item.code);
  const latestWeb = [...producedContents].reverse().find((item) => item?.type === "web" && item.text);
  if (latestChart && /grafik|chart|pasta|trend|cizgi|bar|sutun|rapor/.test(q)) {
    input.chart = latestChart.chart;
    input.data = latestChart.chart?.data || input.data;
    input.chartType = latestChart.chart?.chartType || input.chartType;
    input.title = input.title || latestChart.title || "LUCY Grafiği";
  }
  if (latestMermaid && /diyagram|mermaid|akis|akış|sema|şema/.test(q)) {
    input.mermaid = latestMermaid.code;
    input.title = input.title || latestMermaid.title || "LUCY Diyagramı";
  }
  if (latestWeb && (!String(input.text || input.content || "").trim() || /oku|sayfa|web|link|url|ozet|özet/.test(q))) {
    input.text = latestWeb.text;
    input.title = input.title || latestWeb.title || "Web Özeti";
  }
  return { ...call, input };
}

function fillDocumentInputFromProducedContent(call = {}, producedContents = [], userText = "") {
  const tool = String(call.tool || "").toLowerCase();
  if (tool !== "document") return call;
  const input = call.input && typeof call.input === "object" ? { ...call.input } : {};
  const q = normalizeIntentText(userText);
  const latestWeb = [...producedContents].reverse().find((item) => item?.type === "web" && item.text);
  const latestChart = [...producedContents].reverse().find((item) => item?.type === "chart" && item.chart);
  const latestMermaid = [...producedContents].reverse().find((item) => item?.type === "mermaid" && item.code);
  const current = String(input.content || input.text || input.markdown || "").trim();
  const currentLooksLikePrompt = /\b(bunu|sonra|dosyas[ıi]|yap|haz[ıi]rla|oku|sayfa|link|url)\b/.test(normalizeIntentText(current));
  if (latestWeb && (!current || currentLooksLikePrompt || /oku|sayfa|web|link|url|ozet|özet/.test(q))) {
    input.content = latestWeb.text;
    input.title = input.title || latestWeb.title || "Web Özeti";
    input.filename = input.filename || `${safeOutputStem(input.title || "web-ozeti")}.${input.format || "txt"}`;
  } else if (latestChart && /grafik|chart|pasta|trend|cizgi|bar/.test(q) && !current) {
    input.content = `${latestChart.title || "Grafik"}

${JSON.stringify(latestChart.chart?.data || latestChart.chart, null, 2)}`;
    input.title = input.title || latestChart.title || "Grafik";
  } else if (latestMermaid && /diyagram|mermaid|akis|akış|sema|şema/.test(q) && !current) {
    input.content = latestMermaid.code;
    input.title = input.title || latestMermaid.title || "Diyagram";
  }
  return { ...call, input };
}

function producedContentCandidate(tool = "", result = {}) {
  const t = String(tool || "").toLowerCase();
  if (!result || result.success === false) return null;
  if (t === "chartdata" && result.data) return { type: "chart", chart: result, title: result.title || "Grafik" };
  if (t === "mermaid" && (result.code || result.mermaid)) return { type: "mermaid", code: result.code || result.mermaid, title: result.title || "Diyagram" };
  if (t === "webfetch" && (result.text || result.title)) {
    const title = result.title || result.url || "Web Özeti";
    const text = [result.title ? `Başlık: ${result.title}` : "", result.text ? `Özet: ${result.text}` : "", result.url ? `Kaynak: ${result.url}` : ""].filter(Boolean).join("\n\n");
    return { type: "web", text, title, url: result.url || "" };
  }
  return null;
}

function userAskedMultiOutputChain(userText = "") {
  const q = normalizeIntentText(userText);
  const outputKinds = [
    wantsExcelFromText(q), wantsPdfFromText(q), wantsDocumentFromText(q), wantsQrFromText(q), wantsZipFromText(q),
    wantsChartFromText(q), wantsMermaidFromText(q), wantsTextStatsFromText(q), wantsOcrFromText(q), wantsWebFetchFromText(q),
  ].filter(Boolean).length;
  return outputKinds >= 2 || /\b(hem|ve|sonra|ardindan|ardından|ayrica|ayrıca|birlikte|hepsini)\b/.test(q);
}

function buildImplicitToolCalls(answer = "", req) {
  const userText = latestUserIntentText(req);
  const memory = hydrateMemoryFromRequest(req);
  const activeContent = resolveActiveContent(req, answer);
  const source = activeContentToText(activeContent, sourceFromMemory(req, answer));
  const userInlineContent = inlineContentFromToolRequest(userText);
  const userInlineTable = parseInlineTableObject(userText);
  const inlineTable = userInlineTable || parseInlineTableObject(source);
  const blockStaleArtifactFallback = shouldBlockStaleArtifactFallback(memory, userText);
  const activeContentTableCandidate = chartableTableFromContent(activeContent);
  // Kullanıcı mesajındaki yeni veri her zaman eski context'ten önce gelir.
  const baseTableForIntent = inlineTable || activeContentTableCandidate || (blockStaleArtifactFallback ? null : memory.lastTable);
  const activeTable = rankedSubsetTableForIntent(baseTableForIntent, userText);
  const rankedSubsetRequested = Boolean(rankedSubsetSpecFromText(userText));
  const hasFreshUserContent = Boolean(userInlineContent || userInlineTable);
  if (hasFreshUserContent && activeContent && typeof activeContent === "object") {
    activeContent.title = contentTitleFromText(userInlineContent || userText, activeTable ? "LUCY Tablosu" : "LUCY Ciktisi");
  }
  const title = activeContent?.title || contentTitleFromText(source, activeTable ? "LUCY Tablosu" : "LUCY Çıktısı");
  syncRankedSubsetActiveTable(memory, baseTableForIntent, activeTable, title);
  const stem = safeOutputStem(title);
  const calls = [];

  if (wantsCalculatorFromText(userText) && !wantsDocumentFromText(userText) && !wantsExcelFromText(userText) && !wantsPdfFromText(userText) && !wantsZipFromText(userText)) {
    const expression = calculatorExpressionFromText(userText);
    if (/[0-9]/.test(expression) && /[+\-*/%]/.test(expression) && expression.length > 0) {
      calls.push({ tool: "calculator", input: { expression } });
    }
  }

  if (wantsTimeFromText(userText) && !calls.length) {
    calls.push({ tool: "time", input: { locale: "tr-TR", timeZone: "Europe/Istanbul" } });
  }

  if (wantsWebFetchFromText(userText)) {
    const url = String(userText).match(/https?:\/\/\S+/i)?.[0]?.replace(/[),.;]+$/g, "");
    if (url) calls.push({ tool: "webFetch", input: { url } });
  }


  if (wantsMailFromText(userText)) {
    calls.push({ tool: "mail", input: { to: extractEmailFromText(userText), subject: mailSubjectFromText(userText), text: messagePayloadFromText(userText, "mail") } });
  }

  if (wantsTelegramFromText(userText)) {
    calls.push({ tool: "telegram", input: { text: messagePayloadFromText(userText, "telegram") } });
  }

  if (wantsWhatsappFromText(userText)) {
    calls.push({ tool: "whatsapp", input: { to: extractPhoneFromText(userText), text: messagePayloadFromText(userText, "whatsapp") } });
  }

  if (wantsFileManagerFromText(userText)) {
    calls.push({ tool: "fileManager", input: fileManagerInputFromText(userText, memory, req) });
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

  const selectedChartForStyle = chartFromHistory(memory, userText) || memory.lastChart;
  if (isStyleOnlyChartModify(userText, memory) && selectedChartForStyle?.data) {
    const chartInput = chartToChartInput(selectedChartForStyle, userText);
    if (chartInput) calls.push({ tool: "chartData", input: applyStyleToChartInput(chartInput, userText, selectedChartForStyle) });
  } else if (wantsChartFromText(userText) && !isChartExportOnlyRequest(userText)) {
    const freshInlineTable = parseInlineTableObject(userText);
    const selectedChart = blockStaleArtifactFallback ? null : (chartFromHistory(memory, userText) || memory.lastChart);
    const selectedTableRaw = rankedSubsetTableForIntent(freshInlineTable || activeTable || (blockStaleArtifactFallback ? null : tableFromHistory(memory, userText)), userText);
    const tablePalette = paletteFromTable(selectedTableRaw);
    const selectedTable = tablePalette && selectedChart?.data ? null : selectedTableRaw;
    const activeIsChart = activeContent?.type === "chart" && (activeContent.chart?.data || activeContent.ui?.data);
    const preferExistingChart = !selectedTable?.rows?.length
      && !freshInlineTable
      && selectedChart?.data
      && (activeIsChart || explicitHistoricalArtifactReference(userText) || tablePalette);
    const chartInput = preferExistingChart
      ? chartToChartInput(selectedChart, userText)
      : selectedTable?.rows?.length
        ? tableToChartInput(selectedTable, userText)
        : (selectedChart || (!blockStaleArtifactFallback && memory.lastChart))
          ? chartToChartInput(selectedChart || memory.lastChart, userText)
          : null;
    if (chartInput) {
      const chartTitle = preferExistingChart && styleMutationText(userText)
        ? chartTitleForStyleMutation(userText, selectedChart.title || chartInput.title || title || "Grafik", selectedChart.chartType || chartInput.chartType)
        : chartTitleFromPlan(userText, chartInput, title || "Grafik");
      const input = { ...chartInput, title: chartTitle };
      const palette = detectColorPalette(userText);
      const style = { ...(input.style || {}), ...detectVisualStyle(userText) };
      if (palette.requested) {
        input.colors = palette.colors;
        input.palette = palette.name;
        input.style = { ...style, colorful: true, palette: palette.name, colors: palette.colors };
      } else if (tablePalette?.colors?.length) {
        input.colors = tablePalette.colors;
        input.palette = tablePalette.name;
        input.style = { ...style, colorful: true, palette: tablePalette.name, colors: tablePalette.colors };
      } else {
        input.style = style;
      }
      if (preferExistingChart) input.chartType = selectedChart.chartType || chartInput.chartType || input.chartType;
      calls.push({ tool: "chartData", input });
    }
  }

  if (wantsMermaidFromText(userText) && !wantsChartFromText(userText)) {
    // Aynı mesajda hem grafik hem diyagram istenirse grafik öncelikli; mermaid ayrıca çalışmaz
    const selectedTable = rankedSubsetTableForIntent(tableFromHistory(memory, userText) || activeTable, userText);
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
    const selectedChartForPdf = userSpecificallyReferencesChart(userText)
      ? (chartFromHistory(memory, userText) || memory.lastChart)
      : null;
    const pdfTitle = selectedChartForPdf?.title || title;
    const pdfInput = { title: pdfTitle, filename: `${safeOutputStem(pdfTitle) || stem || "lucy-rapor"}.pdf` };
    if (selectedChartForPdf?.data) {
      pdfInput.chart = selectedChartForPdf;
      pdfInput.data = selectedChartForPdf.data;
      pdfInput.chartType = selectedChartForPdf.chartType || selectedChartForPdf.type || "bar";
      pdfInput.text = "";
    } else if (activeContent?.type === "chart" && (activeContent.chart?.data || activeContent.ui?.data)) {
      const chart = activeContent.chart || activeContent.ui;
      pdfInput.chart = chart;
      pdfInput.data = chart.data;
      pdfInput.chartType = chart.chartType || chart.type || "bar";
      pdfInput.text = "";
    } else if (activeContent?.type === "mermaid" && String(activeContent.code || activeContent.mermaid || "").trim()) {
      pdfInput.mermaid = activeContent.code || activeContent.mermaid;
      pdfInput.text = "";
    } else {
      pdfInput.text = activeTable?.rows?.length && (isOnlyTransformCommand(userText) || rankedSubsetRequested) ? tableToMarkdown(activeTable) : source;
    }
    calls.push({ tool: "pdf", input: pdfInput });
  }

  if (wantsQrFromText(userText)) {
    const url = String(userText).match(/https?:\/\/\S+/i)?.[0]?.replace(/[),.;]+$/g, "");
    const text = url || (!isOnlyTransformCommand(userText) ? userText : memory.lastText || source);
    const qrStem = safeOutputStem(url || text || stem || "lucy-qr");
    if (String(text || "").trim()) calls.push({ tool: "qr", input: { text, filename: `${qrStem || "lucy-qr"}.png` } });
  }

  if (wantsTextStatsFromText(userText)) {
    const text = !isOnlyTransformCommand(userText) && String(userText).length > 40 ? userText : memory.lastText || source;
    if (String(text || "").trim()) calls.push({ tool: "textStats", input: { text } });
  }

  if (wantsDocumentFromText(userText)) {
    const format = documentFormatFromText(userText);
    const inlineContent = rankedSubsetRequested ? "" : documentInlineContentFromText(userText);
    const content = inlineContent || (activeTable?.rows?.length && format !== "json" && format !== "csv" ? tableToMarkdown(activeTable) : source);
    const docTitle = inlineContent ? contentTitleFromText(inlineContent, "LUCY Test Notu") : title;
    const docStem = safeOutputStem(docTitle || stem || "lucy-belge");
    if (String(content || "").trim()) calls.push({ tool: "document", input: { title: docTitle, content, rows: inlineContent ? undefined : activeTable?.rows, format, filename: `${docStem || "lucy-belge"}.${format}` } });
  }

  if (wantsZipFromText(userText)) {
    const isMulti = userAskedMultiOutputChain(userText);
    const chosen = isMulti ? null : selectGeneratedFileFromMemory(userText, memory, req, { allowZip: false });
    const files = chosen?.storedFilename ? [{ storedFilename: chosen.storedFilename, filename: chosen.filename || chosen.storedFilename }] : undefined;
    calls.push({ tool: "zip", input: { filename: `${stem || "lucy-dosyalari"}.zip`, ...(files ? { files } : {}) } });
  }

  const maxCalls = userAskedMultiOutputChain(userText) ? 8 : 5;
  return orderToolCallsForChaining(calls, userText)
    .map((call) => enrichToolCallInput(call, req))
    .filter((call) => isToolCallAllowedByCurrentIntent(call, req))
    .filter(isUsableToolCall)
    .slice(0, maxCalls);
}


function previousUserIntentText(req) {
  const messages = Array.isArray(req?.body?.messages) ? req.body.messages : [];
  let seenLatest = false;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] || {};
    const role = String(message.role || message.sender || "").toLowerCase();
    if (role && role !== "user") continue;
    const text = String(message.content || message.text || message.message || "").trim();
    if (!text) continue;
    if (!seenLatest) { seenLatest = true; continue; }
    return text;
  }
  return "";
}

function latestAssistantAskedClarification(req) {
  const messages = Array.isArray(req?.body?.messages) ? req.body.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] || {};
    const role = String(message.role || message.sender || "").toLowerCase();
    if (role === "user") continue;
    if (role && role !== "assistant") continue;
    const text = normalizeIntentText(messageText(message));
    if (!text) continue;
    return /hangisini|hangisini kastettin|hangi veriyi|ne yapmami|ne yapmam|netlestir|netleştir|daha detay|spesifik|tam olarak/.test(text);
  }
  return false;
}

function actionSuffixFromText(text = "") {
  const q = normalizeIntentText(text);
  if (wantsPdfFromText(q)) return "pdf yap";
  if (wantsExcelFromText(q)) return "excel yap";
  if (wantsZipFromText(q)) return "zip yap";
  if (wantsDocumentFromText(q)) return documentFormatFromText(q) === "docx" ? "word yap" : `${documentFormatFromText(q)} dosyası yap`;
  if (/\btablo\b.*\b(yap|goster|göster|cevir|çevir|donustur|dönüştür)\b|\btablo yap\b/.test(q)) return "tablo yap";
  if (wantsChartFromText(q)) return "grafik yap";
  if (wantsMermaidFromText(q)) return "diyagram yap";
  return "";
}

function sourcePrefixFromText(text = "") {
  const q = normalizeIntentText(text);
  if (/\b(grafik|grafiği|grafigi|chart|pasta|pie|cizgi|çizgi|bar|sutun|sütun)\b/.test(q)) return "son grafiği";
  if (/\b(tablo|tabloyu|tablom)\b/.test(q)) return "son tabloyu";
  if (/\b(dosya|dosyayi|dosyayı|pdf|excel|zip|word|docx)\b/.test(q)) return "son dosyayı";
  if (/\b(metin|yazi|yazı|siir|şiir)\b/.test(q)) return "son metni";
  if (/\b(son|en son|az onceki|az önceki|bunu|bunun|buna|bundaki|bundan|onu|onun|ona|şunu|sunu|şunun|sunun|yaptigini|yaptığını)\b/.test(q)) return "son çıktıyı";
  return "";
}

function currentUserHasClearAction(text = "") {
  const q = normalizeIntentText(text);
  return wantsPdfFromText(q) || wantsExcelFromText(q) || wantsZipFromText(q) || wantsDocumentFromText(q)
    || wantsChartFromText(q) || wantsMermaidFromText(q)
    || /\btablo\b.*\b(yap|goster|göster|cevir|çevir|donustur|dönüştür)\b|\btablo yap\b/.test(q);
}

function storePendingClarification(req, message = "", decision = {}) {
  const memory = getStoredToolMemory(req);
  memory.pendingClarification = {
    question: String(message || ""),
    userText: latestUserIntentText(req),
    decision: decision?.decision || "ASK_CLARIFICATION",
    createdAt: Date.now(),
  };
  memory.updatedAt = Date.now();
  return memory.pendingClarification;
}

function clearPendingClarification(req) {
  const memory = getStoredToolMemory(req);
  memory.pendingClarification = null;
  memory.lastUserIntent = latestUserIntentText(req);
  memory.updatedAt = Date.now();
  return memory;
}

function resolveClarificationFollowUpText(req) {
  const memory = hydrateMemoryFromRequest(req);
  const pending = memory.pendingClarification || null;
  if (!latestAssistantAskedClarification(req) && !pending) return "";
  const current = latestUserIntentText(req);
  const previous = pending?.userText || previousUserIntentText(req);
  if (!current || !previous) return "";

  const currentNorm = normalizeIntentText(current);
  if (/\b(burda|burada|sohbette|chatte|ekranda|buraya)\b/.test(currentNorm)) {
    return `${previous} burada göster`;
  }

  // Kullanıcı zaten hem kaynak hem aksiyon verdi ise aynen kullan.
  if (sourcePrefixFromText(current) && currentUserHasClearAction(current)) return current;

  const source = sourcePrefixFromText(current) || sourcePrefixFromText(previous);
  const action = currentUserHasClearAction(current) ? actionSuffixFromText(current) : actionSuffixFromText(previous);
  if (source && action) return `${source} ${action}`;
  return "";
}

function requestHasResolvableTypedReference(req) {
  const text = normalizeIntentText(latestUserIntentText(req));
  const memory = hydrateMemoryFromRequest(req);
  const hasTypedSource = /\b(grafik|grafiği|grafigi|chart|tablo|tabloyu|dosya|dosyayı|dosyayi|metin|yazi|yazı|diyagram|şema|sema)\b/.test(text);
  const hasVagueCurrentSource = /\b(bunu|bunun|buna|bundaki|bundan|onu|onun|ona|şunu|sunu|şunun|sunun|son|en son|mevcut)\b/.test(text);
  const hasAction = currentUserHasClearAction(text);
  if (hasTypedSource && hasAction) return true;
  if (hasVagueCurrentSource && hasAction && memory.activeContent?.type === "chart" && memory.lastChart?.data) return true;
  return false;
}

function shouldBypassPlannerClarification(decision = {}, req = null) {
  if (decision?.decision !== "ASK_CLARIFICATION") return false;
  if (requestHasResolvableTypedReference(req)) return true;
  if (resolveClarificationFollowUpText(req)) return true;
  return false;
}

function deepSeekPlannerEnabled() {
  return aiPlannerEnabled();
}

function buildClarificationMessage(decision = {}, req = null) {
  const explicit = String(decision?.clarification || "").trim();
  if (explicit) return explicit;
  const memory = hydrateMemoryFromRequest(req);
  const options = [];
  if (memory.lastTable?.rows?.length) options.push("son tabloyu");
  if (memory.lastChart?.data) options.push("son grafiği");
  if (memory.lastMermaid?.code) options.push("son diyagramı");
  if (memory.lastFile?.storedFilename) options.push("son dosyayı");
  if (memory.lastText) options.push("son metni");
  if (options.length) return `Aşkım tam olarak hangisini kastettin: ${options.slice(0, 4).join(", ")} mı?`;
  return "Aşkım bunu tam anlayamadım. Biraz daha detay verir misin?";
}

function shouldAskClarificationWithoutAi(req) {
  const text = normalizeIntentText(latestUserIntentText(req));
  if (!text) return "";
  const vagueRef = /\b(bunu|onu|şunu|sunu|bu|o|son|en son|az onceki|az önceki|ilk|onceki|önceki)\b/.test(text);
  const mutation = /\b(renk|renkli|pastel|neon|kalin|kalın|cizgili|çizgili|degistir|değiştir|duzenle|düzenle|pdf yap|excel yap|word yap|zip yap|grafik yap|tablo yap)\b/.test(text);
  if (!vagueRef || !mutation) return "";
  const memory = hydrateMemoryFromRequest(req);
  if (memory.activeContent?.type === "chart" && memory.lastChart?.data && userStyleMutationOnly(text)) return "";
  if (isChartExportOnlyRequest(text) && memory.lastChart?.data) return "";
  const count = [memory.lastTable?.rows?.length, memory.lastChart?.data, memory.lastMermaid?.code, memory.lastFile?.storedFilename, memory.lastText].filter(Boolean).length;
  if (count <= 1) return "";
  return buildClarificationMessage({}, req);
}

async function buildAiPlannerDecision(req) {
  if (!deepSeekPlannerEnabled()) return null;
  const userText = latestUserIntentText(req);
  if (!String(userText || "").trim()) return null;
  try {
    return await planLucyActionWithDeepSeek({
      userText,
      memory: hydrateMemoryFromRequest(req),
      availableTools: listLoadedTools().map((tool) => tool.name || tool),
    });
  } catch (error) {
    console.warn("Lucy generic AI planner devre dışı:", error.message);
    return null;
  }
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

    return rankAndDedupeToolCalls(planned, userText)
      .map((call) => ({ ...call, tool: normalizeToolName(call.tool) }))
      .map((call) => enrichToolCallInput(call, req))
      .filter((call) => isToolCallAllowedByCurrentIntent(call, req))
      .filter(isUsableToolCall)
      .slice(0, 5);
  } catch (error) {
    console.warn("Lucy DS tool planner fallback devre dışı:", error.message);
    return [];
  }
}


function pushCleanSummaryLine(lines, line = "") {
  const clean = cleanSummaryLine(line);
  if (!clean) return;
  if (lines.includes(clean)) return;
  lines.push(clean);
}

function buildToolFinalAnswer(toolResults = []) {
  const lines = [];
  const widgets = [];
  const seenUi = new Set();

  for (const item of toolResults || []) {
    const ui = item?.ui || normalizeToolResultForUI(item?.tool, item?.result || {}, item?.input || {});
    if (!ui || typeof ui !== "object") continue;

    const tool = String(item?.tool || ui.tool || "tool");
    const canRenderWidget = shouldRenderUi(ui, seenUi);
    const pushWidget = () => {
      if (canRenderWidget) widgets.push(widgetFence(ui));
    };

    if (!ui.success) {
      const errorCode = ui.raw?.error || ui.raw?.raw?.error || "";
      const errorMsg = ui.text || ui.raw?.message || ui.raw?.raw?.message || "Tool çalışmadı.";
      const configErrors = ["mail_config_required", "whatsapp_config_required", "telegram_config_required"];
      pushCleanSummaryLine(lines, `${configErrors.includes(errorCode) ? "⚙️" : "❌"} ${ui.title || tool}: ${errorMsg}`);
      pushWidget();
      continue;
    }

    if (ui.downloadUrl) {
      pushCleanSummaryLine(lines, "✅ İndirme hazırlandı. Aşağıdan indirebilirsin.");
      pushWidget();
      continue;
    }

    if (ui.type === "chart") {
      pushCleanSummaryLine(lines, `✅ ${ui.title || "Grafik"} hazırlandı.`);
      pushWidget();
      continue;
    }

    if (ui.type === "mermaid") {
      pushCleanSummaryLine(lines, `✅ ${ui.title || "Diyagram"} hazırlandı.`);
      pushWidget();
      continue;
    }

    if (ui.text) {
      pushCleanSummaryLine(lines, ui.text);
      pushWidget();
      continue;
    }

    pushCleanSummaryLine(lines, summarizeToolResultLine(tool, ui));
    pushWidget();
  }

  const cleanLines = compactText(lines.filter(Boolean).join("\n")).trim();
  const cleanWidgets = widgets.filter(Boolean).join("");
  return `${cleanLines}${cleanWidgets}`.trim();
}

async function executeToolCallsFromAnswer(answer = "", req) {
  const memory = hydrateMemoryFromRequest(req);
  const clarifiedIntent = resolveClarificationFollowUpText(req);
  if (clarifiedIntent) req.__lucyEffectiveUserText = clarifiedIntent;
  if (req && typeof req === "object") {
    req.__lucyUnderstandingFrame = buildUnderstandingFrame(req, memory);
  }
  const userText = latestUserIntentText(req);
  const aiDecision = await buildAiPlannerDecision(req);

  if (aiDecision?.decision === "ASK_CLARIFICATION" && !shouldBypassPlannerClarification(aiDecision, req)) {
    const clarificationMessage = buildClarificationMessage(aiDecision, req);
    storePendingClarification(req, clarificationMessage, aiDecision);
    return {
      toolCalls: [],
      toolResults: [],
      finalAnswer: clarificationMessage,
      plannerDecision: aiDecision,
    };
  }

  const fallbackClarification = !aiDecision ? shouldAskClarificationWithoutAi(req) : "";
  if (fallbackClarification && !requestHasResolvableTypedReference(req) && !resolveClarificationFollowUpText(req)) {
    storePendingClarification(req, fallbackClarification, { decision: "ASK_CLARIFICATION" });
    return { toolCalls: [], toolResults: [], finalAnswer: fallbackClarification };
  }

  const explicitCalls = [
    ...extractToolCallsFromAnswer(answer),
    ...extractToolCallsFromHtmlButtons(answer),
  ];
  const allowMermaid = requestedMermaidWork(req);
  const allowAnyTool = requestedToolWork(req) || aiDecision?.decision === "TOOL_REQUIRED";
  const mermaidCalls = explicitCalls.length || !allowMermaid ? [] : extractMermaidBlocksFromAnswer(answer);
  const rawToolCalls = orderToolCallsForChaining([...explicitCalls, ...mermaidCalls], userText);

  let toolCalls = [];

  if (aiDecision?.decision === "TOOL_REQUIRED" && Array.isArray(aiDecision.toolCalls) && aiDecision.toolCalls.length) {
    toolCalls = rankAndDedupeToolCalls(aiDecision.toolCalls, userText)
      .map((call) => ({ ...call, tool: normalizeToolName(call.tool) }))
      .map((call) => enrichToolCallInput(call, req))
      .filter((call) => isToolCallAllowedByCurrentIntent(call, req))
      .filter(isUsableToolCall);
  }

  const implicitCallsForCurrentIntent = (allowAnyTool || shouldForceChartRenderer(req)) ? buildImplicitToolCalls(answer, req) : [];

  const forceStyleChart = isStyleOnlyChartModify(userText, hydrateMemoryFromRequest(req));
  const implicitChartCall = implicitCallsForCurrentIntent.find((call) => String(call.tool || "").toLowerCase() === "chartdata");
  if (forceStyleChart && implicitChartCall) {
    // DS cevabı tablo/HTML/metin üretse bile, semantik olarak bu bir chart style mutation ise chartData kazanır.
    toolCalls = [implicitChartCall];
  }

  const chartMemory = hydrateMemoryFromRequest(req);
  const tableBackedChartRequest = Boolean(implicitChartCall && (
    parseInlineTableObject(userText)
    || tableFromHistory(chartMemory, userText)
    || chartMemory.lastTable?.rows?.length
  ));
  if (!forceStyleChart && tableBackedChartRequest && !userSpecificallyReferencesChart(userText)) {
    // Tablo -> grafik deterministik kalmali; planner'in tahmini labels/values secimi tablo motorunu ezmemeli.
    toolCalls = [implicitChartCall];
  }

  if (!toolCalls.length && implicitCallsForCurrentIntent.length) {
    toolCalls = implicitCallsForCurrentIntent;
  }

  if (!toolCalls.length) {
    toolCalls = shouldForceChartRenderer(req)
      ? []
      : rawToolCalls
        .map((call) => ({ ...call, tool: normalizeToolName(call.tool) }))
        .map((call) => enrichToolCallInput(call, req))
        .filter((call) => isToolCallAllowedByCurrentIntent(call, req))
        .filter(isUsableToolCall);
  }

  // File read/list commands are deterministic. If the model guessed another tool,
  // discard it and let the implicit router build the correct fileManager call.
  if (wantsFileManagerFromText(latestUserIntentText(req)) && !toolCalls.some((call) => String(call.tool || "").toLowerCase() === "filemanager")) {
    toolCalls = [];
  }

  if (!toolCalls.length && implicitCallsForCurrentIntent.length) {
    toolCalls = implicitCallsForCurrentIntent;
  } else if (toolCalls.length && implicitCallsForCurrentIntent.length && userAskedMultiOutputChain(latestUserIntentText(req))) {
    // Model bazen zincirin son halkasını (özellikle ZIP veya document) atlıyor.
    // Kullanıcının açık istediği deterministic çağrıları eksikse tamamla.
    const existing = new Set(toolCalls.map((call) => String(canonicalChainToolName(call.tool)).toLowerCase()));
    const additions = implicitCallsForCurrentIntent.filter((call) => !existing.has(String(canonicalChainToolName(call.tool)).toLowerCase()));
    if (additions.length) toolCalls = orderToolCallsForChaining([...toolCalls, ...additions], latestUserIntentText(req));
  }

  if (!toolCalls.length && allowAnyTool && deepSeekPlannerEnabled()) {
    const plannerCalls = await buildDeepSeekPlannerToolCalls(answer, req);
    if (plannerCalls.length) toolCalls = plannerCalls;
  }

  if (!toolCalls.length) {
    clearPendingClarification(req);
    const cleaned = sanitizeNormalAnswer(answer, req);
    if (cleaned) rememberText(getStoredToolMemory(req), cleaned);
    return {
      toolCalls: [],
      toolResults: [],
      finalAnswer: cleaned || (allowAnyTool ? missingToolContextMessage(req) : "Tamam aşkım, buradayım. Ne istersen birlikte yaparız. 💙"),
    };
  }

  clearPendingClarification(req);

  const toolResults = [];
  const producedFilesThisTurn = [];
  const producedContentsThisTurn = [];
  const preferProducedZip = userAskedMultiOutputChain(latestUserIntentText(req));

  for (const originalCall of toolCalls) {
    let call = fillPdfInputFromProducedContent(originalCall, producedContentsThisTurn, latestUserIntentText(req));
    call = fillDocumentInputFromProducedContent(call, producedContentsThisTurn, latestUserIntentText(req));
    call = fillZipInputFromProducedFiles(call, producedFilesThisTurn, { preferProduced: preferProducedZip });
    const validation = validateToolInput(call, req);
    if (!validation.ok) {
      const failed = { success: false, error: validation.code, message: validation.message };
      const ui = normalizeToolResultForUI(call.tool, failed, call.input);
      toolResults.push({ tool: call.tool, input: call.input, result: failed, ui });
      continue;
    }

    let rawResult;
    try {
      rawResult = await executeLucyTool(call.tool, call.input, numberEnv("LUCY_TOOL_TIMEOUT_MS", 30000));
    } catch (error) {
      rawResult = { success: false, error: "tool_execution_error", message: error?.message || "Tool çalışırken hata oluştu." };
    }
    const persistedResult = persistToolFileResult(rawResult, req);
    rememberToolResult(req, call, persistedResult);
    const produced = producedFileCandidate(call.tool, persistedResult);
    if (produced) producedFilesThisTurn.push(produced);
    const producedContent = producedContentCandidate(call.tool, persistedResult);
    if (producedContent) producedContentsThisTurn.push(producedContent);
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
  listToolLoadErrors,
  getLoadedTool,
  executeLucyTool,
  persistToolFileResult,
  executeToolCallsFromAnswer,
};
