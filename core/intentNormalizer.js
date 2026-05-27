// LUCY Tool Intent Normalizer
// Amaç: tool router'dan önce yazım hatası / yakın anlam düzeltmesi yapmak.

function baseNormalize(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/İ/g, "i")
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
  [/\bsema\b/g, "sema"],
  [/\bsemasi\b/g, "sema"],
  [/\bakis semasi\b/g, "akis semasi"],

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

  // Grafik
  [/\bgrafk\b/g, "grafik"],
  [/\bgrafgi\b/g, "grafik"],
  [/\bgrafigi\b/g, "grafik"],
  [/\bgrafiği\b/g, "grafik"],
  [/\bpasta grafigi\b/g, "pasta grafik"],
  [/\bpasta grafi\b/g, "pasta grafik"],
  [/\bcubuk grafigi\b/g, "cubuk grafik"],
  [/\bsutun grafigi\b/g, "sutun grafik"],
  [/\bcizgi grafigi\b/g, "cizgi grafik"],

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
  if (/\b(pasta|pie|dilim|daire|doughnut|donut)\b/.test(text)) return "pie";
  if (/\b(cizgi|line|trend)\b/.test(text)) return "line";
  if (/\b(cubuk|bar|sutun|kolon)\b/.test(text)) return "bar";
  return "bar";
}

function likelyToolIntent(value = "") {
  const text = normalizeToolIntentText(value);
  return /\b(pdf|zip|excel|xlsx|xls|word|docx|document|belge|txt|md|csv|json|qr|ocr|webfetch|web|site|url|hesap|calculator|mail|telegram|whatsapp|time|saat|tarih|textstats|istatistik|filemanager|dosya)\b|grafik|chart|pasta|diyagram|mermaid|akis|sema|ciz|indir|arsiv|rapor|tablo/.test(text);
}

module.exports = {
  baseNormalize,
  normalizeToolIntentText,
  detectChartType,
  likelyToolIntent,
};
