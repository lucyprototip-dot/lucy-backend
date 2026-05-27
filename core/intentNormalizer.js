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
  return {
    colorful: /\b(renkli|rengarenk|colorful|renk)\b/.test(text),
    premium: /\b(premium|sik|modern|profesyonel|neon|cyberpunk)\b/.test(text),
    round: /\b(yuvarlak|daire|pasta|pie|donut|halka)\b/.test(text),
    compact: /\b(kisa|kompakt|minimal)\b/.test(text),
  };
}

function detectColorPalette(value = "") {
  const text = normalizeToolIntentText(value);

  if (/\b(sari|lacivert|beyaz)\b/.test(text)) {
    return {
      name: "yellow-navy-white",
      colors: ["#facc15", "#001f5b", "#ffffff"],
      requested: true,
    };
  }

  if (/\b(siyah beyaz|black white|monokrom|monochrome)\b/.test(text)) {
    return {
      name: "mono",
      colors: ["#ffffff", "#9ca3af", "#111827"],
      requested: true,
    };
  }

  if (/\b(renkli|rengarenk|colorful|renk)\b/.test(text)) {
    return {
      name: "colorful",
      colors: ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899"],
      requested: true,
    };
  }

  if (/\b(neon|cyberpunk|premium)\b/.test(text)) {
    return {
      name: "neon",
      colors: ["#a855f7", "#22d3ee", "#f472b6", "#facc15"],
      requested: true,
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
  return /\b(pdf|zip|excel|xlsx|xls|word|docx|document|belge|txt|md|csv|json|qr|ocr|webfetch|web|site|url|hesap|calculator|mail|telegram|whatsapp|time|saat|tarih|textstats|istatistik|filemanager|dosya)\b|grafik|chart|pasta|yuvarlak|daire|dilim|trend|cizgi|cubuk|sutun|diyagram|mermaid|akis|sema|kutular|baglantili|ciz|indir|arsiv|rapor|tablo/.test(text);
}

module.exports = {
  baseNormalize,
  normalizeToolIntentText,
  detectChartType,
  detectVisualStyle,
  detectColorPalette,
  likelyToolIntent,
};
