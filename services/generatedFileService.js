const fs = require("fs");
const path = require("path");
const { generatedContentDisposition } = require("../core/securityGuards");

const GENERATED_DIR = process.env.LUCY_GENERATED_DIR || path.resolve(__dirname, "..", "generated");
const GENERATED_PUBLIC_PATH = "/generated";

function ensureGeneratedDir() {
  if (!fs.existsSync(GENERATED_DIR)) {
    fs.mkdirSync(GENERATED_DIR, { recursive: true });
  }
}

function setupGeneratedStatic(app, express) {
  ensureGeneratedDir();
  app.use(GENERATED_PUBLIC_PATH, express.static(GENERATED_DIR, {
    dotfiles: "deny",
    fallthrough: false,
    index: false,
    setHeaders(res, filePath) {
      const filename = path.basename(filePath);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Content-Disposition", generatedContentDisposition(filename));
      if (/\.html?$/i.test(filename)) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
      }
    },
  }));
}

module.exports = {
  GENERATED_DIR,
  GENERATED_PUBLIC_PATH,
  ensureGeneratedDir,
  setupGeneratedStatic,
};
