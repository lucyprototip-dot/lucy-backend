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

function escapeXml(value = "") {
  return String(value || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

const PALETTE = ["#2563eb", "#16a34a", "#f97316", "#9333ea", "#dc2626", "#0891b2", "#ca8a04", "#475569", "#db2777", "#65a30d"];

function polarToCartesian(cx, cy, r, angleDeg) {
  const angleRad = (angleDeg - 90) * Math.PI / 180;
  return { x: cx + (r * Math.cos(angleRad)), y: cy + (r * Math.sin(angleRad)) };
}

function piePath(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return [`M ${cx} ${cy}`, `L ${start.x.toFixed(2)} ${start.y.toFixed(2)}`, `A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`, "Z"].join(" ");
}

function buildChartSvg({ labels = [], values = [], chartType = "bar", title = "Grafik" } = {}) {
  const rows = labels.map((label, index) => ({ label: String(label || `Veri ${index + 1}`), value: Number(values[index]) || 0 })).slice(0, 12);
  const type = String(chartType || "bar").toLowerCase();
  if (!rows.length) return "";

  if (type.includes("pie") || type.includes("pasta")) {
    const total = rows.reduce((sum, row) => sum + Math.max(0, row.value), 0) || 1;
    let cursor = 0;
    const slices = rows.map((row, index) => {
      const angle = (Math.max(0, row.value) / total) * 360;
      const path = piePath(150, 160, 105, cursor, cursor + angle);
      cursor += angle;
      return `<path d="${path}" fill="${PALETTE[index % PALETTE.length]}" stroke="#ffffff" stroke-width="3"/>`;
    }).join("");
    const legend = rows.map((row, index) => `<rect x="330" y="${70 + index * 28}" width="14" height="14" rx="3" fill="${PALETTE[index % PALETTE.length]}"/><text x="354" y="${82 + index * 28}" font-size="16" font-weight="700" fill="#0f172a">${escapeXml(row.label)}: ${escapeXml(String(row.value))}</text>`).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="360" viewBox="0 0 760 360"><rect width="760" height="360" rx="18" fill="#f8fafc"/><text x="28" y="36" font-size="22" font-weight="900" fill="#111827">${escapeXml(title)}</text>${slices}<circle cx="150" cy="160" r="45" fill="#fff" opacity=".95"/>${legend}</svg>`;
  }

  const width = 760;
  const height = 360;
  const pad = { left: 130, right: 34, top: 64, bottom: 36 };
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  const barH = Math.min(26, Math.max(16, (height - pad.top - pad.bottom) / rows.length - 8));
  const gap = ((height - pad.top - pad.bottom) - rows.length * barH) / Math.max(1, rows.length - 1);
  const bars = rows.map((row, index) => {
    const y = pad.top + index * (barH + gap);
    const w = Math.max(4, Math.round((Math.abs(row.value) / max) * (width - pad.left - pad.right)));
    return `<text x="24" y="${y + barH * .68}" font-size="15" font-weight="700" fill="#334155">${escapeXml(row.label.slice(0, 18))}</text><rect x="${pad.left}" y="${y}" width="${width - pad.left - pad.right}" height="${barH}" rx="9" fill="#e2e8f0"/><rect x="${pad.left}" y="${y}" width="${w}" height="${barH}" rx="9" fill="${PALETTE[index % PALETTE.length]}"/><text x="${pad.left + w + 10}" y="${y + barH * .68}" font-size="15" font-weight="900" fill="#0f172a">${escapeXml(String(row.value))}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="360" viewBox="0 0 760 360"><rect width="760" height="360" rx="18" fill="#f8fafc"/><text x="28" y="36" font-size="22" font-weight="900" fill="#111827">${escapeXml(title)}</text>${bars}</svg>`;
}

module.exports = {
  name: "chartData",
  description: "Grafik için etiket/veri setini standart JSON formatına çevirir ve PDF/önizleme için SVG üretir",

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
      const labelKey = headers.find((header) => input.rows.some((row) => String(row?.[header] ?? "").trim() && numberFromCell(row?.[header]) === null)) || headers[0];
      const valueKey = headers.find((header) => input.rows.some((row) => numberFromCell(row?.[header]) !== null));
      labels = input.rows.slice(0, 20).map((row, index) => String(row?.[labelKey] ?? `Satır ${index + 1}`));
      values = input.rows.slice(0, 20).map((row) => valueKey ? numberFromCell(row?.[valueKey]) ?? 0 : 1);
    }

    values = values.map((value) => numberFromCell(value) ?? 0);

    if (!labels.length || !values.length || labels.length !== values.length) {
      return {
        success: false,
        error: "invalid_chart_data",
        message: "labels ve values dolu olmalı ve aynı uzunlukta olmalı.",
      };
    }

    const title = input.title || input.label || "Grafik";
    const data = {
      labels,
      datasets: [
        {
          label: input.label || "Veri",
          data: values,
        },
      ],
    };

    return {
      success: true,
      type: "chart",
      tool: "chartData",
      chartType,
      title,
      data,
      svg: buildChartSvg({ labels, values, chartType, title }),
      message: "Grafik verisi ve SVG önizleme hazırlandı.",
    };
  },
};
