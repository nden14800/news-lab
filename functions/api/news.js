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
  const pageSize = clampInt(
    url.searchParams.get("pageSize"),
    18,
    1,
    20
  );

  try {
    let data;

    if (q) {
      /*
       * News API の Everything endpoint では、
       * 現在の公式ドキュメント上、日本語 "ja" は
       * language の有効値に含まれていません。
       *
       * そのため language=ja は付けず、
       * 日本語キーワードをそのまま検索します。
       */
      const params = new URLSearchParams({
        q,
        sortBy: "publishedAt",
        pageSize: String(pageSize),
        page: "1"
      });

      const endpoint =
        `https://newsapi.org/v2/everything?${params.toString()}`;

      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          "X-Api-Key": apiKey,
          "Accept": "application/json",
          "User-Agent": "NewsLab-Experimental/1.0"
        }
      });

      data = await readJsonResponse(response);

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

      return json({
        status: "ok",
        totalResults: Number(data.totalResults || 0),
        articles: Array.isArray(data.articles) ? data.articles : [],
        fetchedAt: new Date().toISOString(),
        endpoint: "everything",
        query: q
      });
    }

    /*
     * 日本向けカテゴリニュース
     *
     * 現在の News API では top-headlines の country パラメータとして
     * "jp" を直接利用する方式ではなく、
     * /top-headlines/sources?country=jp
     * から日本のニュースソースを取得して、
     * top-headlines? sources=...
     * に渡します。
     */
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

    const sourceParams = new URLSearchParams({
      country: "jp",
      category: safeCategory
    });

    const sourcesEndpoint =
      `https://newsapi.org/v2/top-headlines/sources?${sourceParams.toString()}`;

    const sourcesResponse = await fetch(sourcesEndpoint, {
      method: "GET",
      headers: {
        "X-Api-Key": apiKey,
        "Accept": "application/json",
        "User-Agent": "NewsLab-Experimental/1.0"
      }
    });

    const sourcesData = await readJsonResponse(sourcesResponse);

    if (!sourcesResponse.ok || sourcesData.status === "error") {
      return json(
        {
          status: "error",
          code: sourcesData?.code || "sources_error",
          message:
            sourcesData?.message ||
            `News API sources returned HTTP ${sourcesResponse.status}`
        },
        sourcesResponse.status
      );
    }

    const sources = Array.isArray(sourcesData.sources)
      ? sourcesData.sources
      : [];

    if (!sources.length) {
      /*
       * 日本ソースが取れなかった場合は、
       * 一般検索にフォールバックします。
       */
      const fallbackQuery =
        safeCategory === "general"
          ? "日本"
          : getFallbackKeyword(safeCategory);

      const fallbackParams = new URLSearchParams({
        q: fallbackQuery,
        sortBy: "publishedAt",
        pageSize: String(pageSize),
        page: "1"
      });

      const fallbackEndpoint =
        `https://newsapi.org/v2/everything?${fallbackParams.toString()}`;

      const fallbackResponse = await fetch(fallbackEndpoint, {
        method: "GET",
        headers: {
          "X-Api-Key": apiKey,
          "Accept": "application/json",
          "User-Agent": "NewsLab-Experimental/1.0"
        }
      });

      const fallbackData =
        await readJsonResponse(fallbackResponse);

      if (!fallbackResponse.ok || fallbackData.status === "error") {
        return json(
          {
            status: "error",
            code: fallbackData?.code || "fallback_error",
            message:
              fallbackData?.message ||
              `Fallback request returned HTTP ${fallbackResponse.status}`
          },
          fallbackResponse.status
        );
      }

      return json({
        status: "ok",
        totalResults: Number(fallbackData.totalResults || 0),
        articles: Array.isArray(fallbackData.articles)
          ? fallbackData.articles
          : [],
        fetchedAt: new Date().toISOString(),
        endpoint: "everything-fallback",
        category: safeCategory
      });
    }

    /*
     * top-headlines の sources パラメータは最大20ソース。
     */
    const sourceIds = sources
      .map((source) => source?.id)
      .filter(Boolean)
      .slice(0, 20)
      .join(",");

    if (!sourceIds) {
      return json({
        status: "ok",
        totalResults: 0,
        articles: [],
        fetchedAt: new Date().toISOString(),
        endpoint: "top-headlines",
        category: safeCategory
      });
    }

    const headlineParams = new URLSearchParams({
      sources: sourceIds,
      pageSize: String(pageSize),
      page: "1"
    });

    const headlineEndpoint =
      `https://newsapi.org/v2/top-headlines?${headlineParams.toString()}`;

    const headlineResponse = await fetch(headlineEndpoint, {
      method: "GET",
      headers: {
        "X-Api-Key": apiKey,
        "Accept": "application/json",
        "User-Agent": "NewsLab-Experimental/1.0"
      }
    });

    const headlineData =
      await readJsonResponse(headlineResponse);

    if (!headlineResponse.ok || headlineData.status === "error") {
      return json(
        {
          status: "error",
          code: headlineData?.code || "headlines_error",
          message:
            headlineData?.message ||
            `News API headlines returned HTTP ${headlineResponse.status}`
        },
        headlineResponse.status
      );
    }

    return json({
      status: "ok",
      totalResults: Number(headlineData.totalResults || 0),
      articles: Array.isArray(headlineData.articles)
        ? headlineData.articles
        : [],
      fetchedAt: new Date().toISOString(),
      endpoint: "top-headlines",
      category: safeCategory,
      sources: sources.map((source) => ({
        id: source.id,
        name: source.name
      }))
    });
  } catch (error) {
    return json(
      {
        status: "error",
        code: "fetch_failed",
        message:
          error instanceof Error
            ? error.message
            : "Upstream fetch failed."
      },
      502
    );
  }
}

async function readJsonResponse(response) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return {
      status: "error",
      code: "invalid_json",
      message:
        "News API からJSON以外のレスポンスが返りました。"
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

function getFallbackKeyword(category) {
  const keywords = {
    business: "ビジネス OR 経済 OR 企業",
    entertainment: "エンタメ OR 映画 OR 音楽",
    health: "医療 OR 健康",
    science: "科学 OR 宇宙",
    sports: "スポーツ",
    technology: "テクノロジー OR AI OR IT",
    general: "日本"
  };

  return keywords[category] || keywords.general;
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
