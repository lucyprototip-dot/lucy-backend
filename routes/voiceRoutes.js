function registerVoiceRoutes(app, deps) {
  const { sanitizeSpeechText, pickVoiceProfile, envValue } = deps;

  app.post("/api/speak", async (req, res) => {
    try {
      const text = sanitizeSpeechText(req.body?.text);
      if (!text) return res.status(400).json({ success: false, error: "Seslendirilecek temiz metin bulunamadı." });
      const voiceProfile = pickVoiceProfile(req.body?.voiceMode);
      if (!envValue("ELEVENLABS_API_KEY") || !voiceProfile.voiceId) {
        return res.status(500).json({ success: false, error: "ElevenLabs bilgileri eksik" });
      }

      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceProfile.voiceId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": envValue("ELEVENLABS_API_KEY"),
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: voiceProfile.voice_settings,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return res.status(500).json({ success: false, error: errorText || "ElevenLabs API hatası" });
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      res.json({ success: true, audio: buffer.toString("base64"), voiceMode: voiceProfile.id });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

module.exports = registerVoiceRoutes;
