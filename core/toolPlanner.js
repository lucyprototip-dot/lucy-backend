const dotenv = require("dotenv");
const { normalizeToolIntentText, detectChartType, likelyToolIntent } = require("./intentNormalizer");

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

function withTimeout(promise, ms = 12000) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`DeepSeek tool planner timeout: ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function truncate(value = "", max = 1200) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function safeJsonParse(text = "") {
  try { return JSON.parse(text); } catch { return null; }
}

function extractJsonObject(text = "") {
  const source = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  const direct = safeJsonParse(source);
  if (direct) return direct;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start >= 0 && end > start) return safeJsonParse(source.slice(start, end + 1));
  return null;
}

function memorySummary(memory = {}) {
  const table = memory.lastTable?.headers?.length && memory.lastTable?.rows?.length
    ? {
        headers: memory.lastTable.headers,
        rowsSample: memory.lastTable.rows.slice(0, 8),
        rowCount: memory.lastTable.rows.length,
      }
    : null;

  return {
    hasLastText: Boolean(memory.lastText),
    lastTextPreview: truncate(memory.lastText || "", 900),
    hasLastTable: Boolean(table),
    lastTable: table,
    hasLastChart: Boolean(memory.lastChart),
    lastChartType: memory.lastChart?.chartType || memory.lastChart?.type || "",
    hasLastMermaid: Boolean(memory.lastMermaid?.code),
    lastMermaidPreview: truncate(memory.lastMermaid?.code || "", 600),
    hasLastFile: Boolean(memory.lastFile?.storedFilename || memory.lastFile?.filename),
    lastFile: memory.lastFile ? {
      filename: memory.lastFile.filename || "",
      storedFilename: memory.lastFile.storedFilename || "",
      type: memory.lastFile.type || "",
    } : null,
  };
}

function sanitizePlannerToolCall(call = {}) {
  if (!call || typeof call !== "object") return null;
  const tool = String(call.tool || call.name || "").trim();
  if (!tool) return null;

  const allowed = new Set([
    "calculator", "chartData", "document", "excel", "fileManager", "mail",
    "mermaid", "ocr", "qr", "pdf", "telegram", "textStats", "time",
    "webFetch", "whatsapp", "zip",
  ]);

  const canonical = {
    chartdata: "chartData",
    chart: "chartData",
    spreadsheet: "excel",
    xlsx: "excel",
    diagram: "mermaid",
    diyagram: "mermaid",
    stats: "textStats",
    textstats: "textStats",
    web: "webFetch",
    webfetch: "webFetch",
  }[tool.toLowerCase()] || tool;

  if (!allowed.has(canonical)) return null;

  const input = call.input && typeof call.input === "object" ? { ...call.input } : {};
  const source = String(call.source || input.source || "").trim();

  // Güvenlik: planner dosya yolu, sistem komutu, delete/read secret gibi şeyler dayatamaz.
  delete input.command;
  delete input.shell;
  delete input.exec;
  delete input.delete;
  delete input.rm;
  delete input.path;
  delete input.filePath;
  delete input.secret;
  delete input.apiKey;

  if (source && !input.source) input.source = source;
  return { tool: canonical, input };
}

function normalizePlannerResponse(payload = {}, userText = "") {
  const calls = [];
  const list = Array.isArray(payload.toolCalls) ? payload.toolCalls
    : Array.isArray(payload.tool_calls) ? payload.tool_calls
    : payload.tool ? [payload] : [];

  for (const item of list) {
    const call = sanitizePlannerToolCall(item);
    if (call) calls.push(call);
  }

  const chartType = detectChartType(userText);
  for (const call of calls) {
    if (call.tool === "chartData" && !call.input.chartType) call.input.chartType = chartType;
  }

  return calls.slice(0, 4);
}

function plannerEnabled() {
  const flag = envValue("LUCY_DS_TOOL_PLANNER").toLowerCase();
  if (["0", "false", "off", "no", "kapali", "kapalı"].includes(flag)) return false;
  return Boolean(envValue("DEEPSEEK_API_KEY") || envValue("DEEPSEEK_API_KEY_ALT"));
}

async function planToolCallsWithDeepSeek({ userText = "", memory = {}, availableTools = [] } = {}) {
  if (!plannerEnabled()) return [];
  if (!likelyToolIntent(userText)) return [];

  const deepSeekKey = envValue("DEEPSEEK_API_KEY") || envValue("DEEPSEEK_API_KEY_ALT");
  const model = envValue("LUCY_TOOL_PLANNER_MODEL") || envValue("DEEPSEEK_MODEL_FAST") || "deepseek-v4-flash";
  const normalizedUserText = normalizeToolIntentText(userText);
  const summary = memorySummary(memory);

  const systemPrompt = [
    "Sen LUCY için güvenli Tool Planner'sın.",
    "Görevin: Kullanıcı mesajından tool gerekiyorsa SADECE JSON planı üretmek.",
    "Doğal dil cevabı yazma. Markdown kullanma.",
    "Yazım hatalarını ve yakın anlamları anla: siyagram=diyagram, excell=excel, ziip=zip, grafk=grafik.",
    "Grafik eş anlamları: yuvarlak grafik/daire/dilimli/renkli dağılım=pasta; trend/zamana göre/çizgi=line; normal/çubuk/sütun=bar.",
    "Diyagram eş anlamları: şema/akış/kutularla göster/bağlantılı göster/flowchart=mermaid.",
    "Kullanıcı 'bunu/onu/şunu' dediğinde memory içindeki son uygun kaynağı seç.",
    "Asla sistem komutu, dosya silme, .env/API key okuma, key gösterme, shell çalıştırma planlama.",
    "Sadece izinli create/convert/summarize türü tool çağrıları planla.",
    "Cevap formatı: {\"toolCalls\":[{\"tool\":\"excel\",\"source\":\"lastTable\",\"input\":{}}],\"reason\":\"kisa\"}",
    "Tool gerekmiyorsa: {\"toolCalls\":[],\"reason\":\"no_tool\"}",
  ].join("\n");

  const userPrompt = JSON.stringify({
    userText,
    normalizedUserText,
    availableTools,
    memory: summary,
    rules: {
      chartTypes: "pasta/yuvarlak/daire/dilimli/renkli dagilim=>pie, çizgi/trend/zamana göre=>line, normal/çubuk/sütun/bar=>bar",
      preferredSources: "excel/pdf/chart/mermaid için lastTable; zip için lastFile; qr/textStats/document için lastText; fallback varsa boş bırak",
      noDangerousActions: true,
    },
  });

  const payload = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.1,
    max_tokens: numberEnv("LUCY_TOOL_PLANNER_MAX_TOKENS", 900),
    stream: false,
  };

  const request = fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${deepSeekKey}`,
    },
    body: JSON.stringify(payload),
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || data?.message || `DeepSeek planner API hatası: ${response.status}`);
    return data;
  });

  const data = await withTimeout(request, numberEnv("LUCY_TOOL_PLANNER_TIMEOUT_MS", 12000));
  const content = data?.choices?.[0]?.message?.content || "";
  const parsed = extractJsonObject(content);
  if (!parsed) return [];
  return normalizePlannerResponse(parsed, userText);
}

module.exports = {
  planToolCallsWithDeepSeek,
  normalizePlannerResponse,
  plannerEnabled,
};
