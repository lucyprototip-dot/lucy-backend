const { envValue, numberEnv } = require("../core/env");
const { DEEPSEEK_MODEL_FAST } = require("../core/models");
const { askDeepSeek } = require("./deepseek");
const {
  normalizeText,
  normalizeMessages,
  limitText,
  getLastUserText,
  clampMaxTokens,
} = require("../utils/text");

const LUCY_WEB_RESULT_LIMIT = Math.min(numberEnv("LUCY_WEB_RESULT_LIMIT", 8), 10);
const LUCY_WEB_PAGE_READ_LIMIT = Math.min(numberEnv("LUCY_WEB_PAGE_READ_LIMIT", 2), 5);
const TRACE = String(process.env.LUCY_TRACE || "").toLowerCase() === "true";

function trace(label, data = {}) {
  if (!TRACE) return;
  try { console.log(`[LUCY_TRACE] ${label}`, JSON.stringify(data).slice(0, 4000)); } catch {}
}

function isWebMode(body = {}) {
  // Tek kaynak: frontend webSearch boolean. mode/modeId/web geçmişi web açamaz.
  return body.webSearch === true || body.webSearch === "true" || body.webSearch === 1 || body.webSearch === "1";
}

function compactConversation(messages = [], limit = 10) {
  return normalizeMessages(messages)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-limit)
    .map((m) => `${m.role === "user" ? "Kullanıcı" : "Lucy"}: ${m.content}`)
    .join("\n");
}

function fallbackQueryFromConversation(messages = []) {
  const normalized = normalizeMessages(messages);
  const users = normalized.filter((m) => m.role === "user").map((m) => m.content);
  if (!users.length) return "";
  const last = users[users.length - 1] || "";
  const previous = [...users].slice(0, -1).reverse().find((t) => normalizeText(t).length > 3) || "";
  return normalizeText(previous ? `${previous}\nTakip: ${last}` : last);
}

