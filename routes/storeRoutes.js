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

function resolveStoreUserId(req, deps) {
  const { authUserFromRequest, normalizeUserId, DEFAULT_USER_ID } = deps;
  const requireAuth = process.env.LUCY_REQUIRE_AUTH === "true";

  try {
    if (typeof authUserFromRequest === "function") {
      const authUser = authUserFromRequest(req);
      if (authUser && authUser.userId) {
        req.lucyUser = authUser;
        return normalizeUserId(authUser.userId);
      }
    }
  } catch (error) {
    if (requireAuth) throw error;
  }

  if (requireAuth) {
    const error = new Error("Oturum gerekli.");
    error.status = 401;
    error.code = "auth_required";
    throw error;
  }

  return normalizeUserId(requestUserId(req, DEFAULT_USER_ID));
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
    authUserFromRequest,
  } = deps;

  app.get("/api/store", (req, res) => {
    try {
      const userId = resolveStoreUserId(req, { authUserFromRequest, normalizeUserId, DEFAULT_USER_ID });
      const store = readLucyStore(userId);
      res.json({ ok: true, userId, store });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: error.message, code: error.code || "store_error" });
    }
  });

  app.post("/api/store", (req, res) => {
    try {
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        return res.status(400).json({ ok: false, error: "Geçersiz LUCY store verisi." });
      }

      const userId = resolveStoreUserId(req, { authUserFromRequest, normalizeUserId, DEFAULT_USER_ID });
      const { userId: _ignoredUserId, user: _ignoredUser, token: _ignoredToken, ...payload } = req.body;
      const saved = writeLucyStore(payload, userId);
      res.json({ ok: true, userId, updatedAt: saved.updatedAt });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: error.message, code: error.code || "store_error" });
    }
  });

  app.get("/api/store/users", (req, res) => {
    try {
      res.json({ ok: true, users: listLucyUsers() });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: error.message, code: error.code || "store_error" });
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
      res.status(error.status || 500).json({ ok: false, error: error.message, code: error.code || "store_error" });
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
      res.status(error.status || 500).json({ ok: false, error: error.message, code: error.code || "store_error" });
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
