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
} = require("./toolIntentDetector");

function messageText(message = {}) {
  return String(message?.content || message?.text || message?.message || "").trim();
}

function latestUserText(req = {}) {
  if (req && typeof req.__lucyEffectiveUserText === "string" && req.__lucyEffectiveUserText.trim()) {
    return req.__lucyEffectiveUserText.trim();
  }
  const messages = Array.isArray(req?.body?.messages) ? req.body.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] || {};
    const role = String(message.role || message.sender || "").toLowerCase();
    if (role && role !== "user") continue;
    const text = messageText(message);
    if (text) return text;
  }
  return String(req?.body?.prompt || req?.body?.message || req?.body?.text || "").trim();
}

function hasConversationContext(req = {}, memory = {}) {
  const messages = Array.isArray(req?.body?.messages) ? req.body.messages : [];
  if (messages.some((message) => String(message?.role || message?.sender || "").toLowerCase() === "assistant" && messageText(message))) return true;
  return Boolean(
    memory?.activeContent
    || memory?.lastText
    || memory?.lastTable?.rows?.length
    || memory?.lastChart?.data
    || memory?.lastFile?.storedFilename
  );
}

function taskSegmentsFromText(text = "") {
  return String(text || "")
    .split(/\r?\n|(?:\s+\/\s+)/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function looksLikeLiveTimeRequest(text = "") {
  const q = normalizeIntentText(text).replace(/[^\p{L}0-9\s]/gu, " ").replace(/\s+/g, " ").trim();
  const hasTimeWord = /\bsaat\w*\b|\btarih\w*\b|\bzaman\b/.test(q);
  const hasPlaceSet = /\b(sehir\w*|baskent\w*|ulke\w*|dunya\w*|tokyo|londra|paris|istanbul|ankara)\b/.test(q);
  const hasDisplayAction = /\b(yaz|goster|listele|tablo\w*)\b/.test(q);
  return Boolean(hasTimeWord && (hasPlaceSet || hasDisplayAction));
}

function looksLikeStyleOnlyRequest(text = "") {
  const q = normalizeIntentText(text);
  const hasStyle = /\b(renk|renkli|renklerini|renkleri|renkte|palet|tema|stil|sari|lacivert|mavi|mor|neon|pastel|monokrom|siyah|beyaz)\b/.test(q);
  const hasChartRef = /\b(ayni|bunu|son|mevcut|grafik|grafigi|chart|pasta|cizgi|cubuk|bar|sutun)\b/.test(q);
  const hasAction = /\b(yap|olsun|degistir|kullan|uygula|cevir|donustur)\b/.test(q);
  const hasOutputFormat = /\b(pdf|excel|xlsx|zip|word|docx|dosya|tablo|metin)\b/.test(q);
  return Boolean(hasStyle && hasChartRef && hasAction && !hasOutputFormat);
}

function outputTargetsFromText(text = "") {
  const targets = [];
  if (wantsPdfFromText(text)) targets.push("pdf");
  if (wantsExcelFromText(text)) targets.push("excel");
  if (wantsZipFromText(text)) targets.push("zip");
  if (wantsChartFromText(text)) targets.push("chart");
  if (wantsDocumentFromText(text)) targets.push("document");
  if (wantsQrFromText(text)) targets.push("qr");
  if (wantsOcrFromText(text)) targets.push("ocr");
  if (wantsMermaidFromText(text)) targets.push("mermaid");
  if (wantsTextStatsFromText(text)) targets.push("textStats");
  if (wantsCalculatorFromText(text)) targets.push("calculator");
  if (wantsTimeFromText(text)) targets.push("time");
  if (wantsWebFetchFromText(text)) targets.push("webFetch");
  if (wantsMailFromText(text)) targets.push("mail");
  if (wantsWhatsappFromText(text)) targets.push("whatsapp");
  if (wantsTelegramFromText(text)) targets.push("telegram");
  if (wantsFileManagerFromText(text)) targets.push("fileManager");
  if (looksLikeLiveTimeRequest(text)) targets.push("time");
  return [...new Set(targets)];
}

function mentionedConceptsFromText(text = "", primaryIntent = "unknown", outputTargets = []) {
  const q = normalizeIntentText(text);
  const targetSet = new Set(outputTargets);
  const patterns = [
    ["pdf", /\bpdf\b/],
    ["excel", /\b(excel|xlsx|xls|spreadsheet|e tablo)\b/],
    ["word", /\b(word|docx)\b/],
    ["zip", /\b(zip|arsiv|sikistir)\b/],
    ["chart", /\b(grafik\w*|chart|pasta|pie|cizgi|bar|sutun|cubuk|gorsellestir)\b/],
    ["table", /\b(tablo\w*|dataset|veri|liste)\b/],
    ["time", /\b(saat\w*|tarih\w*|zaman|baskent\w*|sehir\w*)\b/],
    ["qr", /\b(qr|karekod|qr kod)\b/],
    ["ocr", /\b(ocr|resim|gorsel|foto|fotograf|yazi oku|metin oku)\b/],
    ["web", /\b(web|site|link|url|kaynak|internette|google|ara|arastir)\b/],
    ["mail", /\b(mail|email|eposta|e posta)\b/],
    ["whatsapp", /\b(whatsapp|wp)\b/],
    ["telegram", /\btelegram\b/],
    ["file", /\b(dosya|belge|dokuman)\b/],
  ];

  return patterns
    .filter(([, pattern]) => pattern.test(q))
    .map(([concept]) => {
      let role = "topic";
      if (targetSet.has(concept) || (concept === "word" && targetSet.has("document"))) role = "output_target";
      else if (primaryIntent === "search_research") role = "research_topic";
      else if (primaryIntent === "read_extract") role = "read_source";
      else if (primaryIntent === "export") role = "format_or_source";
      return { concept, role };
    });
}

function referencesFromText(text = "") {
  const q = normalizeIntentText(text);
  const terms = [];
  const vagueMatches = q.match(/\b(bunu|sunu|onu|bu|o|aynisi|ayni seyi|o zaman|sonra|mevcut|yukaridaki|ustteki)\b/g) || [];
  const ordinalMatches = q.match(/\b(ilk|birinci|ikinci|ucuncu|onceki|bir onceki|son|en son|az onceki)\b/g) || [];
  terms.push(...vagueMatches, ...ordinalMatches);

  const targetTypes = [];
  if (/\b(tablo|tabloyu|dataset|veri|liste)\b/.test(q)) targetTypes.push("table");
  if (/\b(grafik|grafigi|chart|pasta|pie|cizgi|bar|sutun|cubuk)\b/.test(q)) targetTypes.push("chart");
  if (/\b(dosya|dosyayi|pdfi|exceli|zipi|word|docx)\b/.test(q)) targetTypes.push("file");
  if (/\b(metin|yazi|icerik|cevap)\b/.test(q)) targetTypes.push("text");

  let ordinal = "";
  if (/\b(ilk|birinci)\b/.test(q)) ordinal = "first";
  else if (/\b(onceki|bir onceki|az onceki)\b/.test(q)) ordinal = "previous";
  else if (/\b(son|en son|mevcut|yukaridaki|ustteki)\b/.test(q)) ordinal = "last";

  return {
    hasReference: terms.length > 0 || targetTypes.length > 0,
    hasVagueReference: vagueMatches.length > 0,
    terms: [...new Set(terms)],
    targetTypes: [...new Set(targetTypes)],
    ordinal,
  };
}

function sourceRequirementFromFrame(primaryIntent = "unknown", outputTargets = [], references = {}, text = "") {
  const q = normalizeIntentText(text);
  const targets = new Set(outputTargets);
  if (taskSegmentsFromText(text).length > 1 && targets.size > 1) return "working_artifact_chain";
  if (targets.has("time")) return "live_time";
  if (primaryIntent === "search_research") return "web_research";
  if (targets.has("webFetch")) return "web_page";
  if (targets.has("ocr")) return "image";
  if (targets.has("zip")) return "generated_file";
  if (primaryIntent === "read_extract") return /\b(resim|gorsel|foto|fotograf|ocr)\b/.test(q) ? "image" : "file_content";
  if (primaryIntent === "style_only") return "chart";
  if (targets.has("chart")) return "table_or_numeric_data";
  if (targets.has("pdf") || targets.has("excel") || targets.has("document")) {
    if (references.targetTypes.includes("chart")) return "chart";
    if (references.targetTypes.includes("table")) return "table";
    if (references.targetTypes.includes("file")) return "file";
    return "active_artifact";
  }
  if (primaryIntent === "transform_filter") return "table_or_dataset";
  if (primaryIntent === "communication") return "message_payload";
  return "none";
}

function utteranceTypeFromFrame(text = "", primaryIntent = "unknown", outputTargets = [], references = {}, contextAvailable = false) {
  const q = normalizeIntentText(text);
  const segments = taskSegmentsFromText(text);
  if (!String(text || "").trim()) return "empty";
  if (segments.length > 1 && outputTargets.length) return "multi_step";
  if (references.hasVagueReference && (contextAvailable || outputTargets.length)) return "follow_up";
  if (contextAvailable && outputTargets.length && q.length <= 64) return "follow_up";
  if (/\b(pahali olmus|pahali oldu|ucuz olmus|yanlis|olmamis|iyi olmus|guzel olmus|begendim|begenmedim)\b/.test(q) && !outputTargets.length) return "feedback";
  if (primaryIntent !== "unknown" && primaryIntent !== "chat") return "task";
  if (outputTargets.length) return "task";
  return "chat";
}

function primaryIntentFromText(text = "", memory = {}, outputTargets = []) {
  const detected = classifySemanticIntent(text, memory);
  if (looksLikeStyleOnlyRequest(text)) return "style_only";
  if (detected !== "unknown") return detected;
  if (!String(text || "").trim()) return "unknown";
  if (wantsTimeFromText(text) || looksLikeLiveTimeRequest(text)) return "live_data";
  if (wantsWebFetchFromText(text)) return "read_extract";
  if (wantsCalculatorFromText(text)) return "compute";
  if (wantsMailFromText(text) || wantsWhatsappFromText(text) || wantsTelegramFromText(text)) return "communication";
  if (outputTargets.length > 1) return "multi_step_task";
  if (outputTargets.length) return "tool_action";
  return "chat";
}

function clarificationNeedFromFrame(references = {}, contextAvailable = false, outputTargets = [], primaryIntent = "unknown") {
  if (references.hasVagueReference && !contextAvailable && outputTargets.length) {
    return { needed: true, reason: "vague_reference_without_context" };
  }
  if (primaryIntent === "unknown") return { needed: false, reason: "" };
  return { needed: false, reason: "" };
}

function confidenceFromFrame(primaryIntent = "unknown", outputTargets = [], references = {}, contextAvailable = false) {
  let confidence = 0.45;
  if (primaryIntent && !["unknown", "chat"].includes(primaryIntent)) confidence += 0.25;
  if (outputTargets.length) confidence += 0.15;
  if (references.hasReference && contextAvailable) confidence += 0.08;
  if (references.hasVagueReference && !contextAvailable) confidence -= 0.18;
  if (primaryIntent === "chat") confidence = Math.max(confidence, 0.62);
  return Math.max(0.1, Math.min(0.95, Number(confidence.toFixed(2))));
}

function buildUnderstandingFrame(req = {}, memory = {}) {
  const userText = latestUserText(req);
  const outputTargets = outputTargetsFromText(userText);
  const primaryIntent = primaryIntentFromText(userText, memory, outputTargets);
  const references = referencesFromText(userText);
  const contextAvailable = hasConversationContext(req, memory);
  const sourceRequirement = sourceRequirementFromFrame(primaryIntent, outputTargets, references, userText);
  const utteranceType = utteranceTypeFromFrame(userText, primaryIntent, outputTargets, references, contextAvailable);
  const clarificationNeed = clarificationNeedFromFrame(references, contextAvailable, outputTargets, primaryIntent);

  return {
    userText,
    utteranceType,
    primaryIntent,
    mentionedConcepts: mentionedConceptsFromText(userText, primaryIntent, outputTargets),
    references,
    sourceRequirement,
    outputTargets,
    clarificationNeed,
    confidence: confidenceFromFrame(primaryIntent, outputTargets, references, contextAvailable),
  };
}

module.exports = {
  buildUnderstandingFrame,
};
