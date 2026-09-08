# 道の駅ナビ 製品版アーキテクチャ（Phase 1）

このドキュメントは「ナミさん向け試作版」(`v1.0.3-nami` / タグ固定・実地テスト用)とは別に、
将来一般ユーザーへ販売する製品版を安全に育てるための設計文書。
`product/main` ブランチで開発する。**Phase 1は監査・設計・安全な基礎実装までが範囲であり、
外部サービスの本番契約・秘密鍵投入・公開デプロイ切替は一切行わない。**

---

## 0. ブランチ運用

| ブランチ/タグ | 用途 |
|---|---|
| `v1.0.3-nami`（タグ, `d55939a`固定） | 2026-09-10 ナミさん実地テスト用の凍結版。変更・削除しない |
| `main` | 現行公開版（GitHub Pages）。実地テスト後の修正はここへ積み、安定化したら `v1.1.0-nami` としてタグ付け |
| `product/main`（今回作成, `d55939a`起点） | 製品版開発。現時点では `main` と共有ファイルへの変更を一切含まない（`src/product/` 配下の新規ファイルのみ） |

### main → product/main への取り込み方針

`product/main` は今のところ **追加のみ**（既存ファイルを一切変更していない）ため、
`main` 側で発生する 9/10 実地テストの修正（`v1.1.0-nami` として安定化されるもの）は、
差分がぶつからない限り単純な `git merge main` で `product/main` へ安全に取り込める。

- 標準手順: `v1.1.0-nami` タグ付け後、`git checkout product/main && git merge v1.1.0-nami`
- `product/main` が既存共有ファイル（App.tsx, styles.css 等）へ手を入れ始めて以降は、
  意図しない機能変更の巻き込みを避けるため、個別コミットの `git cherry-pick` に切り替える
- どちらの方式でも、取り込み後は必ず Vitest/Playwright 2周を実行してから `product/main` へコミットする

---

## 1. 現状監査結果（v1.0.3-nami / `d55939a` 時点、コードから直接確認）

| 項目 | 現状 |
|---|---|
| フロントエンド | React 18 + TypeScript 5、Vite 5、ビルド成果物は静的ファイルのみ |
| 地図 | Leaflet + leaflet.markercluster、タイルは OpenStreetMap（無料・無キー） |
| 道の駅データ | `src/data/stations.json` に182施設分をハードコード同梱。`Prefecture` 型が東北6県の**クローズドunion**（`src/types.ts`）— 全国化の最大の障害点 |
| 訪問/行きたい/スタンプ | `VisitMap`（`stationId → 排他的な1状態`: unvisited/visited/wishlist/stamped）。**独立したbooleanではなく1状態が循環する設計** |
| 県別達成率 | `countsByPref()` がデータから自動計算（ハードコードなし・良好） |
| 周辺スポット検索 | Overpass API（無料・無キー、2エンドポイントfailover実装済み） |
| ルート作成 | OSRM公開デモサーバー（無料・無キー）+ 概算フォールバック |
| 混合ルート | 道の駅とPOIを同じ`RouteStop`配列で扱う設計、既に拡張性あり |
| Google Maps連携 | URLスキームのみ（Maps URLs）。**APIキー不要・使用実績なし** |
| 営業時間 | `lib/hours.ts` で判定（データ由来、外部APIなし） |
| 保存ルート/設定/バックアップ | すべて `localStorage`（`tohoku-me:*` プレフィックス）。IndexedDB/クラウドは未使用 |
| PWA | `vite-plugin-pwa`（generateSW）。Service Worker自動更新、manifest整備済み |
| GitHub Pages | `.github/workflows/deploy.yml` で `main` push時に自動ビルド・公開。サーバー処理不可（静的ホスティングのみ） |
| テスト | Vitest 193件（product層追加後 238件）、Playwright 151件（iPhone中心+他3機種smoke） |
| GitHub Actions | 型チェック→単体テスト→ビルド→Pages公開の1ジョブ構成 |
| 外部API | OSM tile / Overpass / OSRM demo / GSI住所検索 — **すべて無料・無キー・利用規約上「軽負荷」前提** |
| APIキー/環境変数 | **コード内に一切なし**（`import.meta.env.BASE_URL` のみ使用、これはVite標準でシークレットではない） |
| ユーザー概念 | **存在しない**。端末=ユーザーの暗黙1対1、複数ユーザー・ログインの概念なし |

