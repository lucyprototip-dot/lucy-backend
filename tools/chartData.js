const { renderChartSvg } = require('../core/render/pdfRenderEngine');

function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const normalized = raw.replace(/[^0-9,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

module.exports = {
  name: 'chartData',
  description: 'Grafik verisini standart JSON formatına çevirir ve PDF uyumlu SVG render üretir',

  async execute(input = {}) {
    let labels = Array.isArray(input.labels) ? input.labels : [];
    let values = Array.isArray(input.values) ? input.values : [];
    const chartType = input.chartType || input.type || 'bar';

    if ((!labels.length || !values.length) && input.data?.labels && input.data?.datasets?.[0]?.data) {
      labels = Array.isArray(input.data.labels) ? input.data.labels : [];
      values = Array.isArray(input.data.datasets[0].data) ? input.data.datasets[0].data : [];
    }

    if ((!labels.length || !values.length) && Array.isArray(input.rows) && input.rows.length) {
      const headers = Array.isArray(input.headers) && input.headers.length
        ? input.headers
        : Object.keys(input.rows.find((row) => row && typeof row === 'object') || {});
      const labelKey = headers[0];
      const valueKey = headers.find((header) => input.rows.some((row) => String(row?.[header] ?? '').trim() !== '' && Number.isFinite(parseNumber(row?.[header])))) || headers[1];
      labels = input.rows.slice(0, 24).map((row, index) => String(row?.[labelKey] ?? `Satır ${index + 1}`));
      values = input.rows.slice(0, 24).map((row) => valueKey ? parseNumber(row?.[valueKey]) : 1);
    }

    if (!labels.length || !values.length || labels.length !== values.length) {
      return {
        success: false,
        error: 'invalid_chart_data',
        message: 'labels ve values dolu olmalı ve aynı uzunlukta olmalı.',
      };
    }

    const result = {
      success: true,
      type: 'chart',
      tool: 'chartData',
      chartType,
      title: input.title || input.label || 'Grafik',
      data: {
        labels,
        datasets: [
          {
            label: input.label || 'Veri',
            data: values.map(parseNumber),
          },
        ],
      },
    };

    result.svg = renderChartSvg(result);
    result.message = 'Grafik verisi hazırlandı.';
    return result;
  },
};
