const { env } = require("./env");

const FAST_MODEL = env("DEEPSEEK_MODEL_FAST", "deepseek-v4-flash");
const PRO_MODEL = env("DEEPSEEK_MODEL_PRO", "deepseek-v4-pro");

const MODES = Object.freeze({
  fast: { id: "fast", label: "Hızlı", model: FAST_MODEL, thinking: false, defaultMaxTokens: 1024 },
  think: { id: "think", label: "Düşün", model: FAST_MODEL, thinking: true, reasoningEffort: "high", defaultMaxTokens: 2048 },
  pro_fast: { id: "pro_fast", label: "Pro Hızlı", model: PRO_MODEL, thinking: false, defaultMaxTokens: 2048 },
  pro_think: { id: "pro_think", label: "Pro Düşün", model: PRO_MODEL, thinking: true, reasoningEffort: "max", defaultMaxTokens: 4096 }
});

const ALIASES = Object.freeze({
  "hızlı": "fast", hizli: "fast", chat: "fast",
  "düşün": "think", dusun: "think", thinking: "think", reasoning: "think",
  pro: "pro_fast", "pro hızlı": "pro_fast", "pro hizli": "pro_fast",
  "pro düşün": "pro_think", "pro dusun": "pro_think"
});

function resolveMode(body = {}) {
  const raw = String(body.apiMode || body.mode || body.modeId || "fast").trim().toLowerCase();
  return MODES[ALIASES[raw] || raw] || MODES.fast;
}

function publicModelList() {
  return Object.values(MODES).map(({ id, label, model, thinking }) => ({ id, label, model, thinking }));
}

module.exports = { MODES, resolveMode, publicModelList };