### 全国化した場合に問題になる箇所（発見した課題）

1. **`Prefecture` 型が6県のクローズドunion**（`src/types.ts`）— 型レベルで全国拡張を拒否する設計。`Station.pref` もこの型に依存。
2. **地方（region）区分が存在しない** — 県別フィルタのみで、地方・旅行エリア単位の絞り込み不可。
3. **駅データに `facilities`（EV/温泉/駐車場等）、`phone`、`closedDays`、`source`/`sourceUpdatedAt` が無い** — 現行はPOI(周辺スポット)側にのみ`phone`があり、Station側にはない。
4. **全182施設が単一JSONファイルに直書き**（`stations.json`）— 全国数千施設規模になるとバンドルサイズ・保守性の両面で見直しが必要（Phase 1では未対応、後続課題として記録のみ）。
5. **OSRM公開デモサーバーの「軽負荷前提」規約** — 全国化・利用者増でリクエスト数が増えると規約違反リスク。将来的にセルフホストOSRMへの切替が必要になる可能性が高い（`lib/routing.ts` の `RoutingProvider` 抽象化により差し替えは容易）。
6. **`VisitMap`にユーザー名前空間が無い** — 端末=ユーザー前提のキー設計。クラウド同期には `userId` を持つ形への移行が必須（→ 3章で対応）。

**互換性の実証**: `src/product/station/nationwideStation.test.ts` で実データ182施設全件を新モデルへ変換し、例外なく成功することをテストで保証済み。

---

## 2. 製品版の目標（無料/有料の切り分け）

Phase 1では機能そのものは実装しないが、**将来どの機能がどちらのプランに属するかを中央集約する**
Entitlementシステムを実装済み（`src/product/entitlement/entitlement.ts`）。

| Feature | 無料 | 有料 |
|---|---|---|
| MAP | ✅ | ✅ |
| VISIT_TRACKING | ✅ | ✅ |
| STAMP_TRACKING | ✅ | ✅ |
| BASIC_NEARBY | ✅ | ✅ |
| ADVANCED_ROUTE（時間指定自動/優先条件混在/飲食・観光・温泉込み高度ルート） | ❌ | ✅ |
| CLOUD_SYNC | ❌ | ✅ |
| UNLIMITED_SAVED_ROUTES（無料は3件まで） | ❌(3件上限) | ✅ |
| NATIONWIDE | ❌ | ✅ |
| PHOTO_LOG | ❌ | ✅ |
| MEMO | ❌ | ✅ |
| AD_FREE | ❌ | ✅ |
| SHARING（家族/友達共有） | ❌ | ✅ |

画面側は必ず `hasFeature(plan, 'FEATURE_NAME')` を経由し、`if (isPremium)` の直書きを禁止する運用とする
（Phase 2以降のUI実装時のルールとしてここに明記）。

---

## 3. 全国版対応データモデル

### 3.1 地方・都道府県マスター（実装済み: `src/product/region/regions.ts`）

JIS X 0401 都道府県コード（01〜47）に基づく全都道府県表を実装。地方区分は依頼のとおり
北海道/東北/関東/北陸/中部/近畿/中国/四国/九州/沖縄の10区分。

```
Region ← Prefecture（1:N, code基準） ← Station.prefectureCode
```

「旅行エリア」（例: 北東北、会津、湘南など非公式の粒度）は、公式な全国マスターが存在しないため
Phase 1では `NationwideStation.travelAreaTags: string[]` という自由記述タグとして持たせるに留め、
専用マスターテーブルの新設は行わない（YAGNI — 実際の全国データ投入時に運用しながら語彙を固める）。

### 3.2 NationwideStation（実装済み: `src/product/station/nationwideStation.ts`）

既存 `Station`（東北6県専用）は**変更しない**。`toNationwideStation()` が非破壊的に変換する。

```ts
interface NationwideStation {
  schemaVersion: 2;
  id: string; name: string; kana: string | null;
  prefecture: string; prefectureCode: string; regionId: RegionId;
  travelAreaTags: string[];
  city: string; address: string; lat: number; lng: number;
  status: StationStatus;
  officialUrl: string | null; infoUrl: string;
  phone: string | null; closedDays: string | null;
  facilities: { parking, ev, onsen, restaurant, shop, stampAvailable: boolean | null };
  source: string; sourceUpdatedAt: string | null; lastVerifiedAt: string;
  note?: string;
}
```

