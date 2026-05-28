const { normalizeToolIntentText } = require("./intentNormalizer");

const TOOL_NAMES = [
  "calculator", "chartdata", "document", "excel", "filemanager", "mail", "mermaid", "ocr",
  "pdf", "qr", "telegram", "textstats", "time", "webfetch", "whatsapp", "zip",
];

function norm(value = "") {
  return normalizeToolIntentText(value)
    .replace(/[!?.,;:()\[\]{}"'`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(text, pattern) {
  return pattern.test(norm(text));
}

function hasOutputVerb(text = "") {
  const q = norm(text);
  return /\b(yap|olustur|hazirla|uret|ver|indir|kaydet|donustur|cevir|cikar|çıkar|gonder|gönder|at|ilet|oku|listele|hesapla|ciz|çiz|goster|göster|arsivle|sikistir|sıkıştır)\b/.test(q);
}

function isMetaQuestion(text = "") {
  const q = norm(text);
  const meta = /\b(nedir|ne demek|ne ise yarar|ne işe yarar|nasil|nasıl|nasil calisir|nasıl çalışır|mantigi|mantığı|anlat|acikla|açıkla|ornek|örnek|ornek ver|örnek ver|farki ne|farkı ne)\b/.test(q);
  if (!meta) return false;
  // "pdf yap" gerçek üretimdir; "pdf nasıl yapılır / pdf yapmayı anlat" eğitim sorusudur.
  const strongExecution = /\b(gonder|gönder|at|ilet|indir|kaydet|hemen olustur|hemen oluştur|hemen yap|gercekten yap|gerçekten yap)\b/.test(q);
  return !strongExecution && (!hasOutputVerb(q) || /\b(nasil|nasıl|anlat|acikla|açıkla|ornek|örnek)\b/.test(q));
}

function isStyleReference(text = "") {
  const q = norm(text);
  return /\b(gibi|tarzi|tarzinda|formatinda|uslubunda|dilinde|tonunda|stili|style|tasarimi|tasarım|premium olsun|modern olsun)\b/.test(q) && !/\b(gonder|gönder|at|ilet|dosya|indir|kaydet|olustur|hazirla|uret|yap)\b/.test(q);
}

function mentionsTool(text = "", tool = "") {
  const q = norm(text);
  const patterns = {
    calculator: /\b(hesap|hesapla|calculator|matematik)\b|\d+\s*[+\-*/%]\s*\d+/,
    chartdata: /\b(grafik|chart|pasta grafik|pie|bar grafik|cizgi grafik|trend grafik|sutun grafik|gorsellestir)\b/,
    document: /\b(belge|document|txt|markdown|md|csv|json|html|word|docx|metin dosyasi)\b/,
    excel: /\b(excel|xlsx|xls|spreadsheet|e tablo|calisma kitabi)\b/,
    filemanager: /\b(filemanager|dosyalari listele|dosyaları listele|son dosya|son olusturulan dosya|son oluşturulan dosya|dosyayi oku|dosyayı oku)\b/,
    mail: /\b(mail|maili|email|e posta|eposta|smtp)\b/,
    mermaid: /\b(mermaid|diyagram|diagram|akis semasi|akış şeması|flowchart|sema|şema|blok diyagram)\b/,
    ocr: /\b(ocr|gorseldeki yazi|görseldeki yazı|resimdeki yazi|resimdeki metin|yaziyi oku|yazıyı oku)\b/,
    pdf: /\b(pdf)\b/,
    qr: /\b(qr|karekod|qr kod)\b/,
    telegram: /\b(telegram|telegrama|telegramdan)\b/,
    textstats: /\b(textstats|metin istatistik|kelime say|karakter say|satir say|satır say)\b/,
    time: /\b(saat|tarih|zaman)\b/,
    webfetch: /\b(webfetch|url|link|site|sayfa|linkteki|urldeki|https?:\/\/)\b/,
    whatsapp: /\b(whatsapp|whatsappa|whatsappdan|wp)\b/,
    zip: /\b(zip|arsiv|arşiv|sikistir|sıkıştır)\b/,
  };
  return (patterns[tool] || /$a/).test(q);
}

function explicitToolAction(text = "", tool = "") {
  const raw = String(text || "");
  const q = norm(raw);

  if (isMetaQuestion(q)) return false;
  if (isStyleReference(q) && ["mail", "telegram", "whatsapp", "time", "webfetch"].includes(tool)) return false;

  const hasUrl = /https?:\/\/\S+/i.test(raw);
  const wantsReadUrl = hasUrl && /\b(oku|sayfa|sayfayi|sayfayı|sayfasini|sayfasını|icerik|içerik|getir|al|cikar|çıkar|baslik|başlık|metin|extract|read)\b/.test(q);

  const actions = {
    calculator: /\b(hesapla|kac eder|kaç eder|sonucu ne|toplami ne|carpimi ne|bolumu ne)\b|^\s*[0-9+\-*/().,%\s]+\s$/,
    chartdata: /\b(grafik|chart|gorsellestir|görselleştir|pasta yap|grafik yap|renkli yap|renklendir|pasta grafik|cizgi grafik|bar grafik|sutun grafik)\b/,
    document: /\b(txt|markdown|md|csv|json|html|belge|word|docx|dosya|metin dosyasi)\b.*\b(yap|olustur|hazirla|kaydet|indir|ver|donustur|cevir)\b|\b(bunu|metni|icerigi|içeriği|son|onceki)\b.*\b(txt|markdown|md|csv|json|html|belge|word|docx)\b/,
    excel: /\b(excel|xlsx|xls|spreadsheet|e tablo)\b.*\b(yap|olustur|hazirla|kaydet|indir|ver|donustur|cevir)\b|\b(tabloyu|bunu|son|onceki)\b.*\b(excel|xlsx|xls)\b/,
    filemanager: /\b(dosyalari listele|dosyaları listele|olusturulan dosyalari|oluşturulan dosyaları|son dosyayi oku|son dosyayı oku|son olusturulan dosyayi oku|son oluşturulan dosyayı oku|dosyayi oku|dosyayı oku|generated dosyalari|generated dosyaları)\b/,
    mail: /\b(mail|maili|email|eposta|e posta)\b.*\b(gonder|gönder|at|ilet)\b|\b(gonder|gönder|at|ilet)\b.*\b(mail|maili|email|eposta|e posta)\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}.*\b(mail|maili|email|eposta|e posta|gonder|gönder|at|ilet)\b/,
    mermaid: /\b(mermaid|diyagram|diagram|flowchart|akis semasi|akış şeması|blok diyagram)\b.*\b(yap|olustur|hazirla|ciz|çiz|goster|göster)\b|\b(sema|şema)\b.*\b(yap|olustur|hazirla|ciz|çiz|goster|göster)\b/,
    ocr: /\b(ocr|gorseldeki yazi|görseldeki yazı|resimdeki yazi|resimdeki metin|fotograftaki yazi|yaziyi oku|yazıyı oku|gorseli oku|görseli oku|resmi oku)\b/,
    pdf: /\b(pdf)\b.*\b(yap|olustur|hazirla|kaydet|indir|ver|donustur|cevir)\b|\b(bunu|metni|icerigi|içeriği|son|onceki|tabloyu|exceli)\b.*\b(pdf)\b/,
    qr: /\b(qr|qr kod|karekod)\b.*\b(yap|olustur|hazirla|uret|çıkar|cikar|ver)\b|\b(https?:\/\/\S+)\b.*\b(qr|karekod)\b/,
    telegram: /\b(telegram|telegrama|telegramdan)\b.*\b(gonder|gönder|at|ilet)\b|\b(gonder|gönder|at|ilet)\b.*\b(telegram|telegrama|telegramdan)\b/,
    textstats: /\b(metin istatistik|kelime say|karakter say|satir say|satır say|istatistigini cikar|istatistiğini çıkar|textstats)\b/,
    time: /\b(saat kac|saat kaç|saat nedir|simdi saat|şimdi saat|guncel saat|tarih nedir|bugunun tarihi|bugün tarih|simdi kac|şimdi kaç|zaman nedir)\b|^(saat|zaman)$/,
    webfetch: /https?:\/\/\S+.*\b(oku|icerik|içerik|getir|al|cikar|çıkar|sayfa|sayfasini|sayfasını|baslik|başlık|metin|extract|read)\b|\b(linki|linkteki|url|urldeki|siteyi|sayfayi|sayfayı|sayfasini|sayfasını|bu linki|bu url)\b.*\b(oku|icerik|içerik|getir|al|cikar|çıkar|baslik|başlık|metin)\b/,
    whatsapp: /\b(whatsapp|whatsappa|whatsappdan|wp)\b.*\b(gonder|gönder|at|ilet)\b|\b(gonder|gönder|at|ilet)\b.*\b(whatsapp|whatsappa|whatsappdan|wp)\b/,
    zip: /\b(zip|arsiv|arşiv|sikistir|sıkıştır)\b.*\b(yap|olustur|hazirla|kaydet|indir|ver)\b|\b(bunu|son|onceki|dosyayi|dosyayı|exceli|pdfi)\b.*\b(zip|arsiv|arşiv)\b/,
  };
  // Deterministic Turkish direct-action fallbacks. Keep these outside the action map
  // so planner/model output cannot accidentally bypass hard intent validation.
  if (tool === "webfetch" && wantsReadUrl) return true;
  if (tool === "webfetch" && hasUrl && /\b(oku|sayfa|sayfayi|sayfayı|sayfasini|sayfasını|icerik|içerik|getir|al|cikar|çıkar|baslik|başlık|metin|extract|read)\b/.test(q)) return true;
  if (tool === "mail" && (/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(raw) && /\b(mail|maili|email|eposta|e posta|gonder|gönder|at|ilet)\b/.test(q))) return true;
  if (tool === "mail" && (/\b(mail|maili|email|eposta|e posta)\b.*\b(gonder|gönder|at|ilet)\b/.test(q) || /\b(gonder|gönder|at|ilet)\b.*\b(mail|maili|email|eposta|e posta)\b/.test(q))) return true;
  if (tool === "telegram" && (/\b(telegram|telegrama|telegramdan)\b.*\b(gonder|gönder|at|ilet)\b/.test(q) || /\b(gonder|gönder|at|ilet)\b.*\b(telegram|telegrama|telegramdan)\b/.test(q))) return true;
  if (tool === "whatsapp" && (/\b(whatsapp|whatsappa|whatsappdan|wp)\b.*\b(gonder|gönder|at|ilet)\b/.test(q) || /\b(gonder|gönder|at|ilet)\b.*\b(whatsapp|whatsappa|whatsappdan|wp)\b/.test(q))) return true;
  return (actions[tool] || /$a/).test(q);
}

function shouldBlockToolForConversation(text = "", tool = "") {
  const q = norm(text);
  const normalizedTool = String(tool || "").toLowerCase();

  if (!normalizedTool || !TOOL_NAMES.includes(normalizedTool)) return false;

  if (isMetaQuestion(q) && mentionsTool(q, normalizedTool)) {
    return { block: true, reason: "tool_meta_question" };
  }

  if (isStyleReference(q) && mentionsTool(q, normalizedTool) && !explicitToolAction(q, normalizedTool)) {
    return { block: true, reason: "tool_style_reference_only" };
  }

  if (["mail", "telegram", "whatsapp"].includes(normalizedTool) && /\b(yaz|taslak|metin|ornek|örnek|gibi|tarzi|tarzinda)\b/.test(q) && !/\b(gonder|gönder|at|ilet)\b/.test(q)) {
    return { block: true, reason: "message_compose_not_send" };
  }

  if (normalizedTool === "webfetch" && !/https?:\/\/\S+/i.test(text) && !explicitToolAction(text, normalizedTool)) {
    return { block: true, reason: "webfetch_requires_url" };
  }

  return { block: false, reason: "allowed" };
}

function rankToolCall(call = {}, userText = "") {
  const tool = String(call.tool || "").toLowerCase();
  const priority = {
    filemanager: 100,
    ocr: 95,
    calculator: 90,
    time: 85,
    webfetch: 80,
    chartdata: 70,
    mermaid: 68,
    excel: 60,
    pdf: 58,
    document: 55,
    qr: 50,
    zip: 45,
    textstats: 40,
    mail: 35,
    whatsapp: 34,
    telegram: 33,
  };
  let score = priority[tool] || 0;
  if (explicitToolAction(userText, tool)) score += 50;
  if (mentionsTool(userText, tool)) score += 10;
  return score;
}

function normalizeToolName(tool = "") {
  const t = String(tool || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const aliases = {
    chart: "chartdata",
    chartdata: "chartdata",
    chartData: "chartdata",
    file: "filemanager",
    files: "filemanager",
    filemanager: "filemanager",
    web: "webfetch",
    fetch: "webfetch",
    webfetch: "webfetch",
    textstats: "textstats",
    stats: "textstats",
  };
  return aliases[t] || t;
}

function rankAndDedupeToolCalls(calls = [], userText = "") {
  const cleaned = [];
  const seen = new Set();
  for (const call of calls || []) {
    const tool = normalizeToolName(call.tool);
    const normalized = { ...call, tool };
    const key = `${tool}:${JSON.stringify(normalized.input || {})}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(normalized);
  }
  return cleaned.sort((a, b) => rankToolCall(b, userText) - rankToolCall(a, userText));
}


function isHardToolRequest(text = "") {
  const q = norm(text);
  if (!q) return false;

  // Eğitim/meta veya sadece stil benzetmesi ise tool motorunu hiç açma.
  if (isMetaQuestion(q)) return false;

  const outputTools = [
    "calculator", "chartdata", "document", "excel", "filemanager", "mail", "mermaid", "ocr",
    "pdf", "qr", "telegram", "textstats", "time", "webfetch", "whatsapp", "zip",
  ];

  // Stil referansı, açık üretim/gönderim fiili yoksa normal sohbet kabul edilir.
  if (isStyleReference(q) && !outputTools.some((tool) => explicitToolAction(q, tool))) return false;

  return outputTools.some((tool) => explicitToolAction(q, tool));
}

module.exports = {
  norm,
  hasOutputVerb,
  isMetaQuestion,
  isStyleReference,
  mentionsTool,
  explicitToolAction,
  shouldBlockToolForConversation,
  normalizeToolName,
  rankAndDedupeToolCalls,
  isHardToolRequest,
};
