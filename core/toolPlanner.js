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

function summarizeTable(table = null) {
  return table?.headers?.length && table?.rows?.length
    ? {
        headers: table.headers,
        rowsSample: table.rows.slice(0, 8),
        rowCount: table.rows.length,
      }
    : null;
}

function summarizeChart(chart = null) {
  const data = chart?.data || chart?.raw?.data || null;
  return data?.labels?.length
    ? {
        chartType: chart.chartType || chart.type || "",
        title: chart.title || "",
        labelsSample: data.labels.slice(0, 8),
        valuesSample: (data.datasets?.[0]?.data || []).slice(0, 8),
      }
    : null;
}

function memorySummary(memory = {}) {
  const lastTable = summarizeTable(memory.lastTable);
  const firstTable = summarizeTable(memory.firstTable);
  const activeTable = summarizeTable(memory.activeContent?.type === "table" ? memory.activeContent.table : null);
  const lastChart = summarizeChart(memory.lastChart);
  const firstChart = summarizeChart(memory.firstChart);

  return {
    hasLastText: Boolean(memory.lastText),
    lastTextPreview: truncate(memory.lastText || "", 900),
    hasFirstTable: Boolean(firstTable),
    firstTable,
    hasLastTable: Boolean(lastTable),
    lastTable,
    hasActiveTable: Boolean(activeTable),
    activeTable,
    tableCount: Array.isArray(memory.index?.tables) ? memory.index.tables.length : 0,
    hasLastChart: Boolean(lastChart),
    lastChart,
    hasFirstChart: Boolean(firstChart),
    firstChart,
    chartCount: Array.isArray(memory.index?.charts) ? memory.index.charts.length : 0,
    pendingClarification: memory.pendingClarification ? {
      question: memory.pendingClarification.question || "",
      userText: truncate(memory.pendingClarification.userText || "", 500),
    } : null,
    activeContentType: memory.activeContent?.type || "",
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
  // Her iki env var'ı da kontrol et (tutarlılık için)
  const flag = (envValue("LUCY_DS_TOOL_PLANNER") || envValue("LUCY_DS_TOOL_PLANNER_ENABLED")).toLowerCase();
  if (["0", "false", "off", "no", "kapali", "kapalı"].includes(flag)) return false;
  return Boolean(envValue("DEEPSEEK_API_KEY") || envValue("DEEPSEEK_API_KEY_ALT"));
}


function normalizeDecisionValue(value = "") {
  const v = String(value || "").trim().toUpperCase().replace(/[^A-Z_]/g, "_");
  if (["TOOL_REQUIRED", "NO_TOOL", "ASK_CLARIFICATION"].includes(v)) return v;
  if (["TOOL", "TOOLS", "RUN_TOOL", "RUN_TOOLS"].includes(v)) return "TOOL_REQUIRED";
  if (["ASK", "CLARIFY", "CLARIFICATION", "UNCLEAR", "AMBIGUOUS"].includes(v)) return "ASK_CLARIFICATION";
  return "NO_TOOL";
}

function normalizePlannerDecision(payload = {}, userText = "") {
  const calls = normalizePlannerResponse(payload, userText);
  const decision = normalizeDecisionValue(payload.decision || payload.action || payload.intentDecision || (calls.length ? "TOOL_REQUIRED" : "NO_TOOL"));
  const clarification = String(payload.clarification || payload.question || payload.ask || "").trim();
  const reason = String(payload.reason || payload.explanation || "").trim();
  const confidenceRaw = Number(payload.confidence);
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : (decision === "TOOL_REQUIRED" && calls.length ? 0.75 : 0.6);

  if (decision === "TOOL_REQUIRED" && !calls.length) {
    return { decision: "ASK_CLARIFICATION", toolCalls: [], clarification: clarification || "Aşkım bunu yapabilmem için biraz daha detay verir misin?", reason: reason || "tool_required_without_plan", confidence: Math.min(confidence, 0.55) };
  }

  if (decision === "ASK_CLARIFICATION") {
    return { decision, toolCalls: [], clarification: clarification || "Aşkım bunu tam anlayamadım. Biraz daha detay verir misin?", reason, confidence };
  }

  return { decision, toolCalls: calls, clarification: "", reason, confidence };
}

function pickAllowedString(value = "", allowed = [], fallback = "") {
  const clean = String(value || "").trim();
  return allowed.includes(clean) ? clean : fallback;
}

function clampConfidence(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
}

function normalizeDsIntentDebugPayload(payload = {}) {
  const modes = ["chat", "task"];
  const intents = ["chat", "create", "transform", "export", "search", "read_extract", "calculate", "unknown"];
  const sources = ["none", "fresh_content", "last_artifact", "specific_artifact", "last_topic", "multi_artifact"];
  const referenceTypes = ["none", "vague_this", "last_report", "last_topic", "last_table", "last_chart", "last_file", "multi_artifact"];
  const outputTargets = new Set(["text", "table", "chart", "pdf", "zip", "excel", "word", "json", "csv"]);
  const targetAliases = {
    doc: "word",
    docx: "word",
    xls: "excel",
    xlsx: "excel",
    spreadsheet: "excel",
    document: "word",
    report: "text",
  };
  const reference = payload.reference && typeof payload.reference === "object" ? payload.reference : {};
  const normalizedTargets = (Array.isArray(payload.outputTargets) ? payload.outputTargets : [])
    .map((item) => targetAliases[String(item || "").trim()] || String(item || "").trim())
    .filter((item) => outputTargets.has(item));

  return {
    mode: pickAllowedString(payload.mode, modes, "chat"),
    intent: pickAllowedString(payload.intent, intents, "unknown"),
    source: pickAllowedString(payload.source, sources, "none"),
    topic: payload.topic === null || payload.topic === undefined ? null : String(payload.topic).trim() || null,
    reference: {
      raw: reference.raw === null || reference.raw === undefined ? null : String(reference.raw).trim() || null,
      type: pickAllowedString(reference.type, referenceTypes, "none"),
    },
    outputTargets: [...new Set(normalizedTargets)],
    needsDS: Boolean(payload.needsDS),
    needsTool: Boolean(payload.needsTool),
    toolHints: (Array.isArray(payload.toolHints) ? payload.toolHints : []).map((item) => String(item || "").trim()).filter(Boolean).slice(0, 8),
    confidence: clampConfidence(payload.confidence, 0),
    reasonShort: String(payload.reasonShort || payload.reason || "").trim().slice(0, 240),
  };
}

function aiPlannerEnabled() {
  const flag = (envValue("LUCY_AI_PLANNER") || envValue("LUCY_GENERIC_AI_PLANNER") || envValue("LUCY_DS_TOOL_PLANNER") || envValue("LUCY_DS_TOOL_PLANNER_ENABLED")).toLowerCase();
  if (["0", "false", "off", "no", "kapali", "kapalı"].includes(flag)) return false;
  return Boolean(envValue("DEEPSEEK_API_KEY") || envValue("DEEPSEEK_API_KEY_ALT"));
}

async function debugDeepSeekIntentUnderstanding({ userText = "", context = {} } = {}) {
  const deepSeekKey = envValue("DEEPSEEK_API_KEY") || envValue("DEEPSEEK_API_KEY_ALT");
  const model = envValue("LUCY_DS_INTENT_DEBUG_MODEL") || envValue("DEEPSEEK_MODEL_FAST") || "deepseek-v4-flash";
  const normalizedUserText = normalizeToolIntentText(userText);
  const baseDebug = { model, userText: truncate(userText, 900) };

  if (!String(userText || "").trim()) return { ...baseDebug, error: "empty_user_text" };
  if (!deepSeekKey) return { ...baseDebug, error: "DEEPSEEK_API_KEY missing" };

  const systemPrompt = [
    "Sen LUCY icin read-only Semantic Intent Controller'sin.",
    "Gorevin cevap yazmak degil, kullanicinin niyetini JSON olarak siniflandirmak.",
    "Tool calistirma, karar verme, kullaniciya cevap yazma. Sadece JSON dondur.",
    "PDF, Word, Excel, grafik, tablo, zip, QR, OCR gibi kelimeler konu, kaynak, cikti formati veya tool hedefi olabilir; once niyeti ayir.",
    "Ornekler:",
    "\"askim bugun nasilsin\" -> chat, needsDS true, needsTool false.",
    "\"bana ask siiri yaz\" -> create, source fresh_content, output text, needsDS true, needsTool false.",
    "\"bunu pdf yap\" -> export, source last_artifact, output pdf, needsDS false, needsTool true.",
    "\"almanya hakkinda kisa rapor hazirla ve pdf olarak ver\" -> create, source fresh_content, topic Almanya, output text+pdf, needsDS true, needsTool true.",
    "\"bu raporu zip yap\" -> export, source last_artifact veya last_report, output zip, needsTool true.",
    "\"son konustugumuz konu hakkinda tablo yap\" -> create, source last_topic, output table, needsDS true, needsTool false veya table tool varsa needsTool true.",
    "\"pdf okuyucu program ara\" -> search, source none/fresh_content, output text, needsTool true, toolHints web/search; PDF uretme degil.",
    "\"pdf icerigini ozetle\" -> read_extract, source last_file/specific_artifact, output text, needsTool true veya file-read; PDF uretme degil.",
    "\"ikisini zip yap\" veya \"bunlari zip yap\" -> export, source multi_artifact, output zip, needsTool true.",
    "JSON schema disina cikma.",
    "{\"mode\":\"chat|task\",\"intent\":\"chat|create|transform|export|search|read_extract|calculate|unknown\",\"source\":\"none|fresh_content|last_artifact|specific_artifact|last_topic|multi_artifact\",\"topic\":null,\"reference\":{\"raw\":null,\"type\":\"none|vague_this|last_report|last_topic|last_table|last_chart|last_file|multi_artifact\"},\"outputTargets\":[\"text|table|chart|pdf|zip|excel|word|json|csv\"],\"needsDS\":true,\"needsTool\":false,\"toolHints\":[],\"confidence\":0.0,\"reasonShort\":\"kisa\"}",
  ].join("\n");

  const userPrompt = JSON.stringify({
    userText,
    normalizedUserText,
    readOnlyContext: context,
  });

  const payload = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0,
    max_tokens: numberEnv("LUCY_DS_INTENT_DEBUG_MAX_TOKENS", 700),
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
    if (!response.ok) throw new Error(data?.error?.message || data?.message || `DeepSeek intent debug API hatasÄ±: ${response.status}`);
    return data;
  });

  try {
    const data = await withTimeout(request, numberEnv("LUCY_DS_INTENT_DEBUG_TIMEOUT_MS", 6000));
    const content = data?.choices?.[0]?.message?.content || "";
    const parsed = extractJsonObject(content);
    if (!parsed) return { ...baseDebug, parseError: "DeepSeek intent debug JSON parse edilemedi", raw: truncate(content, 1200) };
    return { ...baseDebug, ...normalizeDsIntentDebugPayload(parsed) };
  } catch (error) {
    return { ...baseDebug, error: error?.message || "DeepSeek intent debug error" };
  }
}