新規フィールドは全て `null`/空配列で「不明」を表現し、データを捏造しない。全国データ投入は
Phase 1の対象外（Gate 19で明示除外）。

---

## 4. Userデータモデル（実装済み: `src/product/user/userModels.ts`, `migration.ts`）

現状の `localStorage`（`VisitMap` / `SavedRoute[]` / `MapSettings`）を監査し、将来クラウド同期できる
形へ**非破壊的に変換する**関数群を実装した。既存データの書き込み・削除は一切行わない（読み取り専用の
変換のみ。実際の移行実行は Phase 2 以降、クラウド接続時に行う）。

```ts
AppUser { id, authMethod: 'local'|'google'|'email', email, displayName, plan, createdAt }
UserStationState { userId, stationId, visited, wantToGo, stampCollected, visitedAt, wantToGoAt,
                    stampCollectedAt, memo, photoIds, updatedAt }
UserSettings { userId, map: MapSettings, roadPrefDefault, updatedAt }
SavedRouteRef { userId, routeId, route: SavedRoute, syncedAt }
```

### 重要な設計判断: 状態モデルの意味論変更

既存の `StationState` は `unvisited→visited→wishlist→stamped` の**排他的な1状態**（循環）。
新モデルは `visited` / `wantToGo` / `stampCollected` を**独立したboolean**に分離した。
`stamped` は「訪問済みかつスタンプ取得済み」（`visited: true, stampCollected: true`）に変換する
——スタンプ取得は訪問なしにはあり得ない、という現実の意味論をより正確に表現するための意図的な改善。
既存記録の削除・改変ではなく、意味の明確化である（`migration.test.ts` で検証済み）。

### localStorageキーの名前空間について

既存キー（`tohoku-me:visits:v2` / `tohoku-me:routes:v1` / `tohoku-me:trip:v1` /
`tohoku-me:poi-last-ok:v2` 等）はすべて`tohoku-me:`接頭辞済みで、`src/product/`側の
Auth/CloudSync抽象化は現状すべてno-op実装（`authProvider.ts`はローカルのみ、
`cloudSyncProvider.ts`は未接続）でlocalStorageキーを一切持たないため、**現時点で
名前衝突は発生していない**。クラウド同期を実際に有効化する段階で、ユーザー単位の
名前空間（例: `tohoku-me:user:<userId>:visits`）へ移行する設計にすれば、
匿名ローカル利用者のデータを壊さずに済む（`migration.ts`の非破壊変換関数がその橋渡しを担う）。
本ラウンドでは実際のキー再設計・書き込みは行っていない（Phase 2でクラウド同期を
有効化するタイミングで実施する）。

---

## 5. 認証・クラウド 推奨方式: **Supabase**

| 評価軸 | Supabase | Firebase |
|---|---|---|
| 小規模開始コスト | 無料枠が広い（DB 500MB, Storage 1GB, MAU 50,000） | 無料枠あるが従量課金の伸びが早い傾向 |
| Googleログイン | 標準対応 | 標準対応 |
| メールログイン | 標準対応（Magic Link/パスワード） | 標準対応 |
| DB | **Postgres**（SQL、集計・レポートに強い） | Firestore（NoSQL、MRR集計等のレポートは苦手） |
| 写真保存 | Supabase Storage（S3互換、画像変換あり） | Firebase Storage |
| セキュリティ | **Row Level Security**（テーブル単位でユーザー分離を宣言的に強制） | セキュリティルール（別記法、学習コスト） |
| TypeScriptとの相性 | supabase-js がTS-first、スキーマから型生成可 | 良好だがFirestoreの型付けはやや弱い |
| 全国展開/数千〜数万人 | Postgresは実績十分、Pro tier($25/mo)で余裕 | 同等に対応可能 |
| ベンダーロックイン | **低い**（中身はPostgres。セルフホストSupabase/生Postgresへ移行可） | 高い（Firestoreはプロプライエタリ形式） |
| 運用負荷 | Auth+DB+Storage+Edge Functionsが1つにまとまる | Auth+Firestore+Storage+Cloud Functionsで各サービス別管理 |
| 決済連携との相性 | Edge Functions（Deno/TS）でStripe webhook等を同居できる | Cloud Functionsで同等に可能 |