function extractRecentDomain(messages = []) {
  const text = normalizeMessages(messages).slice(-8).map((m) => m.content).join("\n");
  const match = text.match(/\b([a-z0-9-]+\.)+[a-z]{2,}(?:\/[\w\-./?%&=#:+]*)?/i);
  return match ? match[0].replace(/[.,;:!?]+$/, "") : "";
}

function isLowInformationQuery(query = "") {
  const clean = normalizeText(query).replace(/https?:\/\/[^\s]+/gi, "");
  if (!clean) return true;
  if (/\b([a-z0-9-]+\.)+[a-z]{2,}/i.test(clean)) return false;
  const words = clean.split(/\s+/).filter(Boolean);
  return words.length <= 3 && clean.length <= 40;
}

function strengthenQueryWithContext(query = "", body = {}) {
  let out = normalizeText(query);
  const fallback = fallbackQueryFromConversation(body.messages);
  const recentDomain = extractRecentDomain(body.messages);
  if (isLowInformationQuery(out) && fallback) out = fallback;
  if (recentDomain && !out.toLowerCase().includes(recentDomain.toLowerCase())) {
    out = normalizeText(`${recentDomain} ${out}`);
  }
  return out || fallback;
}

async function planWebSearchQueryWithDeepSeek(body = {}) {
  const deepSeekKey = envValue("DEEPSEEK_API_KEY") || envValue("DEEPSEEK_API_KEY_ALT");
  const conversation = compactConversation(body.messages, 10);
  const fallbackQuery = fallbackQueryFromConversation(body.messages);

  if (!deepSeekKey || !conversation) return fallbackQuery;

  const plannerPayload = {
    model: DEEPSEEK_MODEL_FAST,
    temperature: 0,
    max_tokens: 220,
    stream: false,
    messages: [
      {
        role: "system",
        content: [
          "Sen sadece web arama sorgusu üreten iç planlayıcısın.",
          "Kullanıcıya cevap yazma.",
          "Konuşmanın tamamını yorumla; son mesaj tek başına anlamsızsa önceki somut isteğe bağla.",
          "Önceki konuşmada site/domain/firma/para birimi geçiyorsa takip isteğini ona bağla.",
          "Yazım hatalarını bağlama göre düzelt.",
          "Kullanıcıya cevap yazma, yalnızca arama motoru sorgusu üret.",
          "Cevap sadece JSON olsun.",
          "Şema: {\"query\":\"arama sorgusu\",\"reason\":\"kısa iç neden\"}",
          "query arama motoruna uygun, kısa ve net Türkçe olsun."
        ].join(" ")
      },
      { role: "user", content: JSON.stringify({ conversation, fallback_query: fallbackQuery }) }
    ]
  };

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${deepSeekKey}` },
      body: JSON.stringify(plannerPayload),
    });
    const data = await response.json().catch(() => ({}));
    const raw = data?.choices?.[0]?.message?.content || "";
    const jsonText = raw.match(/\{[\s\S]*\}/)?.[0] || "";
    const parsed = JSON.parse(jsonText);
    const query = strengthenQueryWithContext(parsed?.query || "", body);
    trace("web.plan", { query, rawQuery: parsed?.query || "", reason: parsed?.reason || "", fallbackQuery });
    return query || fallbackQuery;
  } catch (error) {
    const query = strengthenQueryWithContext(fallbackQuery, body);
    trace("web.plan.error", { error: error.message, fallbackQuery: query });
    return query;
  }
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
  const timeoutMs = options.timeoutMs || 9000;
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
  if (!response.ok) return [];
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
  if (!response.ok) return [];
  const results = [];
  if (data.AbstractText) results.push({ provider: "duckduckgo", title: data.Heading || "DuckDuckGo özet", text: data.AbstractText, url: data.AbstractURL || data.AbstractSource || "" });
  if (data.Answer) results.push({ provider: "duckduckgo", title: "Anlık cevap", text: data.Answer, url: data.AnswerType || "" });
  flattenDuckDuckGoTopics(data.RelatedTopics).slice(0, 8).forEach((item) => results.push({ provider: "duckduckgo", title: item.title, text: item.text || item.title, url: item.url }));
  return results.filter((item) => item.text || item.url).slice(0, 8);
}

async function searchDuckDuckGoHtml(query = "") {
  const url = `https://html.duckduckgo.com/html/?${new URLSearchParams({ q: query }).toString()}`;
  const response = await fetchText(url, { headers: { Accept: "text/html" }, timeoutMs: 9000 });
  if (!response.ok || !response.text) return [];
  const chunks = response.text.split(/<div class="result[\s\S]*?">/i).slice(1, 10);
  const results = [];
  for (const chunk of chunks) {
    const hrefRaw = chunk.match(/class="result__a"[^>]+href="([^"]+)"/i)?.[1] || chunk.match(/<a[^>]+href="([^"]+)"[^>]*>/i)?.[1] || "";
    const title = stripHtml(chunk.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/i)?.[1] || "");
    const snippet = stripHtml(chunk.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i)?.[1] || chunk.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || "");
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

function isJunkSearchResult(item = {}, query = "") {
  const url = String(item.url || "").toLowerCase();
  const title = String(item.title || "").toLowerCase();
  if (!url && !title) return true;
  if (url.includes("translate.google") || url.includes("instagram.com")) return true;
  if (url === "https://www.google.com" || title === "google") return true;
  return false;
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
    if (isJunkSearchResult(item, safeQuery)) return false;
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
  return { urls, pages, usefulPages: pages.filter((item) => normalizeText(item.text).length >= 120), searchResults: searchResults.filter((item) => normalizeText(item.text).length >= 30 || item.url), searchQuery };
}

function hasNumericOrSubstantialContext(contextItems = []) {
  const joined = contextItems.join("\n");
  return /\d/.test(joined) || joined.length > 900;
}

async function buildLiveWebBody(body = {}, plan = {}) {
  const conversation = compactConversation(body.messages, 10);
  const lastUserText = getLastUserText(body.messages);
  const searchText = strengthenQueryWithContext(plan.query || await planWebSearchQueryWithDeepSeek(body), body);
  const web = await collectWebContext(searchText);
  const contextItems = [];

  web.usefulPages.forEach((item) => contextItems.push(`KAYNAK ${contextItems.length + 1}\nSağlayıcı: ${item.provider || "web"}\nBaşlık: ${item.title || item.url}\nURL: ${item.url}\nMetin:\n${limitText(item.text, 2400)}`));
  web.searchResults.forEach((item) => contextItems.push(`KAYNAK ${contextItems.length + 1}\nSağlayıcı: ${item.provider || "web"}\nBaşlık: ${item.title}\nURL: ${item.url || "yok"}\nÖzet:\n${item.text || ""}`));

  trace("web.context", { searchText, sourceCount: contextItems.length, urls: web.urls, searchResults: web.searchResults.slice(0, 3).map((r) => ({ title: r.title, url: r.url })) });

  if (!contextItems.length || !hasNumericOrSubstantialContext(contextItems)) {
    return { instantAnswer: "Web açık aşkım ama güvenilir kaynak bulamadım. Kaynak yoksa kur, fiyat veya canlı veri söyleyemem." };
  }

  const webContext = contextItems.slice(0, 5).map((item) => limitText(item, 2600)).join("\n\n---\n\n");
  const finalUserContent = [
    "Konuşma bağlamı:",
    conversation,
    "",
    `Kullanıcının son isteği: ${lastUserText}`,
    `Web arama sorgusu: ${searchText}`,
    "",
    "WEB_CONTEXT aşağıda.",
    "Sadece WEB_CONTEXT içindeki kaynaklara dayanarak cevap ver.",
    "Kaynakta olmayan kur, fiyat, oran, tarih veya sayı yazma.",
    "Eski sohbet hafızasındaki kur/fiyat/sayıları yok say; canlı/güncel veri sadece WEB_CONTEXT'ten alınır.",
    "İç analiz, plan, akıl yürütme, 'kullanıcı şöyle demiş' açıklaması yazma.",
    "Asla kendi düşünme sürecini, planını veya görev yorumunu yazma.",
    "Sadece kullanıcıya verilecek nihai cevabı Türkçe yaz.",
    "Sonunda kaynak URL'lerini kısa listele.",
    "",
    `WEB_CONTEXT:\n${webContext}`
  ].join("\n");

  return {
    requestBody: {
      ...body,
      webSearch: false,
      mode: "fast",
      modeId: "fast",
      apiMode: "fast",
      thinking: false,
      max_tokens: clampMaxTokens(plan.max_tokens || body.max_tokens || body.options?.max_tokens, 8000),
      messages: [{ role: "user", content: finalUserContent }],
      systemHint: `${body.systemHint || ""}\nWeb modu aktif. Cevap final kanalındadır. İç analiz/planner/reasoning yazma. Kaynak dışı sayı veya canlı veri verme.`.trim(),
    },
  };
}

async function answerLiveWebIfNeeded(body = {}, plan = null) {
  if (!isWebMode(body) && !plan?.needs_web) return null;
  const finalPlan = plan || { needs_web: true, query: await planWebSearchQueryWithDeepSeek(body), max_tokens: 8000 };
  const liveWeb = await buildLiveWebBody(body, finalPlan);
  if (liveWeb.instantAnswer) return liveWeb.instantAnswer;
  return askDeepSeek(liveWeb.requestBody);
}

module.exports = { isWebMode, planWebSearchQueryWithDeepSeek, buildLiveWebBody, answerLiveWebIfNeeded };
