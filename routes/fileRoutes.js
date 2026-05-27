function registerFileRoutes(app, deps) {
  const {
    upload,
    handleUploadedFile,
    askOpenRouterVision,
    askOpenRouterText,
    generateWithOpenRouter,
    normalizeText,
    safeUnlink,
  } = deps;

  // Frontend bu üç endpoint'i sırayla deniyor. Hepsi aynı dosya okuma motoruna bağlandı.
  app.post("/api/upload-file", upload.single("file"), handleUploadedFile);
  app.post("/api/file", upload.single("file"), handleUploadedFile);
  app.post("/api/read-file", upload.single("file"), handleUploadedFile);

  app.post("/api/analyze-image", upload.single("image"), async (req, res) => {
    let uploadedPath = null;
    try {
      const file = req.file || req.files?.image || req.files?.file;
      if (!file) return res.status(400).json({ success: false, error: "Resim gerekli" });
      uploadedPath = file.path;
      const mimeType = file.mimetype;
      if (!mimeType || !mimeType.startsWith("image/")) return res.status(400).json({ success: false, error: "Yüklenen dosya resim değil" });

      const answer = await askOpenRouterVision({
        prompt: req.body.prompt || "Bu resmi Türkçe ayrıntılı analiz et.",
        filePath: uploadedPath,
        mimeType,
        originalName: file.originalname,
      });

      res.json({ success: true, provider: "openrouter", fileName: file.originalname, answer });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    } finally {
      safeUnlink(uploadedPath);
    }
  });

  app.post("/api/analyze-video", upload.single("video"), async (req, res) => {
    let uploadedPath = null;
    try {
      if (!req.file) return res.status(400).json({ success: false, error: "Video gerekli" });
      uploadedPath = req.file.path;
      const prompt = `${req.body.prompt || "Bu videoyu analiz et."}\n\nDosya adı: ${req.file.originalname}\nMIME: ${req.file.mimetype}\nBoyut: ${req.file.size} bayt\n\nNot: Bu endpoint OpenRouter video destekli model için hazırlandı. Model ayarı .env: OPENROUTER_VIDEO_MODEL`;
      const answer = await askOpenRouterText({ prompt, modelEnv: "OPENROUTER_VIDEO_MODEL", fallbackModel: "google/gemini-2.0-flash-001" });
      res.json({ success: true, provider: "openrouter", fileName: req.file.originalname, answer });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    } finally {
      safeUnlink(uploadedPath);
    }
  });

  app.post("/api/generate-image", async (req, res) => {
    try {
      const prompt = normalizeText(req.body.prompt);
      if (!prompt) return res.status(400).json({ success: false, error: "prompt gerekli" });
      const result = await generateWithOpenRouter({ prompt, kind: "image" });
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/generate-video", async (req, res) => {
    try {
      const prompt = normalizeText(req.body.prompt);
      if (!prompt) return res.status(400).json({ success: false, error: "prompt gerekli" });
      const result = await generateWithOpenRouter({ prompt, kind: "video" });
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

module.exports = registerFileRoutes;