**推奨理由の要点**: この製品はUser→UserStationState（1:N）、SavedRoute、将来のMRR/解約率などの
運営分析まで見据えると**関係データ**が中心であり、SQLの方が自然。RLSにより「ユーザーは自分のデータしか
読み書きできない」を宣言的に保証でき、フロント実装ミスによる情報漏洩リスクを下げられる。
Auth・DB・Storage・決済用サーバー処理（Edge Functions）を単一ベンダーに集約でき、月額300円という
薄利益率のプロダクトにとって運用ベンダー数を増やさない点が特に有利。

**Phase 1では実施しないこと**: Supabaseプロジェクトの作成、APIキー/接続情報の投入、実データの送信。
`src/product/auth/authProvider.ts` / `src/product/cloud/cloudSyncProvider.ts` のインターフェースのみ実装し、
デフォルト実装は `LocalOnlyAuthProvider` / `LocalOnlyCloudSyncProvider`（常に未接続・no-op）。
将来Supabase版 `SupabaseAuthProvider` / `SupabaseCloudSyncProvider` を追加する際も、この
インターフェースを実装するだけで済み、呼び出し側コードの変更は不要。

---

## 6. FREE/PREMIUM Entitlement（実装済み）

`src/product/entitlement/entitlement.ts` に中央集約。プラン別機能表は2章のとおり。
`hasFeature(plan, feature)` / `entitlementsFor(plan)` / `canSaveMoreRoutes(plan, count)` を提供。
価格・プラン内容が変わってもこのファイルの更新のみで済み、画面コードへ `if (isPremium)` を
書き散らす必要がない。

---

## 7. 決済設計 推奨方式: **Stripe Checkout + Customer Portal + Webhook（Supabase Edge Functions経由）**

### アーキテクチャ

```
[ブラウザ(GitHub Pages静的配信)]
   │ ①「有料プランに登録」ボタン
   ▼
[Supabase Edge Function: create-checkout-session]  ← STRIPE_SECRET_KEY はここだけに置く
   │ ② Stripe Checkout Session作成 → Checkout URLを返す
   ▼
[ブラウザ → Stripe Checkout（Stripeがホスト。カード情報はStripeが直接処理、当アプリは触れない）]
   │ ③ 決済完了
   ▼
[Stripe → Webhook POST]
   ▼
[Supabase Edge Function: stripe-webhook]  ← 署名検証（STRIPE_WEBHOOK_SECRET）
   │ ④ subscriptions テーブルを更新（status/planId/currentPeriodEnd等）
   ▼
[Supabase Postgres: subscriptions テーブル]
   │ ⑤ フロントは自分の購読状態をRLS経由で読み取り、plan を 'premium' として反映
   ▼
[entitlement.ts: hasFeature('premium', ...) が真に]
```

### 検討事項への回答

- **月額/年額**: Stripe Price を2種（`price_month`, `price_year`）用意し、`BillingProvider.createCheckoutSession({ interval })` で切替。
- **Checkout/Customer Portal**: Stripeのホスト型UIをそのまま使う（自前のカード入力フォームを作らない＝PCI対応を自前で持たない）。
- **subscription status**: `Subscription`型（`none|trialing|active|past_due|canceled|incomplete`）で表現済み（`billingProvider.ts`）。
- **webhook**: `checkout.session.completed` / `customer.subscription.updated` / `customer.subscription.deleted` / `invoice.payment_failed` を購読し、都度 `subscriptions` テーブルを更新。
- **entitlement更新**: Webhookがsubscriptionsテーブルを更新 → フロントは購読状態からplanを導出するだけで、entitlement.ts自体の変更は不要。
- **解約**: Customer Portal経由（`cancel_at_period_end`）。即時失効ではなく期間満了時失効を既定にする想定。
- **支払い失敗/再契約**: `past_due` ステータスをUIで案内し、Customer Portalへ誘導。Stripeのスマートリトライに任せる。
- **trial**: Stripe Subscriptionの `trial_period_days` で後から追加可能（アーキテクチャ変更不要）。
- **税務**: Stripe Tax を後から有効化するだけで消費税対応可能（設計変更不要）。

