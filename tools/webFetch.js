const axios = require("axios");
const cheerio = require("cheerio");

module.exports = {
  name: "webFetch",
  description: "Bir web sayfasının başlık ve temel metin özetini çeker",

  async execute(input = {}) {
    const url = String(input.url || "").trim();

    if (!/^https?:\/\//i.test(url)) {
      return {
        success: false,
        error: "valid_url_required",
        message: "Geçerli http/https URL gerekli.",
      };
    }

    try {
      const response = await axios.get(url, {
        timeout: 12000,
        maxContentLength: 2_000_000,
        headers: { "User-Agent": "LUCY-Web/1.0" },
      });

      const $ = cheerio.load(response.data);
      const title = $("title").first().text().trim();
      const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 4000);

      return {
        success: true,
        url,
        title,
        text,
      };
    } catch (error) {
      return {
        success: false,
        error: "fetch_failed",
        message: error.message,
      };
    }
  },
};
