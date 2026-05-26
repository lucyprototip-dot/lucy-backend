const axios = require("axios");

function env(name) {
  return String(process.env[name] || "").trim().replace(/^[\'\"]|[\'\"]$/g, "");
}

module.exports = {
  name: "telegram",
  description: "Telegram Bot API ile mesaj gönderir. TELEGRAM_BOT_TOKEN ve TELEGRAM_CHAT_ID gerekir.",

  async execute(input = {}) {
    const token = env("TELEGRAM_BOT_TOKEN");
    const chatId = String(input.chatId || input.chat_id || env("TELEGRAM_CHAT_ID") || "").trim();
    const text = String(input.text || input.message || input.body || "").trim();

    if (!text) return { success: false, error: "text_required", message: "Telegram mesajı için text gerekli." };
    if (!token || !chatId) {
      return {
        success: false,
        error: "telegram_config_required",
        message: "Telegram için Railway Variables içine TELEGRAM_BOT_TOKEN ve TELEGRAM_CHAT_ID eklenmeli.",
        draft: { chatId, text },
      };
    }

    const response = await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: input.parseMode || "Markdown",
      disable_web_page_preview: Boolean(input.disablePreview),
    }, { timeout: 15000 });

    return {
      success: true,
      type: "message",
      platform: "telegram",
      chatId,
      messageId: response.data?.result?.message_id,
    };
  },
};