### 秘密鍵の扱い

`STRIPE_SECRET_KEY` と `STRIPE_WEBHOOK_SECRET` は **Supabase Edge Functionsの環境変数にのみ**置く。
GitHub Pages（静的配信のみ）にはStripeの公開可能キー（`pk_...`、これは秘匿情報ではない）すら
埋め込む必要はない設計（Checkout URLへのリダイレクトのみのため）。
`src/product/billing/billingProvider.ts` の `BillingProvider` インターフェースは、
実装がフロントから直接Stripe SDKの秘密操作を呼ばない形に強制してある
（`createCheckoutSession`はURLを受け取るだけ）。

**Phase 1では実施しないこと**: Stripeアカウント作成・商品/価格作成・Webhookエンドポイント実装。
デフォルト実装 `UnavailableBillingProvider` は操作しようとすると明示的に `BillingNotConfiguredError` を返す。

---

## 8. 収益化レイヤー（実装済み: `src/product/monetization/monetization.ts`）

```ts
PLACEMENTS = ['MAP_BOTTOM', 'STATION_DETAIL', 'NEARBY_RESULTS', 'ROUTE_RESULT']
MonetizationContent = AdContent（kind:'ad'） | SponsoredContent（kind:'sponsored', sponsorName必須）
MonetizationProvider.getContent(placement): MonetizationContent | null
resolveMonetizationContent(provider, placement, hasAdFree): 呼び出し側の唯一の窓口
```

「広告」(`ad`)と「スポンサー/PR掲載」(`sponsored`)は型レベルで区別されており、
`sponsored` は `sponsorName` を必須フィールドとして持つため、UI側で自然と
「PR」「〇〇提供」等の明示が強制される設計。宿泊アフィリエイト・飲食予約・旅行用品・
カー用品・温泉/観光チケット・自治体タイアップは、すべて `SponsoredContent` として
表現できる（個別サービスのSDK固有コードは各Providerの実装内に閉じ込め、
呼び出し側は`MonetizationContent`のユニオン型しか見ない）。

AD_FREE（PREMIUM特典）の判定は収益化コード側ではなく、呼び出し側が
`entitlement.hasFeature(plan, 'AD_FREE')` の結果を `resolveMonetizationContent()` へ渡す形にし、
課金ロジックと収益化ロジックを混在させていない。

---

## 9. 運営者用管理基盤 方針

Phase 1で管理画面そのものは作らない。データ境界/API境界のみ設計する。

- **Phase 1〜2初期**: Supabase Studio（テーブルエディタ/SQLエディタ）をそのまま「簡易管理画面」として使う。追加コストゼロ。道の駅情報更新、お知らせ、エラーログ確認等はSQLで対応可能。
- **Phase 3以降**: 専用管理UIが必要になった時点で、既存Reactコンポーネント資産を再利用した内部限定アプリを追加。すべての書き込みは **Supabase Edge Functions経由**とし、クライアントに`service_role`キーを絶対に渡さない（RLSをバイパスする権限のため）。
- 管理対象候補（4.で列挙されたもの）は将来的に以下のテーブル群に対応させる想定:
  `stations`（施設マスタ）, `station_reports`（不具合/情報更新報告）, `pois_cache`, `announcements`（お知らせ）, `inquiries`（お問い合わせ）, `sponsorships`（広告/スポンサー掲載）, `subscriptions`（有料会員・MRR算出元）, `error_logs`。

---

## 10. 法務・情報表示 方針

必要ページ（**Phase 1では内容を確定しない。ページ構成と実装場所のみ整理**）:

| ページ | 実装場所（Phase2以降の想定） | 備考 |
|---|---|---|
| 利用規約 | `public/legal/terms.html`（静的） | 法的内容はユーザー/専門家レビュー必須 |
| プライバシーポリシー | `public/legal/privacy.html` | Supabase/Stripe利用時の第三者提供先明記が必要になる |
| 特定商取引法に基づく表記 | `public/legal/tokushoho.html` | **個人/法人どちらで販売するかにより要否・記載内容が変わる。Phase 1では要否を確定しない** |
| お問い合わせ | 既存の外部リンクUI or フォーム | Supabase接続後は`inquiries`テーブルへ |
| 不具合報告 | 同上 | `station_reports`と共通導線でも可 |
| データ更新日/情報提供元 | **既存 `DATA_META`（stations.json内）で対応済み** | 全国化時も同じ仕組みを流用可能 |
| 免責事項 | 各ページ末尾 or 独立ページ | 「最新情報は公式サイト等でご確認ください」の定型文を徹底 |

