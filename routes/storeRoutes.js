function requestUserId(req, fallbackUserId) {
  return (
    req.headers["x-lucy-user-id"] ||
    req.headers["x-user-id"] ||
    req.query.userId ||
    req.query.user ||
    (req.body && (req.body.userId || req.body.user)) ||
    fallbackUserId
  );
}

function registerStoreRoutes(app, deps) {
  const {
    readLucyStore,
    writeLucyStore,
    readRootStore,
    writeRootStore,
    listLucyUsers,
    normalizeUserId,
    STORE_PATH,
    DEFAULT_USER_ID,
    PORT,
  } = deps;

  app.get("/api/store", (req, res) => {
    try {
      const userId = normalizeUserId(requestUserId(req, DEFAULT_USER_ID));
      const store = readLucyStore(userId);
      res.json({ ok: true, userId, store });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/store", (req, res) => {
    try {
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        return res.status(400).json({ ok: false, error: "Geçersiz LUCY store verisi." });
      }

      const userId = normalizeUserId(requestUserId(req, DEFAULT_USER_ID));
      const { userId: _ignoredUserId, user: _ignoredUser, ...payload } = req.body;
      const saved = writeLucyStore(payload, userId);
      res.json({ ok: true, userId, updatedAt: saved.updatedAt });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/store/users", (req, res) => {
    try {
      res.json({ ok: true, users: listLucyUsers() });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/store/root", (req, res) => {
    try {
      if (process.env.LUCY_ENABLE_STORE_ROOT !== "true") {
        return res.status(403).json({ ok: false, error: "Root store erişimi kapalı." });
      }
      const root = readRootStore();
      res.json({ ok: true, root });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/store/root", (req, res) => {
    try {
      if (process.env.LUCY_ENABLE_STORE_ROOT !== "true") {
        return res.status(403).json({ ok: false, error: "Root store yazma erişimi kapalı." });
      }
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        return res.status(400).json({ ok: false, error: "Geçersiz root store verisi." });
      }
      const saved = writeRootStore(req.body);
      res.json({ ok: true, updatedAt: saved.updatedAt });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/", (req, res) => {
    res.json({
      success: true,
      message: "LUCY backend çalışıyor",
      brain: "DeepSeek",
      port: PORT,
      storeMode: "multi-user-json",
    });
  });
}

module.exports = registerStoreRoutes;
