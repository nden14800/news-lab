```js
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
    let articles = [];
    let totalResults = 0;
    let endpoint = "";

    if (q) {
      const params = new URLSearchParams({
        q,
        sortBy: "publishedAt",
        pageSize: "50",
        page: "1"
      });

      const apiUrl =
        `https://newsapi.org/v2/everything?${params.toString()}`;

      const response = await fetch(apiUrl, {
        method: "GET",
        headers: {
          "X-Api-Key": apiKey,
          "Accept": "application/json",
          "User-Agent": "NewsLab-Experimental/1.0"
        }
      });

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

      const sourceParams = new URLSearchParams({
        country: "jp",
        category: safeCategory
      });

      const sourcesUrl =
        `https://newsapi.org/v2/top-headlines/sources?${sourceParams.toString()}`;

      const sourcesResponse = await fetch(sourcesUrl, {
        method: "GET",
        headers: {
          "X-Api-Key": apiKey,
          "Accept": "application/json",
          "User-Agent": "NewsLab-Experimental/1.0"
        }
      });

      const sourcesData =
        await readJsonResponse(sourcesResponse);

      if (
        !sourcesResponse.ok ||
        sourcesData.status === "error"
      ) {
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
        pageSize: "50",
        page: "1"
      });

      const headlinesUrl =
        `https://newsapi.org/v2/top-headlines?${headlineParams.toString()}`;

      const headlinesResponse = await fetch(headlinesUrl, {
        method: "GET",
        headers: {
          "X-Api-Key": apiKey,
          "Accept": "application/json",
          "User-Agent": "NewsLab-Experimental/1.0"
        }
      });

      const headlinesData =
        await readJsonResponse(headlinesResponse);

      if (
        !headlinesResponse.ok ||
        headlinesData.status === "error"
      ) {
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

      totalResults = Number(
        headlinesData.totalResults || 0
      );

      endpoint = "top-headlines";

      articles = filterJapaneseArticles(
        Array.isArray(headlinesData.articles)
          ? headlinesData.articles
          : []
      );

      articles = deduplicateArticles(articles);
    }

    articles = articles
      .sort((a, b) => {
        const aTime = Date.parse(a.publishedAt || "") || 0;
        const bTime = Date.parse(b.publishedAt || "") || 0;
        return bTime - aTime;
      })
      .slice(0, pageSize);

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
          error instanceof Error
            ? error.message
            : "Upstream fetch failed."
      },
      502
    );
  }
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

    /*
     * 日本語に使われる文字を数えます。
     * 漢字・ひらがな・カタカナを対象にして、
     * 日本語文字の割合が低い記事を除外します。
     */
    const japaneseCharacters =
      (text.match(
        /[\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g
      ) || []).length;

    const latinCharacters =
      (text.match(/[A-Za-z]/g) || []).length;

    const meaningfulCharacters =
      japaneseCharacters + latinCharacters;

    if (meaningfulCharacters === 0) {
      return false;
    }

    const japaneseRatio =
      japaneseCharacters / meaningfulCharacters;

    /*
     * タイトルが完全に英語の場合は除外。
     */
    const titleJapanese =
      (
        title.match(
          /[\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\uF900-\uFAFF]/g
        ) || []
      ).length;

    const titleLatin =
      (title.match(/[A-Za-z]/g) || []).length;

    if (
      titleLatin >= 8 &&
      titleJapanese === 0
    ) {
      return false;
    }

    /*
     * 全体の日本語比率が低すぎる記事も除外。
     */
    if (
      japaneseRatio < 0.12 &&
      titleJapanese < 2
    ) {
      return false;
    }

    /*
     * 明らかに外国語だけの見出しを除外。
     */
    const forbiddenOnlyPattern =
      /^[A-Za-z0-9\s\-_:.,!?'"()[\]\/&+]+$/;

    if (
      title.length >= 8 &&
      forbiddenOnlyPattern.test(title)
    ) {
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
      url ||
      `${title}|${cleanText(article.source?.name)}`;

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function cleanText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/\s+/g, " ")
    .trim();
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

  return Math.max(
    min,
    Math.min(max, number)
  );
}

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=UTF-8",
        "cache-control": "no-store"
      }
    }
  );
}
```
