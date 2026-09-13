export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const apiKey = env.NEWSAPI_KEY;

  if (!apiKey) {
    return json(
      {
        status: "error",
        code: "missing_api_key",
        message:
          "NEWSAPI_KEY が Cloudflare Pages の環境変数 / Secret に設定されていません。"
      },
      500
    );
  }

  const q = (url.searchParams.get("q") || "").trim();
  const category = (url.searchParams.get("category") || "general").trim();
  const pageSize = clampInt(url.searchParams.get("pageSize"), 18, 1, 20);

  try {
    let articles = [];
    let totalResults = 0;
    let endpoint = "";

    if (q) {
      const jpSources = await fetchJapaneseSources(apiKey);
      const sourceIds = jpSources
        .map((source) => source?.id)
        .filter(Boolean)
        .slice(0, 20)
        .join(",");

      const params = new URLSearchParams({
        q,
        sortBy: "publishedAt",
        pageSize: "50",
        page: "1"
      });

      if (sourceIds) {
        params.set("sources", sourceIds);
      }

      const apiUrl = `https://newsapi.org/v2/everything?${params.toString()}`;
      const response = await newsApiFetch(apiUrl, apiKey);
      const data = await readJsonResponse(response);

      if (!response.ok || data.status === "error") {
        return json(
          {
            status: "error",
            code: data?.code || "upstream_error",
            message:
              data?.message ||
              `News API returned HTTP ${response.status}`
          },
          response.status
        );
      }

      totalResults = Number(data.totalResults || 0);
      endpoint = "everything";
      articles = filterJapaneseArticles(
        Array.isArray(data.articles) ? data.articles : []
      );
    } else {
      const allowedCategories = new Set([
        "business",
        "entertainment",
        "general",
        "health",
        "science",
        "sports",
        "technology"
      ]);

      const safeCategory = allowedCategories.has(category)
        ? category
        : "general";

      const sources = await fetchJapaneseSources(apiKey, safeCategory);
      const sourceIds = sources
        .map((source) => source?.id)
        .filter(Boolean)
        .slice(0, 20)
        .join(",");

      if (!sourceIds) {
        return json({
          status: "ok",
          totalResults: 0,
          filteredResults: 0,
          articles: [],
          fetchedAt: new Date().toISOString(),
          endpoint: "top-headlines",
          category: safeCategory,
          language: "ja"
        });
      }

      const headlineParams = new URLSearchParams({
        sources: sourceIds,
        pageSize: "100",
        page: "1"
      });

      const headlinesUrl =
        `https://newsapi.org/v2/top-headlines?${headlineParams.toString()}`;
      const headlinesResponse = await newsApiFetch(headlinesUrl, apiKey);
      const headlinesData = await readJsonResponse(headlinesResponse);

      if (!headlinesResponse.ok || headlinesData.status === "error") {
        return json(
          {
            status: "error",
            code: headlinesData?.code || "headlines_error",
            message:
              headlinesData?.message ||
              `News API returned HTTP ${headlinesResponse.status}`
          },
          headlinesResponse.status
        );
      }

      totalResults = Number(headlinesData.totalResults || 0);
      endpoint = "top-headlines";

      // country=jp の source を指定済みなので、カテゴリ取得では
      // 記事本文の文字比率フィルタをかけず、取得した記事をそのまま利用する。
      articles = Array.isArray(headlinesData.articles)
        ? headlinesData.articles
        : [];

      articles = deduplicateArticles(articles);

      return json({
        status: "ok",
        totalResults,
        filteredResults: Math.min(articles.length, pageSize),
        articles: sortArticles(articles).slice(0, pageSize),
        fetchedAt: new Date().toISOString(),
        endpoint,
        category: safeCategory,
        language: "ja"
      });
    }

    articles = sortArticles(articles).slice(0, pageSize);

    return json({
      status: "ok",
      totalResults,
      filteredResults: articles.length,
      articles,
      fetchedAt: new Date().toISOString(),
      endpoint,
      language: "ja"
    });
  } catch (error) {
    return json(
      {
        status: "error",
        code: "fetch_failed",
        message:
          error instanceof Error ? error.message : "Upstream fetch failed."
      },
      502
    );
  }
}

async function fetchJapaneseSources(apiKey, category = "") {
  const params = new URLSearchParams({ country: "jp" });

  if (category) {
    params.set("category", category);
  }

  const apiUrl =
    `https://newsapi.org/v2/top-headlines/sources?${params.toString()}`;
  const response = await newsApiFetch(apiUrl, apiKey);
  const data = await readJsonResponse(response);

  if (!response.ok || data.status === "error") {
    throw new Error(
      data?.message ||
        `News API sources returned HTTP ${response.status}`
    );
  }

  return Array.isArray(data.sources) ? data.sources : [];
}

async function newsApiFetch(apiUrl, apiKey) {
  return fetch(apiUrl, {
    method: "GET",
    headers: {
      "X-Api-Key": apiKey,
      Accept: "application/json",
      "User-Agent": "NewsLab-Experimental/1.0"
    }
  });
}

function filterJapaneseArticles(articles) {
  return articles.filter((article) => {
    if (!article || typeof article !== "object") {
      return false;
    }

    const title = cleanText(article.title);
    const description = cleanText(article.description);

    if (!title) {
      return false;
    }

    const text = `${title} ${description}`.trim();
    const japaneseCharacters =
      text.match(
        /[\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g
      ) || [];
    const latinCharacters = text.match(/[A-Za-z]/g) || [];

    // 検索結果では、日本語文字が一切ない英語記事だけ除外する。
    // 「AI」「NHK」「Apple」など英字を含む日本語記事は残す。
    if (japaneseCharacters.length === 0 && latinCharacters.length >= 8) {
      return false;
    }

    return true;
  });
}

function deduplicateArticles(articles) {
  const seen = new Set();

  return articles.filter((article) => {
    const url = cleanText(article.url);
    const title = cleanText(article.title)
      .toLowerCase()
      .replace(/\s+/g, " ");

    const key =
      url || `${title}|${cleanText(article.source?.name)}`;

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function sortArticles(articles) {
  return [...articles].sort((a, b) => {
    const aTime = Date.parse(a.publishedAt || "") || 0;
    const bTime = Date.parse(b.publishedAt || "") || 0;
    return bTime - aTime;
  });
}

function cleanText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim();
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
