const DEFAULT_PALETTE = [
  "#facc15", "#1d4ed8", "#ffffff", "#ec4899", "#22c55e",
  "#f97316", "#8b5cf6", "#06b6d4", "#ef4444", "#84cc16",
];

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
      const valueKey = headers.find((header) => input.rows.some((row) => {
        const num = Number(String(row?.[header] ?? "").replace(/[%₺$€£]/g, "").replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(/,/g, "."));
        return Number.isFinite(num);
      }));
      labels = input.rows.slice(0, 30).map((row, index) => String(row?.[labelKey] ?? `Satır ${index + 1}`));
      values = input.rows.slice(0, 30).map((row) => {
        const num = Number(String(row?.[valueKey] ?? 0).replace(/[%₺$€£]/g, "").replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(/,/g, "."));
        return Number.isFinite(num) ? num : 0;
      });
    }

    const numericValues = values.map((value) => Number(value) || 0);
    if (!labels.length || !numericValues.length || labels.length !== numericValues.length) {
      return {
        success: false,
        error: "invalid_chart_data",
        message: "labels ve values dolu olmalı ve aynı uzunlukta olmalı.",
      };
    }

    const colors = paletteFor(input, labels.length);
    const title = input.title || input.label || (chartType === "pie" ? "Pasta Grafiği" : chartType === "line" ? "Trend Grafiği" : "Grafik");

    return {
      success: true,
      chartType,
      style: { ...style, colorful: style.colorful || chartType === "pie" || Boolean(input.colorful) },
      colors,
      palette: colors,
      title,
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
