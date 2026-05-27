function registerStoreRoutes(app, deps) {
  const { readLucyStore, writeLucyStore, STORE_PATH, PORT } = deps;

  app.get("/api/store", (req, res) => {
    try {
      const store = readLucyStore();
      res.json({ ok: true, path: STORE_PATH, store });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/store", (req, res) => {
    try {
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        return res.status(400).json({ ok: false, error: "Geçersiz LUCY store verisi." });
      }

      const saved = writeLucyStore(req.body);
      res.json({ ok: true, path: STORE_PATH, updatedAt: saved.updatedAt });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/", (req, res) => {
    res.json({ success: true, message: "LUCY backend çalışıyor", brain: "DeepSeek", port: PORT });
  });
}

module.exports = registerStoreRoutes;
