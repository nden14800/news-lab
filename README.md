NewsLab — Experimental News Platform

Cloudflare Pages + Pages Functions + News API で動作する実験的ニュースサイトです。

ファイル構成

news-lab/
├── index.html
├── README.md
└── functions/
    └── api/
        └── news.js

Cloudflare Pages 設定

GitHub リポジトリにこの3ファイルを配置します。

Cloudflare Dashboard → Workers & Pages → 対象Pagesプロジェクトを開きます。

Settings → Variables and Secrets から Secret を追加します。

名前を NEWSAPI_KEY、値をNews APIのAPIキーにします。

Production / Preview の必要な環境に設定します。

再デプロイします。

静的フロントエンドは index.html にHTML/CSS/JavaScriptをすべて内蔵しています。
APIキーをブラウザへ直接出さないため、News APIへのリクエストだけ functions/api/news.js が担当します。

動作

総合 / テクノロジー / ビジネス / 科学 / ヘルス / スポーツ / エンタメ

キーワード検索

ローディングSkeleton

APIエラーUI

最新記事表示

元記事への外部リンク

APIステータスと取得件数表示

レスポンシブUI

News API

トップ画面・カテゴリは /v2/top-headlines、キーワード検索は /v2/everything を利用します。

注意

News APIの利用条件・無料プランの制約・データ提供条件はNews API公式ドキュメントで最新情報を確認してください。
このプロジェクトは実験用であり、ニュース出版社そのものではありません。
