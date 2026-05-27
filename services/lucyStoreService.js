const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.LUCY_DATA_DIR || path.resolve(__dirname, "..", "data");
const STORE_FILE_NAME = process.env.LUCY_STORE_FILE || "lucy_web_arsiv.json";
const STORE_PATH = path.join(DATA_DIR, STORE_FILE_NAME);
const ARCHIVE_FILE = STORE_PATH;
const LEGACY_STORE_PATH = path.join(DATA_DIR, "lucy-store.json");
const BACKUP_DIR = path.join(DATA_DIR, "backup");
const BACKUP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_BACKUP_FILES = Number(process.env.LUCY_MAX_BACKUPS || 30);

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

function emptyLucyStore() {
  return {
    version: "lucy-v11.9.0",
    updatedAt: new Date().toISOString(),
    chats: [],
    gpts: [],
    academy: [],
    projects: [],
    memory: "",
    exporter: [],
    live: {},
    activeChatId: "",
    activeGptId: "lucy-standard",
    activeProjectId: "",
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

function readLucyStore() {
  ensureDataDir();

  if (!fs.existsSync(STORE_PATH) && fs.existsSync(LEGACY_STORE_PATH)) {
    fs.copyFileSync(LEGACY_STORE_PATH, STORE_PATH);
  }

  if (!fs.existsSync(STORE_PATH)) {
    const initialStore = emptyLucyStore();
    fs.writeFileSync(STORE_PATH, JSON.stringify(initialStore, null, 2), "utf8");
    return initialStore;
  }

  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    if (!raw.trim()) return emptyLucyStore();
    return { ...emptyLucyStore(), ...JSON.parse(raw) };
  } catch (error) {
    console.error("LUCY data store okunamadı:", error.message);
    return emptyLucyStore();
  }
}

function writeLucyStore(nextStore = {}) {
  ensureDataDir();

  const safeStore = {
    ...emptyLucyStore(),
    ...nextStore,
    updatedAt: new Date().toISOString(),
  };

  createLucyStoreBackup();

  const tempPath = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(safeStore, null, 2), "utf8");
  fs.renameSync(tempPath, STORE_PATH);
  return safeStore;
}

module.exports = {
  DATA_DIR,
  STORE_PATH,
  ARCHIVE_FILE,
  ensureDataDir,
  emptyLucyStore,
  readLucyStore,
  writeLucyStore,
};
