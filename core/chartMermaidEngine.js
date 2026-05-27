const { detectChartType, detectVisualStyle, detectColorPalette, normalizeToolIntentText } = require("./intentNormalizer");
const { cleanLabel: cleanSafeMermaidLabel, sanitizeMermaidCode, buildFlowchartFromPairs, buildPieMermaid } = require("./safeMermaidBuilder");

function numberFromCell(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const clean = String(value ?? "")
    .replace(/[%₺$€£]/g, "")
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(/,/g, ".");
  const num = Number(clean);
  return Number.isFinite(num) ? num : null;
}

function normalizeHeader(header = "") {
  return normalizeToolIntentText(header).replace(/[^a-z0-9]+/g, " ").trim();
}

function isNumericColumn(rows = [], header = "") {
  return rows.some((row) => numberFromCell(row?.[header]) !== null);
}

function numericHeaders(table) {
  const rows = table?.rows || [];
  return (table?.headers || []).filter((header) => isNumericColumn(rows, header));
}

function labelHeader(table) {
  const rows = table?.rows || [];
  const headers = table?.headers || [];
  return headers.find((header) => rows.some((row) => String(row?.[header] ?? "").trim() && numberFromCell(row?.[header]) === null)) || headers[0];
}

function scoreHeaderForQuery(header = "", userText = "", chartType = "bar") {
  const h = normalizeHeader(header);
  const q = normalizeToolIntentText(userText);
  let score = 0;

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

  return score;
}

function chooseValueHeader(table, userText = "", chartType = "bar") {
  const nums = numericHeaders(table);
  if (!nums.length) return null;
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
  return headers.reduce((sum, header) => sum + (numberFromCell(row?.[header]) ?? 0), 0);
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
  return matching.length >= 2 ? matching : (nums.length >= 3 ? nums : []);
}

function columnTotalsByHeaders(table, headers = []) {
  const rows = table?.rows || [];
  return headers.map((header) => rows.reduce((sum, row) => sum + (numberFromCell(row?.[header]) ?? 0), 0));
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
  return {
    labels: rows.map((row, index) => rowLabel(row, labelKey, index)),
    values: rows.map((row) => numberFromCell(row?.[valueKey]) ?? 0),
    label: valueKey,
  };
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
  const exp = expenseHeaders(table);
  if (q.includes("gider") && exp.length >= 2) {
    return {
      labels: rows.map((row, index) => rowLabel(row, labelKey, index)),
      values: rows.map((row) => rowTotalByHeaders(row, exp)),
      label: "Toplam Gider",
    };
  }

  // "gelir trendi" için gelirleri satır bazında topla.
  const inc = incomeHeaders(table);
  if (q.includes("gelir") && inc.length >= 1) {
    return {
      labels: rows.map((row, index) => rowLabel(row, labelKey, index)),
      values: rows.map((row) => rowTotalByHeaders(row, inc)),
      label: "Toplam Gelir",
    };
  }

  const valueKey = chooseValueHeader(table, userText, "line");
  if (!valueKey) return null;
  return {
    labels: rows.map((row, index) => rowLabel(row, labelKey, index)),
    values: rows.map((row) => numberFromCell(row?.[valueKey]) ?? 0),
    label: valueKey,
  };
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
  const valueKey = chooseValueHeader(table, userText, "bar");
  if (!valueKey) return null;
  return {
    labels: rows.map((row, index) => rowLabel(row, labelKey, index)),
    values: rows.map((row) => numberFromCell(row?.[valueKey]) ?? 0),
    label: valueKey,
  };
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
  return {
    labels,
    values,
    chartType: hasExplicitChartType ? detectChartType(userText) : (chart.chartType || chart.type || "bar"),
    label: data?.datasets?.[0]?.label || chart.label || chart.title || "Veri",
    title: chart.title || "Grafik",
    style: styleFromUserText(userText),
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
