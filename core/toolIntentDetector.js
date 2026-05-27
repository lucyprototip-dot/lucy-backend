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
  // Sadece net "belge/dosya" kastı olanlar — "word", "json", "html" gibi genel kelimelerden kaçın
  return /\b(txt dosya|markdown dosya|md dosya|docx belge|belge olustur|metin belgesi|dosya yap|dosya olarak kaydet|csv dosya|json dosya|html dosya)\b|dosya olarak ver/.test(q)
    && !wantsPdfFromText(q) && !wantsExcelFromText(q) && !wantsZipFromText(q);
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
  // Sadece net diyagram/akış kastı olanlar — "sema", "bagla", "node" gibi çok geniş kelimeler çıkarıldı
  return /mermaid|diyagram|diagram|flowchart|akis diagrami|akis semasi|is akisi|proses akisi|blok diyagram|kutularla goster|sequencediagram|classDiagram|statediagram|erdiagram|gantt/.test(q);
}

function wantsTextStatsFromText(text = "") {
  const q = normalizeIntentText(text);
  return /textstats|metin istatistik|kelime say|karakter say|satir say|satır say/.test(q);
}

function wantsCalculatorFromText(text = "") {
  const q = normalizeIntentText(text);
  // Sayı içeren hesap isteği — sadece "hesapla", "kaç eder" gibi açık math kastı
  if (/\b(hesapla|hesap|calculator|matematik|hesaplayin|kac eder|sonucu ne|toplami ne|carpimi ne|bolumu ne)\b/.test(q)) return true;
  // Saf sayısal ifade (tüm metin sayı/operatörden oluşuyorsa)
  if (/^[0-9+\-*/().,%\s]+$/.test(String(text || "").trim())) return true;
  return false;
}

function wantsTimeFromText(text = "") {
  const q = normalizeIntentText(text);
  // "saat kaç?", "tarih nedir?", "zaman ne?" — sadece açık zaman sorguları
  return /\b(saat kac|saat nedir|simdi saat|guncel saat|saat ne|kacinci saat|tarih nedir|bugunun tarihi|bugun kac|bugunun saati|simdi kac|zaman nedir|gunun tarihi)\b/.test(q)
    || /^(saat|zaman)\b/.test(q.trim());
}

function wantsWebFetchFromText(text = "") {
  const q = normalizeIntentText(text);
  // Açık "oku/getir/içerik al" talebi
  if (/webfetch|web fetch|siteyi oku|url oku|linki oku|sayfayi oku|sayfayı oku|icerigi al|icerik getir|bu url|bu linki|siteye gir|web'den/.test(q)) return true;
  // Sadece URL varsa ve başka metin çok kısaysa (kullanıcı direkt URL yapıştırdı)
  const raw = String(text || "").trim();
  const urlMatch = raw.match(/^https?:\/\/\S+/i);
  if (urlMatch && raw.replace(urlMatch[0], "").replace(/[.,!? ]/g, "").length < 15) return true;
  return false;
}

function wantsMailFromText(text = "") {
  const q = normalizeIntentText(text);
  // Mail gönder kastı — sadece "gönder/ilet/yaz" kombinasyonuyla
  return /\b(mail gonder|email gonder|eposta gonder|mail at|mail yaz|mailine gonder|maile gonder)\b/.test(q);
}

function wantsWhatsappFromText(text = "") {
  const q = normalizeIntentText(text);
  return /whatsapp gonder|whatsapp at|wp mesaj gonder|whatsapp yaz/.test(q);
}

function wantsTelegramFromText(text = "") {
  const q = normalizeIntentText(text);
  return /telegram gonder|telegram at|telegram yaz|telegram mesaj/.test(q);
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
