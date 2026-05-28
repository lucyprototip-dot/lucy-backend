function firstUploadedFile(req) {
  if (req.file) return req.file;
  if (Array.isArray(req.files)) return req.files[0] || null;
  if (req.files && typeof req.files === "object") {
    for (const value of Object.values(req.files)) {
      if (Array.isArray(value) && value[0]) return value[0];
      if (value && typeof value === "object") return value;
    }
  }
  return null;
}

function flexibleUpload(upload, uploadStatusForError) {
  return (req, res, next) => {
    upload.any()(req, res, (error) => {
      if (error) {
        const status = typeof uploadStatusForError === "function" ? uploadStatusForError(error) : 400;
        return res.status(status).json({
          success: false,
          error: error.code || "upload_failed",
          message: error.message || "Dosya yüklenemedi.",
        });
      }
      const file = firstUploadedFile(req);
      if (file && !req.file) req.file = file;
      next();
    });
  };
}

function registerFileRoutes(app, deps) {
  const {
    upload,
    handleUploadedFile,
    askOpenRouterVision,
    askOpenRouterText,
    generateWithOpenRouter,
    normalizeText,
    safeUnlink,
    uploadStatusForError,
  } = deps;

  // Frontend farklı field adları gönderebiliyor: file, image, document, upload vb.
  // PATCH-3: Unexpected field yüzünden /api/upload-file patlamasın diye flexible upload kullanılır.
  const acceptAnyFile = flexibleUpload(upload, uploadStatusForError);

  app.post("/api/upload-file", acceptAnyFile, handleUploadedFile);
  app.post("/api/file", acceptAnyFile, handleUploadedFile);
  app.post("/api/read-file", acceptAnyFile, handleUploadedFile);

  app.post("/api/analyze-image", acceptAnyFile, async (req, res) => {
    let uploadedPath = null;
    try {
      const file = firstUploadedFile(req);
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

  app.post("/api/analyze-video", acceptAnyFile, async (req, res) => {
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
