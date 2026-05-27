const { normalizeToolIntentText } = require("./intentNormalizer");

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

function normalizeIntentText(value = "") {
  return normalizeToolIntentText(decodeHtmlEntities(value));
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
  return /grafik|chart|pasta grafik|pasta olarak|pasta yap|pie chart|yuvarlak grafik|yuvarlak pasta|daire grafik|dilimli grafik|renkli dagilim|dagilim|cizgi grafik|trend grafik|bar grafik|sutun grafik|cubuk grafik|doughnut|donut|cizelge|gorsellestir|görselleştir|renkli pasta|renklerini degistir|renkleri degistir|renk degistir|renklendir|tema degistir|stil degistir|palet degistir|renkli yap/.test(q);
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
  return /mermaid|diyagram|diagram|flowchart|akış|akis|şema|sema|akis semasi|kutularla|baglantili goster|bagla|baglantili|node|blok sema/.test(q);
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
    .replace(/\b(bunu|sunlari|son|az onceki|onceki|yukardaki|yukaridaki|tabloyu|metni|icerigi|dosyayi|dosyaları|dosyalari|olarak|seklinde|lutfen|hadi|bana|gonder|hazirla|yap|yaz|ver|indir|cevir|donustur)\b/g, " ")
    .replace(/\s+/g, " ").trim();
  return /^(pdf|excel|xlsx|xls|zip|docx|word|csv|json)$/.test(compact) || q.length <= 42;
}

function stripToolNoise(text = "") {
  return stripHtmlToolButtons(String(text || ""))
    .replace(/```json\s*[\s\S]*?```/gi, "")
    .replace(/```lucy-widget\s*[\s\S]*?```/gi, "")
    .replace(/\{\s*"tool_call"\s*:\s*\{[\s\S]*?\}\s*\}/gi, "")
    .trim();
}

module.exports = {
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
};
