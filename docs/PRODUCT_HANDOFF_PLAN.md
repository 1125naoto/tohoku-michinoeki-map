# 販売版（product/main）への引継ぎ計画 — ナミさん版 FINAL GATE 完了時点

作成日: 2026-09-07 / 対象: `fix/pretest-ux`（NAMI_FINAL_CANDIDATE）→ `product/main`（=262b767）

**この文書は計画のみ。product/main には一切変更を加えていない。**

## 1. 引継ぎ対象コミット（fix/pretest-ux、mainからの差分。古い順）

| # | commit | 内容 | 販売版への取り込み | 理由 |
|---|---|---|---|---|
| 1 | `0f626e0` | 実地テスト前UX改善（周辺検索の実質0件問題・駅の絞り込み・マーカー誤タップ） | **取り込む** | 基盤UX。マーカータップで状態が変わらない安全設計は必須 |
| 2 | `1a66675` | Overpass接続先の更新（private.coffee / VK Maps） | 取り込む（後述の静的キャッシュが主、これはフォールバック） | 無料公開APIの実接続結果に基づく |
| 3 | `7cc70ed` | 周辺検索の診断情報表示（本番ホストでは非表示） | 取り込む | 販売版でもサポート時に有用。`isDiagnosticsHost()` の本番ホスト判定を販売版ドメインへ更新すること |
| 4 | `1b3b678` | スマホ実機テストのワンクリック化（bat） | 取り込む（開発用） | 販売版の実機検証にもそのまま使える（FINAL版は #13） |
| 5 | `1b213b3` | stagger race + stale-while-revalidate | **取り込む** | 体感速度と「空白を見せない」設計の中核 |
| 6 | `65d6415` / `43736ce` | 事前生成 静的POIキャッシュ（181駅）+ 週次更新workflow | **取り込む（最重要）** | 実データ表示率40%→100%。全国展開時は駅数分のJSON生成に拡張（1駅≈12KB、1200駅≈15MB、配信は駅単位のため負荷一定） |
| 7 | `3f7b1aa` | e2e安定化（マーカー近接fixture） | 取り込む | テスト資産 |
| 8 | `e73a2f7` | 周辺スポット: 「地図で指定」廃止・都道府県絞り込み | **取り込む** | 47都道府県前提で `PREFECTURES` を拡張するだけで動く設計 |
| 9 | `a357efb` | subcategory多重分類（`subcategories[]`）・cuisine/店名判定・温泉多重所属 | **取り込む（最重要）** | 分類精度（ラーメン41→118件、温泉1→77件）。Python生成スクリプトと同期必須 |
| 10 | `368986f` | 県別・状態フィルターで一覧を自動展開しない | 取り込む | UX |
| 11 | `7ab2418` | 位置情報エラー種別の区別・HTTPS前提・Cloudflare Tunnel実機環境 | **取り込む** | `describeGeolocationError()` は販売版でもそのまま。販売版はHTTPS本番のためSecure Context問題は発生しない |
| 12 | `119e76a` | 細分類0件時の案内文修正（カテゴリ自体が0件と誤表示しない） | 取り込む | UX |
| 13 | （本FINAL GATE） | BUILD ID / build-info.json / 動作診断パネル / POIキャッシュの版管理 / lodging下書き消失修正 / FINAL launcher / SW更新検証スクリプト | **取り込む（最重要）** | 「検証したものと実機が同一か」を証明する仕組み。販売版のサポート品質の土台 |

## 2. 取り込み戦略

**推奨: `git merge --no-ff fix/pretest-ux` を product/main へ行う（cherry-pick ではなく一括）**

理由:
- 上記13項目は相互依存が強い（静的キャッシュ ⇄ subcategory多重分類 ⇄ Python生成スクリプト ⇄ e2e fixture ⇄ BUILD ID/診断）。個別 cherry-pick すると `public/data/poi/*.json` の版とJSの分類ロジックの版が食い違う（まさに今回の実機不具合の根本原因の再現）。
- `poiDataVersion`（ビルド時ハッシュ）と `POI_SCHEMA_VERSION` は「JSとデータを同時に動かす」前提で設計している。

手順案（product/main側で実施。今はやらない）:
1. `product/main` から作業ブランチ `feat/merge-nami-final` を切る
2. `git merge --no-ff NAMI_FINAL_CANDIDATE`（= fix/pretest-ux の凍結コミット）
3. 販売版固有の差分（Supabase/認証/課金/analytics 等）とのコンフリクトを解消。特に `src/App.tsx` の state 追加箇所と `vite.config.ts` の `define`/plugin 追加箇所
4. `isDiagnosticsHost()` の本番ホスト名を販売版ドメインに変更（現在は `1125naoto.github.io` 固定）
5. `public/data/poi/` を販売版の対象駅で再生成（`py -3 scripts/fetch_poi_cache.py`）。全国なら `stations.json` 拡張後に実行
6. TypeScript / Vitest / Playwright×2 / build / PWA / secret scan
7. `node scripts/verify_sw_update.cjs` と `node scripts/final_gate_check.cjs`（駅IDを販売版のゴールデンサンプルに変更）で実機同一性を証明

## 3. 販売版で追加設計が必要な点（取り込みと同時に検討）

- **安定したHTTPS URL**: quick tunnel はURLが毎回変わる（今回の実機不一致の一因）。販売版は本番HTTPSドメインが前提なので問題ないが、検証環境は Cloudflare 名前付きトンネル（要アカウント）か、ステージング用固定URLを用意する
- **PWA更新の可視化**: 診断パネルの「配信元と同じ最新版」判定は、本番でも `build-info.json` を常に最新配信すれば機能する（GitHub Pages/CDNのキャッシュ設定で `build-info.json` は短TTLにする）
- **POIデータ更新運用**: `.github/workflows/refresh-poi-cache.yml`（週次）は default branch でのみ動作。販売版では更新頻度と対象駅数に応じて `fetch_poi_cache.py` の並列化を検討
- **localStorage キーのプレフィックス**: `tohoku-me:*` は東北版由来。販売版で複数地域を扱うなら名前空間を再設計（移行コード必須）

## 4. ナミさん版 FINAL FREEZE 後の運用ルール

- `fix/pretest-ux` はタグ `NAMI_FINAL_CANDIDATE` 相当として扱う（タグ作成はユーザー判断。この作業では作成しない）
- 以後ナミさん版を修正するのは「データ消失」「起動不能」「主要機能不能」のみ
- 実機テスト時は必ず `スマホ実機テスト開始.bat` が最後に表示した HTTPS URL とビルドIDを使い、実機の「動作診断」でビルドID一致を確認する
