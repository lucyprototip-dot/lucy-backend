const { normalizeToolIntentText, detectColorPalette } = require("./intentNormalizer");

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

function timeIntentText(value = "") {
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

function toolMetaOrStyleReference(text = "") {
  const q = normalizeIntentText(text);
  const meta = /\b(nedir|ne demek|ne ise yarar|nasil calisir|mantigi|anlat|acikla|ornek ver|farki ne)\b/.test(q);
  const style = /\b(gibi|tarzi|tarzinda|formatinda|uslubunda|dilinde|tonunda|premium olsun|modern olsun)\b/.test(q);
  const action = /\b(yap|olustur|hazirla|uret|ver|indir|kaydet|donustur|cevir|gonder|at|ilet|oku|listele|hesapla|ciz|goster|arsivle|sikistir)\b/.test(q);
  return (meta || style) && !action;
}

function semanticText(text = "") {
  return normalizeIntentText(text)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u0131\u0130]/g, "i")
    .replace(/[\u011f\u011e]/g, "g")
    .replace(/[\u00fc\u00dc]/g, "u")
    .replace(/[\u015f\u015e]/g, "s")
    .replace(/[\u00f6\u00d6]/g, "o")
    .replace(/[\u00e7\u00c7]/g, "c")
    .replace(/[^a-z0-9\s'/.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasSearchResearchIntent(q = "") {
  const appSubject = /\b(program|uygulama|app|android|ios|okuyucu|duzeltici|editor|alternatif|market|play store|store)\b/.test(q);
  const appQualifier = /\b(ucretsiz|reklamsiz)\b/.test(q) && /\b(program|uygulama|app|okuyucu|duzeltici|editor)\b/.test(q);
  const appAction = /\b(ara|arastir|bul|oner|tavsiye|listele)\b/.test(q);
  const linkTerm = /\b(link|linkini|linklerini|kaynak|kaynaklarini|site|sitesini|adresini)\b/.test(q);
  const webAction = /\b(arastir|internette ara|webde ara|web'de ara|google'da ara|google da ara)\b/.test(q);
  const linkAction = /\b(link|linkini|linklerini|kaynak|kaynaklarini|site|sitesini|adresini)\b.*\b(bul|ver|goster|listele|ara)\b/.test(q)
    || /\b(bul|ver|goster|listele|ara)\b.*\b(link|linkini|linklerini|kaynak|kaynaklarini|site|sitesini|adresini)\b/.test(q);
  const sourceExportRef = /\b(bunu|sunlari|sunu|metni|icerigi|tabloyu|grafigi|grafik|dosyayi|son|onceki|exceli|pdfi|raporu)\b/.test(q)
    && /\b(pdf|excel|xlsx|xls|word|docx|txt|markdown|md|csv|json|html|zip)\b/.test(q);
  const appResearch = (appSubject || appQualifier) && (appAction || linkTerm);
  return Boolean(webAction || appResearch || (linkAction && !sourceExportRef));
}

function hasReadExtractIntent(q = "") {
  return /\b(pdf|word|docx|txt|excel|xlsx|xls|dosya|belge|resim|gorsel|foto|fotograf)\b.*\b(oku|ozetle|icerigini|icerik|metin|yazi|cikar|extract|anlat|analiz)\b/.test(q)
    || /\b(oku|ozetle|icerigini|metin|yazi|cikar|extract|analiz)\b.*\b(pdf|word|docx|txt|excel|xlsx|xls|dosya|belge|resim|gorsel|foto|fotograf)\b/.test(q)
    || /\b(resimden|gorselden|fotograftan)\b.*\b(yazi|metin)\b.*\b(cikar|oku)\b/.test(q);
}

function hasExportIntent(q = "") {
  const exportVerb = /\b(yap|olustur|hazirla|kaydet|indir|ver|gonder|aktar|cevir|donustur)\b/;
  const exportType = /\b(pdf|excel|xlsx|xls|word|docx|txt|markdown|md|csv|json|html|zip)\b/;
  const sourceRef = /\b(bunu|sunlari|sunu|metni|icerigi|tabloyu|grafigi|grafik|dosyayi|son|onceki|exceli|pdfi|raporu)\b/;
  return (exportType.test(q) && exportVerb.test(q))
    || (sourceRef.test(q) && exportType.test(q))
    || /\b(pdf|excel|xlsx|word|docx|zip)\s+olarak\b/.test(q)
    || /\b(arsivle|sikistir)\b/.test(q);
}

function hasTransformFilterIntent(q = "") {
  return /\b(en\s+(pahali|ucuz|yuksek|dusuk|buyuk|kucuk|fazla)|top\s+\d+|ilk\s+\d+|\d+\s+(urun|kalem|satir|kayit|kaydi)|filtrele|sirala|sirali)\b/.test(q)
    || /\b(tablodan|veriden|tablo|veri|dataset)\b.*\bbul\b/.test(q)
    || /\b(tablo|tabloyu|veri|dataset|liste)\b.*\b(grafik|chart|pasta|cizgi|cubuk|bar|sutun|gorsellestir|cevir|donustur)\b/.test(q)
    || /\b(grafik|chart|pasta|cizgi|cubuk|bar|sutun|gorsellestir)\b.*\b(yap|olustur|hazirla|ciz|goster)\b/.test(q);
}

function hasStyleOnlyIntent(q = "", memory = {}) {
  const style = /\b(renk|renkli|renklerini|renkleri|renkte|renklerde|renklendir|palet|palette|tema|stil|sari|lacivert|mavi|mor|neon|pastel|monokrom|siyah|beyaz)\b/.test(q);
  const action = /\b(yap|olsun|degistir|kullan|uygula|cevir|donustur)\b/.test(q);
  const chartRef = /\b(ayni|bunu|son|mevcut|grafik|grafigi|chart|pasta|cizgi|cubuk|bar|sutun)\b/.test(q) || Boolean(memory?.lastChart?.data);
  return Boolean(style && action && chartRef && !/\b(pdf|excel|xlsx|zip|word|docx|dosya|tablo|metin)\b/.test(q));
}

function hasCommunicationIntent(q = "") {
  return /\b(mail|maili|email|eposta|e posta|telegram|whatsapp|whatsappa|wp)\b.*\b(gonder|at|ilet)\b/.test(q)
    || /\b(gonder|at|ilet)\b.*\b(mail|maili|email|eposta|e posta|telegram|whatsapp|whatsappa|wp)\b/.test(q);
}

function classifySemanticIntent(text = "", memory = {}) {
  const q = semanticText(text);
  if (!q) return "unknown";
  if (hasCommunicationIntent(q)) return "communication";
  if (hasReadExtractIntent(q)) return "read_extract";
  if (hasTransformFilterIntent(q)) return "transform_filter";
  if (hasSearchResearchIntent(q)) return "search_research";
  if (hasStyleOnlyIntent(q, memory)) return "style_only";
  if (hasExportIntent(q)) return "export";
  return "unknown";
}

function wantsPdfFromText(text = "") {
  const intent = classifySemanticIntent(text);
  if (intent === "search_research" || intent === "read_extract") return false;
  const q = semanticText(text);
  return /\bpdf\b.*\b(yap|olustur|hazirla|kaydet|indir|ver|gonder|aktar|cevir|donustur|yaz)\b/.test(q)
    || /\b(bunu|sunu|metni|icerigi|tabloyu|grafigi|grafik|dosyayi|son|onceki|exceli|raporu)\b.*\bpdf\b/.test(q)
    || /\bpdf\s+olarak\b|\brapor\s+pdf\b/.test(q);
}

function wantsExcelFromText(text = "") {
  const intent = classifySemanticIntent(text);
  if (intent === "search_research" || intent === "read_extract") return false;
  const q = semanticText(text);
  return /\b(excel|xlsx|xls|e-tablo|spreadsheet|calisma kitabi)\b.*\b(yap|olustur|hazirla|kaydet|indir|ver|gonder|aktar|cevir|donustur)\b/.test(q)
    || /\b(tabloyu|bunu|sunu|son|onceki|metni|icerigi)\b.*\b(excel|xlsx|xls)\b/.test(q)
    || /\b(excel|xlsx|xls)\s+olarak\b/.test(q);
}

function wantsZipFromText(text = "") {
  const intent = classifySemanticIntent(text);
  if (intent === "search_research" || intent === "read_extract") return false;
  const q = semanticText(text);
  return /\b(zip|arsiv)\b.*\b(yap|olustur|hazirla|kaydet|indir|ver|gonder|aktar)\b/.test(q)
    || /\b(bunu|sunu|son|onceki|dosyayi|exceli|pdfi)\b.*\b(zip|arsiv)\b/.test(q)
    || /\b(arsivle|sikistir)\b/.test(q);
}

function wantsChartFromText(text = "") {
  const q = normalizeIntentText(text);
  const palette = detectColorPalette(text);
  const chartWords = /grafik|chart|pasta grafik|pasta olarak|pasta yap|pie chart|yuvarlak grafik|yuvarlak pasta|daire grafik|dilimli grafik|renkli dagilim|dagilim|cizgi grafik|trend grafik|bar grafik|sutun grafik|cubuk grafik|doughnut|donut|cizelge|gorsellestir|görselleştir|renkli pasta/.test(q);
  const styleAction = /\b(renk|renkli|renklerini|renkleri|renklendir|palet|palette|tema|stil|pastel|neon|siyah beyaz|monokrom)\b.*\b(yap|olsun|degistir|değiştir|cevir|donustur|kullan|uygula)\b/.test(q);
  const explicitPaletteAction = palette.requested && /\b(bunu|bunun|buna|bundaki|son|grafik|chart|renkleri|renklerini)\b/.test(q) && /\b(yap|olsun|degistir|değiştir|kullan|uygula|cevir|donustur)\b/.test(q);
  return chartWords || styleAction || explicitPaletteAction
    || /pastel renk|pastel renklerde|pastel yap|renklerini degistir|renkleri degistir|renk degistir|renklendir|tema degistir|stil degistir|palet degistir|renkli yap/.test(q);
}

function wantsDocumentFromText(text = "") {
  const intent = classifySemanticIntent(text);
  if (intent === "search_research" || intent === "read_extract") return false;
  const q = normalizeIntentText(text);
  // Genel kelimeler tek başına tool tetiklemesin; ama "yap/olustur/kaydet/ver/indir" gibi
  // net çıktı fiilleriyle gelirse document tool çalışsın.
  return (
    /\b(txt dosya|markdown dosya|md dosya|docx belge|belge olustur|belge hazirla|metin belgesi|dosya yap|dosya hazirla|dosya olarak kaydet|dosya olarak ver|csv dosya|json dosya|html dosya)\b/.test(q)
    || /\b(word|docx|belge|txt|markdown|md|csv|json|html)\b.*\b(yap|olustur|hazirla|kaydet|ver|indir|cikar|çıkar|donustur|cevir|aktar)\b/.test(q)
    || /\b(bunu|sunlari|metni|icerigi|tabloyu|onceki|son)\b.*\b(word|docx|belge|txt|markdown|md|csv|json|html)\b/.test(q)
  );
}

function wantsQrFromText(text = "") {
  const intent = classifySemanticIntent(text);
  if (intent === "search_research" || intent === "read_extract") return false;
  const q = normalizeIntentText(text);
  return /\bqr\b|karekod|qr kod/.test(q);
}

function wantsOcrFromText(text = "") {
  const q = normalizeIntentText(text);
  return /\bocr\b|gorselden yazi|gorseldeki yazi|gorseldeki metin|resimdeki yazi|resimdeki metin|fotograftaki yazi|fotograftaki metin|goruntu metni|metni oku|yaziyi oku|yazıyı oku|resmi oku|gorseli oku/.test(q);
}

function wantsMermaidFromText(text = "") {
  const q = normalizeIntentText(text);
  // "sema" tek başına geniş; fakat "sema yap/goster/ciz" ve "akis semasi" net diyagram kastı.
  return /mermaid|diyagram|diagram|flowchart|akis diagrami|akis semasi|is akisi|proses akisi|blok diyagram|blok sema|kutularla goster|baglantili goster|sequencediagram|classDiagram|statediagram|erdiagram|gantt/.test(q)
    || /\b(sema|şema)\b.*\b(yap|olustur|hazirla|goster|ciz|kur)\b/.test(q)
    || /\b(bunu|sunlari|metni|icerigi|tabloyu|onceki|son)\b.*\b(sema|şema|diyagram|diagram)\b/.test(q);
}

function wantsTextStatsFromText(text = "") {
  const q = normalizeIntentText(text);
  return /textstats|metin istatistik|kelime say|karakter say|satir say|satır say/.test(q);
}


function wantsFileManagerFromText(text = "") {
  const q = normalizeIntentText(text);
  return /\b(olusturulan dosyalari listele|oluşturulan dosyaları listele|dosyalari listele|dosyaları listele|generated dosyalari|generated dosyaları|son olusturulan dosyayi oku|son oluşturulan dosyayı oku|son dosyayi oku|son dosyayı oku|dosyayi oku|dosyayı oku|filemanager)\b/.test(q);
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
  const q = timeIntentText(text);
  // "saat/tarih" tek başına geniş; soru kalıbı veya bugün/şimdi bağlamı varsa time tool.
  return /\b(saat kac|saat nedir|simdi saat|guncel saat|saat ne|kacinci saat|tarih nedir|bugunun tarihi|bugun tarih|bugun kac|bugunun saati|simdi kac|zaman nedir|gunun tarihi|tarih ne)\b/.test(q)
    || /\b(su an|simdi|guncel|canli)\b.*\b(saat|saati|saatini|saatleri|saatlerini)\b/.test(q)
    || /\b(saat|saati|saatini|saatleri|saatlerini)\b.*\b(su an|simdi|guncel|canli)\b/.test(q)
    || /\b(sehir|sehirler|sehirlerin|baskent|baskentler|baskentlerin|ulke|ulkelerin)\b.*\b(saat|saati|saatini|saatleri|saatlerini)\b/.test(q)
    || /^(saat|zaman)$/.test(q.trim());
}

function wantsWebFetchFromText(text = "") {
  const q = normalizeIntentText(text);
  const raw = String(text || "").trim();
  const hasUrl = /https?:\/\/\S+/i.test(raw);

  // Açık URL/link/sayfa okuma talebi. "linkteki başlığı çıkar" gibi doğal Türkçe de dahil.
  if (/webfetch|web fetch|siteyi oku|url oku|linki oku|linkteki|bu linkteki|urldeki|url deki|sayfayi oku|sayfayı oku|sayfasini oku|sayfasını oku|icerigi al|icerik getir|bu url|bu linki|siteye gir|web'den/.test(q)) return true;
  if (hasUrl && /\b(oku|sayfa|sayfayi|sayfayı|sayfasini|sayfasını|icerik|içerik|getir|al|cikar|çıkar|baslik|başlık|metin|extract|read)\b/.test(q)) return true;

  // Sadece URL varsa ve başka metin çok kısaysa (kullanıcı direkt URL yapıştırdı)
  const urlMatch = raw.match(/^https?:\/\/\S+/i);
  if (urlMatch && raw.replace(urlMatch[0], "").replace(/[.,!? ]/g, "").length < 15) return true;
  return false;
}

function wantsMailFromText(text = "") {
  const q = normalizeIntentText(text);
  // Mail gönder kastı — mail/maili/e-posta + gönder/at/ilet kombinasyonları.
  return /\b(mail|maili|email|e posta|eposta)\b.*\b(gonder|at|ilet)\b/.test(q)
    || /\b(gonder|at|ilet)\b.*\b(mail|maili|email|e posta|eposta)\b/.test(q)
    || /[a-z0-9._%+-]+\s+at\s+[a-z0-9.-]+\s+adresine.*\b(gonder|ilet)\b/.test(q);
}

function wantsWhatsappFromText(text = "") {
  const q = normalizeIntentText(text);
  return /\b(whatsapp|whatsappa|whatsappdan|wp)\b.*\b(gonder|at|ilet)\b/.test(q)
    || /\b(gonder|at|ilet)\b.*\b(whatsapp|whatsappa|whatsappdan|wp)\b/.test(q);
}

function wantsTelegramFromText(text = "") {
  const q = normalizeIntentText(text);
  return /\b(telegram|telegrama|telegramdan)\b.*\b(gonder|at|ilet)\b/.test(q)
    || /\b(gonder|at|ilet)\b.*\b(telegram|telegrama|telegramdan)\b/.test(q);
}

function isOnlyTransformCommand(text = "") {
  const q = normalizeIntentText(text).replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!q) return false;
  const compact = q
    .replace(/\b(bunu|sunu|sunlari|onu|son|en son|az onceki|onceki|bir onceki|yukardaki|yukaridaki|ustteki|mevcut|tabloyu|metni|icerigi|dosyayi|dosyalari|olarak|seklinde|lutfen|hadi|bana|gonder|hazirla|yap|yaz|ver|indir|cevir|donustur)\b/g, " ")
    .replace(/\s+/g, " ").trim();
  const bareFormat = /^(pdf|excel|xlsx|xls|zip|docx|word|csv|json)$/.test(compact);
  const explicitReference = /\b(bunu|sunu|onu|son|en son|az onceki|onceki|bir onceki|yukardaki|yukaridaki|ustteki|mevcut|tabloyu|metni|icerigi|dosyayi|dosyalari)\b/.test(q);
  const hasFormatAction = /\b(pdf|excel|xlsx|xls|zip|docx|word|csv|json)\b/.test(q) && /\b(yap|ver|indir|cevir|donustur|kaydet|hazirla|olustur)\b/.test(q);
  return bareFormat || Boolean(explicitReference && hasFormatAction);
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
  toolMetaOrStyleReference,
};
