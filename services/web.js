const { envValue, numberEnv } = require("../core/env");
const { DEEPSEEK_MODEL_FAST } = require("../core/models");
const { askDeepSeek } = require("./deepseek");
const { normalizeText, limitText, getLastUserText, clampMaxTokens } = require("../utils/text");

const LUCY_WEB_RESULT_LIMIT = Math.min(numberEnv("LUCY_WEB_RESULT_LIMIT", 8), 10);
const LUCY_WEB_PAGE_READ_LIMIT = Math.min(numberEnv("LUCY_WEB_PAGE_READ_LIMIT", 2), 5);

function isWebMode(body = {}) {
  const mode = String(body.mode || body.modeId || body.apiMode || "").toLowerCase();
  return body.webSearch === true || body.webSearch === "true" || mode === "web" || mode.includes("web");
}

function decodeHtml(value = "") {
  return String(value || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&#x2F;/g, "/");
}

function stripHtml(html = "") {
  return decodeHtml(String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function extractTitle(html = "") {
  const title = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return normalizeText(stripHtml(title || ""));
}

function extractMetaDescription(html = "") {
  const meta = String(html || "").match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1]
    || String(html || "").match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:description|og:description)["'][^>]*>/i)?.[1];
  return normalizeText(decodeHtml(meta || ""));
}

function extractUrlsFromText(text = "") {
  const value = String(text || "");
  const urls = new Set();
  for (const match of value.match(/https?:\/\/[^\s)\]}>'"]+/gi) || []) urls.add(match.replace(/[.,;:!?]+$/, ""));
  for (const match of value.match(/\b([a-z0-9-]+\.)+[a-z]{2,}(?:\/[\w\-./?%&=#:+]*)?/gi) || []) {
    const clean = match.replace(/[.,;:!?]+$/, "");
    if (!/^https?:\/\//i.test(clean)) urls.add(`https://${clean}`);
  }
  return Array.from(urls).slice(0, 4);
}

function buildWebSearchQuery(text = "") {
  const clean = normalizeText(text)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/[^\s)\]}>'"]+/gi, " ")
    .replace(/[#*_>`~|{}[\]();]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  return clean.length <= 280 ? clean : clean.slice(0, 280);
}

async function fetchText(url, options = {}) {
  const timeoutMs = options.timeoutMs || 12000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LUCY-WebReader/1.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
        ...(options.headers || {}),
      },
    });
    const text = await response.text().catch(() => "");
    return { ok: response.ok, status: response.status, finalUrl: response.url || url, text, contentType: response.headers.get("content-type") || "" };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPageSummary(url = "") {
  const attempts = [url];
  if (url.startsWith("https://")) attempts.push(url.replace("https://", "http://"));
  if (!url.includes("www.")) attempts.push(url.replace(/^https?:\/\//, (m) => `${m}www.`));
  let lastError = "";
  for (const attempt of Array.from(new Set(attempts))) {
    try {
      const result = await fetchText(attempt);
      if (!result.ok || !result.text) { lastError = `HTTP ${result.status}`; continue; }
      const isHtml = result.contentType.includes("html") || /<html|<body|<title/i.test(result.text);
      const title = isHtml ? extractTitle(result.text) : "";
      const description = isHtml ? extractMetaDescription(result.text) : "";
      const bodyText = isHtml ? stripHtml(result.text) : normalizeText(result.text);
      const content = limitText([description, bodyText].filter(Boolean).join("\n\n"), 18000);
      if (content.length >= 160 || title || description) return { title: title || attempt, text: content, url: result.finalUrl || attempt };
      lastError = "Sayfadan yeterli metin çıkmadı";
    } catch (error) {
      lastError = error.message || "erişim hatası";
    }
  }
  return { title: url, text: "", url, error: lastError || "Sayfa okunamadı" };
}

async function searchGoogleApi(query = "") {
  const key = envValue("GOOGLE_SEARCH_API_KEY") || envValue("GOOGLE_API_KEY");
  const cx = envValue("GOOGLE_SEARCH_ENGINE_ID") || envValue("GOOGLE_CSE_ID") || envValue("GOOGLE_CX");
  if (!key || !cx) return [];
  const url = `https://www.googleapis.com/customsearch/v1?${new URLSearchParams({ key, cx, q: query, num: String(Math.min(LUCY_WEB_RESULT_LIMIT, 10)), safe: "off" }).toString()}`;
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "LUCY-GoogleSearch/1.0" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Google arama API hatası: ${response.status}`);
  return (data.items || []).map((item) => ({ provider: "google", title: item.title || item.htmlTitle || item.link || "Google sonucu", text: item.snippet || item.htmlSnippet || "", url: item.link || "" })).filter((item) => item.text || item.url).slice(0, LUCY_WEB_RESULT_LIMIT);
}

function flattenDuckDuckGoTopics(topics = [], out = []) {
  for (const item of topics || []) {
    if (item?.Text || item?.FirstURL) out.push({ title: item.Text || item.Result || "Sonuç", text: item.Text || "", url: item.FirstURL || "" });
    if (Array.isArray(item?.Topics)) flattenDuckDuckGoTopics(item.Topics, out);
  }
  return out;
}

async function searchDuckDuckGoApi(query = "") {
  const url = `https://api.duckduckgo.com/?${new URLSearchParams({ q: query, format: "json", no_html: "1", no_redirect: "1", skip_disambig: "1" }).toString()}`;
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "LUCY-WebSearch/1.0" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`DuckDuckGo API hatası: ${response.status}`);
  const results = [];
  if (data.AbstractText) results.push({ title: data.Heading || "DuckDuckGo özet", text: data.AbstractText, url: data.AbstractURL || data.AbstractSource || "" });
  if (data.Answer) results.push({ title: "Anlık cevap", text: data.Answer, url: data.AnswerType || "" });
  flattenDuckDuckGoTopics(data.RelatedTopics).slice(0, 8).forEach((item) => results.push({ title: item.title, text: item.text || item.title, url: item.url }));
  return results.filter((item) => item.text || item.url).slice(0, 8);
}

async function searchDuckDuckGoHtml(query = "") {
  const url = `https://html.duckduckgo.com/html/?${new URLSearchParams({ q: query }).toString()}`;
  const response = await fetchText(url, { headers: { Accept: "text/html" }, timeoutMs: 9000 });
  if (!response.ok || !response.text) return [];

  const html = response.text;
  const chunks = html.split(/<div class="result[\s\S]*?">/i).slice(1, 10);
  const results = [];

  for (const chunk of chunks) {
    const hrefRaw = chunk.match(/class="result__a"[^>]+href="([^"]+)"/i)?.[1]
      || chunk.match(/<a[^>]+href="([^"]+)"[^>]*>/i)?.[1]
      || "";
    const title = stripHtml(chunk.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/i)?.[1] || "");
    const snippet = stripHtml(chunk.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i)?.[1]
      || chunk.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i)?.[1]
      || "");

    let href = decodeHtml(hrefRaw);
    try {
      if (href.includes("duckduckgo.com/l/?")) {
        const parsed = new URL(href.startsWith("http") ? href : `https:${href}`);
        href = parsed.searchParams.get("uddg") || href;
      }
    } catch {}

    if (title || snippet || href) results.push({ provider: "duckduckgo", title: title || href || "Sonuç", text: snippet || title, url: href });
  }

  return results.slice(0, 8);
}


