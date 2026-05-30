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

function aiPlannerEnabled() {
  const flag = (envValue("LUCY_AI_PLANNER") || envValue("LUCY_GENERIC_AI_PLANNER") || envValue("LUCY_DS_TOOL_PLANNER") || envValue("LUCY_DS_TOOL_PLANNER_ENABLED")).toLowerCase();
  if (["0", "false", "off", "no", "kapali", "kapalı"].includes(flag)) return false;
  return Boolean(envValue("DEEPSEEK_API_KEY") || envValue("DEEPSEEK_API_KEY_ALT"));
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
  normalizePlannerResponse,
  normalizePlannerDecision,
  aiPlannerEnabled,
  plannerEnabled,
};
