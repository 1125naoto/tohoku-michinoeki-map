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
| 14 | （本NAMI FINAL BLOCKER対応） | 現在地取得の共通化(`getBestCurrentPosition`・高精度→低精度2段階リトライ・iOS向け案内)／ラーメン分類の実データ監査に基づく拡充(POI_SCHEMA_VERSION v3)／`PoiProvider`抽象化(`StaticOsmPoiProvider`/`OverpassPoiProvider`/`ExternalPlacesProvider`スタブ)／動作診断へのPOI raw件数・検索半径・現在地試行ログ追加 | **取り込む（最重要）** | 実機で「現在地取得不可」「都市部でラーメン0件」の2大BLOCKERを修正。詳細は本文書末尾「NAMI FINAL BLOCKER 監査結果」参照 |

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

## 5. NAMI FINAL BLOCKER 監査結果（2026-09-07）

実機（本物のiPhone）で「現在地取得不可」「都市部でラーメン0件」の2件が報告され、
READY判定を撤回して根本原因を監査・修正した記録。

### 5.1 現在地取得（PART A）

- 既存コードは元々 Permissions API を取得可否の判断に使っておらず（`DiagnosticsPanel.tsx`の
  表示専用利用のみ）、A1の懸念は構造的に該当なしと確認した。
- `src/lib/geolocation.ts` に `getBestCurrentPosition()` を新設。1回目
  `enableHighAccuracy:true, timeout:12000, maximumAge:0` → `POSITION_UNAVAILABLE`/`TIMEOUT`の
  場合のみ2回目 `enableHighAccuracy:false, timeout:15000, maximumAge:60000` で再試行。
  `PERMISSION_DENIED`は再試行しない。App.tsx/OriginPicker.tsx/MapView.tsx/DiagnosticsPanel.tsx
  の4箇所すべてをこの共通関数に統一。
- iOS実機のUAでは`PERMISSION_DENIED`時に「iPhoneの位置情報設定で、このサイトの位置情報を
  許可してください」を追加表示。
- 動作診断パネルに試行ログ（高精度/低精度・成功可否・code/message・所要時間）を追加。

### 5.2 ラーメン検索（PART B）実データ監査結果

仙台駅周辺（都市部密集、restaurant/fast_food 584件）・盛岡駅周辺(91件)・山形市中心部(43件)の
実Overpassデータを取得し監査。

- **cuisineタグ付与率は52%**（仙台）。cuisine=noodleは実データ上、ラーメン店だけでなく
  そば店（「そばの神田」）・うどん店（「丸亀製麺」）・麻辣湯店（「七宝麻辣湯」）にも
  横断して付与されており、`cuisine=noodle`をそのままラーメンとみなす修正は**しなかった**
  （誤分類を生むことをこのデータで確認したため）。
- 一方、店名側に「つけ麺」「油そば」「中華蕎麦」「拉麺」「支那そば」「麺屋/麺処/麺房/麺工房
  （店名先頭のみ）」「一蘭・町田商店（チェーン名）」を追加したところ、仙台データで
  ラーメン検出数が37→47件（+27%）に増加し、3都市・restaurant/fast_food計718件で
  **誤検出（うどん/そば/パスタ/麻辣湯の誤分類）は0件**だった。
  （`src/lib/poi.ts` classifyFoodGenre、`scripts/fetch_poi_cache.py` classify_food_genre、
  両方に反映・単体テストで固定化: `src/lib/poi.test.ts`）
- `POI_SCHEMA_VERSION`を2→3に更新し、旧分類で保存された端末側キャッシュを無効化。
- **追加で判明した副次的な問題（今回は修正せず記録のみ）**: 都市部での`around`検索は
  `OVERPASS_ELEMENT_LIMIT=80`のキャップにかかりやすく（今回検証した5地点中4地点で
  3km圏内から80件到達）、かつ`out center body N`に距離順ソートが無いため、
  近い店舗が並び順の都合で切り捨てられる可能性が理論上ある。また監査中に
  `overpass-api.de`で単独9秒超・`maps.mail.ru`で8秒タイムアウトを実測したが、
  これは監査スクリプト自身が同一無料ミラーへ短時間に連続アクセスしたことによる
  レート制限の影響を強く疑っており、実際の利用者の初回アクセスでも同程度に
  遅いと断定はできない。販売版移行時に実運用トラフィックで再計測することを推奨する。

### 5.3 PoiProvider抽象化（PART B5）

`src/lib/poiProvider.ts` に `PoiProvider`インターフェースを新設し、
`StaticOsmPoiProvider`（駅起点の事前生成静的キャッシュ）・`OverpassPoiProvider`
（ライブOverpass。現在地検索は常にこれを使う）を実装。UI（`PoiSearchPanel.tsx`）は
従来通りデータ源を意識しない。`ExternalPlacesProvider`は型のみのプレースホルダー
（呼び出すと明示的に例外。APIキー要求・契約確定は一切していない）。

### 5.4 POI_PROVIDER_LIMITATION の判定

**部分的にYES**（全面的な有料API移行が必須という意味ではない）。
今回の分類拡充で店名・cuisineタグに何らかの手がかりがあるラーメン店はほぼ拾えるように
なったが、**店名・cuisineタグのどちらにもラーメンを示す語が一切現れない全国チェーン**
（今回の実データで実際に検出: 一蘭・町田商店）は個別のチェーン名を追加する以外に
拾う方法が無く、これはOSMのタグ付け網羅性そのものの限界であってアプリの分類ロジックの
バグではない。販売版で「全国どこでも主要チェーンを含め漏れなく拾う」ことを成功条件にする
場合は、チェーン名リストを継続的にメンテナンスし続けるか、Phase 2でPlaces系APIの採用を
検討することを推奨する（下表）。現時点（東北6県・実地テスト規模）ではOSM+今回の分類拡充で
実用上十分と判断する。

| Provider | 日本国内カバレッジ | 料金モデル（要最新確認） | 利用規約上の主な制約 | 備考 |
|---|---|---|---|---|
| Google Places API | 非常に高い（実質最良） | 従量課金、無料枠は限定的 | 結果のキャッシュ・自前DB化は原則禁止、地図表示との組み合わせ要件あり | 最有力候補。コストが利用規模に比例して増える点の事前試算が必要 |
| HERE Places | 高い（欧米は特に強い、国内は都市部中心） | 無料枠あり＋従量課金 | Google比で規約は緩やかだがキャッシュ可否は要確認 | 為替・料金改定の影響を受けやすい |
| Foursquare Places | 中〜高（国内は都市部中心、地方が手薄な傾向） | 無料枠あり＋従量課金 | 商用利用条件の確認必須 | 道の駅のような郊外拠点でのカバレッジ実測が別途必要 |
| Mapbox（POI検索機能） | 中（地図タイルは強いがPOI検索は限定的) | サブスク＋従量課金 | - | 今回の用途（郊外道の駅＋都市部飲食店）には他社が優勢な可能性 |

上記は一般的な特性の整理であり、正式な料金・規約は採用検討時に必ず一次情報を再確認すること。
本エンジンではAPIキーの要求・契約行為は一切行っていない。
