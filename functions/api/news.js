export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const apiKey = env.NEWSAPI_KEY;

  if (!apiKey) {
    return json({
      status: "error",
      code: "missing_api_key",
      message: "NEWSAPI_KEY が Cloudflare Pages の環境変数 / Secret に設定されていません。"
    }, 500);
  }

  const q = (url.searchParams.get("q") || "").trim();
  const category = (url.searchParams.get("category") || "general").trim();
  const pageSize = clampInt(url.searchParams.get("pageSize"), 18, 1, 20);
  const categories = new Set([
    "business",
    "entertainment",
    "general",
    "health",
    "science",
    "sports",
    "technology"
  ]);
  const safeCategory = categories.has(category) ? category : "general";

  try {
    let endpoint;
    let params;

    if (q) {
      params = new URLSearchParams({
        q,
        sortBy: "publishedAt",
        pageSize: String(Math.min(100, Math.max(20, pageSize * 3))),
        page: "1"
      });
      endpoint = "everything";
    } else {
      params = new URLSearchParams({
        country: "us",
        category: safeCategory,
        pageSize: String(Math.min(100, Math.max(20, pageSize))),
        page: "1"
      });
      endpoint = "top-headlines";
    }

    const response = await newsApiFetch(
      `https://newsapi.org/v2/${endpoint}?${params.toString()}`,
      apiKey
    );
    const data = await readJsonResponse(response);

    if (!response.ok || data.status === "error") {
      return json({
        status: "error",
        code: data?.code || "upstream_error",
        message: data?.message || `News API returned HTTP ${response.status}`
      }, response.status);
    }

    let articles = Array.isArray(data.articles) ? data.articles : [];

    if (q) {
      articles = deduplicateArticles(articles);
    } else {
      articles = deduplicateArticles(articles);
    }

    articles = sortArticles(articles).slice(0, pageSize);

    return json({
      status: "ok",
      totalResults: Number(data.totalResults || 0),
      filteredResults: articles.length,
      articles,
      fetchedAt: new Date().toISOString(),
      endpoint,
      category: safeCategory,
      language: q ? "any" : "en",
      country: "us"
    });
  } catch (error) {
    return json({
      status: "error",
      code: "fetch_failed",
      message: error instanceof Error ? error.message : "Upstream fetch failed."
    }, 502);
  }
}

async function newsApiFetch(apiUrl, apiKey) {
  return fetch(apiUrl, {
    method: "GET",
    headers: {
      "X-Api-Key": apiKey,
      "Accept": "application/json",
      "User-Agent": "NewsLab-Experimental/1.0"
    }
  });
}

function deduplicateArticles(articles) {
  const seen = new Set();

  return articles.filter((article) => {
    if (!article || typeof article !== "object") return false;

    const url = cleanText(article.url);
    const title = cleanText(article.title)
      .toLowerCase()
      .replace(/\s+/g, " ");
    const key = url || `${title}|${cleanText(article.source?.name)}`;

    if (!key || seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function sortArticles(articles) {
  return [...articles].sort((a, b) => {
    const aTime = Date.parse(a?.publishedAt || "") || 0;
    const bTime = Date.parse(b?.publishedAt || "") || 0;
    return bTime - aTime;
  });
}

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

async function readJsonResponse(response) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return {
      status: "error",
      code: "invalid_json",
      message: "News API からJSON以外のレスポンスが返りました。"
    };
  }
}

function clampInt(value, fallback, min, max) {
  const number = Number.parseInt(value || "", 10);

  if (!Number.isFinite(number)) return fallback;

  return Math.max(min, Math.min(max, number));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}
