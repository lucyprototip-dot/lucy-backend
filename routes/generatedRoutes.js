function registerGeneratedRoutes(app, deps) {
  const { fs, path, GENERATED_DIR, GENERATED_PUBLIC_PATH, ensureGeneratedDir, publicBaseUrl } = deps;

  app.get("/api/generated", (req, res) => {
    try {
      ensureGeneratedDir();
      const files = fs.readdirSync(GENERATED_DIR)
        .filter((name) => !name.startsWith("."))
        .map((name) => {
          const filePath = path.join(GENERATED_DIR, name);
          const stat = fs.statSync(filePath);
          const url = `${publicBaseUrl(req)}${GENERATED_PUBLIC_PATH}/${encodeURIComponent(name)}`;
          return {
            name,
            storedFilename: name,
            size: stat.size,
            createdAt: stat.birthtime?.toISOString?.() || stat.mtime.toISOString(),
            updatedAt: stat.mtime.toISOString(),
            url,
            downloadUrl: url,
          };
        })
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      res.json({ success: true, count: files.length, files });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

module.exports = registerGeneratedRoutes;
