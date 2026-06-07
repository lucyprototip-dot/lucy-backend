const DEEPSEEK_MODEL_FAST = process.env.DEEPSEEK_MODEL_FAST || "deepseek-chat";
const DEEPSEEK_MODEL_THINKING = process.env.DEEPSEEK_MODEL_THINKING || "deepseek-reasoner";
const DEEPSEEK_MODEL_PRO = process.env.DEEPSEEK_MODEL_PRO || "deepseek-chat";
const DEEPSEEK_MODEL_PRO_THINKING = process.env.DEEPSEEK_MODEL_PRO_THINKING || DEEPSEEK_MODEL_THINKING;

const MODE_TO_DEEPSEEK_MODEL = {
  fast: DEEPSEEK_MODEL_FAST,
  hızlı: DEEPSEEK_MODEL_FAST,
  hizli: DEEPSEEK_MODEL_FAST,
  chat: DEEPSEEK_MODEL_FAST,
  web: DEEPSEEK_MODEL_FAST,
  think: DEEPSEEK_MODEL_THINKING,
  thinking: DEEPSEEK_MODEL_THINKING,
  reasoning: DEEPSEEK_MODEL_THINKING,
  düşün: DEEPSEEK_MODEL_THINKING,
  dusun: DEEPSEEK_MODEL_THINKING,
  düşünme: DEEPSEEK_MODEL_THINKING,
  dusunme: DEEPSEEK_MODEL_THINKING,
  pro_fast: DEEPSEEK_MODEL_PRO,
  pro_hizli: DEEPSEEK_MODEL_PRO,
  pro_hızlı: DEEPSEEK_MODEL_PRO,
  "pro-hizli": DEEPSEEK_MODEL_PRO,
  "pro-hızlı": DEEPSEEK_MODEL_PRO,
  "pro hızlı": DEEPSEEK_MODEL_PRO,
  "pro hizli": DEEPSEEK_MODEL_PRO,
  pro_think: DEEPSEEK_MODEL_PRO_THINKING,
  pro_thinking: DEEPSEEK_MODEL_PRO_THINKING,
  pro_dusun: DEEPSEEK_MODEL_PRO_THINKING,
  pro_düşün: DEEPSEEK_MODEL_PRO_THINKING,
  pro_dusunme: DEEPSEEK_MODEL_PRO_THINKING,
  pro_düşünme: DEEPSEEK_MODEL_PRO_THINKING,
  "pro-dusun": DEEPSEEK_MODEL_PRO_THINKING,
  "pro-düşün": DEEPSEEK_MODEL_PRO_THINKING,
  "pro-dusunme": DEEPSEEK_MODEL_PRO_THINKING,
  "pro-düşünme": DEEPSEEK_MODEL_PRO_THINKING,
  "pro düşün": DEEPSEEK_MODEL_PRO_THINKING,
  "pro dusun": DEEPSEEK_MODEL_PRO_THINKING,
  "pro düşünme": DEEPSEEK_MODEL_PRO_THINKING,
  "pro dusunme": DEEPSEEK_MODEL_PRO_THINKING,
};

const THINKING_MODE_IDS = new Set([
  "think", "thinking", "reasoning", "düşün", "dusun", "düşünme", "dusunme",
  "pro_think", "pro_thinking", "pro_dusun", "pro_düşün", "pro_dusunme", "pro_düşünme",
  "pro-dusun", "pro-düşün", "pro-dusunme", "pro-düşünme", "pro düşün", "pro dusun", "pro düşünme", "pro dusunme",
]);

function pickDeepSeekModel({ mode, modeId, apiMode, model, routerModel } = {}) {
  const explicitModel = String(model || routerModel || "").trim();
  const explicitLower = explicitModel.toLowerCase();
  if (explicitLower.includes("deepseek-reasoner")) return DEEPSEEK_MODEL_THINKING;
  if (explicitLower.includes("deepseek-chat")) return DEEPSEEK_MODEL_FAST;
  if (explicitLower.includes("deepseek-v4-pro")) return DEEPSEEK_MODEL_PRO;
  if (explicitLower.includes("deepseek-v4-flash")) return DEEPSEEK_MODEL_FAST;
  const raw = String(apiMode || mode || modeId || "").toLowerCase();
  return MODE_TO_DEEPSEEK_MODEL[raw] || DEEPSEEK_MODEL_FAST;
}

function wantsDeepSeekThinking(body = {}) {
  const raw = String(body.apiMode || body.mode || body.modeId || "").toLowerCase();
  const model = pickDeepSeekModel(body);
  return body.thinking === true || body.thinking === "true" || THINKING_MODE_IDS.has(raw) || model === DEEPSEEK_MODEL_THINKING || model === DEEPSEEK_MODEL_PRO_THINKING;
}

function modelList() {
  return [
    { id: "fast", label: "Hızlı", model: DEEPSEEK_MODEL_FAST, thinking: false },
    { id: "think", label: "Düşün", model: DEEPSEEK_MODEL_THINKING, thinking: true },
    { id: "pro_fast", label: "Pro Hızlı", model: DEEPSEEK_MODEL_PRO, thinking: false },
    { id: "pro_think", label: "Pro Düşün", model: DEEPSEEK_MODEL_PRO_THINKING, thinking: true },
  ];
}

module.exports = {
  DEEPSEEK_MODEL_FAST,
  DEEPSEEK_MODEL_THINKING,
  DEEPSEEK_MODEL_PRO,
  DEEPSEEK_MODEL_PRO_THINKING,
  pickDeepSeekModel,
  wantsDeepSeekThinking,
  modelList,
};
