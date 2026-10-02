# PROJECT_STATUS — 道の駅ナビ（全国版）

最終更新: 2026-10-02（ディザスタリカバリ・チェックポイント）。Claude Code が「再開して」と言われたら、このファイルから現在地を把握する。

## 1. 現在の本番状態（2026-10-02 時点）

| 対象 | 状態 |
|---|---|
| アプリ本体 | https://1125naoto.github.io/tohoku-michinoeki-map/ （GitHub Pages、`main` へのpushで `deploy.yml` が自動デプロイ） |
| 購入者ゲート | 有効（`VITE_ACCESS_GATE_ENABLED=true`）。未契約者には課金画面、契約者・招待コード保持者だけアプリが開く |
| 販売LP・規約・特商法・Thanks | `/monitor/`（`src/monitorSite/` が静的HTMLを生成） |
| 公式サイト | https://michinoekinavi.jp/ （`src/officialSite/` で生成 → `scripts/deploy-official.ps1` が `1125naoto/michinoekinavi-site` に配置） |
| 料金 | 月額プラン: 最初の2か月 250円/月 → 3回目の支払いから 500円/月（自動）。年間プラン: 4,980円/年。税込 |
| 有効な契約 | 2026-10-02 時点で 0 件（Owner の実決済テスト契約は返金済み・解約済み） |
| ナミちゃん | 招待コードによる無料アクセス（Safari・iPhoneホーム画面版とも）。招待コードは GitHub Secret `NAMI_ACCESS_CODE` |

## 2. アーキテクチャ（要点）

- **アプリ**: React + Vite + TypeScript の PWA。記録は端末の localStorage のみ（サーバーなし）。
- **購入者ゲート**（`src/components/AccessGate.tsx`, `src/lib/accessCredential.ts`）:
  - 資格情報 = Stripe Checkout Session ID（Thanksページが `?session_id=` を localStorage に保存）または招待コード（`?activate=`）。
  - `public/access-control/active.json` の SHA-256 ハッシュ一覧と照合（fail-closed）。取得時は `?t=` でCDNキャッシュを回避。
  - 決済後30分以内で一覧に未反映の間は「お支払いを確認しています」を表示し15秒ごとに再確認（アクセスは与えない）。
  - iPhoneホーム画面版への招待コード引き継ぎ: `src/lib/installManifestSelector.ts`（HTML解析時に start_url 無しの `manifest-handoff.webmanifest` を選ぶ）＋ SW が `?activate=` の画面遷移を precache から外す。WebKit の実装に基づく設計（詳細はファイル冒頭のコメント）。
- **購入者一覧の同期**（`.github/workflows/sync-subscriptions.yml` → `scripts/sync-subscriptions.mjs`）:
  - 1回の実行で約55分間・1分ごとに Stripe（読み取り専用キー `STRIPE_API_KEY`）を見て active.json を更新し、変更があれば `deploy.yml` を起動。終了前に自分自身を `workflow_dispatch` で再起動（cron `*/10` は途切れたとき用のウォッチドッグ。GitHubのcronは実測3〜7時間間隔でしか動かない）。
  - 各実行の最初に `scripts/check-intro-schedules.mjs` が、料金切替が未設定のまま3日を過ぎた月額契約を確認し、あれば GitHub Issue で通知（解消で自動クローズ）。
- **月額プランの 250円→500円 切替**（`scripts/apply-intro-schedules.mjs`、判定は `scripts/introSchedulePlan.mjs`）:
  - 導入価格の契約に Stripe Subscription Schedule を設定（導入価格を残り月数 → 500円/月 → release）。冪等。
  - **実行場所は Owner のPC**: Windows タスク「MichinoekiNavi Billing Runner」（10分ごと）が `scripts/local-billing-runner/run-hidden.vbs` → `run.ps1` を実行し、このPCでログイン済みの Stripe CLI（プロファイル `michinoeki-live`）で設定する。ログ: `%LOCALAPPDATA%\MichinoekiNaviBillingRunner\runner.log`（秘密値なし）。
  - GitHub 側に書き込みキーは置いていない（Stripe の制限付きキー発行に本人確認が必要で、2026-10-02 に断念した経緯あり）。

## 3. Stripe（Live、アカウント表示名「お宝ファインダー」）

| 用途 | ID |
|---|---|
| 商品「道の駅ナビ 全国版」 | `prod_VHqkd8f4kNSm2y` |
| 月額 導入価格 250円/月 | `price_1ULl7FICXxuNXmZymoNS8hQH` |
| 月額 3回目以降 500円/月 | `price_1ULkA5ICXxuNXmZyTAcQqpvZ` |
| 年額 4,980円/年 | `price_1ULkA7ICXxuNXmZybRGXYs1h` |
| 月額プラン Payment Link | `plink_1ULl7HICXxuNXmZyoI24UDAL`（https://buy.stripe.com/bJe00kbKNgYW6PQ95W7Zu09） |
| 年間プラン Payment Link | `plink_1ULkBFICXxuNXmZyW4nGOkkm`（https://buy.stripe.com/9B6fZi5mp9wu7TU4PG7Zu08） |
| 旧・月額250円固定（無効化済み・新規販売禁止） | `plink_1UHH4SICXxuNXmZyihmdzOho` / `price_1UHH2vICXxuNXmZyr0tSquxk` |
| Customer Portal ログイン | https://billing.stripe.com/p/login/bJe5kE3eheQO8XYaa07Zu00 |

- 決済画面の支払いボタン付近に、3回目から500円になる旨・自動更新を表示（Payment Link の `custom_text.submit`）。
- 決済完了後は `/monitor/thanks/?session_id=…` へリダイレクト。

## 4. 重要な設計判断（経緯）

- Payment Link はクーポンを自動適用できない（`prefilled_promo_code` は入力欄に入るだけ）ため、「導入価格の Price ＋ Subscription Schedule」方式にした。
- 年間プランの「1,020円お得」は、比較基準（500円/月×12か月）と月額プランの初年度実額（5,500円）を必ず併記する。
- 「先行モニター／正式版の予定価格」方式は 2026-10-01 に終了。
- iPhone ホーム画面版は Safari と保存領域が別。読み込み後の manifest 差し替えは WebKit に無視される（実機で失敗を確認済み）。

## 5. 残課題・次の作業

1. **最初の実際の月額購入で、3回目の支払いから500円に切り替わる設定がされたことを確認**（runner.log に `configured`、Stripe の契約に schedule が付く）。まだ実購入がないため未実証。
2. ナミちゃんの実機（iPhone ホーム画面版）での確認結果待ち（招待コード引き継ぎの第3版 `434a247`）。
3. X（Twitter）手動販売運用: 投稿案5本を作成済み・Owner 承認待ち（リポジトリ外。投稿は未実行）。
4. README の旧記述（東北版時代の説明など）の整理は未着手（機能には影響なし）。

## 6. 既知の注意点

- Stripe の決済画面には事業者名「お宝ファインダー」が表示される（Stripe アカウント共通設定）。LP の FAQ で説明済み。
- 購入者一覧の同期は GitHub Actions のランナーを常時1本使う（公開リポジトリは無料）。
- このPCが2か月以上起動しない／Stripe CLI のログインが切れると料金切替が設定されない → GitHub Issue で通知される（顧客は250円のまま＝顧客に不利な変更は起きない）。
- 作業用 worktree（`../道の駅-pricing` 等）や、別セッションの未コミット作業がローカルに残っていることがある。別セッションの作業ファイルは勝手に消さない。
