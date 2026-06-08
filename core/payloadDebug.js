const crypto = require("crypto");
const { normalizeMessages, getLastUserText, normalizeText } = require("../utils/text");

const DEBUG_PREFIX = "[LUCY_PROMPT_PAYLOAD_DEBUG]";

function isPromptDebugEnabled() {
  const value = String(process.env.LUCY_DEBUG_PROMPT || process.env.LUCY_DEBUG_PROMPT_PAYLOAD || "").toLowerCase();
  return value === "1" || value === "true";
}

function sha256(value = "") {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function safePreview(value = "", max = 80) {
  return normalizeText(value).replace(/\s+/g, " ").slice(0, max);
}

function hasMemory(body = {}) {
  return Boolean(
    normalizeText(body.memory?.global || body.globalMemory || "") ||
    normalizeText(body.memory?.project || body.activeProject?.memory || body.projectMemory || "")
  );
}

function incomingSystemMessageCount(messages = []) {
  return normalizeMessages(messages).filter((message) => message.role === "system").length;
}

function buildDebugMetadata({
  body = {},
  payload = null,
  route = "",
  provider = "",
  stream = false,
  model = null,
  event = "route",
  extra = {},
} = {}) {
  const payloadMessages = Array.isArray(payload?.messages) ? payload.messages : [];
  const bodyMessages = normalizeMessages(body.messages);
  const firstPayloadMessage = payloadMessages[0] || null;
  const systemPromptFirst = firstPayloadMessage?.role === "system";
  const systemPromptHash = systemPromptFirst ? sha256(firstPayloadMessage.content || "") : null;
  const routeDebug = body._lucyRouteDebug || {};
  const activeGptPromptPresent = Boolean(normalizeText(body.activeGpt?.prompt || ""));
  const systemHintPresent = Boolean(normalizeText(body.systemHint || ""));
  const memoryPresent = hasMemory(body);
  const frontendSystemMessages = incomingSystemMessageCount(body.messages);
  const frontendExtraInstructionPresent = Boolean(
    activeGptPromptPresent ||
    memoryPresent ||
    frontendSystemMessages > 0 ||
    routeDebug.frontendSystemHintPresent
  );

  return {
    event,
    route: route || routeDebug.route || "unknown",
    provider: provider || routeDebug.provider || "unknown",
    mode: body.apiMode || body.mode || body.modeId || null,
    model,
    webSearch: body.webSearch === true,
    messagesCount: payloadMessages.length || bodyMessages.length,
    messages0Role: firstPayloadMessage?.role || null,
    systemPromptHash,
    systemPromptFirst,
    activeGptPromptPresent,
    systemHintPresent,
    memoryPresent,
    frontendExtraInstructionPresent,
    frontendSystemMessages,
    webFinalPromptAddons: Boolean(routeDebug.webFinalPromptAddons || payloadMessages.some((message) => String(message.content || "").includes("WEB_CONTEXT"))),
    sourceFollowupRoute: routeDebug.sourceFollowupRoute === true,
    noSourceGuardRoute: routeDebug.noSourceGuardRoute === true,
    webOffGuardRoute: routeDebug.webOffGuardRoute === true,
    stream: stream === true,
    promptPayloadSent: Boolean(payload),
    lastUserPreview: safePreview(getLastUserText(body.messages)),
    ...extra,
  };
}

function logPromptDebug(metadata = {}) {
  if (!isPromptDebugEnabled()) return;
  try {
    console.log(DEBUG_PREFIX, JSON.stringify(metadata));
  } catch {}
}

function logRouteDebug(options = {}) {
  logPromptDebug(buildDebugMetadata(options));
}

module.exports = {
  buildDebugMetadata,
  logPromptDebug,
  logRouteDebug,
  sha256,
};
