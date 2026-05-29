const DEFAULT_PALETTE = [
  "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#14b8a6",
];

function parseNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value ?? "")
    .replace(/[−–—]/g, "-")
    .replace(/[’']/g, "")
    .trim();
  if (!raw) return null;

  const match = raw.match(/-?\d[\d\s.,]*/);
  if (!match) return null;

  let token = match[0].replace(/\s/g, "");
  if (!token || token === "-") return null;

  const comma = token.lastIndexOf(",");
  const dot = token.lastIndexOf(".");

  if (comma >= 0 && dot >= 0) {
    token = comma > dot
      ? token.replace(/\./g, "").replace(/,/g, ".")
      : token.replace(/,/g, "");
  } else if (comma >= 0) {
    const parts = token.split(",");
    const last = parts[parts.length - 1] || "";
    token = parts.length === 2 && last.length <= 2
      ? token.replace(/,/g, ".")
      : token.replace(/,/g, "");
  } else if (dot >= 0) {
    const parts = token.split(".");
    const last = parts[parts.length - 1] || "";
    token = parts.length > 2 || (parts.length === 2 && last.length === 3)
      ? token.replace(/\./g, "")
      : token;
  }

  const num = Number(token);
  return Number.isFinite(num) ? num : null;
}

function normalizeHeader(header = "") {
  return String(header || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}


function explicitMetricRequested(input = {}) {
  const q = normalizeHeader(input.userText || input.prompt || input.request || input.title || input.label || "");
  if (/\b(toplam|total|tutar|amount|bedel|gelir|satis|ciro|revenue|sales)\b/.test(q)) return "total";
  if (/\b(birim fiyat|unit price|adet fiyat|fiyat|price)\b/.test(q)) return "price";
  if (/\b(miktar|adet|quantity|count|sayi|sayisi)\b/.test(q)) return "quantity";
  if (/\b(deger|value|puan|skor)\b/.test(q)) return "value";
  return "";
}

function strictValueHeader(headers = [], rows = [], input = {}) {
  const candidates = headers.filter((header) => rows.some((row) => parseNumber(row?.[header]) !== null));
  if (!candidates.length) return null;

  const requested = explicitMetricRequested(input);
  if (requested === "quantity") {
    const quantity = candidates.find((header) => /miktar|adet|quantity|count|sayi|sayisi/.test(normalizeHeader(header)));
    if (quantity) return quantity;
  }
  if (requested === "price") {
    const price = candidates.find((header) => /birim fiyat|unit price|adet fiyat|fiyat|price/.test(normalizeHeader(header)));
    if (price) return price;
  }

  const ranked = candidates
    .map((header, index) => {
      const h = normalizeHeader(header);
      let score = 0;
      if (/^toplam$|toplam tutar|toplam gelir|genel toplam|total/.test(h)) score = 1000;
      else if (/^tutar$|amount|bedel/.test(h)) score = 920;
      else if (/^gelir$|^satis$|ciro|revenue|sales/.test(h)) score = 850;
      else if (/^deger$|^value$/.test(h)) score = 500;
      return { header, score: score + (candidates.length - index) * 0.01 };
    })
    .filter((item) => item.score >= 1)
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.header || null;
}

function scoreValueHeader(header = "", input = {}) {
  const h = normalizeHeader(header);
  const q = normalizeHeader(input.userText || input.prompt || input.request || input.title || input.label || "");
  let score = 0;

  if (/^#|^no$|^id$|sira/.test(h)) score -= 100;
  if (/not|aciklama|kategori|category|birim$|unit$/.test(h)) score -= 50;
  if (/toplam|total/.test(q) && /toplam|total/.test(h)) score += 150;
  if (/tahmini fiyat|fiyat|tutar|bedel|amount|price/.test(q) && /tahmini fiyat|fiyat|tutar|bedel|amount|price/.test(h)) score += 120;
  if (/toplam|total/.test(h)) score += 80;
  if (/tutar|amount|bedel/.test(h)) score += 65;
  if (/tahmini fiyat/.test(h)) score += 55;
  if (/fiyat|price/.test(h)) score += 35;
  if (/deger|value/.test(h)) score += 30;
  if (/miktar|adet|quantity|count/.test(h)) score += 10;
  if (/birim fiyat|unit price/.test(h)) score += 8;

  return score;
}

function chooseLabelHeader(headers = [], rows = []) {
  const scored = headers.map((header, index) => {
    const h = normalizeHeader(header);
    const hasText = rows.some((row) => String(row?.[header] ?? "").trim() && parseNumber(row?.[header]) === null);
    let score = (headers.length - index) * 0.01;
    if (hasText) score += 10;
    if (/^urun$|urun adi|urun ad|urun ismi|product/.test(h)) score += 100;
    if (/^ad$|^isim$|^adi$|^ismi$|baslik|title|name/.test(h)) score += 80;
    if (/kategori|category/.test(h)) score += 30;
    if (/not|aciklama|description/.test(h)) score -= 20;
    return { header, score };
  }).sort((a, b) => b.score - a.score);
  return scored[0]?.header || headers[0];
}

function chooseValueHeader(headers = [], rows = [], input = {}) {
  const candidates = headers.filter((header) => rows.some((row) => parseNumber(row?.[header]) !== null));
  if (!candidates.length) return null;
  const strict = strictValueHeader(headers, rows, input);
  if (strict) return strict;
  const scored = candidates.map((header, index) => ({
    header,
    score: scoreValueHeader(header, input) + (candidates.length - index) * 0.01,
  })).sort((a, b) => b.score - a.score);
  return scored[0]?.header || candidates[0];
}

function cleanNumber(value) {
  const num = parseNumber(value);
  return num === null ? 0 : num;
}

function paletteFor(input = {}, count = 1) {
  const style = input.style && typeof input.style === "object" ? input.style : {};
  const explicit = Array.isArray(input.colors) ? input.colors : Array.isArray(style.colors) ? style.colors : [];
  const base = explicit.length ? explicit : DEFAULT_PALETTE;
  return Array.from({ length: Math.max(1, count) }, (_, i) => base[i % base.length]);
}

module.exports = {
  name: "chartData",
  description: "Grafik için etiket ve veri setini standart JSON formatına çevirir",

  async execute(input = {}) {
    let labels = Array.isArray(input.labels) ? input.labels : [];
    let values = Array.isArray(input.values) ? input.values : [];
    const chartType = input.chartType || input.type || "bar";
    const style = input.style && typeof input.style === "object" ? input.style : {};

    if ((!labels.length || !values.length) && input.data?.labels && input.data?.datasets?.[0]?.data) {
      labels = Array.isArray(input.data.labels) ? input.data.labels : [];
      values = Array.isArray(input.data.datasets[0].data) ? input.data.datasets[0].data : [];
    }

    if ((!labels.length || !values.length) && Array.isArray(input.rows) && input.rows.length) {
      const headers = Array.isArray(input.headers) && input.headers.length
        ? input.headers
        : Object.keys(input.rows.find((row) => row && typeof row === "object") || {});
      const labelKey = chooseLabelHeader(headers, input.rows);
      const valueKey = chooseValueHeader(headers, input.rows, input);
      if (!valueKey) {
        return { success: false, error: "numeric_values_required", message: "Grafik için en az bir sayısal kolon gerekli." };
      }
      const pairs = input.rows.slice(0, 30)
        .map((row, index) => ({
          label: String(row?.[labelKey] ?? `Satır ${index + 1}`).trim() || `Satır ${index + 1}`,
          value: parseNumber(row?.[valueKey]),
        }))
        .filter((item) => item.value !== null);
      labels = pairs.map((item) => item.label);
      values = pairs.map((item) => item.value);
      if (!input.label) input.label = valueKey;
    }

    const numericValues = values.map((value) => parseNumber(value));
    if (!labels.length || !numericValues.length || labels.length !== numericValues.length || numericValues.some((value) => value === null)) {
      return {
        success: false,
        error: "invalid_chart_data",
        message: "labels ve values dolu, aynı uzunlukta ve sayısal olmalı.",
      };
    }

    const colors = paletteFor(input, labels.length);
    const title = input.title || input.label || (chartType === "pie" ? "Pasta Grafiği" : chartType === "line" ? "Trend Grafiği" : "Grafik");
    const colorful = Boolean(style.colorful || chartType === "pie" || input.colorful || colors.length);
    const paletteName = style.palette || input.palette || (colorful ? "colorful" : "default");

    return {
      success: true,
      type: "chart",
      tool: "chartData",
      chartType,
      colorful,
      paletteName,
      style: { ...style, colors, colorful, palette: paletteName },
      colors,
      palette: colors,
      title,
      label: input.label || "Veri",
      data: {
        labels,
        datasets: [
          {
            label: input.label || "Veri",
            data: numericValues,
            backgroundColor: colors,
            borderColor: colors,
          },
        ],
      },
    };
  },
};
