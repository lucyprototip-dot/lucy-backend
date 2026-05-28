const fs = require("fs");
const path = require("path");

const DEFAULT_USER_ID = normalizeUserId(process.env.LUCY_DEFAULT_USER_ID || "omer");
const STORE_FILE_NAME = process.env.LUCY_STORE_FILE || "lucy_web_arsiv.json";
const STORE_PATH = resolveStorePath();
const DATA_DIR = path.dirname(STORE_PATH);
const ARCHIVE_FILE = STORE_PATH;
const LEGACY_STORE_PATH = path.join(DATA_DIR, "lucy-store.json");
const EXAMPLE_STORE_PATH = path.resolve(__dirname, "..", "data", "lucy_web_arsiv.example.json");
const BACKUP_DIR = process.env.LUCY_BACKUP_DIR
  ? path.resolve(process.env.LUCY_BACKUP_DIR)
  : path.join(DATA_DIR, "backup");
const BACKUP_INTERVAL_MS = Number(process.env.LUCY_BACKUP_INTERVAL_MS || 5 * 60 * 1000);
const MAX_BACKUP_FILES = Number(process.env.LUCY_MAX_BACKUPS || 30);

function resolveStorePath() {
  if (process.env.LUCY_DATA_PATH && process.env.LUCY_DATA_PATH.trim()) {
    return path.resolve(process.env.LUCY_DATA_PATH.trim());
  }

  const dataDir = process.env.LUCY_DATA_DIR
    ? path.resolve(process.env.LUCY_DATA_DIR)
    : path.resolve(__dirname, "..", "data");

  return path.join(dataDir, STORE_FILE_NAME);
}

function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (error) {
    console.error("Geçici dosya silinemedi:", error.message);
  }
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function normalizeUserId(value) {
  const raw = String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const clean = raw
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 64);
  return clean || "default";
}

