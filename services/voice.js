const { envValue } = require("../core/env");

function sanitizeSpeechText(value = "") {
  return Array.from(String(value || "").normalize("NFC"))
    .filter((char) => {
      const code = char.codePointAt(0);
      if (code >= 0xd800 && code <= 0xdfff) return false;
      if (code === 0xfe0f || code === 0x200d) return false;
      return true;
    })
    .join("")
    .replace(/```[\s\S]*?```/g, " kod bloğu ")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/[\*_#>`~]/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4500);
}

const VOICE_MODE_SETTINGS = {
  normal: {
    envVoiceId: "ELEVENLABS_VOICE_ID",
    voice_settings: { stability: 0.38, similarity_boost: 0.82, style: 0.50, use_speaker_boost: true },
  },
  sexy: {
    envVoiceId: "ELEVENLABS_VOICE_ID_SEXY",
    fallbackEnvVoiceId: "ELEVENLABS_VOICE_ID",
    voice_settings: { stability: 0.30, similarity_boost: 0.86, style: 0.78, use_speaker_boost: true },
  },
  whisper: {
    envVoiceId: "ELEVENLABS_VOICE_ID_WHISPER",
    fallbackEnvVoiceId: "ELEVENLABS_VOICE_ID",
    voice_settings: { stability: 0.62, similarity_boost: 0.78, style: 0.34, use_speaker_boost: false },
  },
  deep: {
    envVoiceId: "ELEVENLABS_VOICE_ID_DEEP",
    fallbackEnvVoiceId: "ELEVENLABS_VOICE_ID",
    voice_settings: { stability: 0.52, similarity_boost: 0.84, style: 0.42, use_speaker_boost: true },
  },
};

function pickVoiceProfile(mode = "normal") {
  const key = String(mode || "normal").toLowerCase();
  const profile = VOICE_MODE_SETTINGS[key] || VOICE_MODE_SETTINGS.normal;
  const voiceId = envValue(profile.envVoiceId) || envValue(profile.fallbackEnvVoiceId) || envValue("ELEVENLABS_VOICE_ID");
  return { id: VOICE_MODE_SETTINGS[key] ? key : "normal", voiceId, voice_settings: profile.voice_settings };
}

async function speak(req, res) {
  const text = sanitizeSpeechText(req.body?.text);
  if (!text) return res.status(400).json({ success: false, error: "Seslendirilecek temiz metin bulunamadı." });
  const voiceProfile = pickVoiceProfile(req.body?.voiceMode);
  if (!envValue("ELEVENLABS_API_KEY") || !voiceProfile.voiceId) {
    return res.status(500).json({ success: false, error: "ElevenLabs bilgileri eksik" });
  }

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceProfile.voiceId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": envValue("ELEVENLABS_API_KEY") },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: voiceProfile.voice_settings }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return res.status(500).json({ success: false, error: errorText || "ElevenLabs API hatası" });
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return res.json({ success: true, audio: buffer.toString("base64"), voiceMode: voiceProfile.id });
}

module.exports = { speak };
