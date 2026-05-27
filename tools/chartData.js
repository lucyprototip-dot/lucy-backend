module.exports = {
  name: "chartData",
  description: "Grafik için etiket ve veri setini standart JSON formatına çevirir",

  async execute(input = {}) {
    let labels = Array.isArray(input.labels) ? input.labels : [];
    let values = Array.isArray(input.values) ? input.values : [];
    const chartType = input.chartType || "bar";

    if ((!labels.length || !values.length) && input.data?.labels && input.data?.datasets?.[0]?.data) {
      labels = Array.isArray(input.data.labels) ? input.data.labels : [];
      values = Array.isArray(input.data.datasets[0].data) ? input.data.datasets[0].data : [];
    }

    if ((!labels.length || !values.length) && Array.isArray(input.rows) && input.rows.length) {
      const headers = Array.isArray(input.headers) && input.headers.length
        ? input.headers
        : Object.keys(input.rows.find((row) => row && typeof row === "object") || {});
      const labelKey = headers[0];
      const valueKey = headers.find((header) => input.rows.some((row) => Number(String(row?.[header] ?? "").replace(/\./g, "").replace(/,/g, ".")) || Number(String(row?.[header] ?? "").replace(/\./g, "").replace(/,/g, ".")) === 0));
      labels = input.rows.slice(0, 20).map((row, index) => String(row?.[labelKey] ?? `Satır ${index + 1}`));
      values = input.rows.slice(0, 20).map((row) => valueKey ? Number(String(row?.[valueKey] ?? 0).replace(/\./g, "").replace(/,/g, ".")) || 0 : 1);
    }

    if (!labels.length || !values.length || labels.length !== values.length) {
      return {
        success: false,
        error: "invalid_chart_data",
        message: "labels ve values dolu olmalı ve aynı uzunlukta olmalı.",
      };
    }

    return {
      success: true,
      chartType,
      title: input.title || input.label || "Grafik",
      data: {
        labels,
        datasets: [
          {
            label: input.label || "Veri",
            data: values.map((value) => Number(value) || 0),
          },
        ],
      },
    };
  },
};
