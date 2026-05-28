function registerAuthRoutes(app, deps) {
  const {
    ensureAuthUsers,
    listAuthUsersPublic,
    loginLucyUser,
    authUserFromRequest,
    requireLucyAuth,
    changeLucyPassword,
  } = deps;

  ensureAuthUsers();

  app.get("/api/auth/users", (req, res) => {
    try {
      res.json({ ok: true, users: listAuthUsersPublic() });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message, code: error.code || "auth_users_failed" });
    }
  });

  app.post("/api/auth/login", (req, res) => {
    try {
      const { username, user, password } = req.body || {};
      const loginName = username || user;
      if (!loginName || !password) {
        return res.status(400).json({ ok: false, error: "Kullanıcı adı ve şifre gerekli.", code: "missing_credentials" });
      }

      const result = loginLucyUser(loginName, password);
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: error.message, code: error.code || "login_failed" });
    }
  });

  app.get("/api/auth/me", (req, res) => {
    try {
      const user = authUserFromRequest(req);
      if (!user) return res.status(401).json({ ok: false, error: "Oturum gerekli.", code: "auth_required" });
      res.json({ ok: true, user });
    } catch (error) {
      res.status(error.status || 401).json({ ok: false, error: error.message, code: error.code || "auth_error" });
    }
  });

  app.post("/api/auth/change-password", requireLucyAuth, (req, res) => {
    try {
      const { currentPassword, oldPassword, newPassword } = req.body || {};
      const user = changeLucyPassword(req.lucyUser.userId, currentPassword || oldPassword, newPassword);
      res.json({ ok: true, user });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: error.message, code: error.code || "change_password_failed" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    res.json({ ok: true });
  });
}

module.exports = registerAuthRoutes;
