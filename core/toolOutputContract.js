// LUCY Tool Output Contract Guard
// Amaç: Tool çıktılarının UI tarafına tek ve güvenli formatta gitmesini sağlamak.
// PDF / SRC / Lucy Exporter'a dokunmaz.

function asBool(value, fallback = true) {
  if (value === undefined || value === null) return fallback;
  return value !== false;
}

function asText(value = "") {
  return String(value ?? "").trim();
}

function uniqueArray(values = []) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    const key = String(value ?? "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function normalizeColors(result = {}, input = {}) {
  const style = result.style && typeof result.style === "object" ? result.style : {};
  const inputStyle = input.style && typeof input.style === "object" ? input.style : {};
  const candidates = [
    result.colors,
    result.palette,
    style.colors,
    input.colors,
    input.palette,
    inputStyle.colors,
  ].find((x) => Array.isArray(x) && x.length);
  return Array.isArray(candidates) ? uniqueArray(candidates) : [];
}

function normalizeChartData(result = {}, input = {}) {
  const data = result.data || result.chartData || input.data || null;
  const labels = Array.isArray(data?.labels) ? data.labels : Array.isArray(result.labels) ? result.labels : Array.isArray(input.labels) ? input.labels : [];
  const values = Array.isArray(data?.datasets?.[0]?.data) ? data.datasets[0].data : Array.isArray(result.values) ? result.values : Array.isArray(input.values) ? input.values : [];
  const numericValues = values.map((value) => Number(value) || 0);
  const colors = normalizeColors(result, input);
  const chartType = result.chartType || input.chartType || result.type || input.type || "bar";
  const label = result.label || input.label || data?.datasets?.[0]?.label || "Veri";
  const style = {
    ...(input.style && typeof input.style === "object" ? input.style : {}),
    ...(result.style && typeof result.style === "object" ? result.style : {}),
  };
  if (colors.length) {
    style.colors = colors;
    style.colorful = true;
  }
  return {
    success: asBool(result.success, true),
    type: "chart",
    tool: "chartData",
    title: result.title || input.title || label || "Grafik",
    chartType,
    data: {
      labels,
      datasets: [{
        label,
        data: numericValues,
        ...(colors.length ? { backgroundColor: colors, borderColor: colors } : {}),
      }],
    },
    style,
    colors,
    palette: result.paletteName || result.palette || style.palette || (colors.length ? "colorful" : "default"),
    text: result.text || result.message || "",
    error: result.error,
  };
}

function stripMermaidFence(code = "") {
  return String(code || "")
    .replace(/^```mermaid\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function normalizeMermaid(result = {}, input = {}) {
  const code = stripMermaidFence(result.code || result.mermaid || input.code || input.mermaid || input.text || "");
  return {
    success: asBool(result.success, Boolean(code)),
    type: "mermaid",
    tool: "mermaid",
    title: result.title || input.title || "Mermaid diyagram",
    code,
    text: result.text || result.message || "",
    error: result.error,
  };
}

function normalizeFile(result = {}, input = {}, toolName = "tool") {
  const url = result.downloadUrl || result.url || "";
  return {
    success: asBool(result.success, Boolean(url || result.filename || result.storedFilename)),
    type: "file",
    tool: toolName,
    title: result.title || input.title || input.filename || `${toolName} sonucu`,
    url,
    downloadUrl: url,
    filename: result.filename || result.downloadName || result.storedFilename || input.filename || "",
    storedFilename: result.storedFilename || "",
    mimeType: result.mimeType || result.contentType || "",
    text: result.text || result.message || "",
    error: result.error,
  };
}


function normalizeCalculator(result = {}, input = {}) {
  const expression = asText(result.expression || input.expression || "");
  const rawResult = result.result !== undefined ? result.result : (result.value !== undefined ? result.value : "");
  const ok = asBool(result.success, rawResult !== "" && rawResult !== undefined && rawResult !== null);
  const text = ok
    ? `${expression ? `${expression} = ` : ""}${String(rawResult)}`.trim()
    : asText(result.message || result.error || "Hesaplama başarısız oldu.");
  return {
    success: ok,
    type: "calculation",
    tool: "calculator",
    title: result.title || input.title || "calculator sonucu",
    expression,
    result: rawResult,
    text,
    error: result.error,
  };
}

function normalizeToolOutput(toolName = "tool", result = {}, input = {}) {
  const tool = String(toolName || result.tool || "tool");
  const lower = tool.toLowerCase();
  const value = result && typeof result === "object" ? result : { value: result, text: String(result ?? "") };

  if (lower === "calculator") {
    return normalizeCalculator(value, input);
  }

  if (lower === "chartdata" || value.chartType || value.data?.labels || input.chartType) {
    return normalizeChartData(value, input);
  }
  if (lower === "mermaid" || value.type === "mermaid" || value.code || value.mermaid || input.code || input.mermaid) {
    return normalizeMermaid(value, input);
  }
  if (value.downloadUrl || value.url || value.storedFilename || value.filename || value.base64) {
    return normalizeFile(value, input, tool);
  }

  return {
    success: asBool(value.success, true),
    type: value.type || lower || "tool",
    tool,
    title: value.title || input.title || `${tool} sonucu`,
    text: value.text || value.message || value.value || "",
    error: value.error,
  };
}

module.exports = {
  normalizeToolOutput,
  normalizeChartData,
  normalizeMermaid,
  normalizeFile,
  normalizeCalculator,
  stripMermaidFence,
};
