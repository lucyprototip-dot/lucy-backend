module.exports = {
  name: "chartData",
  description: "Grafik için etiket ve veri setini standart JSON formatına çevirir",

  async execute(input = {}) {
    const labels = Array.isArray(input.labels) ? input.labels : [];
    const values = Array.isArray(input.values) ? input.values : [];
    const chartType = input.chartType || "bar";

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
      data: {
        labels,
        datasets: [
          {
            label: input.label || "Veri",
            data: values,
          },
        ],
      },
    };
  },
};
