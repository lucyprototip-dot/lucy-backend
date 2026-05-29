// LUCY Tool Intent Normalizer
// Amaç: tool router'dan önce yazım hatası / yakın anlam / stil niyetlerini güvenli şekilde normalize etmek.

function baseNormalize(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/İ/g, "i")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}

const PHRASE_REPLACEMENTS = [
  // Diyagram / Mermaid
  [/\bsiyagram\b/g, "diyagram"],
  [/\bdiygram\b/g, "diyagram"],
  [/\bdiag?ram\b/g, "diyagram"],
  [/\bdigram\b/g, "diyagram"],
  [/\bdiyagram olarak dedim\b/g, "diyagram yap"],
  [/\bsiyagram olarak dedim\b/g, "diyagram yap"],
  [/\bsemasi\b/g, "sema"],
  [/\bsema olarak\b/g, "sema"],
  [/\bakis semasi\b/g, "akis semasi"],
  [/\bflow chart\b/g, "flowchart"],

  // Excel
  [/\bexcell\b/g, "excel"],
  [/\bexel\b/g, "excel"],
  [/\bexcele\b/g, "excel"],
  [/\bekselle?\b/g, "excel"],
  [/\bxslx\b/g, "xlsx"],
  [/\bxslsx\b/g, "xlsx"],
  [/\bxlsx olarak\b/g, "excel olarak"],

  // PDF
  [/\bpedefe\b/g, "pdf"],
  [/\bpdfe\b/g, "pdf"],
  [/\bpdfye\b/g, "pdf"],
  [/\bpdf'e\b/g, "pdf"],

  // ZIP
  [/\bziip\b/g, "zip"],
  [/\bzipp\b/g, "zip"],
  [/\bzipe\b/g, "zip"],
  [/\bzip'e\b/g, "zip"],
  [/\barsive\b/g, "arsiv"],
  [/\barsivle\b/g, "arsiv"],

  // Grafik / Chart
  [/\bgrafk\b/g, "grafik"],
  [/\bgrafgi\b/g, "grafik"],
  [/\bgrafigi\b/g, "grafik"],
  [/\bgrafiği\b/g, "grafik"],
  [/\bgrefik\b/g, "grafik"],
  [/\bgrefi\b/g, "grafik"],
  [/\bpasta grafigi\b/g, "pasta grafik"],
  [/\bpasta grafi\b/g, "pasta grafik"],
  [/\byuvarlak grafik\b/g, "pasta grafik"],
  [/\byuvarlan grafik\b/g, "pasta grafik"],
  [/\byuvarlak pasta\b/g, "pasta grafik"],
  [/\byuvarlan pasta\b/g, "pasta grafik"],
  [/\bdaire grafik\b/g, "pasta grafik"],
  [/\bdilimli grafik\b/g, "pasta grafik"],
  [/\bcubuk grafigi\b/g, "cubuk grafik"],
  [/\bsutun grafigi\b/g, "sutun grafik"],
  [/\bcizgi grafigi\b/g, "cizgi grafik"],
  [/\btrend grafigi\b/g, "trend grafik"],

  // Referans kelimeleri
  [/\bbi onceki\b/g, "bir onceki"],
  [/\baz onceki\b/g, "onceki"],
  [/\byukardaki\b/g, "yukaridaki"],
  [/\bustteki\b/g, "ustteki"],
  [/\bpunu\b/g, "bunu"],
  [/\bbumu\b/g, "bunu"],
  [/\bbnu\b/g, "bunu"],

  // QR / OCR / diğer
  [/\bkare kod\b/g, "karekod"],
  [/\bqrcode\b/g, "qr"],
  [/\bokur musun\b/g, "oku"],
  [/\banaliz et\b/g, "istatistik"],
];

function normalizeToolIntentText(value = "") {
  let text = baseNormalize(value);
  for (const [pattern, replacement] of PHRASE_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }
  return text.replace(/\s+/g, " ").trim();
}

function detectChartType(value = "") {
  const text = normalizeToolIntentText(value);
  if (/\b(pasta|pie|dilim|daire|yuvarlak|doughnut|donut|halka)\b/.test(text)) return "pie";
  if (/\b(cizgi|line|trend|zaman|aylik|gelisim|degisim)\b/.test(text)) return "line";
  if (/\b(cubuk|bar|sutun|kolon|normal grafik|karsilastir)\b/.test(text)) return "bar";
  return "bar";
}

function detectVisualStyle(value = "") {
  const text = normalizeToolIntentText(value);
  const colorStyle = /\b(renkli|rengarenk|colorful|renk|renkte|renklerde|renklerle|renklere|farkli renk|ayri renk)\b/.test(text)
    || /\b\d+\s*(?:farkli|ayri)?\s*renk(?:te|li|le|lerle|lerde)?\b/.test(text);
  return {
    colorful: colorStyle,
    premium: /\b(premium|sik|modern|profesyonel|neon|cyberpunk|pastel)\b/.test(text),
    round: /\b(yuvarlak|daire|pasta|pie|donut|halka)\b/.test(text),
    compact: /\b(kisa|kompakt|minimal)\b/.test(text),
  };
}

function uniqueColors(colors = []) {
  const seen = new Set();
  return colors.filter((color) => {
    const key = String(color || "").toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function expandPalette(colors = [], min = 4) {
  const base = uniqueColors(colors);
  if (!base.length) return [];
  const out = [...base];
  let i = 0;
  while (out.length < min && i < min * 3) {
    out.push(base[i % base.length]);
    i += 1;
  }
  return out;
}

function detectNamedColors(text = "") {
  const colorMap = [
    [/(saf\s+)?siyah|black/g, "#050505", "siyah"],
    [/(saf\s+)?beyaz|white/g, "#f8fafc", "beyaz"],
    [/gri|gray|grey|gumus|gümüş/g, "#9ca3af", "gri"],
    [/kirmizi|kırmızı|red/g, "#ef4444", "kirmizi"],
    [/bordo|burgundy/g, "#7f1d1d", "bordo"],
    [/sari|sarı|altin|altın|yellow|gold/g, "#facc15", "sari"],
    [/turuncu|orange/g, "#f97316", "turuncu"],
    [/yesil|yeşil|green/g, "#22c55e", "yesil"],
    [/turkuaz|turquoise/g, "#14b8a6", "turkuaz"],
    [/camgobegi|camgöbeği|cyan/g, "#22d3ee", "cyan"],
    [/lacivert|navy/g, "#001f5b", "lacivert"],
    [/mavi|blue/g, "#2563eb", "mavi"],
    [/mor|purple|violet/g, "#8b5cf6", "mor"],
    [/pembe|pink/g, "#ec4899", "pembe"],
    [/fuşya|fusya|fuchsia|magenta/g, "#d946ef", "fusya"],
    [/kahverengi|brown/g, "#92400e", "kahverengi"],
  ];

  const hits = [];
  for (const [pattern, color, name] of colorMap) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text))) {
      hits.push({ index: match.index, color, name });
    }
  }
  hits.sort((a, b) => a.index - b.index);
  return {
    names: hits.map((hit) => hit.name),
    colors: uniqueColors(hits.map((hit) => hit.color)),
  };
}

function isPlainTableCreationRequest(text = "") {
  const q = normalizeToolIntentText(text);
  if (!/tablo/.test(q)) return false;
  if (/(excel|xlsx|xls|pdf|word|docx|zip|dosya|indir|kaydet|gonder|gönder|cevir|donustur|grafik|chart|pasta|cizgi|bar|sutun|renk|emoji|gorsel|görsel)/.test(q)) return false;
  if (/(bunu|bunun|buna|onu|onun|ona|son|onceki|önceki|az onceki|yazdigin|yazdığın|senin)/.test(q)) return false;
  return /(yap|olustur|oluştur|hazirla|hazırla|goster|göster)/.test(q);
}

function detectColorPalette(value = "") {
  const text = normalizeToolIntentText(value);

  const named = detectNamedColors(text);
  const wantsDifferentColors = /\b(?:farkli|ayri)\s+renk(?:te|li|le|lerle|lerde)?\b/.test(text)
    || /\b\d+\s*(?:farkli|ayri)?\s*renk(?:te|li|le|lerle|lerde)?\b/.test(text)
    || /\brenk(?:te|lerde|lerle|lere)\b/.test(text);

  // Takım/marka/tema ifadeleri sabit komut değil, semantik kısa yol olarak yorumlanır.
  if (/\bfenerbahce|fenerbahçe\b/.test(text)) {
    return { name: "fenerbahce", colors: ["#facc15", "#001f5b"], requested: true, dynamic: true };
  }
  if (/\bgalatasaray\b/.test(text)) {
    return { name: "galatasaray", colors: ["#f59e0b", "#a90432"], requested: true, dynamic: true };
  }
  if (/\bbesiktas|beşiktaş\b/.test(text)) {
    return { name: "besiktas", colors: ["#050505", "#f8fafc", "#ef4444"], requested: true, dynamic: true };
  }

  // Açık renk adları verilmişse en güçlü niyet budur: hangi renkler yazıldıysa o sırada kullan.
  // Örn: “sarı lacivert beyaz kırmızı”, “mor mavi”, “siyah gri beyaz”.
  if (named.colors.length >= 2) {
    const wantsMono = named.names.includes("siyah") && named.names.includes("beyaz") && named.colors.length <= 3;
    return {
      name: wantsMono ? "mono-explicit" : "explicit",
      colors: expandPalette(named.colors, 4),
      requested: true,
      dynamic: true,
      names: named.names,
    };
  }

  if (/\b(siyah beyaz|black white|monokrom|monochrome|gri ton|gri tonlarda)\b/.test(text)) {
    return {
      name: "mono",
      colors: ["#050505", "#4b5563", "#9ca3af", "#f8fafc"],
      requested: true,
    };
  }

  if (/\b(koyu pastel|daha koyu pastel|pastel.*koyu|dark pastel)\b/.test(text)) {
    return {
      name: "dark-pastel",
      colors: ["#8b5cf6", "#0891b2", "#db2777", "#ca8a04", "#16a34a", "#dc2626"],
      requested: true,
    };
  }

  if (/\b(pastel|soft renk|yumusak renk|yumuşak renk)\b/.test(text)) {
    return {
      name: "pastel",
      colors: ["#c4b5fd", "#a5f3fc", "#fbcfe8", "#fde68a", "#bbf7d0", "#fecaca"],
      requested: true,
    };
  }

  if (/\b(neon|cyberpunk|premium)\b/.test(text)) {
    const neonFromNamed = named.colors.length ? named.colors : ["#a855f7", "#22d3ee", "#f472b6", "#facc15"];
    return {
      name: "neon",
      colors: expandPalette(neonFromNamed, 4),
      requested: true,
      dynamic: Boolean(named.colors.length),
    };
  }

  if (wantsDifferentColors || /\b(renkli|rengarenk|colorful|renk)\b/.test(text)) {
    return {
      name: "colorful",
      colors: ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899"],
      requested: true,
      dynamic: wantsDifferentColors,
    };
  }

  if (named.colors.length === 1) {
    return {
      name: "single-explicit",
      colors: expandPalette(named.colors, 4),
      requested: true,
      dynamic: true,
      names: named.names,
    };
  }

  return {
    name: "default",
    colors: [],
    requested: false,
  };
}

function likelyToolIntent(value = "") {
  const text = normalizeToolIntentText(value);
  if (isPlainTableCreationRequest(value)) return false;
  const metaOrStyle = /\b(nedir|ne demek|ne ise yarar|nasil calisir|mantigi|anlat|acikla|ornek ver|farki ne|gibi|tarzi|tarzinda|formatinda|uslubunda|tonunda)\b/.test(text);
  const action = /\b(yap|olustur|hazirla|uret|ver|indir|kaydet|donustur|cevir|degistir|değiştir|gonder|at|ilet|oku|listele|hesapla|ciz|goster|arsivle|sikistir|kullan|uygula|olsun)\b/.test(text);
  const palette = detectColorPalette(value);
  const artifactReference = /\b(bunu|bunun|buna|bundaki|bundan|onu|onun|ona|şunu|sunu|son|en son|onceki|önceki|mevcut|daha|grafik|chart|tablo|dosya|renkleri|renklerini)\b/.test(text);
  const chartReference = /\b(grafik|chart|pasta|pie|cizgi|bar|sutun|cubuk|dilim|daire|yuvarlak)\b/.test(text);
  if (metaOrStyle && !action) return false;
  // “Bunu X renk yap / X renkleri kullan” gibi istekler tool işidir; X dinamik çıkarılır.
  // Salt “saat tarzı premium olsun” gibi stil referanslarını ise tool niyeti sanma.
  if (palette.requested && (artifactReference || chartReference || (palette.dynamic && action))) return true;
  if (/\b(tablo)\b.*\b(yap|olustur|hazirla|goster|cevir|donustur)\b|\b(bunu|son|grafik|chart)\b.*\btablo\b/.test(text)) return true;
  // Tool hakkında açıklama/eğitim soruları tool çalıştırmaz: "PDF nasıl yapılır", "Excel örneği anlat" vb.
  if (/\b(pdf|excel|xlsx|xls|zip|qr|ocr|webfetch|mail|telegram|whatsapp|mermaid|diyagram|grafik|chart|calculator|hesap|textstats)\b/.test(text)
      && /\b(nasil|nedir|ne demek|ne ise yarar|mantigi|anlat|acikla|ornek|farki)\b/.test(text)
      && !/\b(gonder|indir|kaydet|dosya olarak|gercekten|hemen olustur|hemen yap)\b/.test(text)) return false;
  // Açık Türkçe gönderim/URL okuma kalıpları tool niyetidir.
  if (/https?:\/\/\S+/.test(String(value || "")) && /\b(oku|sayfa|sayfayi|sayfayı|sayfasini|sayfasını|icerik|içerik|getir|al|cikar|çıkar|baslik|başlık|metin)\b/.test(text)) return true;
  if (/\b(linkteki|urldeki|linki|url|siteyi|sayfayi|sayfayı|sayfasini|sayfasını)\b.*\b(oku|icerik|içerik|getir|al|cikar|çıkar|baslik|başlık|metin)\b/.test(text)) return true;
  if (/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(String(value || "")) && /\b(mail|maili|email|eposta|e posta|gonder|gönder|at|ilet)\b/.test(text)) return true;
  if (/\b(mail|maili|email|eposta|e posta)\b.*\b(gonder|gönder|at|ilet)\b/.test(text) || /\b(gonder|gönder|at|ilet)\b.*\b(mail|maili|email|eposta|e posta)\b/.test(text)) return true;
  if (/\b(telegram|telegrama|telegramdan)\b.*\b(gonder|gönder|at|ilet)\b/.test(text) || /\b(gonder|gönder|at|ilet)\b.*\b(telegram|telegrama|telegramdan)\b/.test(text)) return true;
  if (/\b(whatsapp|whatsappa|whatsappdan|wp)\b.*\b(gonder|gönder|at|ilet)\b/.test(text) || /\b(gonder|gönder|at|ilet)\b.*\b(whatsapp|whatsappa|whatsappdan|wp)\b/.test(text)) return true;

  // Son grafiği/diyagramı doğal dille değiştirme: "renkli pasta yap", "çizgi grafik yap", "farklı renklerde yap".
  if (/\b(renkli|renklendir|rengarenk|farkli renk|farkli renklerde|palet|tema|neon|pastel|sari|lacivert|beyaz|pasta|pie|yuvarlak|daire|dilim|cizgi|line|trend|cubuk|bar|sutun)\b.*\b(yap|olsun|cevir|donustur|goster|görster|goster|hazirla)\b/.test(text)) return true;

  // Genel kelimeler tek başına tool tetiklemesin; açık çıktı fiili veya net tool kalıbı varsa tetiklensin.
  return /\b(zip|excel|xlsx|xls|docx|qr|ocr|webfetch|hesap|calculator|hesapla|mail gonder|maili gonder|email gonder|eposta gonder|telegram gonder|telegrama gonder|telegram mesaj gonder|whatsapp gonder|whatsappa gonder|whatsapp mesaj gonder|textstats|filemanager)\b|grafik|chart|pasta grafik|yuvarlak grafik|daire grafik|dilimli|trend grafik|cizgi grafik|cubuk grafik|sutun grafik|diyagram|mermaid|akis diagrami|akis semasi|blok diyagram|kutularla goster|indir|arsivle|rapor pdf|excel yap|pdf yap|zip yap|qr kod|dosyalari listele|dosyalari oku|dosyayi oku|son dosyayi oku|son olusturulan dosyayi oku|olusturulan dosyalari|filemanager|https?:\/\/\S+.*(oku|icerik|getir|al|cikar|sayfa|sayfasini|baslik|metin)/.test(text)
    || /\b(pdf)\b.*\b(yap|olustur|hazirla|kaydet|ver|indir|donustur|cevir)\b/.test(text)
    || /\b(word|docx|belge|txt|markdown|md|csv|json|html)\b.*\b(yap|olustur|hazirla|kaydet|ver|indir|donustur|cevir)\b/.test(text)
    || /\b(sema|şema)\b.*\b(yap|olustur|hazirla|goster|ciz|kur)\b/.test(text)
    || /\b(saat kac|saat nedir|saat ne|tarih nedir|tarih ne|bugun tarih|bugunun tarihi|simdi kac|zaman nedir)\b/.test(text);
}

module.exports = {
  baseNormalize,
  normalizeToolIntentText,
  detectChartType,
  detectVisualStyle,
  detectColorPalette,
  likelyToolIntent,
  isPlainTableCreationRequest,
};
