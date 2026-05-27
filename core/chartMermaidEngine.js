const { detectChartType } = require("./intentNormalizer");

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

function tableToChartInput(table, userText = "") {
  if (!table?.headers?.length || !table?.rows?.length) return null;

  const headers = table.headers;
  const sampleRows = table.rows.slice(0, 20);

  let labelKey = headers.find((header) =>
    sampleRows.some((row) => String(row?.[header] ?? "").trim() && numberFromCell(row?.[header]) === null)
  ) || headers[0];

  let valueKey = headers.find((header) =>
    sampleRows.some((row) => numberFromCell(row?.[header]) !== null)
  );

  let values;
  if (valueKey) {
    values = sampleRows.map((row) => numberFromCell(row?.[valueKey]) ?? 0);
  } else {
    valueKey = "Adet";
    values = sampleRows.map(() => 1);
  }

  const labels = sampleRows.map((row, index) =>
    String(row?.[labelKey] ?? `Satır ${index + 1}`).trim() || `Satır ${index + 1}`
  );

  const chartType = detectChartType(userText);
  return { labels, values, chartType, label: valueKey || "Veri" };
}

function tableToMermaidCode(table, title = "LUCY Tablosu") {
  if (!table?.headers?.length || !table?.rows?.length) return "";

  const headers = table.headers;
  const labelKey = headers[0];
  const valueKey = headers.find((header) => table.rows.some((row) => numberFromCell(row?.[header]) !== null)) || headers[1] || headers[0];

  const cleanNode = (value = "") => String(value || "")
    .replace(/[\[\]{}()<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 52) || "Değer";

  const root = cleanNode(title);
  const lines = ["flowchart TD", `A["${root}"]`];
  table.rows.slice(0, 16).forEach((row, index) => {
    const label = cleanNode(row?.[labelKey] ?? `Satır ${index + 1}`);
    const value = cleanNode(row?.[valueKey] ?? "");
    lines.push(`A --> N${index + 1}["${label}${value ? `\\n${value}` : ""}"]`);
  });
  return lines.join("\n");
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
    raw: {
      success: true,
      chartType: chart.chartType || chart.type || "bar",
      title: chart.title || title || "Grafik",
      data,
    },
  };
}

function mermaidUiFromMemory(mermaid = {}, title = "Mermaid diyagram") {
  const code = mermaid.code || mermaid.mermaid || "";
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
  tableToMermaidCode,
  chartUiFromMemory,
  mermaidUiFromMemory,
};
