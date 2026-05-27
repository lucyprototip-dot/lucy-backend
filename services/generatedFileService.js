const fs = require("fs");
const path = require("path");

const GENERATED_DIR = process.env.LUCY_GENERATED_DIR || path.resolve(__dirname, "..", "generated");
const GENERATED_PUBLIC_PATH = "/generated";

function ensureGeneratedDir() {
  if (!fs.existsSync(GENERATED_DIR)) {
    fs.mkdirSync(GENERATED_DIR, { recursive: true });
  }
}

function setupGeneratedStatic(app, express) {
  ensureGeneratedDir();
  app.use(GENERATED_PUBLIC_PATH, express.static(GENERATED_DIR));
}

module.exports = {
  GENERATED_DIR,
  GENERATED_PUBLIC_PATH,
  ensureGeneratedDir,
  setupGeneratedStatic,
};
