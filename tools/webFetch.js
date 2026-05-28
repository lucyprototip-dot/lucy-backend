const axios = require("axios");
const cheerio = require("cheerio");
const { assertPublicHttpUrl } = require("../core/securityGuards");

module.exports = {
  name: "webFetch",
  description: "Bir public web sayfasının başlık ve temel metin özetini güvenli şekilde çeker",

  async execute(input = {}) {
    const rawUrl = String(input.url || "").trim();

    let url;
    try {
      url = await assertPublicHttpUrl(rawUrl);
    } catch (error) {
      return {
        success: false,
        error: error.code || "url_blocked",
        message: error.message || "Güvenli ve geçerli public http/https URL gerekli.",
      };
    }

    try {
      const response = await axios.get(url, {
        timeout: Number(process.env.LUCY_WEBFETCH_TIMEOUT_MS || 10000),
        maxContentLength: Number(process.env.LUCY_WEBFETCH_MAX_BYTES || 1_500_000),
        maxBodyLength: Number(process.env.LUCY_WEBFETCH_MAX_BYTES || 1_500_000),
        maxRedirects: 0,
        responseType: "text",
        transformResponse: [(data) => data],
        validateStatus: (status) => status >= 200 && status < 300,
        headers: {
          "User-Agent": "LUCY-Web/1.0 (+safe-fetch)",
          "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        },
      });

      const contentType = String(response.headers?.["content-type"] || "").toLowerCase();
      if (contentType && !/(text\/html|application\/xhtml\+xml|text\/plain)/i.test(contentType)) {
        return {
          success: false,
          error: "unsupported_content_type",
          message: `Bu içerik türü webFetch için uygun değil: ${contentType}`,
          url,
        };
      }

      const $ = cheerio.load(String(response.data || ""));
      $("script, style, noscript, iframe, object, embed").remove();
      const title = $("title").first().text().replace(/\s+/g, " ").trim();
      const text = ($("main").text() || $("article").text() || $("body").text() || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, Number(process.env.LUCY_WEBFETCH_TEXT_LIMIT || 4000));

      return {
        success: true,
        url,
        title,
        text,
        contentType,
      };
    } catch (error) {
      const status = error?.response?.status;
      return {
        success: false,
        error: status && status >= 300 && status < 400 ? "redirect_blocked" : "fetch_failed",
        message: status && status >= 300 && status < 400
          ? "Güvenlik nedeniyle yönlendirmeli URL otomatik takip edilmedi. Son hedef URL'yi doğrudan ver."
          : error.message,
        url,
        status,
      };
    }
  },
};
