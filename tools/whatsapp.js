const axios = require("axios");

function env(name) {
  return String(process.env[name] || "").trim().replace(/^[\'\"]|[\'\"]$/g, "");
}

module.exports = {
  name: "whatsapp",
  description: "WhatsApp Cloud API ile metin mesajı gönderir. WHATSAPP_TOKEN ve WHATSAPP_PHONE_NUMBER_ID gerekir.",

  async execute(input = {}) {
    const token = env("WHATSAPP_TOKEN") || env("WHATSAPP_ACCESS_TOKEN");
    const phoneNumberId = env("WHATSAPP_PHONE_NUMBER_ID");
    const to = String(input.to || input.phone || input.recipient || "").replace(/[^0-9]/g, "");
    const text = String(input.text || input.message || input.body || "").trim();

    if (!to) return { success: false, error: "to_required", message: "WhatsApp için alıcı telefon gerekli." };
    if (!text) return { success: false, error: "text_required", message: "WhatsApp mesajı için text gerekli." };
    if (!token || !phoneNumberId) {
      return {
        success: false,
        error: "whatsapp_config_required",
        message: "WhatsApp için Railway Variables içine WHATSAPP_TOKEN ve WHATSAPP_PHONE_NUMBER_ID eklenmeli.",
        draft: { to, text },
      };
    }

    const response = await axios.post(
      `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { preview_url: Boolean(input.previewUrl), body: text },
      },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
    );

    return {
      success: true,
      type: "message",
      platform: "whatsapp",
      to,
      messageId: response.data?.messages?.[0]?.id,
    };
  },
};