単一ページアプリで現在ルーターを使っていないため、法務ページは**別ファイルの静的HTML**として
`public/legal/`配下に置き、既存Reactアプリのルーティングに影響を与えない設計を推奨する
（ルーターライブラリの新規導入が不要）。

---

## 11. Analytics / Error Monitoring 方針

| 用途 | 推奨サービス | 理由 |
|---|---|---|
| 利用状況分析 | **Plausible Analytics**（または自己ホストの Umami） | Cookie不要・軽量・プライバシー配慮でCookie同意バナーが不要になりやすい。小規模開始の月額が安い |
| エラー監視 | **Sentry** | 無料枠(5,000イベント/月)、TypeScript/ReactおよびVite向けのsource map連携が標準的で強力 |

計測したい指標（利用者数、継続利用、機能別利用、無料→有料転換、ルート作成利用、周辺検索利用、エラー）は
`AnalyticsProvider.track({name, props})` のイベント名設計で後から対応する。
PIIを`props`に含めない運用ルールをコード中のコメントで明記済み（`analyticsProvider.ts`）。

**Phase 1では実施しないこと**: 実サービスのSDK導入・実アカウント作成。
`NullAnalyticsProvider` / `ConsoleErrorReportingProvider`（開発時のみconsole出力、本番は無出力）を実装済み。

---

## 12. 初回チュートリアル（設計のみ、未実装）

既存アプリには既に「ホーム画面追加の案内: 初回表示→閉じたら再表示しない→保存タブから再表示」という
確立された永続化パターン（`localStorage`キーで1度だけ表示）がある。Phase 2でこの同じ idiom を再利用し、
`tohoku-me:onboarding-seen:v1` のようなキーで以下5ステップのオーバーレイを実装する想定:

1. 道の駅を探す（地図・フィルター）
2. 訪問/行きたい/スタンプを記録（タップで状態循環）
3. ルートを作る（コース作成画面へ）
4. 周辺スポットを探す（🔍ボタン）
5. ホーム画面に追加（既存A2HSバナー導線と統合）

Phase 1では大規模UI変更を行わないため、コンポーネント自体は今回実装しない。

---

## 13. GitHub Pagesと製品インフラ 推奨方針

**結論: フロントエンドはGitHub Pagesのまま維持し、サーバーが必要な部分だけSupabase Edge Functionsを追加する。**

理由:
- 月額300円という薄利益率のプロダクトにとって、固定費を増やさないことが最優先。
- GitHub Pagesは静的配信のみで既に無料・安定稼働中。移行の実利がない。
- 認証・DB・写真保存・決済webhookに必要な「サーバー処理」は、5章・7章の推奨どおりSupabaseに集約すれば、
  Vercel/Cloudflare/Renderを別途足す必要がない（ベンダー数を増やさない）。
- 将来的にSSR/APIルートがどうしても必要になった場合のみ、Vercel等への移行を再検討する（Phase 1時点では不要）。

---

## 13a. Staging環境（実機テスト用の安定HTTPS URL）方針

**現状**: `fix/pretest-ux`の実機テストはCloudflare Quick Tunnel（`scripts/pretest-start.ps1`）を
使っており、起動のたびにURLがランダムに変わる。ビルドID突き合わせ機構
（`vite.config.ts`のBUILD ID・`DiagnosticsPanel`）で「検証した版と実機が同一か」は証明できるが、
「毎回同じURLをブックマークして使う」用途には向かない。

**今回のスコープ**: 本ラウンドでは実際のstaging環境を作成・deployしない（merge/tag/release/
deploy禁止のため）。以下は設計のみで、実行は次フェーズでユーザー判断のもと行う。

**推奨案（費用・設定コストの低い順）**:

1. **名前付きCloudflare Tunnel**（推奨）: 無料のCloudflareアカウント1つで、固定サブドメイン
   （例: `staging.michinoeki-navi.example.com`）を発行できる。`cloudflared tunnel login`は
   初回のみユーザー自身のブラウザ認証が必要（本ラウンドでは実施しない）。以後は
   `scripts/pretest-start.ps1`と同じ「クリーンビルド→BUILD ID証明→URL表示」フローを
   固定URLに対して回せる。追加の月額費用なし。
