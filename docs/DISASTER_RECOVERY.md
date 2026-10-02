# DISASTER_RECOVERY — 道の駅ナビ（全国版）

このPCが故障・紛失・初期化されたときに、新しいPCから開発と運用を再開するための手順と、データの所在。
秘密値はこのファイルにもリポジトリにも書かない（名前と保管場所だけ）。

## 1. 新PCでの復旧手順

1. ツールを入れる: Git, Node.js 22 以上（CI は 22）, GitHub CLI（`gh`）, Stripe CLI, （任意）Python 3（`npm run gen-icons` 用）, Claude Code。
2. GitHub にログイン: `gh auth login`（Owner のアカウント `1125naoto`）。
3. 取得と検証:
   ```bash
   git clone https://github.com/1125naoto/tohoku-michinoeki-map.git 道の駅
   cd 道の駅
   npm ci
   npx tsc --noEmit
   npx vitest run
   # 本番相当ビルド（Git Bash では先頭に MSYS_NO_PATHCONV=1）
   DEPLOY_BASE=/tohoku-michinoeki-map/ VITE_ACCESS_GATE_ENABLED=true npm run build
   npm run dev   # 開発サーバー
   ```
4. Claude Code をこのフォルダで起動し「再開して」と入力 → `CLAUDE.md` → `docs/PROJECT_STATUS.md` から現在地を把握する。
5. 本番の運用（購入者一覧の同期・デプロイ）は GitHub Actions で動いているため、**PCを失っても止まらない**。新PCで特に設定しなくてよい。
6. 料金切替（3回目から500円）の実行場所をこのPCから新PCへ移す（Owner の操作が2つ必要。下の「3. このPCにしかない状態」）。

## 2. 秘密情報・認証の所在（値は書かない）

| 名前 | 保管場所 | PCを失ったら | 新PCでの対応 |
|---|---|---|---|
| `STRIPE_API_KEY`（読み取り専用の制限付きキー） | GitHub Actions Secret | 失われない | 不要 |
| `NAMI_ACCESS_CODE`（ナミちゃんの招待コード） | GitHub Actions Secret。このPCの `data/access-control/manual-grants.local.json`（gitignore）と、Owner向け `Documents\ナミちゃん用_道の駅ナビ開始URL.txt` にも | GitHub側は残る（値は読み出せない）。ローカルの2ファイルは失われる | 運用には不要（同期は Secret を使う）。ナミちゃんへ開始URLを再送する必要が出たときだけ、新しい招待コードを作って Secret を更新し、新しいURLを渡す（旧コードは無効になるので、ナミちゃんの端末は新URLで一度開き直す） |
| Stripe CLI のログイン（プロファイル `michinoeki-live`） | このPCの Windows 資格情報マネージャー | 失われる | `stripe login --project-name michinoeki-live`（Owner がブラウザで承認。Live の「お宝ファインダー」アカウント） |
| GitHub CLI のログイン | このPC | 失われる | `gh auth login` |
| Stripe のダッシュボード／本人確認 | Owner のStripeアカウント | 失われない | — |

`.env` は使っていない。ビルド時の値は `.env.example` を参照（秘密値なし）。

## 3. このPCにしかない状態（再セットアップが必要）

| 内容 | 新PCでの再現方法 |
|---|---|
| Windows タスク「MichinoekiNavi Billing Runner」（10分ごとに料金切替を設定） | (1) `git clone https://github.com/1125naoto/tohoku-michinoeki-map.git 道の駅-billing-runner`（専用フォルダ。実行のたびに origin/main に合わせる）(2) Stripe CLI にログイン (3) Owner の許可を得てタスクを登録（`scripts/local-billing-runner/run-hidden.vbs` を `wscript.exe //B //Nologo` で10分ごと、ログオン中のみ）。登録までの間は、GitHub の見守りが3日後に Issue で知らせる。顧客は250円のままで、不利な変更は起きない |
| Claude Code のメモリ（`~/.claude/projects/.../memory`） | リポジトリの `CLAUDE.md` と `docs/` に必要な情報を移してある |
| 作業用 worktree（`道の駅-pricing` など）と、別セッションの未コミット作業 | 未コミット作業は `backup/dr-2026-10-02-*` ブランチに退避済み（下記）。worktree は必要なら `git worktree add` で作り直す |

## 4. データの分類（2026-10-02 監査）

| 対象 | 分類 | 備考 |
|---|---|---|
| ソースコード・Git履歴・全ブランチ・タグ | A | GitHub `1125naoto/tohoku-michinoeki-map`。ローカルにしかないコミットは 0 件（監査済み） |
| 施設データ（`src/data/`）・周辺スポットのキャッシュ（`public/data/poi/`）・画像（`public/`） | A | リポジトリに含まれる。キャッシュは `refresh-poi-cache.yml` で再生成も可能 |
| 購入者一覧 `public/access-control/active.json` | A | ハッシュのみ。同期で毎分再生成 |
| 公式サイトの配信物 | A / C | `1125naoto/michinoekinavi-site` に配置済み。ソースはこのリポジトリ（`npm run build:official` で再生成） |
| 別セッションの未コミット作業（`src/product/config/productConfig.ts` の変更、`package-lock.json` の変更、`astra-audit/`・`fable-audit/`・`poi_audit*`・`data/poi_truncation_*`） | A（退避ブランチ） | `backup/dr-2026-10-02-monitor-sales-lp-live-link` に退避（作業ツリーは変更していない） |
| `dist/`・`dist-official/`・`node_modules/`・`e2e/screenshots/`・`__pycache__` | C | ビルド・テストで再生成 |
| `data/access-control/manual-grants.local.json`・ナミちゃん用URLのTXT | D | 秘密値。GitHubに保存しない（運用は GitHub Secret で継続） |
| Stripe CLI / gh のログイン | D | 新PCでログインし直す |

B（GitHub 以外へのバックアップが必要）に該当するものは無い。

## 5. 復旧後の確認

- `npx vitest run` が全件成功、`npm run build`（上記の本番相当）が成功。
- 本番: LP `/monitor/` に月額（最初の2か月 250円/月・3か月目以降 500円/月）と年間（4,980円/年）が出る。アプリを未契約の状態で開くと課金画面。
- GitHub Actions: 「道の駅ナビ全国版 購入者ゲートの同期」が動き続けている（`gh run list --workflow sync-subscriptions.yml`）。
- 料金切替: 新PCで runner を手動実行し、ログに `probe: OK` が出る（`powershell -File scripts/local-billing-runner/run.ps1` → `%LOCALAPPDATA%\MichinoekiNaviBillingRunner\runner.log`）。
