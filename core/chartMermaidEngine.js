const { detectChartType, detectVisualStyle, detectColorPalette, normalizeToolIntentText } = require("./intentNormalizer");
const { cleanLabel: cleanSafeMermaidLabel, sanitizeMermaidCode, buildFlowchartFromPairs, buildPieMermaid } = require("./safeMermaidBuilder");

function numberFromCell(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const raw = String(value ?? "")
    .replace(/[−–—]/g, "-")
    .replace(/[’']/g, "")
    .trim();
  if (!raw) return null;

  // Gerçek kullanıcı tabloları genelde "30 TL", "2 kg", "12’li", "1.234,56 ₺" gibi gelir.
  // Hücre komple sayı değilse bile ilk güvenli numeric token çıkarılır.
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
  return normalizeToolIntentText(header).replace(/[^a-z0-9]+/g, " ").trim();
}

function chartIntentText(userText = "") {
  return String(userText || "")
    .split(/\r?\n/)
    .filter((line) => !String(line || "").includes("|"))
    .join("\n");
}

function isNumericColumn(rows = [], header = "") {
  return rows.some((row) => numberFromCell(row?.[header]) !== null);
}

function numericHeaders(table) {
  const rows = table?.rows || [];
  return (table?.headers || []).filter((header) => isNumericColumn(rows, header));
}


function explicitMetricRequested(userText = "") {
  const q = normalizeToolIntentText(userText);
  if (/\b(toplam|total|tutar|amount|bedel|gelir|satis|satış|ciro|revenue|sales)\b/.test(q)) return "total";
  if (/\b(birim fiyat|unit price|adet fiyat|fiyat|price)\b/.test(q)) return "price";
  if (/\b(miktar|adet|quantity|count|sayi|sayisi|sayı|sayısı)\b/.test(q)) return "quantity";
  if (/\b(deger|değer|value|puan|skor)\b/.test(q)) return "value";
  return "";
}

function scoreStrictValueHeader(header = "") {
  const h = normalizeHeader(header);
  if (/^toplam$|toplam tutar|toplam gelir|genel toplam|total/.test(h)) return 1000;
  if (/^tutar$|amount|bedel/.test(h)) return 920;
  if (/^gelir$|^satis$|^satış$|ciro|revenue|sales/.test(h)) return 850;
  if (/^deger$|^değer$|^value$/.test(h)) return 500;
  // "Birim Fiyat" toplam değildir. Sadece gerçek toplam/tutar yoksa scoring fallback bunu seçebilir.
  return 0;
}

function strictValueHeader(table, userText = "") {
  const nums = numericHeaders(table);
  if (!nums.length) return null;

  const requested = explicitMetricRequested(userText);
  if (requested === "quantity") {
    const quantity = nums.find((header) => /miktar|adet|quantity|count|sayi|sayisi|sayı|sayısı/.test(normalizeHeader(header)));
    if (quantity) return quantity;
  }
  if (requested === "price") {
    const price = nums.find((header) => /birim fiyat|unit price|adet fiyat|fiyat|price/.test(normalizeHeader(header)));
    if (price) return price;
  }

  // Kullanıcı farklı bir numeric metrik istemediyse, explicit toplam/tutar/gelir kolonu satır bazında kilitlenir.
  // Bu modda asla miktar x birim fiyat gibi yeniden hesaplama yapılmaz.
  const strict = nums
    .map((header, index) => ({ header, score: scoreStrictValueHeader(header) + (nums.length - index) * 0.01 }))
    .filter((item) => item.score >= 1)
    .sort((a, b) => b.score - a.score)[0];
  return strict?.header || null;
}

function labelHeader(table) {
  const rows = table?.rows || [];
  const headers = table?.headers || [];
  const textHeaders = headers.filter((header) => rows.some((row) => String(row?.[header] ?? "").trim() && numberFromCell(row?.[header]) === null));
  if (!textHeaders.length) return headers[0];

  const scored = textHeaders.map((header, index) => {
    const h = normalizeHeader(header);
    let score = (textHeaders.length - index) * 0.01;
    if (/^urun$|urun adi|urun ad|urun ismi|product/.test(h)) score += 100;
    if (/^ad$|^isim$|^adi$|^ismi$|baslik|title|name/.test(h)) score += 80;
    if (/kategori|category/.test(h)) score += 45;
    if (/kalem|aciklama|not|description/.test(h)) score += 25;
    return { header, score };
  }).sort((a, b) => b.score - a.score);

  return scored[0]?.header || textHeaders[0] || headers[0];
}

function scoreHeaderForQuery(header = "", userText = "", chartType = "bar") {
  const h = normalizeHeader(header);
  const q = normalizeToolIntentText(chartIntentText(userText));
  let score = 0;

  if (/urun|ürün|product|ad|adi|adı|isim|ismi|model|kategori|category|aciklama|açıklama|description/.test(h)) score -= 220;
  if (/^#|^no$|^id$|sira|sıra/.test(h)) score -= 90;
  if (/not|aciklama|açıklama|kategori|category|birim$|unit$/.test(h)) score -= 40;
  if (/toplam|total/.test(q) && /toplam|total/.test(h)) score += 140;
  if (/tahmini fiyat|fiyat|tutar|bedel|amount|price/.test(q) && /tahmini fiyat|fiyat|tutar|bedel|amount|price/.test(h)) score += 110;

  if (q.includes("net") && /net|kar|kâr|kazanc|bakiye/.test(h)) score += 80;
  if (q.includes("gider") && /gider|kira|fatura|market|ulasim|eglence|saglik|giyim|abonelik|harcama/.test(h)) score += 70;
  if (q.includes("gelir") && /gelir|maas|maaş|freelance|kazanc/.test(h)) score += 70;
  if (/puan|skor|deger|değer|adet|miktar|sayi|sayisi/.test(q) && /puan|skor|deger|adet|miktar|sayi/.test(h)) score += 60;
  if (q && h && q.includes(h)) score += 90;

  if (chartType === "line") {
    if (/net|kar|kâr|toplam/.test(h)) score += 25;
    if (/tarih|ay|gun|gün|kategori|aciklama/.test(h)) score -= 50;
  }

  if (chartType === "pie") {
    if (/net|kar|kâr/.test(h)) score -= 10;
    if (/gider|harcama|masraf|deger|adet|puan/.test(h)) score += 20;
  }

  if (/toplam|total/.test(h)) score += 55;
  if (/tutar|amount|bedel/.test(h)) score += 45;
  if (/gelir|satis|ciro|revenue|sales/.test(h)) score += 40;
  if (/deger|value/.test(h)) score += 32;
  if (/miktar|adet|quantity|count/.test(h)) score += 18;
  if (/birim fiyat|unit price/.test(h)) score += 8;
  if (/fiyat|price/.test(h)) score += 10;

  if (/adet|miktar|quantity|count/.test(q) && /adet|miktar|quantity|count/.test(h)) score += 80;
  if (/birim fiyat|unit price/.test(q) && /birim fiyat|unit price/.test(h)) score += 90;

  return score;
}

function chooseValueHeader(table, userText = "", chartType = "bar") {
  const nums = numericHeaders(table);
  if (!nums.length) return null;
  const strict = strictValueHeader(table, userText);
  if (strict) return strict;
  const scored = nums.map((header, index) => ({
    header,
    score: scoreHeaderForQuery(header, userText, chartType) + (nums.length - index) * 0.01,
  })).sort((a, b) => b.score - a.score);
  return scored[0]?.header || nums[0];
}

function rowLabel(row = {}, key = "", index = 0) {
  return String(row?.[key] ?? `Satır ${index + 1}`).trim() || `Satır ${index + 1}`;
}

function rowTotalByHeaders(row = {}, headers = []) {
  let seen = false;
  const total = headers.reduce((sum, header) => {
    const value = numberFromCell(row?.[header]);
    if (value === null) return sum;
    seen = true;
    return sum + value;
  }, 0);
  return seen ? total : null;
}

function rowSeriesFromValueHeader(table = {}, labelKey = "", valueKey = "", limit = 30) {
  const rows = (table?.rows || []).slice(0, limit);
  const labels = [];
  const values = [];

  rows.forEach((row, index) => {
    const value = numberFromCell(row?.[valueKey]);
    if (value === null) return;
    labels.push(rowLabel(row, labelKey, index));
    values.push(value);
  });

  return labels.length ? { labels, values, label: valueKey } : null;
}

function rowSeriesFromTotalHeaders(table = {}, labelKey = "", headers = [], limit = 40, label = "Toplam") {
  const rows = (table?.rows || []).slice(0, limit);
  const labels = [];
  const values = [];

  rows.forEach((row, index) => {
    const total = rowTotalByHeaders(row, headers);
    if (total === null) return;
    labels.push(rowLabel(row, labelKey, index));
    values.push(total);
  });

  return labels.length ? { labels, values, label } : null;
}

function expenseHeaders(table) {
  const nums = numericHeaders(table);
  return nums.filter((header) => /gider|kira|fatura|market|ulasim|eglence|saglik|giyim|abonelik|harcama|masraf/i.test(normalizeHeader(header)));
}

function incomeHeaders(table) {
  const nums = numericHeaders(table);
  return nums.filter((header) => /gelir|maas|maaş|freelance|kazanc/i.test(normalizeHeader(header)));
}

function compactTitle(value = "Grafik") {
  return String(value || "Grafik").replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim().slice(0, 90) || "Grafik";
}


function styleFromUserText(userText = "") {
  const visual = detectVisualStyle(userText);
  const palette = detectColorPalette(userText);
  return {
    ...visual,
    palette: palette.name,
    colors: palette.requested ? palette.colors : (visual.colors || []),
    colorful: visual.colorful || palette.requested,
  };
}

function monthLikeHeaders(table) {
  const nums = numericHeaders(table);
  const monthPattern = /ocak|subat|şubat|mart|nisan|mayis|mayıs|haziran|temmuz|agustos|ağustos|eylul|eylül|ekim|kasim|kasım|aralik|aralık|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|ay\s*\d+/i;
  const matching = nums.filter((header) => monthPattern.test(normalizeHeader(header)) || monthPattern.test(String(header || "")));
  return matching.length >= 2 ? matching : [];
}

function columnTotalsByHeaders(table, headers = []) {
  const rows = table?.rows || [];
  return headers.map((header) => rows.reduce((sum, row) => sum + (numberFromCell(row?.[header]) ?? 0), 0));
}

function wantsColumnSummary(userText = "") {
  const q = normalizeToolIntentText(userText);
  if (/yonetici\s+ozeti|yönetici\s+özeti|executive\s+summary|kisa\s+ozet|kısa\s+özet/.test(q)) return false;
  return /kolon toplam|sutun toplam|sütun toplam|kolonlari|kolonları|sutunlari|sütunları|metrik|metrikleri|numeric kolon|sayisal kolon|sayısal kolon/.test(q)
    || /(metrik|kolon|sutun|sütun).*(karsilastir|karşılaştır)/.test(q);
}

function tableToColumnSummaryInput(table) {
  const nums = numericHeaders(table);
  if (nums.length < 2) return null;
  return {
    labels: nums,
    values: columnTotalsByHeaders(table, nums),
    label: "Kolon Toplamları",
  };
}

function tableToPieInput(table, userText = "") {
  const rows = (table?.rows || []).slice(0, 30);
  const headers = table?.headers || [];
  if (!headers.length || !rows.length) return null;
  const q = normalizeToolIntentText(userText);
  const labelKey = labelHeader(table);
  const monthHeaders = monthLikeHeaders(table);

  // 6x6 aylık masraf tablosu gibi: satırlar kategori, kolonlar ay ise pasta/trend için ay toplamlarını kullan.
  if (monthHeaders.length >= 2 && !/kategori|kalem|masraf kalemi|harcama kalemi/.test(q)) {
    return {
      labels: monthHeaders,
      values: columnTotalsByHeaders(table, monthHeaders),
      label: "Aylık Toplam",
    };
  }

  // Aylık gelir/gider tablosu gibi: ilk satır/ay üzerinden kategori dağılımı istenebilir.
  // "gider" denmişse gider sütunlarını kategori olarak topla. "gelir" denmişse gelir sütunlarını topla.
  if (wantsColumnSummary(userText)) {
    const columnSummary = tableToColumnSummaryInput(table);
    if (columnSummary) return columnSummary;
  }

  const exp = expenseHeaders(table);
  const inc = incomeHeaders(table);
  if (q.includes("gider") && exp.length >= 2) {
    const totals = exp.map((header) => ({ label: header, value: rows.reduce((sum, row) => sum + (numberFromCell(row?.[header]) ?? 0), 0) }));
    return { labels: totals.map((x) => x.label), values: totals.map((x) => x.value), label: "Gider Dağılımı" };
  }
  if (q.includes("gelir") && inc.length >= 1) {
    const totals = inc.map((header) => ({ label: header, value: rows.reduce((sum, row) => sum + (numberFromCell(row?.[header]) ?? 0), 0) }));
    return { labels: totals.map((x) => x.label), values: totals.map((x) => x.value), label: "Gelir Dağılımı" };
  }

  // Çok kolonlu finans tablosu: gider kolonları varsa pasta için gider dağılımı daha mantıklı.
  if (exp.length >= 2) {
    const totals = exp.map((header) => ({ label: header, value: rows.reduce((sum, row) => sum + (numberFromCell(row?.[header]) ?? 0), 0) }));
    return { labels: totals.map((x) => x.label), values: totals.map((x) => x.value), label: "Gider Dağılımı" };
  }

  const valueKey = chooseValueHeader(table, userText, "pie");
  if (!valueKey) return null;
  return rowSeriesFromValueHeader(table, labelKey, valueKey, 30);
}

function tableToLineInput(table, userText = "") {
  const rows = (table?.rows || []).slice(0, 40);
  const headers = table?.headers || [];
  if (!headers.length || !rows.length) return null;
  const labelKey = labelHeader(table);
  const q = normalizeToolIntentText(userText);
  const monthHeaders = monthLikeHeaders(table);

  if (monthHeaders.length >= 2) {
    return {
      labels: monthHeaders,
      values: columnTotalsByHeaders(table, monthHeaders),
      label: "Aylık Toplam",
    };
  }

  // "gider trendi" için giderleri satır bazında topla.
  if (wantsColumnSummary(userText)) {
    const columnSummary = tableToColumnSummaryInput(table);
    if (columnSummary) return columnSummary;
  }

  const exp = expenseHeaders(table);
  if (q.includes("gider") && exp.length >= 2) {
    return rowSeriesFromTotalHeaders(table, labelKey, exp, 40, "Toplam Gider");
  }

  // "gelir trendi" için gelirleri satır bazında topla.
  const inc = incomeHeaders(table);
  if (q.includes("gelir") && inc.length >= 1) {
    return rowSeriesFromTotalHeaders(table, labelKey, inc, 40, "Toplam Gelir");
  }

  const valueKey = chooseValueHeader(table, userText, "line");
  if (!valueKey) return null;
  return rowSeriesFromValueHeader(table, labelKey, valueKey, 40);
}

function tableToBarInput(table, userText = "") {
  const rows = (table?.rows || []).slice(0, 30);
  const headers = table?.headers || [];
  if (!headers.length || !rows.length) return null;
  const labelKey = labelHeader(table);
  const monthHeaders = monthLikeHeaders(table);
  if (monthHeaders.length >= 2 && !/kategori|kalem|masraf kalemi|harcama kalemi/.test(normalizeToolIntentText(userText))) {
    return {
      labels: monthHeaders,
      values: columnTotalsByHeaders(table, monthHeaders),
      label: "Aylık Toplam",
    };
  }
  if (wantsColumnSummary(userText)) {
    const columnSummary = tableToColumnSummaryInput(table);
    if (columnSummary) return columnSummary;
  }
  const valueKey = chooseValueHeader(table, userText, "bar");
  if (!valueKey) return null;
  return rowSeriesFromValueHeader(table, labelKey, valueKey, 30);
}

function tableToChartInput(table, userText = "") {
  if (!table?.headers?.length || !table?.rows?.length) return null;
  const chartType = detectChartType(userText);
  const style = styleFromUserText(userText);
  const picked = chartType === "pie" ? tableToPieInput(table, userText)
    : chartType === "line" ? tableToLineInput(table, userText)
    : tableToBarInput(table, userText);
  if (!picked?.labels?.length || !picked?.values?.length) return null;
  return {
    labels: picked.labels,
    values: picked.values,
    chartType,
    label: picked.label || "Veri",
    style,
  };
}

function chartToChartInput(chart = {}, userText = "") {
  const data = chart.data || chart.raw?.data || null;
  const labels = data?.labels || chart.labels || [];
  const values = data?.datasets?.[0]?.data || chart.values || [];
  if (!Array.isArray(labels) || !labels.length || !Array.isArray(values) || !values.length) return null;
  const text = normalizeToolIntentText(userText);
  const hasExplicitChartType = /pasta|pie|dilim|daire|yuvarlak|doughnut|donut|halka|cizgi|line|trend|zaman|aylik|gelisim|degisim|cubuk|bar|sutun|kolon|normal grafik|karsilastir/.test(text);
  const previousStyle = chart.style || chart.raw?.style || {};
  const previousColors = chart.colors || chart.palette || chart.raw?.colors || chart.raw?.palette || previousStyle.colors || [];
  const requestedStyle = styleFromUserText(userText);
  const mergedStyle = {
    ...previousStyle,
    ...requestedStyle,
    colors: Array.isArray(requestedStyle.colors) && requestedStyle.colors.length
      ? requestedStyle.colors
      : (Array.isArray(previousColors) ? previousColors : []),
    colorful: Boolean(requestedStyle.colorful || previousStyle.colorful || (Array.isArray(previousColors) && previousColors.length)),
  };
  return {
    labels,
    values,
    chartType: hasExplicitChartType ? detectChartType(userText) : (chart.chartType || chart.type || "bar"),
    label: data?.datasets?.[0]?.label || chart.label || chart.title || "Veri",
    title: chart.title || "Grafik",
    style: mergedStyle,
    colors: mergedStyle.colors,
  };
}

function cleanMermaidLabel(value = "") {
  return cleanSafeMermaidLabel(value);
}

function tableToMermaidCode(table, title = "LUCY Tablosu", userText = "") {
  if (!table?.headers?.length || !table?.rows?.length) return "";
  const chartInput = tableToChartInput(table, userText) || tableToBarInput(table, userText);
  if (!chartInput?.labels?.length) return "";
  const chartType = detectChartType(userText);
  if (chartType === "pie" && /mermaid|pasta|pie|yuvarlak|daire/i.test(normalizeToolIntentText(userText))) {
    return buildPieMermaid({ title, labels: chartInput.labels, values: chartInput.values });
  }
  return buildFlowchartFromPairs({ title, labels: chartInput.labels, values: chartInput.values, userText });
}

function chartToMermaidCode(chart = {}, title = "Grafik", userText = "") {
  const input = chartToChartInput(chart, userText);
  if (!input) return "";
  const chartType = detectChartType(userText) || input.chartType || "bar";
  if (chartType === "pie" && /mermaid|pasta|pie|yuvarlak|daire/i.test(normalizeToolIntentText(userText))) {
    return buildPieMermaid({ title: title || chart.title || "Dağılım", labels: input.labels, values: input.values });
  }
  return buildFlowchartFromPairs({ title: title || chart.title || "Grafik", labels: input.labels, values: input.values, userText });
}

function chartUiFromMemory(chart = {}, title = "Grafik") {
  const data = chart.data || chart.raw?.data || null;
  if (!data?.labels?.length) return null;
  return {
    type: "chart",
    tool: "chartData",
    title: chart.title || title || "Grafik",
    success: true,
    chartType: chart.chartType || chart.type || "bar",
    data,
    style: chart.style || {},
    colors: chart.colors || chart.palette || chart.style?.colors || [],
    raw: {
      success: true,
      chartType: chart.chartType || chart.type || "bar",
      title: chart.title || title || "Grafik",
      data,
      style: chart.style || {},
      colors: chart.colors || chart.palette || chart.style?.colors || [],
    },
  };
}

function mermaidUiFromMemory(mermaid = {}, title = "Mermaid diyagram") {
  const code = sanitizeMermaidCode(mermaid.code || mermaid.mermaid || "", mermaid.userText || mermaid.title || title || "");
  if (!String(code || "").trim()) return null;
  return {
    type: "mermaid",
    tool: "mermaid",
    title: mermaid.title || title || "Mermaid diyagram",
    success: true,
    code,
    raw: { success: true, type: "mermaid", code },
  };
}

module.exports = {
  numberFromCell,
  tableToChartInput,
  chartToChartInput,
  tableToMermaidCode,
  chartToMermaidCode,
  chartUiFromMemory,
  mermaidUiFromMemory,
};
