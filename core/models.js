const DEEPSEEK_MODEL_FAST = process.env.DEEPSEEK_MODEL_FAST || "deepseek-v4-flash";
const DEEPSEEK_MODEL_THINKING = process.env.DEEPSEEK_MODEL_THINKING || "deepseek-v4-flash";
const DEEPSEEK_MODEL_PRO = process.env.DEEPSEEK_MODEL_PRO || "deepseek-v4-pro";

const MODE_TO_DEEPSEEK_MODEL = {
  fast: DEEPSEEK_MODEL_FAST,
  hızlı: DEEPSEEK_MODEL_FAST,
  hizli: DEEPSEEK_MODEL_FAST,
  chat: DEEPSEEK_MODEL_FAST,
  web: DEEPSEEK_MODEL_FAST,
  think: DEEPSEEK_MODEL_THINKING,
  reasoning: DEEPSEEK_MODEL_THINKING,
  düşün: DEEPSEEK_MODEL_THINKING,
  dusun: DEEPSEEK_MODEL_THINKING,
  düşünme: DEEPSEEK_MODEL_THINKING,
  pro_fast: DEEPSEEK_MODEL_PRO,
  pro_hizli: DEEPSEEK_MODEL_PRO,
  pro_hızlı: DEEPSEEK_MODEL_PRO,
  "pro-hizli": DEEPSEEK_MODEL_PRO,
  "pro-hızlı": DEEPSEEK_MODEL_PRO,
  "pro hızlı": DEEPSEEK_MODEL_PRO,
  "pro hizli": DEEPSEEK_MODEL_PRO,
  pro_think: DEEPSEEK_MODEL_PRO,
  pro_dusun: DEEPSEEK_MODEL_PRO,
  pro_düşün: DEEPSEEK_MODEL_PRO,
  "pro-dusun": DEEPSEEK_MODEL_PRO,
  "pro-düşün": DEEPSEEK_MODEL_PRO,
  "pro düşün": DEEPSEEK_MODEL_PRO,
  "pro dusun": DEEPSEEK_MODEL_PRO,
};

const THINKING_MODE_IDS = new Set([
  "think", "reasoning", "düşün", "dusun", "düşünme",
  "pro_think", "pro_dusun", "pro_düşün", "pro-dusun", "pro-düşün", "pro düşün", "pro dusun",
]);

function pickDeepSeekModel({ mode, modeId, apiMode, model, routerModel } = {}) {
  const explicitModel = String(model || routerModel || "").trim();
  const explicitLower = explicitModel.toLowerCase();
  if (explicitLower.includes("deepseek-v4-pro")) return DEEPSEEK_MODEL_PRO;
  if (explicitLower.includes("deepseek-v4-flash")) return DEEPSEEK_MODEL_FAST;
  if (explicitLower.includes("deepseek-reasoner")) return DEEPSEEK_MODEL_THINKING;
  if (explicitLower.includes("deepseek-chat")) return DEEPSEEK_MODEL_FAST;
  const raw = String(apiMode || mode || modeId || "").toLowerCase();
  return MODE_TO_DEEPSEEK_MODEL[raw] || DEEPSEEK_MODEL_FAST;
}

function wantsDeepSeekThinking(body = {}) {
  const raw = String(body.apiMode || body.mode || body.modeId || "").toLowerCase();
  return body.thinking === true || body.thinking === "true" || THINKING_MODE_IDS.has(raw);
}

function modelList() {
  return [
    { id: "fast", label: "Hızlı", model: DEEPSEEK_MODEL_FAST, thinking: false },
    { id: "think", label: "Düşün", model: DEEPSEEK_MODEL_THINKING, thinking: true },
    { id: "pro_fast", label: "Pro Hızlı", model: DEEPSEEK_MODEL_PRO, thinking: false },
    { id: "pro_think", label: "Pro Düşün", model: DEEPSEEK_MODEL_PRO, thinking: true },
  ];
}

module.exports = {
  DEEPSEEK_MODEL_FAST,
  DEEPSEEK_MODEL_THINKING,
  DEEPSEEK_MODEL_PRO,
  pickDeepSeekModel,
  wantsDeepSeekThinking,
  modelList,
};