function backupFileName() {
  return `lucy_web_arsiv_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
}

function rotateBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((name) => name.endsWith(".json"))
      .map((name) => ({
        name,
        path: path.join(BACKUP_DIR, name),
        time: fs.statSync(path.join(BACKUP_DIR, name)).mtimeMs,
      }))
      .sort((a, b) => b.time - a.time);

    files.slice(MAX_BACKUP_FILES).forEach((file) => safeUnlink(file.path));
  } catch (error) {
    console.error("LUCY backup temizleme hatası:", error.message);
  }
}

function createLucyStoreBackup() {
  try {
    ensureDataDir();
    if (!fs.existsSync(STORE_PATH)) return;
    const stat = fs.statSync(STORE_PATH);
    if (!stat.size) return;

    const backups = fs.readdirSync(BACKUP_DIR)
      .filter((name) => name.endsWith(".json"))
      .map((name) => ({
        name,
        time: fs.statSync(path.join(BACKUP_DIR, name)).mtimeMs,
      }))
      .sort((a, b) => b.time - a.time);

    if (backups[0] && Date.now() - backups[0].time < BACKUP_INTERVAL_MS) return;

    fs.copyFileSync(STORE_PATH, path.join(BACKUP_DIR, backupFileName()));
    rotateBackups();
  } catch (error) {
    console.error("LUCY backup oluşturulamadı:", error.message);
  }
}

function emptyUserStore() {
  return {
    version: "lucy-v11.9.0",
    updatedAt: new Date().toISOString(),
    chats: [],
    gpts: [],
    academy: [],
    projects: [],
    work: [],
    folders: [],
    memory: "",
    exporter: [],
    live: {},
    activeChatId: "",
    activeGptId: "lucy-standard",
    activeProjectId: "",
    activeWorkId: "",
    settings: {
      theme: "dark",
      sidebarOpen: true,
      sidebarWidth: 293,
      fontScale: "normal",
      activeModeId: "fast",
      webSearchEnabled: false,
    },
  };
}

function emptyRootStore() {
  return {
    version: "lucy-multi-user-v1",
    schema: "multi-user-json-store",
    updatedAt: new Date().toISOString(),
    users: {},
    authUsers: {},
  };
}

function isLegacyUserStore(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return ["chats", "gpts", "academy", "projects", "memory", "settings"].some((key) => key in value);
}

function normalizeUserStore(store = {}) {
  const base = emptyUserStore();
  const safe = store && typeof store === "object" && !Array.isArray(store) ? store : {};
  return {
    ...base,
    ...safe,
    chats: Array.isArray(safe.chats) ? safe.chats : base.chats,
    gpts: Array.isArray(safe.gpts) ? safe.gpts : base.gpts,
    academy: Array.isArray(safe.academy) ? safe.academy : base.academy,
    projects: Array.isArray(safe.projects) ? safe.projects : base.projects,
    work: Array.isArray(safe.work) ? safe.work : base.work,
    folders: Array.isArray(safe.folders) ? safe.folders : base.folders,
    exporter: Array.isArray(safe.exporter) ? safe.exporter : base.exporter,
    live: safe.live && typeof safe.live === "object" && !Array.isArray(safe.live) ? safe.live : base.live,
    settings: {
      ...base.settings,
      ...(safe.settings && typeof safe.settings === "object" && !Array.isArray(safe.settings) ? safe.settings : {}),
    },
    updatedAt: safe.updatedAt || base.updatedAt,
  };
}

function normalizeRootStore(input = {}) {
  const now = new Date().toISOString();

  if (input && typeof input === "object" && !Array.isArray(input) && input.users && typeof input.users === "object" && !Array.isArray(input.users)) {
    const root = {
      ...emptyRootStore(),
      ...input,
      users: {},
      authUsers: input.authUsers && typeof input.authUsers === "object" && !Array.isArray(input.authUsers) ? input.authUsers : {},
      updatedAt: input.updatedAt || now,
    };

    Object.entries(input.users).forEach(([rawUserId, userStore]) => {
      const userId = normalizeUserId(rawUserId);
      root.users[userId] = normalizeUserStore(userStore);
    });

    if (!root.users[DEFAULT_USER_ID]) root.users[DEFAULT_USER_ID] = emptyUserStore();
    return root;
  }

  const root = emptyRootStore();
  root.updatedAt = now;
  root.users[DEFAULT_USER_ID] = normalizeUserStore(isLegacyUserStore(input) ? input : {});
  root.authUsers = input && typeof input === "object" && !Array.isArray(input) && input.authUsers && typeof input.authUsers === "object" && !Array.isArray(input.authUsers) ? input.authUsers : {};
  return root;
}

function loadInitialRootStore() {
  if (fs.existsSync(EXAMPLE_STORE_PATH)) {
    try {
      const raw = fs.readFileSync(EXAMPLE_STORE_PATH, "utf8");
      if (raw.trim()) return normalizeRootStore(JSON.parse(raw));
    } catch (error) {
      console.error("LUCY example store okunamadı:", error.message);
    }
  }
  return normalizeRootStore({});
}

function readRootStore() {
  ensureDataDir();

  if (!fs.existsSync(STORE_PATH) && fs.existsSync(LEGACY_STORE_PATH)) {
    fs.copyFileSync(LEGACY_STORE_PATH, STORE_PATH);
  }

  if (!fs.existsSync(STORE_PATH)) {
    const initialStore = loadInitialRootStore();
    writeRootStore(initialStore, { backup: false });
    return initialStore;
  }

  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    if (!raw.trim()) return normalizeRootStore({});
    return normalizeRootStore(JSON.parse(raw));
  } catch (error) {
    console.error("LUCY data store okunamadı:", error.message);
    return normalizeRootStore({});
  }
}

function writeRootStore(nextRoot = {}, options = {}) {
  ensureDataDir();

  const root = normalizeRootStore(nextRoot);
  root.updatedAt = new Date().toISOString();

  if (options.backup !== false) createLucyStoreBackup();

  const tempPath = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(root, null, 2), "utf8");
  fs.renameSync(tempPath, STORE_PATH);
  return root;
}

function readLucyStore(userId = DEFAULT_USER_ID) {
  const safeUserId = normalizeUserId(userId || DEFAULT_USER_ID);
  const root = readRootStore();

  if (!root.users[safeUserId]) {
    root.users[safeUserId] = emptyUserStore();
    writeRootStore(root);
  }

  return normalizeUserStore(root.users[safeUserId]);
}

function writeLucyStore(nextStore = {}, userId = DEFAULT_USER_ID) {
  const safeUserId = normalizeUserId(userId || DEFAULT_USER_ID);
  const root = readRootStore();
  const previous = root.users[safeUserId] ? normalizeUserStore(root.users[safeUserId]) : emptyUserStore();

  root.users[safeUserId] = normalizeUserStore({
    ...previous,
    ...(nextStore && typeof nextStore === "object" && !Array.isArray(nextStore) ? nextStore : {}),
    updatedAt: new Date().toISOString(),
  });

  writeRootStore(root);
  return root.users[safeUserId];
}

function listLucyUsers() {
  const root = readRootStore();
  return Object.keys(root.users).sort();
}

module.exports = {
  DATA_DIR,
  STORE_PATH,
  ARCHIVE_FILE,
  DEFAULT_USER_ID,
  ensureDataDir,
  normalizeUserId,
  emptyUserStore,
  emptyLucyStore: emptyUserStore,
  emptyRootStore,
  normalizeUserStore,
  readRootStore,
  writeRootStore,
  readLucyStore,
  writeLucyStore,
  listLucyUsers,
};
