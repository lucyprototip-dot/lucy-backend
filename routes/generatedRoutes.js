function registerGeneratedRoutes(app, deps) {
  const { fs, path, GENERATED_DIR, GENERATED_PUBLIC_PATH, ensureGeneratedDir, publicBaseUrl, envBool } = deps;

  app.get("/api/generated", (req, res) => {
    try {
      if (!envBool?.("LUCY_ENABLE_GENERATED_LIST", false)) {
        return res.status(403).json({
          success: false,
          error: "generated_list_disabled",
          message: "Generated dosya listeleme güvenlik nedeniyle kapalı. Linkler tool çıktılarında tekil olarak döner.",
        });
      }

      ensureGeneratedDir();
      const files = fs.readdirSync(GENERATED_DIR)
        .filter((name) => !name.startsWith("."))
        .map((name) => {
          const filePath = path.join(GENERATED_DIR, name);
          const stat = fs.statSync(filePath);
          if (!stat.isFile()) return null;
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
        .filter(Boolean)
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .slice(0, Number(process.env.LUCY_GENERATED_LIST_LIMIT || 100));
      res.json({ success: true, count: files.length, files });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

module.exports = registerGeneratedRoutes;
