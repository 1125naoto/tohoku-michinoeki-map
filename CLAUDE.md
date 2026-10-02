# CLAUDE.md — 道の駅ナビ（全国版）

Claude Code が新しいセッション／新しいPCでこのリポジトリを開いたとき、最初に読むファイル。
「再開して」と言われたら、まず **[docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md)**（現在地・残課題・次の作業）を読み、
PCを新しくした直後なら **[docs/DISASTER_RECOVERY.md](docs/DISASTER_RECOVERY.md)** の「新PCでの復旧手順」を先に済ませる。

## このプロジェクト
- 全国1,237施設の道の駅を地図で探し、訪問・スタンプ・行きたいを記録し、ドライブコースを作れるPWA（React + Vite + TypeScript、GitHub Pages）。
- 有料販売中: 月額プラン（最初の2か月 250円/月 → 3回目の支払いから自動で 500円/月）と年間プラン（4,980円/年）、いずれも税込。Stripe Payment Link。
- 本番: アプリ https://1125naoto.github.io/tohoku-michinoeki-map/ ・販売LP `/monitor/` ・公式サイト https://michinoekinavi.jp/（別リポジトリ `1125naoto/michinoekinavi-site` へ `scripts/deploy-official.ps1` で生成物を配置）。

## 絶対に守ること
- **秘密値（Stripeキー、NAMIの招待コード、トークン等）をコード・ログ・コミット・チャットに出さない。** 確認は真偽値・長さ・ハッシュ比較だけ。
- **`1125naoto/tohoku-michinoeki-nami`（ナミちゃん専用の凍結版）は変更禁止。** remote `nami-release` に push しない。
- **force push・履歴の書き換えをしない。** `main` へのpushは本番デプロイ（`.github/workflows/deploy.yml`）になる。ドキュメントだけの変更は `[skip ci]` を付ける。
- **料金の数字はページに直書きしない。** `src/monitorSite/config.ts` の `pricing` → `src/monitorSite/pricing.ts` が全ページ（LP・規約・特商法・Thanks・公式サイト・アプリのゲート画面）の文言を生成する。二重価格表示（通常価格・○%OFF等）は禁止。
- Stripe の Live 操作（価格・リンク・契約）は、目的を確認してから。既存契約者の価格を勝手に変えない。
- このPC固有の自動化（Windowsのスケジュールタスク等）は、Ownerの明示的な許可があるときだけ登録する。

## よく使うコマンド
- 依存関係: `npm ci`（Node 22 で CI 実行。ローカルは Node 22 以上）
- 型チェック: `npx tsc --noEmit` ／ 単体テスト: `npx vitest run`（E2E は Playwright: `npx playwright test`）
- 本番相当ビルド: `DEPLOY_BASE=/tohoku-michinoeki-map/ VITE_ACCESS_GATE_ENABLED=true npm run build`（Git Bash では `MSYS_NO_PATHCONV=1` を付ける）
- 開発サーバー: `npm run dev`
- 公式サイト: `npm run build:official` → `powershell -File scripts/deploy-official.ps1`
