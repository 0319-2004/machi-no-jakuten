# 街の弱点｜高島平・舟渡 水害編

[日本語](#日本語) | [English](#english)

## 日本語

> 地図を読む前に、街の弱点を知る。

東京都板橋区の高島平・舟渡周辺を対象に、洪水の「深さ」「始まる時間」「続く時間」を地点ごとに読み解くWeb作品です。雨の規模別の最大浸水想定と、荒川の堤防決壊後に浸水が広がる時間変化を分けて表示します。

### 公開アプリ

- **GitHub Pages（現在の公開サイト）:** [街の弱点を開く](https://0319-2004.github.io/machi-no-jakuten/)
- **従来版（ロールバック用に維持）:** [chatgpt.site版を開く](https://machi-no-jakuten.ritosuper.chatgpt.site/)
- **浸水ナビAPI Worker:** [Cloudflare Worker](https://machi-no-jakuten-shinsui-api.ritoyamasaki.workers.dev/api/shinsui)

### 主な機能

- 高島平・舟渡周辺の駅、住所、施設検索と地図タップによる地点選択
- 1/10、1/30、1/50、1/100、1/200、想定最大規模の資料切り替え
- 破堤ケースごとの水深グラフ、浸水開始、最大水深、継続時間
- 時間スライダーと再生機能による浸水範囲の変化表示
- 2D地図上での浸水範囲、選択地点、想定上の決壊地点の表示
- PLATEAUの地形・建物と公式浸水タイルを重ねたCesium 3D表示
- 洪水時の指定緊急避難場所、直線距離、平常時の徒歩経路への案内
- 気象庁キキクル、浸水ナビ、自治体情報など公的な原本へのリンク
- PC・モバイル対応

### 現在の構成

- フロントエンドはNext.jsの静的エクスポートとして生成し、GitHub Pagesで配信します。
- `/machi-no-jakuten`を`basePath`として使用します。
- ブラウザからの浸水ナビAPIリクエストは、独立したCloudflare Workerの`GET /api/shinsui`へ送信します。
- Workerは入力検証、公式GSI APIへの中継、24時間のfreshキャッシュ、7日間のstale fallback、リクエスト統合、再試行、上流APIへの2.1秒間隔を提供します。
- 本番CORSはGitHub Pagesと移行期間中の既存フロントエンドを明示的に許可し、ワイルドカードは使用しません。
- 従来のNext/vinext APIルートとデプロイ設定は、ロールバック互換性のため現在も残しています。

主要ファイル：

- `app/FloodPageClient.tsx` — フロントエンドの主要UI
- `app/CesiumFloodView.tsx` — Cesium 3D表示
- `worker/shinsui/index.ts` — 独立したShinsui API Worker
- `wrangler.shinsui.jsonc` — Workerの環境別設定
- `.github/workflows/deploy-pages.yml` — 手動GitHub Pagesデプロイ

### データと表現方針

本作品では、頻度別の最大浸水と、堤防決壊後の時間変化を別のデータとして扱います。公式に存在しない途中時刻の水深は補間・創作しません。3Dの水深表示は公開タイルの水深区分を用いた比較表現であり、水の流れを計算する流体シミュレーションではありません。

主な出典：

- [国土地理院「ハザードマップポータル」](https://disaportal.gsi.go.jp/)
- [国土地理院「浸水ナビ」](https://suiboumap.gsi.go.jp/)
- [国土地理院「指定緊急避難場所データ」](https://www.gsi.go.jp/bousaichiri/hinanbasho.html)
- [荒川下流河川事務所「多段階浸水想定図」](https://www.ktr.mlit.go.jp/arage/arage00953.html)
- [国土交通省「PLATEAU」](https://www.mlit.go.jp/plateau/)
- [板橋区「洪水ハザードマップ」](https://www.city.itabashi.tokyo.jp/bousai/bousai/map/1005742.html)

各データの著作権・利用条件は提供元の規約に従います。リポジトリのMIT Licenseはアプリケーションコードにのみ適用され、第三者が提供する地図・タイル・3D都市モデル・資料には適用されません。

### ローカル開発

Node.js `22.13.0`以上を使用してください。

```bash
npm ci
npm run dev
```

通常のvinextビルドと全テスト：

```bash
npm test
```

GitHub Pages用の静的エクスポートと成果物テスト：

```bash
npm run test:pages
```

Shinsui Workerの単体テストとdry-runビルド：

```bash
npm run test:shinsui-worker
npm run build:shinsui
```

### デプロイ

GitHub Pagesへの公開は、GitHub Actionsの`Deploy GitHub Pages`ワークフローを`workflow_dispatch`で手動実行します。`main`へのpushだけでは自動公開されません。

Workerの本番・previewは別名です。

- Production: `machi-no-jakuten-shinsui-api`
- Preview: `machi-no-jakuten-shinsui-api-preview`

Workerをデプロイするときは、対象環境を確認し、テストとdry-runの完了後にWranglerを明示的に実行してください。

```bash
# Production
npx wrangler deploy --config wrangler.shinsui.jsonc

# Preview
npx wrangler deploy --config wrangler.shinsui.jsonc --env preview
```

### 免責

本作品は学習および平常時の事前確認を目的としています。実際の避難判断には、気象庁、国土交通省、板橋区などが発表する最新情報を必ず確認してください。表示された浸水想定や避難場所は、個別の建物・経路の安全性を保証するものではありません。

### ライセンス

アプリケーションコードは[MIT License](./LICENSE)で公開します。

---

## English

> Understand the city's vulnerabilities before reading the map.

This web project explores flood depth, onset, and duration at selected locations around Takashimadaira and Funado in Itabashi City, Tokyo. It presents maximum inundation assumptions by rainfall frequency separately from the time-based spread of flooding after an Arakawa River levee breach.

### Live applications

- **GitHub Pages (current public site):** [Open Machi no Jakuten](https://0319-2004.github.io/machi-no-jakuten/)
- **Previous deployment (kept as a rollback target):** [Open the chatgpt.site version](https://machi-no-jakuten.ritosuper.chatgpt.site/)
- **Shinsui API Worker:** [Cloudflare Worker](https://machi-no-jakuten-shinsui-api.ritoyamasaki.workers.dev/api/shinsui)

### Features

- Search for stations, addresses, and facilities around Takashimadaira and Funado, or select a point on the map
- Switch between 1-in-10, 1-in-30, 1-in-50, 1-in-100, 1-in-200, and maximum-assumption source layers
- View depth graphs, inundation onset, maximum depth, and duration for each levee-breach scenario
- Explore changes in inundation over time with a timeline slider and playback controls
- View inundation areas, the selected point, and the assumed breach point on a 2D map
- View Cesium 3D terrain and buildings from PLATEAU with official inundation tiles
- Find designated emergency evacuation sites, straight-line distances, and links to normal-condition walking routes
- Open authoritative sources such as JMA Kikikuru, GSI Shinsui Navi, and local government information
- Responsive desktop and mobile layouts

### Current architecture

- The frontend is generated as a Next.js static export and hosted on GitHub Pages.
- The site uses `/machi-no-jakuten` as its `basePath`.
- Browser requests for Shinsui Navi data are sent to `GET /api/shinsui` on a standalone Cloudflare Worker.
- The Worker provides input validation, GSI API proxying, a 24-hour fresh cache, a 7-day stale fallback, request coalescing, retries, and a 2.1-second upstream request interval.
- Production CORS explicitly allows GitHub Pages and the existing frontend during migration; it does not use a wildcard.
- The previous Next/vinext API route and deployment configuration remain available for rollback compatibility.

Key files:

- `app/FloodPageClient.tsx` — main frontend UI
- `app/CesiumFloodView.tsx` — Cesium 3D view
- `worker/shinsui/index.ts` — standalone Shinsui API Worker
- `wrangler.shinsui.jsonc` — environment-specific Worker configuration
- `.github/workflows/deploy-pages.yml` — manual GitHub Pages deployment

### Data and visualization policy

Maximum inundation by rainfall frequency and time-based inundation after a levee breach are treated as separate datasets. The application does not interpolate or invent water depths for timestamps not published by the official source. The 3D depth display is a comparative visualization based on published tile categories, not a fluid-dynamics simulation.

Primary sources:

- [GSI Hazard Map Portal](https://disaportal.gsi.go.jp/)
- [GSI Shinsui Navi](https://suiboumap.gsi.go.jp/)
- [GSI Designated Emergency Evacuation Site Data](https://www.gsi.go.jp/bousaichiri/hinanbasho.html)
- [Arakawa Lower River Office multi-stage flood assumption maps](https://www.ktr.mlit.go.jp/arage/arage00953.html)
- [Project PLATEAU, Ministry of Land, Infrastructure, Transport and Tourism](https://www.mlit.go.jp/plateau/)
- [Itabashi City Flood Hazard Map](https://www.city.itabashi.tokyo.jp/bousai/bousai/map/1005742.html)

Copyright and usage conditions for each dataset are governed by its provider. The repository's MIT License applies only to the application code and does not cover third-party maps, tiles, 3D city models, or source materials.

### Local development

Use Node.js `22.13.0` or later.

```bash
npm ci
npm run dev
```

Run the regular vinext build and the complete test suite:

```bash
npm test
```

Build the GitHub Pages static export and validate the artifact:

```bash
npm run test:pages
```

Run the Shinsui Worker unit tests and dry-run build:

```bash
npm run test:shinsui-worker
npm run build:shinsui
```

### Deployment

GitHub Pages is published by manually running the `Deploy GitHub Pages` GitHub Actions workflow through `workflow_dispatch`. A push to `main` does not publish the site automatically.

Production and preview Workers use different names:

- Production: `machi-no-jakuten-shinsui-api`
- Preview: `machi-no-jakuten-shinsui-api-preview`

Before deploying a Worker, confirm the target environment and complete the tests and dry run. Then invoke Wrangler explicitly:

```bash
# Production
npx wrangler deploy --config wrangler.shinsui.jsonc

# Preview
npx wrangler deploy --config wrangler.shinsui.jsonc --env preview
```

### Disclaimer

This project is intended for learning and advance review under normal conditions. Always consult the latest information published by the Japan Meteorological Agency, the Ministry of Land, Infrastructure, Transport and Tourism, Itabashi City, and other authorities when making evacuation decisions. The displayed inundation assumptions and evacuation sites do not guarantee the safety of any individual building or route.

### License

The application code is released under the [MIT License](./LICENSE).
