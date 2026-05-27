function registerExportRoutes(app, deps) {
  const {
    fs,
    ARCHIVE_FILE,
    exporterChatTitle,
    exporterMessages,
    exporterPlainText,
    exporterMarkdown,
    exporterJson,
    exporterJsonl,
    exporterYaml,
    exporterOfficeTable,
    exporterDocx,
    exporterXlsx,
    exporterPdf,
    exporterSvg,
  } = deps;

  app.post("/api/export-chat", async (req, res) => {
    try {
      const format = String(req.body?.format || "html").toLowerCase();
      const title = exporterChatTitle(req.body?.chatTitle || req.body?.title || "Lucy sohbet");
      const messages = exporterMessages(req.body?.messages || []);
      const base = `${title.replace(/\s+/g, "-") || "lucy-sohbet"}-${Date.now()}`;
      let buffer;
      let ext = format;
      let mime = "application/octet-stream";

      if (format === "txt") { buffer = Buffer.from(exporterPlainText(title, messages), "utf8"); mime = "text/plain;charset=utf-8"; }
      else if (format === "md") { buffer = Buffer.from(exporterMarkdown(title, messages), "utf8"); mime = "text/markdown;charset=utf-8"; }
      else if (format === "json") { buffer = Buffer.from(exporterJson(title, messages), "utf8"); mime = "application/json;charset=utf-8"; }
      else if (format === "jsonl") { buffer = Buffer.from(exporterJsonl(messages), "utf8"); mime = "application/x-ndjson;charset=utf-8"; }
      else if (format === "yaml" || format === "yml") { buffer = Buffer.from(exporterYaml(title, messages), "utf8"); ext = "yaml"; mime = "application/x-yaml;charset=utf-8"; }
      else if (format === "doc") { buffer = Buffer.from(exporterOfficeTable(title, messages), "utf8"); mime = "application/msword;charset=utf-8"; }
      else if (format === "xls") { buffer = Buffer.from(exporterOfficeTable(title, messages), "utf8"); mime = "application/vnd.ms-excel;charset=utf-8"; }
      else if (format === "docx") { buffer = exporterDocx(title, messages); mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"; }
      else if (format === "xlsx") { buffer = exporterXlsx(title, messages); mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"; }
      else if (format === "pdf") { buffer = await exporterPdf(title, messages); mime = "application/pdf"; }
      else if (format === "image" || format === "resim" || format === "svg") { buffer = Buffer.from(exporterSvg(title, messages), "utf8"); ext = "svg"; mime = "image/svg+xml;charset=utf-8"; }
      else { buffer = Buffer.from(exporterHtml(title, messages), "utf8"); ext = "html"; mime = "text/html;charset=utf-8"; }

      res.json({ success: true, filename: `${base}.${ext}`, ext, mime, base64: buffer.toString("base64") });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/archive", async (req, res) => {
    try {
      if (!fs.existsSync(ARCHIVE_FILE)) {
        fs.writeFileSync(
          ARCHIVE_FILE,
          JSON.stringify(
            {
              version: "lucy-v11.9.0",
              updatedAt: new Date().toISOString(),
              chats: [],
              gpts: [],
              academy: [],
              projects: [],
              memory: "",
              exporter: [],
              live: {},
            },
            null,
            2
          )
        );
      }

      const raw = fs.readFileSync(ARCHIVE_FILE, "utf8");
      const data = JSON.parse(raw);

      res.json(data);
    } catch (err) {
      console.error("Archive read error:", err);
      res.status(500).json({
        error: "archive_read_failed",
      });
    }
  });
}

module.exports = registerExportRoutes;
