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
  wantsCalculatorFromText,
  wantsTimeFromText,
  wantsWebFetchFromText,
  wantsMailFromText,
  wantsWhatsappFromText,
  wantsTelegramFromText,
  wantsFileManagerFromText,
} = require("./toolIntentDetector");
const { buildUnderstandingFrame } = require("./understandingFrame");

function cloneJsonSafe(value) {
  if (value === undefined || value === null) return value;
  try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
}

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

function latestAssistantText(req = {}) {
  const messages = Array.isArray(req?.body?.messages) ? req.body.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] || {};
    const role = String(message.role || message.sender || "").toLowerCase();
    if (role !== "assistant") continue;
    const text = messageText(message);
    if (text) return text;
  }
  return "";
}

function outputTargetsFromText(text = "") {
  const targets = [];
  const q = normalizeIntentText(text);
  if (wantsPdfFromText(text)) targets.push("pdf");
  if (wantsExcelFromText(text)) targets.push("excel");
  if (wantsZipFromText(text)) targets.push("zip");
  if (wantsChartFromText(text)) targets.push("chart");
  if (/\b(tablo\w*|table|dataset|veri tablosu|liste\w*)\b/.test(q)) targets.push("table");
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
  return [...new Set(targets)];
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

function detectReference(text = "") {
  const q = normalizeIntentText(text);
  const terms = [];
  const vague = q.match(/\b(bunu|sunu|şunu|onu|bunun|sunun|onun|buna|bunda|bu|su|şu|o|aynisini|aynisi|ayni seyi|mevcut)\b/g) || [];
  const historical = q.match(/\b(son|en son|onceki|bir onceki|az onceki|az once|yukaridaki|ustteki|ilk|birinci)\b/g) || [];
  const plural = q.match(/\b(bunlari|bunları|sunlari|şunları|onlari|onları|ikisini|ikiside|iki dosyayi|iki dosyayı|bu dosyalari|bu dosyaları)\b/g) || [];
  const report = q.match(/\b(bu rapor|raporu|son rapor|onun raporu|raporunu|raporu)\b/g) || [];
  const lastTopic = q.match(/\b(son konustugumuz|son konuştuğumuz|az once konustugumuz|az önce konuştuğumuz|son bahsettigimiz|son bahsettiğimiz|onun hakkinda|onun hakkında)\b/g) || [];
  terms.push(...vague, ...historical, ...plural, ...report, ...lastTopic);

  const targetTypes = [];
  if (/\b(tablo|tabloyu|tablosu|dataset|veri|liste)\b/.test(q)) targetTypes.push("table");
  if (/\b(grafik|grafigi|chart|pasta|pie|cizgi|bar|sutun|cubuk)\b/.test(q)) targetTypes.push("chart");
  if (/\b(dosya|dosyayi|dosyaları|dosyalari|pdfi|pdf|exceli|zipi|wordu|docxu)\b/.test(q)) targetTypes.push("file");
  if (/\b(rapor|analiz|metin|yazi|icerik|cevap|şiir|siir)\b/.test(q)) targetTypes.push("text");

  let count = "single";
  if (plural.length || /\b(ikisini|bunlari|bunları|sunlari|şunları|bu dosyalari|bu dosyaları)\b/.test(q)) count = "multiple";

  let temporal = "";
  if (/\b(ilk|birinci)\b/.test(q)) temporal = "first";
  else if (/\b(onceki|bir onceki|az onceki|az once)\b/.test(q)) temporal = "previous";
  else if (/\b(son|en son|mevcut|yukaridaki|ustteki|son konustugumuz|son konuştuğumuz)\b/.test(q)) temporal = "last";

  return {
    rawTerms: [...new Set(terms)],
    hasReference: Boolean(terms.length || targetTypes.length),
    hasVagueReference: Boolean(vague.length || historical.length || report.length),
    hasMultiReference: count === "multiple",
    hasLastTopicReference: Boolean(lastTopic.length),
    targetTypes: [...new Set(targetTypes)],
    count,
    temporal,
  };
}

function extractTopic(text = "") {
  const q = normalizeIntentText(text);
  const original = String(text || "").trim();
  const countryMap = [
    ["turkiye", "Türkiye"], ["türkiye", "Türkiye"], ["almanya", "Almanya"], ["fransa", "Fransa"],
    ["ingiltere", "İngiltere"], ["italya", "İtalya"], ["ispanya", "İspanya"], ["japonya", "Japonya"],
    ["cin", "Çin"], ["çin", "Çin"], ["rusya", "Rusya"], ["abd", "ABD"], ["amerika", "Amerika"],
  ];
  for (const [needle, label] of countryMap) {
    if (new RegExp(`\\b${needle}\\b`).test(q)) return { raw: label, kind: "entity", source: "country-keyword" };
  }

  const aboutMatch = original.match(/(?:^|\s)([^\n.,!?]{2,80}?)(?:\s+hakkında|\s+hakkinda|\s+ile ilgili|\s+konusunda|\s+üzerine|\s+uzerine)/i);
  if (aboutMatch?.[1]) {
    const raw = aboutMatch[1].replace(/^(bana|benim icin|benim için|askim|aşkım)\s+/i, "").trim();
    if (raw) return { raw, kind: "phrase", source: "about-pattern" };
  }

  const forMatch = original.match(/(?:^|\s)([^\n.,!?]{2,80}?)(?:\s+için|\s+icin)\s+([^\n.,!?]{2,40})/i);
  if (forMatch?.[1] && /tablo|rapor|analiz|şiir|siir|liste/i.test(forMatch[2] || "")) {
    const raw = forMatch[1].replace(/^(bana|benim|askim|aşkım)\s+/i, "").trim();
    if (raw) return { raw, kind: "phrase", source: "for-pattern" };
  }

  if (/\b(ask siiri|aşk şiiri|siir|şiir)\b/.test(q)) return { raw: "Aşk şiiri", kind: "content_type", source: "poem-keyword" };
  if (/\b(pazar alisverisi|pazar alışverişi|alisveris|alışveriş)\b/.test(q)) return { raw: "Pazar alışverişi", kind: "content_type", source: "shopping-keyword" };
  return { raw: "", kind: "none", source: "none" };
}

function previousTopicFromMemoryOrMessages(req = {}, memory = {}) {
  const candidates = [memory?.lastTopic, memory?.activeContent?.topic, memory?.lastFile?.topic, memory?.lastTable?.topic, memory?.lastChart?.topic]
    .filter(Boolean)
    .map((topic) => String(topic || "").trim())
    .filter(Boolean);
  if (candidates.length) return candidates[0];

  const messages = Array.isArray(req?.body?.messages) ? req.body.messages : [];
  for (let i = messages.length - 2; i >= 0; i -= 1) {
    const text = messageText(messages[i]);
    const topic = extractTopic(text);
    if (topic.raw) return topic.raw;
  }
  return "";
}

function isCreateTextRequest(text = "") {
  const q = normalizeIntentText(text);
  const createVerb = /\b(yap\w*|yaz\w*|hazirla\w*|hazırla\w*|olustur\w*|oluştur\w*|uret\w*|üret\w*|taslak|cikar\w*|çıkar\w*|listele\w*|anlat\w*|ver\w*)\b/.test(q);
  const contentNoun = /\b(şiir\w*|siir\w*|rapor\w*|analiz\w*|ozet\w*|özet\w*|metin|yazi\w*|yazı\w*|belge\w*|strateji|plan|liste\w*|icerik|içerik|tablo\w*|grafik\w*)\b/.test(q);
  return Boolean(createVerb && contentNoun);
}

function isPureChat(text = "", semanticIntent = "unknown", outputTargets = []) {
  const q = normalizeIntentText(text);
  if (!q) return false;
  if (outputTargets.length) return false;
  if (semanticIntent && !["unknown", "chat"].includes(semanticIntent)) return false;
  if (isCreateTextRequest(text)) return false;
  return !/\b(pdf|zip|excel|xlsx|word|docx|grafik|chart|tablo|ara|arastir|hesapla|saat|oku|ozetle|yaz|hazirla|olustur|uret)\b/.test(q);
}

function primaryIntent(text = "", memory = {}) {
  const semantic = classifySemanticIntent(text, memory);
  if (isCreateTextRequest(text)) return "create";
  if (semantic && semantic !== "unknown") return semantic;
  return "chat";
}

function sourceKindFor({ intent, outputTargets, reference, topic, contextAvailable }) {
  const targetSet = new Set(outputTargets || []);
  if (intent === "search_research") return "web_research";
  if (intent === "read_extract") return "file_content";
  if (targetSet.has("calculator")) return "none";
  if (targetSet.has("time")) return "live_time";
  if (reference.hasMultiReference) return "multi_artifact";
  if (reference.hasLastTopicReference) return "last_topic";
  if (intent === "create" || topic.raw) return "fresh_content";
  if (intent === "chat") return "none";
  if (reference.hasVagueReference && contextAvailable) return "last_artifact";
  if (intent === "export" && reference.hasVagueReference && contextAvailable) return "last_artifact";
  if (["pdf", "zip", "excel", "document", "chart"].some((target) => targetSet.has(target)) && contextAvailable) return "last_artifact";
  return "none";
}

function needsToolForTargets(targets = []) {
  const toolTargets = new Set(["pdf", "zip", "excel", "document", "chart", "mermaid", "qr", "ocr", "textStats", "calculator", "time", "webFetch", "mail", "whatsapp", "telegram", "fileManager"]);
  return targets.some((target) => toolTargets.has(target));
}

function buildLucyUnderstandingCore(req = {}, options = {}) {
  const memory = cloneJsonSafe(options.memory || {}) || {};
  const userText = latestUserText(req);
  const normalizedText = normalizeIntentText(userText);
  const frame = cloneJsonSafe(options.frame || req?.__lucyUnderstandingFrame || buildUnderstandingFrame(req, memory));
  const outputs = outputTargetsFromText(userText);
  const intent = primaryIntent(userText, memory);
  const effectiveOutputs = (intent === "create" && outputs.length && !outputs.includes("text")) ? ["text", ...outputs] : outputs;
  const reference = detectReference(userText);
  let topic = extractTopic(userText);
  const previousTopic = previousTopicFromMemoryOrMessages(req, memory);
  if (reference.hasLastTopicReference && previousTopic) {
    topic = { raw: previousTopic, kind: "context", source: "last-topic-reference" };
  }
  const contextAvailable = hasConversationContext(req, memory);
  const sourceKind = sourceKindFor({ intent, outputTargets: effectiveOutputs, reference, topic, contextAvailable });
  const needsTool = needsToolForTargets(effectiveOutputs);
  const needsDS = intent === "chat" || intent === "create" || sourceKind === "fresh_content" || (effectiveOutputs.includes("table") && !needsTool);
  const mode = isPureChat(userText, intent, outputs) ? "chat" : "task";
  const topicChangedFromPrevious = Boolean(topic.raw && previousTopic && normalizeIntentText(topic.raw) !== normalizeIntentText(previousTopic));

  const conflicts = [];
  if (frame?.sourceRequirement && sourceKind === "fresh_content" && ["active_artifact", "generated_file"].includes(frame.sourceRequirement)) {
    conflicts.push({ type: "source_conflict", legacyFrameSource: frame.sourceRequirement, coreSource: sourceKind });
  }
  if (frame?.primaryIntent && frame.primaryIntent !== "unknown" && intent !== frame.primaryIntent) {
    conflicts.push({ type: "intent_mismatch", legacyFrameIntent: frame.primaryIntent, coreIntent: intent });
  }
  if (frame?.outputTargets?.length) {
    const frameTargets = new Set(frame.outputTargets);
    for (const target of outputs) {
      if (!frameTargets.has(target)) conflicts.push({ type: "target_missing_in_frame", target });
    }
  }

  let confidence = 0.5;
  if (mode === "chat") confidence += 0.2;
  if (intent !== "chat" && intent !== "unknown") confidence += 0.18;
  if (outputs.length) confidence += 0.12;
  if (reference.hasReference && contextAvailable) confidence += 0.1;
  if (topic.raw) confidence += 0.1;
  if (reference.hasVagueReference && !contextAvailable) confidence -= 0.18;
  if (conflicts.length) confidence -= Math.min(0.2, conflicts.length * 0.06);
  confidence = Math.max(0.1, Math.min(0.97, Number(confidence.toFixed(2))));

  return {
    version: "root-1-readonly",
    userText,
    normalizedText,
    mode,
    intent,
    source: {
      kind: sourceKind,
      artifactIds: [],
      confidence: sourceKind === "none" ? 0.5 : confidence,
    },
    output: {
      targets: effectiveOutputs.length ? effectiveOutputs : ["text"],
      needsDS: Boolean(needsDS),
      needsTool: Boolean(needsTool),
    },
    topic: {
      raw: topic.raw,
      kind: topic.kind,
      source: topic.source,
      previous: previousTopic,
      changedFromPrevious: topicChangedFromPrevious,
    },
    reference,
    clarification: {
      needed: Boolean(reference.hasVagueReference && !contextAvailable),
      reason: reference.hasVagueReference && !contextAvailable ? "vague_reference_without_context" : "",
      question: reference.hasVagueReference && !contextAvailable ? "Hangi içeriği kastettiğini netleştirir misin?" : "",
    },
    legacyFrame: frame ? {
      utteranceType: frame.utteranceType,
      primaryIntent: frame.primaryIntent,
      sourceRequirement: frame.sourceRequirement,
      outputTargets: frame.outputTargets || [],
      confidence: frame.confidence,
    } : null,
    signals: {
      contextAvailable,
      latestAssistantPreview: latestAssistantText(req).slice(0, 180),
    },
    conflicts,
    confidence,
  };
}

module.exports = {
  buildLucyUnderstandingCore,
};