async function searchWeb(query = "") {
  const safeQuery = buildWebSearchQuery(query);
  if (!safeQuery) return [];
  const [googleResults, duckApiResults] = await Promise.all([
    searchGoogleApi(safeQuery).catch(() => []),
    searchDuckDuckGoApi(safeQuery).catch(() => []),
  ]);
  const duckHtmlResults = duckApiResults.length ? [] : await searchDuckDuckGoHtml(safeQuery).catch(() => []);
  const seen = new Set();
  return [...googleResults, ...duckApiResults, ...duckHtmlResults].filter((item) => {
    const key = item.url || item.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, LUCY_WEB_RESULT_LIMIT);
}

async function collectWebContext(query = "") {
  const urls = extractUrlsFromText(query);
  const searchQuery = buildWebSearchQuery(query);
  const pages = [];
  for (const url of urls) pages.push(await fetchPageSummary(url));
  const searchResults = await searchWeb(searchQuery).catch((error) => [{ title: "Arama hatası", text: error.message, url: "" }]);
  for (const item of searchResults.slice(0, LUCY_WEB_PAGE_READ_LIMIT)) {
    if (item.url && /^https?:\/\//i.test(item.url)) {
      const page = await fetchPageSummary(item.url);
      if (page.text) pages.push(page);
    }
  }
  return {
    urls,
    pages,
    usefulPages: pages.filter((item) => normalizeText(item.text).length >= 120),
    searchResults: searchResults.filter((item) => normalizeText(item.text).length >= 30 || item.url),
    searchQuery,
  };
}

async function buildLiveWebBody(body = {}, plan = {}) {
  const lastUserText = getLastUserText(body.messages);
  const searchText = normalizeText(plan.query || plan.resolved_request || lastUserText);
  const resolvedRequest = normalizeText(plan.resolved_request || searchText || lastUserText);
  const web = await collectWebContext(searchText);
  const contextItems = [];
  web.usefulPages.forEach((item) => contextItems.push(`KAYNAK ${contextItems.length + 1}\nSağlayıcı: ${item.provider || "web"}\nBaşlık: ${item.title || item.url}\nURL: ${item.url}\nMetin:\n${limitText(item.text, 2400)}`));
  web.searchResults.forEach((item) => contextItems.push(`KAYNAK ${contextItems.length + 1}\nSağlayıcı: ${item.provider || "web"}\nBaşlık: ${item.title}\nURL: ${item.url || "yok"}\nÖzet:\n${item.text || ""}`));

  if (!contextItems.length) {
    const tried = web.urls.length ? `\nDenenen URL: ${web.urls.join(", ")}` : "";
    return { instantAnswer: `Web açık ama bu sorgu için okunabilir kaynak metni bulamadım.${tried}\n\nYanlış bilgi üretmemek için cevap vermiyorum. Daha net bir arama cümlesi veya farklı bir URL gönder.` };
  }

  const webContext = contextItems.slice(0, 5).map((item) => limitText(item, 2600)).join("\n\n---\n\n");
  return {
    requestBody: {
      ...body,
      webSearch: false,
      max_tokens: clampMaxTokens(plan.max_tokens || body.max_tokens || body.options?.max_tokens, 8000),
      messages: [{ role: "user", content: `Kullanıcı sorusu: ${lastUserText}\nArama bağlamı: ${searchText}\n\nWEB_CONTEXT aşağıda. Sadece bu kaynaklara dayanarak cevap ver. Kaynaklarda olmayan şeyi uydurma. Eğer kaynaklar yetersizse açıkça "Kaynaklar bunu göstermiyor" de. Türkçe cevap ver ve sonunda kaynak URL'lerini kısa listele.\n\nWEB_CONTEXT:\n${webContext}` }],
      systemHint: `${body.systemHint || ""}\nWeb modu aktif. Google araması varsa öncelikli kullan. Sadece WEB_CONTEXT kullan. Kaynak dışı tahmin yapma.`,
    },
  };
}

async function answerLiveWebIfNeeded(body = {}, plan = null) {
  if (!isWebMode(body) && !plan?.needs_web) return null;
  const liveWeb = await buildLiveWebBody(body, plan || {});
  if (liveWeb.instantAnswer) return liveWeb.instantAnswer;
  return askDeepSeek(liveWeb.requestBody);
}

module.exports = {
  isWebMode,
  buildLiveWebBody,
  answerLiveWebIfNeeded,
};
