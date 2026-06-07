function envValue(name) {
  const value = process.env[name];
  if (value === undefined || value === null) return "";
  return String(value).trim().replace(/^[\'\"]|[\'\"]$/g, "");
}

function numberEnv(name, fallback) {
  const value = Number(envValue(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

module.exports = { envValue, numberEnv };
