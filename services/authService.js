const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const {
  readRootStore,
  writeRootStore,
  normalizeUserId,
  normalizeUserStore,
  emptyUserStore,
} = require("./lucyStoreService");

const AUTH_TOKEN_TTL = process.env.LUCY_AUTH_TOKEN_TTL || "7d";
const PASSWORD_MIN_LENGTH = Number(process.env.LUCY_PASSWORD_MIN_LENGTH || 4);
const INITIAL_PASSWORD = process.env.LUCY_INITIAL_PASSWORD || "1234";

const DEFAULT_USERS = [
  {
    userId: "omer",
    username: "ömer",
    aliases: ["ömer", "omer"],
    displayName: "Ömer Karaçam",
    role: "owner",
  },
  {
    userId: "ozer",
    username: "özer",
    aliases: ["özer", "ozer"],
    displayName: "Özer Güler",
    role: "user",
  },
  {
    userId: "vedat",
    username: "vedat",
    aliases: ["vedat"],
    displayName: "Vedat Karlı",
    role: "user",
  },
  {
    userId: "murat",
    username: "murat",
    aliases: ["murat"],
    displayName: "Murat Karaağaç",
    role: "user",
  },
];

function turkishFold(value = "") {
  return String(value)
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._@-]/g, "")
    .slice(0, 96);
}

function normalizeLoginKey(value = "") {
  return turkishFold(value);
}

function publicUser(authUser) {
  if (!authUser || typeof authUser !== "object") return null;
  return {
    userId: authUser.userId,
    username: authUser.username,
    displayName: authUser.displayName,
    role: authUser.role || "user",
    mustChangePassword: Boolean(authUser.mustChangePassword),
    updatedAt: authUser.updatedAt,
    lastLoginAt: authUser.lastLoginAt || "",
  };
}

function getAuthSecret() {
  const secret = String(process.env.LUCY_AUTH_SECRET || "").trim();
  if (secret) return secret;
  return "lucy-dev-change-this-secret";
}

function defaultPasswordHash() {
  return bcrypt.hashSync(INITIAL_PASSWORD, 10);
}

function ensureAuthUsers() {
  const root = readRootStore();
  const now = new Date().toISOString();
  let changed = false;

  if (!root.authUsers || typeof root.authUsers !== "object" || Array.isArray(root.authUsers)) {
    root.authUsers = {};
    changed = true;
  }

  for (const seed of DEFAULT_USERS) {
    const userId = normalizeUserId(seed.userId);
    const aliases = Array.from(new Set([...(seed.aliases || []), seed.username, seed.userId].filter(Boolean)));
    const loginKeys = Array.from(new Set(aliases.map(normalizeLoginKey).filter(Boolean)));

    if (!root.authUsers[userId]) {
      root.authUsers[userId] = {
        userId,
        username: seed.username,
        aliases,
        loginKeys,
        displayName: seed.displayName,
        role: seed.role || "user",
        passwordHash: defaultPasswordHash(),
        mustChangePassword: false,
        createdAt: now,
        updatedAt: now,
      };
      changed = true;
    } else {
      const current = root.authUsers[userId];
      const nextLoginKeys = Array.from(new Set([...(current.loginKeys || []), ...loginKeys].filter(Boolean)));
      const nextAliases = Array.from(new Set([...(current.aliases || []), ...aliases].filter(Boolean)));
      const patched = {
        ...current,
        userId,
        username: current.username || seed.username,
        aliases: nextAliases,
        loginKeys: nextLoginKeys,
        displayName: current.displayName || seed.displayName,
        role: current.role || seed.role || "user",
        passwordHash: current.passwordHash || defaultPasswordHash(),
        updatedAt: current.updatedAt || now,
      };
      if (JSON.stringify(patched) !== JSON.stringify(current)) {
        root.authUsers[userId] = patched;
        changed = true;
      }
    }

    if (!root.users || typeof root.users !== "object" || Array.isArray(root.users)) {
      root.users = {};
      changed = true;
    }

    if (!root.users[userId]) {
      root.users[userId] = emptyUserStore();
      changed = true;
    } else {
      root.users[userId] = normalizeUserStore(root.users[userId]);
    }
  }

  if (changed) writeRootStore(root);
  return readRootStore().authUsers || {};
}

function findAuthUser(usernameOrId) {
  const authUsers = ensureAuthUsers();
  const key = normalizeLoginKey(usernameOrId);
  if (!key) return null;

  const directId = normalizeUserId(key);
  if (authUsers[directId]) return authUsers[directId];

  return Object.values(authUsers).find((user) => {
    const keys = Array.isArray(user.loginKeys) ? user.loginKeys : [];
    const aliases = Array.isArray(user.aliases) ? user.aliases.map(normalizeLoginKey) : [];
    return normalizeLoginKey(user.username) === key || keys.includes(key) || aliases.includes(key);
  }) || null;
}

