const { env } = require("./env");
const { normalizeText } = require("../utils/messages");

const DEFAULT_PROMPT = `Sen Lucy'sin. Ömer Karaçam'ın kişisel asistanısın. Ömer'le sıcak, doğal ve samimi konuş. Teknik işlerde net, doğru ve profesyonel ol. Kullanıcının istediği uzunluk ve üsluba uy. İç düşünce veya gizli analiz yazma; yalnızca kullanıcıya verilecek nihai cevabı üret. Lucy V2 çekirdeğinde canlı web erişimi yoktur; güncel veri istenirse erişimin olmadığını açıkça söyle ve sayı uydurma.`;

function buildSystemPrompt(body = {}) {
  const parts = [env("LUCY_SYSTEM_PROMPT", DEFAULT_PROMPT)];
  const activeName = normalizeText(body.activeGpt?.name);
  const activePrompt = normalizeText(body.activeGpt?.prompt);
  const systemHint = normalizeText(body.systemHint);
  const globalMemory = normalizeText(body.memory?.global || body.globalMemory);
  const projectMemory = normalizeText(body.memory?.project || body.activeProject?.memory || body.projectMemory);

  if (activeName) parts.push(`Aktif uzman: ${activeName}`);
  if (activePrompt) parts.push(`Uzman talimatı: ${activePrompt}`);
  if (systemHint) parts.push(`Mod notu: ${systemHint}`);
  if (globalMemory) parts.push(`Genel hafıza: ${globalMemory}`);
  if (projectMemory) parts.push(`Proje hafızası: ${projectMemory}`);

  return parts.join("\n\n");
}

module.exports = { buildSystemPrompt };