2. **GitHub Pages 第二環境**: 現行の`main`ブランチpushで自動デプロイする`deploy.yml`とは別に、
   `workflow_dispatch`（手動トリガーのみ、pushでは動かない）の第二ワークフローを用意し、
   `feat/merge-nami-final`等の作業ブランチを別パス（例: `/staging/`）または別リポジトリの
   GitHub Pagesへ配信する。無料だがGitHub Pages側の追加設定（Pages環境の作成）が要る。
   なお本ラウンドではワークフローファイルの新規作成・実行は行っていない（deploy相当のため）。
3. **Cloudflare Pages / Vercel等の無料枠**: アカウント作成が必要な点はTunnelと同様だが、
   git pushだけで自動反映されるプレビュー機能を持つホスティングもあり、staging運用の
   手間はさらに減る。ただしベンダーを1つ増やすことになる（13章の「ベンダー数を増やさない」
   方針とはトレードオフ）。

いずれの案も「BUILD ID証明」「PWA更新確認」の既存の仕組み（`buildInfo.ts`・
`DiagnosticsPanel`・`verify_sw_update.cjs`）をそのまま流用できるよう設計されている
（配信先が変わるだけで、検証ロジック自体は変更不要）。

---

## 14. Phase 1で実装したもの（`src/product/` 配下、既存アプリからは未import）

```
src/product/
  schema/version.ts            スキーマバージョン管理・汎用migrationランナー
  region/regions.ts             全47都道府県マスター・10地方区分
  station/nationwideStation.ts  全国化対応Station型・既存Stationからの非破壊変換
  user/userModels.ts            AppUser / UserStationState / UserSettings / SavedRouteRef
  user/migration.ts             既存localStorageデータ→新モデルへの非破壊変換
  entitlement/entitlement.ts    FREE/PREMIUM機能表・中央判定
  monetization/monetization.ts  広告/スポンサー掲載の抽象化（Placement・型で明確区別)
  billing/billingProvider.ts    Stripe連携を見据えた決済インターフェース（秘密鍵はフロントに置かない設計）
  auth/authProvider.ts          認証インターフェース（デフォルト: ローカルのみ）
  cloud/cloudSyncProvider.ts    クラウド同期インターフェース（デフォルト: 未接続）
  analytics/analyticsProvider.ts    利用状況計測インターフェース（デフォルト: no-op）
  errors/errorReportingProvider.ts  エラー監視インターフェース（デフォルト: 開発時consoleのみ）
  featureFlags/featureFlags.ts  製品版未完成機能を隠すフラグ（デフォルト全false）
  config/productConfig.ts       上記すべてのデフォルト実装を束ねる合成ルート
  index.ts                      バレルexport
```

**動作診断パネル（`DiagnosticsPanel.tsx`）について**: BUILD ID・POIデータ版・Service Worker状態・
現在地取得の試行ログ・周辺スポットのraw件数等、開発・サポート対応に有用な情報を持つ。
現状すでに(a)`<details>`で折りたたみ表示（明示的にタップしないと開かない）、
(b)`isDiagnosticsHost()`により本番ホスト（`1125naoto.github.io`固定）では技術的な文言を
出さない、という2段階で一般利用者への露出を抑えている。製品版ドメインが決まり次第、
`isDiagnosticsHost()`のホスト名判定を更新する必要がある（未着手）。「設定→サポート情報→
診断情報」のような専用導線への再配置はUX上望ましいが、本ラウンドでは現状維持とし、
次フェーズの設定画面設計と合わせて検討する（現状でも「常時露出」ではないため、
Phase 1 統合のブロッカーではないと判断した）。

各モジュールに対応する `*.test.ts` を同階層に配置（15章参照）。
**既存の `App.tsx` 等からはこれらを一切importしていない** — Phase 1は「安全な土台」までが目的であり、
v1.0.3-namiの挙動を一切変えていないことをビルド後のバンドルサイズ差分ゼロ（後述）で確認済み。

---

## 15. テスト・回帰結果

最終報告（本チャット末尾の回答）に記載。
