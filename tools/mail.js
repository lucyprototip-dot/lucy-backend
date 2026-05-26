const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");

function env(name) {
  return String(process.env[name] || "").trim().replace(/^['\"]|['\"]$/g, "");
}

function generatedDir() {
  return process.env.LUCY_GENERATED_DIR || path.resolve(__dirname, "..", "generated");
}

function safeResolveGenerated(name = "") {
  const clean = path.basename(String(name || ""));
  if (!clean) return null;
  const full = path.resolve(generatedDir(), clean);
  const base = path.resolve(generatedDir());
  if (!full.startsWith(base)) return null;
  return full;
}

function buildTransporter() {
  const host = env("SMTP_HOST") || env("MAIL_HOST");
  const port = Number(env("SMTP_PORT") || env("MAIL_PORT") || 587);
  const user = env("SMTP_USER") || env("MAIL_USER");
  const pass = env("SMTP_PASS") || env("MAIL_PASS");
  const secureRaw = env("SMTP_SECURE") || env("MAIL_SECURE");
  const secure = secureRaw ? ["1", "true", "yes"].includes(secureRaw.toLowerCase()) : port === 465;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

function normalizeAttachments(inputAttachments = []) {
  const attachments = Array.isArray(inputAttachments) ? inputAttachments : [];

  return attachments
    .map((item) => {
      if (!item || typeof item !== "object") return null;

      if (item.base64) {
        return {
          filename: item.filename || "lucy-attachment.bin",
          content: Buffer.from(String(item.base64), "base64"),
          contentType: item.mimeType,
        };
      }

      const storedName = item.storedFilename || item.generatedFile || item.filename;
      const filePath = safeResolveGenerated(storedName);
      if (filePath && fs.existsSync(filePath)) {
        return {
          filename: item.downloadName || item.originalName || path.basename(filePath),
          path: filePath,
        };
      }

      return null;
    })
    .filter(Boolean);
}

module.exports = {
  name: "mail",
  description: "SMTP ayarları varsa gerçek e-posta gönderir. Ayar yoksa güvenli hata döndürür.",

  async execute(input = {}) {
    const to = String(input.to || input.recipient || "").trim();
    const subject = String(input.subject || "LUCY Mesajı").trim();
    const text = String(input.text || input.body || input.message || "").trim();
    const html = input.html ? String(input.html) : undefined;

    if (!to) {
      return { success: false, error: "to_required", message: "Mail göndermek için alıcı e-posta gerekli." };
    }

    if (!text && !html) {
      return { success: false, error: "body_required", message: "Mail göndermek için metin veya HTML içerik gerekli." };
    }

    const transporter = buildTransporter();
    if (!transporter) {
      return {
        success: false,
        error: "smtp_config_required",
        message: "SMTP ayarları yok. Railway Variables içine SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS ve MAIL_FROM eklenmeden gerçek mail gönderilemez.",
        draft: { to, subject, text, html },
      };
    }

    const from = env("MAIL_FROM") || env("SMTP_FROM") || env("SMTP_USER") || env("MAIL_USER");
    const attachments = normalizeAttachments(input.attachments);

    const info = await transporter.sendMail({ from, to, subject, text: text || undefined, html, attachments });

    return {
      success: true,
      type: "mail",
      to,
      subject,
      messageId: info.messageId,
      accepted: info.accepted || [],
      rejected: info.rejected || [],
      attachments: attachments.map((item) => item.filename || path.basename(item.path || "attachment")),
    };
  },
};
