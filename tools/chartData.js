const DEFAULT_PALETTE = [
  "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#14b8a6",
];

function cleanNumber(value) {
  const raw = String(value ?? "")
    .replace(/[%₺$€£]/g, "")
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(/,/g, ".");
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
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
      const labelKey = headers[0];
      const valueKey = headers.find((header) => input.rows.some((row) => Number.isFinite(cleanNumber(row?.[header]))));
      labels = input.rows.slice(0, 30).map((row, index) => String(row?.[labelKey] ?? `Satır ${index + 1}`));
      values = input.rows.slice(0, 30).map((row) => cleanNumber(row?.[valueKey]));
    }

    const numericValues = values.map((value) => cleanNumber(value));
    if (!labels.length || !numericValues.length || labels.length !== numericValues.length) {
      return {
        success: false,
        error: "invalid_chart_data",
        message: "labels ve values dolu olmalı ve aynı uzunlukta olmalı.",
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
