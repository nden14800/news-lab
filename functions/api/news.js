export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const apiKey = env.NEWSAPI_KEY;

  if (!apiKey) {
    return json({
      status: "error",
      code: "missing_api_key",
      message:
        "NEWSAPI_KEY が Cloudflare Pages の環境変数 / Secret に設定されていません。"
    }, 500);
  }

  const q = (url.searchParams.get("q") || "").trim();
  const category = (url.searchParams.get("category") || "general").trim();
  const pageSize = clampInt(
    url.searchParams.get("pageSize"),
    18,
    1,
    50
  );

  let endpoint;

  if (q) {
    const params = new URLSearchParams({
      q,
      language: "ja",
      sortBy: "publishedAt",
      pageSize: String(pageSize),
      page: "1"
    });

    endpoint = `https://newsapi.org/v2/everything?${params.toString()}`;
  } else {
    const allowed = new Set([
      "business",
      "entertainment",
      "general",
      "health",
      "science",
      "sports",
      "technology"
    ]);

    const safeCategory = allowed.has(category)
      ? category
      : "general";

    const params = new URLSearchParams({
      country: "jp",
      category: safeCategory,
      pageSize: String(pageSize),
      page: "1"
    });

    endpoint = `https://newsapi.org/v2/top-headlines?${params.toString()}`;
  }

  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "X-Api-Key": apiKey,
        "Accept": "application/json",
        "User-Agent": "NewsLab-Experimental/1.0 (+Cloudflare Pages)"
      }
    });

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      data = {
        status: "error",
        message: "News API からJSON以外のレスポンスが返りました。"
      };
    }

    if (!response.ok) {
      return json({
        status: "error",
        code: data?.code || "upstream_error",
        message:
          data?.message ||
          `News API returned HTTP ${response.status}`
      }, response.status);
    }

    return json({
      status: data.status || "ok",
      totalResults: Number(data.totalResults || 0),
      articles: Array.isArray(data.articles)
        ? data.articles
        : [],
      fetchedAt: new Date().toISOString(),
      endpoint: q ? "everything" : "top-headlines"
    });
  } catch (error) {
    return json({
      status: "error",
      code: "fetch_failed",
      message:
        error instanceof Error
          ? error.message
          : "Upstream fetch failed."
    }, 502);
  }
}

function clampInt(value, fallback, min, max) {
  const number = Number.parseInt(value || "", 10);

  if (!Number.isFinite(number)) {
    return fallback;
  }

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
