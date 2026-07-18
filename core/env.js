require("dotenv").config();

function env(name, fallback = "") {
  const value = process.env[name];
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  return String(value).trim().replace(/^["']|["']$/g, "");
}

function envNumber(name, fallback) {
  const value = Number(env(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

module.exports = { env, envNumber };