async function planLucyActionWithDeepSeek({ userText = "", memory = {}, availableTools = [] } = {}) {
  if (!aiPlannerEnabled()) return null;
  const deepSeekKey = envValue("DEEPSEEK_API_KEY") || envValue("DEEPSEEK_API_KEY_ALT");
  const model = envValue("LUCY_TOOL_PLANNER_MODEL") || envValue("DEEPSEEK_MODEL_FAST") || "deepseek-v4-flash";
  const normalizedUserText = normalizeToolIntentText(userText);
  const summary = memorySummary(memory);

  const systemPrompt = [
    "Sen LUCY WEB için generic AI planner'sın. Komut ezberleme; kullanıcının gerçek niyetini semantik olarak anla.",
    "Önce karar ver: TOOL_REQUIRED, NO_TOOL veya ASK_CLARIFICATION.",
    "NO_TOOL: Kullanıcı bilgi soruyor, sohbet ediyor, stil örneği istiyor veya gerçek işlem istemiyor.",
    "TOOL_REQUIRED: Kullanıcı dosya/grafik/pdf/excel/zip/qr/web okuma/hesap/gönderim gibi gerçek işlem istiyor.",
    "'pdf okuyucu program ara', 'excel uygulaması öner', 'qr okuyucu link bul' gibi istekler web araştırmasıdır; pdf/excel/qr üretme.",
    "'pdf içeriğini özetle' dosya okuma/anlama niyetidir; 'bunu pdf yap' ise export niyetidir.",
    "ASK_CLARIFICATION: 'bunu/onu/son/ilk tablo/az önceki' gibi referans belirsizse veya hangi çıktı istendiği net değilse.",
    "Artifact registry'de firstTable/lastTable/activeTable/lastChart/pendingClarification varsa bunları kullan; 'ilk tablo' firstTable, 'son tablo/bu tablo' lastTable/activeTable demektir.",
    "Tablo -> grafik isteklerinde satırları veri noktası kabul et; kolon toplamı yapma. 'Toplam sütununu baz al' denirse value=Toplam, label=Ürün/Ad/Kategori olmalı.",
    "'en pahalı 3', 'top 5', 'en yüksek 10', 'en ucuz 3' gibi filtre/sıralama adımı varsa, sonraki grafik/belge/pdf/zip araçları tam tabloyu değil filtrelenmiş alt veri setini kullanmalı.",
    "Belirsiz durumda asla eski context'i kafana göre seçme; kısa bir soru üret.",
    "Asla yapılmayan iş için 'yaptım' deme. Raw JSON, raw HTML veya tool_call kullanıcıya gösterme.",
    "Kullanıcı kaç çıktı istiyorsa o kadar tool planla. Örn: txt, md, pdf, word, excel, zip istiyorsa hepsini sırala.",
    "ZIP istenirse aynı turda üretilen dosyaları ZIP'e alacak şekilde en sona zip planla.",
    "Tool gerekmiyorsa toolCalls boş olmalı.",
    "Cevap sadece JSON olsun. Markdown yok.",
    "JSON şeması: {\"decision\":\"TOOL_REQUIRED|NO_TOOL|ASK_CLARIFICATION\",\"clarification\":\"kısa soru veya boş\",\"toolCalls\":[{\"tool\":\"excel\",\"source\":\"lastTable\",\"input\":{}}],\"confidence\":0.0,\"reason\":\"kısa\"}",
  ].join("\n");

  const userPrompt = JSON.stringify({
    userText,
    normalizedUserText,
    availableTools,
    artifactRegistry: summary,
    semanticRules: [
      "'pdf nedir', 'excel nasıl yapılır', 'mail gibi yaz' => NO_TOOL",
      "'pdf okuyucu program ara', 'excel uygulaması öner', 'qr okuyucu link bul' => web araştırması; üretim tool'u çağırma",
      "'pdf içeriğini özetle' => dosya okuma/anlama; 'bunu pdf yap' => export",
      "'bunu pdf yap', 'excel hazırla', 'zip yap', 'siteyi oku' => TOOL_REQUIRED",
      "'bunu pastel yap' ve son hedef net değilse => ASK_CLARIFICATION",
      "'ilk tablom', 'son grafik', 'az önceki dosya' gibi ifadeleri artifactRegistry ile çöz; emin değilsen sor",
      "pendingClarification varsa kullanıcının kısa cevabını önceki soruya bağla",
      "sırala/filtrele/top N adımı varsa sonraki çıktıları bu filtrelenmiş dataset üzerinden planla",
      "tablo/grafik/dosya stil değiştirme isteklerinde raw HTML/code değil render hedefi planla",
    ],
  });

  const payload = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0,
    max_tokens: numberEnv("LUCY_TOOL_PLANNER_MAX_TOKENS", 1100),
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
  if (!parsed) return null;
  return normalizePlannerDecision(parsed, userText);
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
    "'pdf okuyucu program ara', 'excel uygulaması öner', 'qr okuyucu link bul' web araştırmasıdır; pdf/excel/qr üretme.",
    "'pdf içeriğini özetle' dosya okuma/anlama niyetidir; 'bunu pdf yap' export niyetidir.",
    "'ilk tablo' firstTable; 'son/bu tablo' lastTable veya activeTable; pendingClarification varsa kısa cevabı önceki soruya bağla.",
    "Tablo -> grafik isteklerinde satır bazlı çalış: label=Ürün/Ad/Kategori, value=Toplam/Tutar/Fiyat. Kolon toplamı ancak kullanıcı açıkça kolon/sütun toplamı isterse yapılır.",
    "'en pahalı 3', 'top 5', 'en yüksek 10', 'en ucuz 3' gibi filtre/sıralama adımı varsa chart/pdf/word/excel bu alt veri setinden beslenmelidir.",
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
  planLucyActionWithDeepSeek,
  debugDeepSeekIntentUnderstanding,
  normalizePlannerResponse,
  normalizePlannerDecision,
  aiPlannerEnabled,
  plannerEnabled,
};