function issueToken(authUser) {
  const payload = {
    sub: authUser.userId,
    userId: authUser.userId,
    username: authUser.username,
    displayName: authUser.displayName,
    role: authUser.role || "user",
  };
  return jwt.sign(payload, getAuthSecret(), { expiresIn: AUTH_TOKEN_TTL });
}

function loginLucyUser(username, password) {
  const authUser = findAuthUser(username);
  if (!authUser || !authUser.passwordHash) {
    const error = new Error("Kullanıcı adı veya şifre hatalı.");
    error.status = 401;
    error.code = "invalid_credentials";
    throw error;
  }

  if (!bcrypt.compareSync(String(password || ""), authUser.passwordHash)) {
    const error = new Error("Kullanıcı adı veya şifre hatalı.");
    error.status = 401;
    error.code = "invalid_credentials";
    throw error;
  }

  const root = readRootStore();
  const now = new Date().toISOString();
  root.authUsers = root.authUsers || {};
  root.authUsers[authUser.userId] = {
    ...authUser,
    lastLoginAt: now,
    updatedAt: now,
  };
  if (!root.users[authUser.userId]) root.users[authUser.userId] = emptyUserStore();
  writeRootStore(root);

  const freshUser = root.authUsers[authUser.userId];
  return { token: issueToken(freshUser), user: publicUser(freshUser), expiresIn: AUTH_TOKEN_TTL };
}

function tokenFromRequest(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  if (match) return match[1].trim();
  return (
    req.headers["x-lucy-token"] ||
    req.headers["x-auth-token"] ||
    req.query.token ||
    (req.body && req.body.token) ||
    ""
  );
}

function verifyLucyToken(token) {
  if (!token) return null;
  try {
    const decoded = jwt.verify(String(token), getAuthSecret());
    const authUser = findAuthUser(decoded.userId || decoded.sub || decoded.username);
    if (!authUser) return null;
    return publicUser(authUser);
  } catch (error) {
    const authError = new Error("Oturum geçersiz veya süresi dolmuş.");
    authError.status = 401;
    authError.code = "invalid_token";
    throw authError;
  }
}

function authUserFromRequest(req) {
  const token = tokenFromRequest(req);
  if (!token) return null;
  return verifyLucyToken(token);
}

function requireLucyAuth(req, res, next) {
  try {
    const user = authUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ ok: false, error: "Oturum gerekli.", code: "auth_required" });
    }
    req.lucyUser = user;
    return next();
  } catch (error) {
    return res.status(error.status || 401).json({ ok: false, error: error.message, code: error.code || "auth_error" });
  }
}

function changeLucyPassword(userId, currentPassword, newPassword) {
  const authUsers = ensureAuthUsers();
  const safeUserId = normalizeUserId(userId);
  const authUser = authUsers[safeUserId];
  if (!authUser) {
    const error = new Error("Kullanıcı bulunamadı.");
    error.status = 404;
    error.code = "user_not_found";
    throw error;
  }

  if (!bcrypt.compareSync(String(currentPassword || ""), authUser.passwordHash)) {
    const error = new Error("Mevcut şifre hatalı.");
    error.status = 401;
    error.code = "current_password_invalid";
    throw error;
  }

  const nextPassword = String(newPassword || "");
  if (nextPassword.length < PASSWORD_MIN_LENGTH) {
    const error = new Error(`Yeni şifre en az ${PASSWORD_MIN_LENGTH} karakter olmalı.`);
    error.status = 400;
    error.code = "weak_password";
    throw error;
  }

  const root = readRootStore();
  const now = new Date().toISOString();
  root.authUsers[safeUserId] = {
    ...root.authUsers[safeUserId],
    passwordHash: bcrypt.hashSync(nextPassword, 10),
    mustChangePassword: false,
    passwordChangedAt: now,
    updatedAt: now,
  };
  writeRootStore(root);
  return publicUser(root.authUsers[safeUserId]);
}

function listAuthUsersPublic() {
  const users = ensureAuthUsers();
  return Object.values(users).map(publicUser).filter(Boolean).sort((a, b) => a.userId.localeCompare(b.userId));
}

module.exports = {
  DEFAULT_USERS,
  normalizeLoginKey,
  ensureAuthUsers,
  listAuthUsersPublic,
  loginLucyUser,
  verifyLucyToken,
  authUserFromRequest,
  requireLucyAuth,
  changeLucyPassword,
};
