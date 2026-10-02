# Astra 販売前 Final Audit コンテキスト — 道の駅ナビ 全国版 v1.1.0-rc2

このファイルは監査用の資料であり、製品コードではありません。
**README や本ファイルの自己申告を信用せず、同梱の src / public / e2e / scripts の実体から独立に判定してください。**
記載が実体と食い違う場合は、実体を正とし、その食い違い自体を指摘対象としてください。

---

## 1. 監査対象の同定

| 項目 | 値 |
|---|---|
| PRODUCT | 道の駅ナビ 全国版（Roadside Station Navigator, nationwide） |
| RC_TAG | `v1.1.0-rc2`（annotated tag） |
| RC_HEAD | `272d30466a1839057db75b193e2a8f91ff419d7e` |
| BRANCH | `feat/nationwide-poi-cache` |
| QA_URL | https://1125naoto.github.io/tohoku-michinoeki-map-qa/ |
| QA_BUILD | `272d30466a18@20260917T051417`（environment=qa, dirty=false） |
| PRODUCTION_STATUS | **未deploy**。`origin/main` = `d55939accba67090c65181da571d9662f64eca5d` のまま。mainへのmergeもなし |
| NAMI_STATUS | **独立・未変更**。別リポジトリ `tohoku-michinoeki-nami` の main = `f1e84b02a23dcad433d46532e760f5c6e1780845` |
| 直前のFIX版 | `v1.1.0-rc1` = `da8b232a107e66660ff5044a5bc36aefe23ac314`（変更していない） |

同梱の `astra-audit/evidence/git_rc2.txt` に、HEAD・タグ・worktree状態・origin/NAMIの参照先を実測値として収録しています。

### RC1 → RC2 の差分
`astra-audit/evidence/commits_rc1_to_rc2.txt` と `diffstat_rc1_to_rc2.txt` を参照してください。
RC1以降は「戻る導線の整備」「名称・住所検索（施設名検索の追加と精度改善）」「コース作成途中からの周辺検索」の3系統のみです。

---

## 2. データ規模（実データから算出）

| 項目 | 値 | 出典 |
|---|---|---|
| STATION_COUNT | 1,237（うち `status=open` 1,235） | `src/data/stations.json` |
| PREFECTURE_COUNT | 47 | `src/types.ts` の `PREFECTURES` / `src/product/region/regions.ts` の `PREFECTURE_TABLE` |
| REGION_COUNT | 10（北海道・東北・関東・北陸・中部・近畿・中国・四国・九州・沖縄） | `src/types.ts` の `AREAS` / `regions.ts` の `REGION_IDS` |
| POI静的キャッシュ | 1,235ファイル | `public/data/poi/*.json` |
| poiDataVersion | `de4416294929` | ビルド時に `vite.config.ts` が算出し `build-info.json` へ出力 |

---

## 3. 主要機能（Owner iPhone 実機QAで確認済みの範囲）

Owner iPhone 実機QA: **PASS**（販売を止める重大問題は現時点で未確認）。

- 全国道の駅マップ（1,237施設）
- 初回起動の地域選択 →「何県を回りますか？」→ 県選択 → 地図（COLD STARTは必ず地域選択から）
- 複数県の同時選択、地図からの「🗾 地域・県を変更」
- 訪問済み / 行きたい / スタンプ の記録と達成率集計
- 周辺スポット検索（アプリ内POI: OSM/Overpass + 静的キャッシュ）
- 食べる / 観光 / 温泉・休憩 / 宿泊 のカテゴリとアイコン付きサブカテゴリ
- Google Maps カテゴリ検索（市区町村ベース。例「ラーメン 秋田市」）
- Google Web 詳細検索（候補一覧のあとの補助導線）
- コース作成（おすすめコース自動選定 / 地図から選ぶ手動選択）
- 出発地点の指定: 現在地 / 名称・住所検索 / 地図で選ぶ / 道の駅から
- カスタム出発地・経由地・最終目的地（自由地点）
- コース作成途中の「🔍 この駅の周辺を探す」（コース完成前に利用可能）
- Google Maps へのコース受け渡し（分割ナビ、waypoint制約対応）
- コースの保存 / 復元 / 旅行中（TripState）
- PWA（オフライン閲覧、ホーム画面追加、Service Workerによる自動更新）
- サブ画面の「← 戻る」導線（アプリ内stateで戻る。`history.back()` は使わない）

---

## 4. 既知の制約（隠さず記載。ここも監査対象）

### 4-1. 名称検索の守備範囲
- 実装: **OpenStreetMap Nominatim（施設名）＋ 国土地理院 住所検索API（住所・地名）＋ アプリ内の道の駅データ**。
  いずれも無料・APIキー不要。`src/lib/nominatim.ts` / `src/lib/geocode.ts` / `src/lib/placeSearch.ts`。
- **Google Places 相当の全店舗・全ホテル検索は保証しません。** OSMに登録が無い施設は見つかりません
  （実測例:「リブマックス郡山」は0件）。
- 曖昧・非正式な施設名称を100%解決することも保証しません（実測例:「郡山中央インター」）。
- **正式なfallbackは「🗺️ 地図で選ぶ」**。検索0件時にエラー内へボタンを出し、既存の地図指定フローへ接続します。
- 設計判断: 名称一致が弱く表示中の都道府県とも異なる候補は**出さず0件を返す**方針
  （無関係な県のICを並べるより「見つからない」と伝える）。`dropUnrelated()` を参照。
- Nominatim公開インスタンスの利用条件に合わせ、1.5秒間隔・日本国内限定・最大5件・
  **検索ボタン押下時のみ**（オートコンプリートなし）・出典表示「© OpenStreetMap contributors」。
  → この運用が公開製品として妥当かは、**Astra側で独自に再評価してください**（レート制限・可用性・利用規約の観点）。

### 4-2. 既知のテスト不安定（PASS扱いしません）
- `e2e/manual-route.spec.ts` が `tab-route` クリック等で **60秒の actionability timeout** を起こすことがあります。
- 現時点の調査結果（Astra側で再評価してください）:
  - RC2の差分は `src/lib/placeSearch.ts` / `src/components/PlaceSearchBox.tsx` /
    `src/components/OriginPicker.tsx` とテストのみで、地図選択フロー
    （`ManualRouteBuilder` / `RouteSelectionSheet` / `MapView` / タブ切替）は未変更。
  - **今回一切変更していない既存テスト「シナリオ1」も同じtimeoutで失敗**する。
  - これは `b22797c` 時点で stash して取得した基準測定でも失敗していた5件のうちの1つ。
- したがって「RC2による回帰ではない」と判断していますが、**実機で同種のタップ不能が起きないかは独立に確認してください**。
  実際、過去に「地図上部に行を追加して地図が縮み、マーカーが周辺スポットパネルの下に隠れてタップできなくなる」
  実バグがこの種のテストで検出された経緯があります。

### 4-3. その他
- Production 未deploy。NAMI版は別リポジトリで独立。
- 有料API・APIキー・スクレイピングは使用していません。
- 営業時間・休館日などのデータは更新されうるため、アプリ内でも公式情報の確認を促しています。

---

## 5. テスト結果（RC2 HEAD で実測）

| 種別 | 結果 | 証拠 |
|---|---|---|
| TypeScript (`tsc --noEmit`) | **PASS**（EXIT_CODE=0） | `astra-audit/evidence/typescript_rc2.txt` |
| Vitest | **586/586 PASS**（31ファイル） | `astra-audit/evidence/vitest_rc2.txt` |
| 関連E2E `e2e/back-nav-origin.spec.ts` | **13/13 PASS** | 本パッケージ作成セッション内で実行。ログファイルは未保存のため、再現するには同梱の spec を実行してください |
| E2E `e2e/manual-route.spec.ts` | **不安定（上記4-2）** | 同上 |
| full Playwright | **未実行**（本FIX/パッケージ工程では新規実行していません） | — |

TypeScript と Vitest は本パッケージ作成時に RC2 HEAD 上で実行した生ログです。
E2Eは実行ログを保存していないため、**数値を鵜呑みにせず、必要なら同梱specを実行して独立に確認してください。**

---

## 6. Astra に重点的に見てほしいユーザージャーニー

| ID | ジャーニー |
|---|---|
| A | 初回起動 → 地域 → 県 → 地図 → 道の駅を見る |
| B | 道の駅 → 行きたい → 訪問 → スタンプ |
| C | 道の駅 → 周辺スポット → 食事/観光/温泉/宿泊 → 外部検索 → アプリへ戻る |
| D | 複数道の駅を選ぶ → コース作成 → 出発地点 → 経由 → 最終目的地 → Google Maps |
| E | コース作成途中 → 道の駅周辺で昼食等を探す → アプリへ戻る → コース作成継続 |
| F | 名称検索失敗 → 地図で選ぶ → コース作成継続 |
| G | コース保存 → 再表示/復元 |
| H | PWA/再訪 → 状態保持 |

各ジャーニーについて「詰まる箇所」「戻れなくなる箇所」「状態が失われる箇所」を重点的に見てください。

---

## 7. 判定の分類（Astraへの要求）

| 区分 | 定義 |
|---|---|
| **P0** | 販売/公開を停止すべき。重大な安全性・データ破損・主要機能の不成立 |
| **P1** | 販売前に修正/追加する価値が非常に高い。一般ユーザーが普通に遭遇し、商品価値・信頼性・継続利用に大きく影響 |
| **P2** | 販売後 v1.2 で対応可能 |
| **P3** | 将来改善・アイデア |

**重要: 「あると便利」だけでP1にしないでください。**

P1（特に機能追加）には、次をすべて添えてください。

1. 具体的なユーザー困難（誰が・いつ・何に詰まるか）
2. 発生頻度（どのくらいのユーザーが遭遇するか）
3. 販売への影響（返金・低評価・解約につながるか）
4. 既存の代替手段の有無（今のUIで回避できるか）
5. 実装コスト（概算）
6. regression risk（既存機能を壊す危険）
7. 販売後では遅い理由

---

## 8. 商品価値の監査（コード監査で終わらせない）

コードの正しさだけでなく、**有料商品として成立しているか**も判定対象です。

- 初見ユーザーが迷わないか
- 旅行**前**の計画ツールとして使いやすいか
- 旅行**中**に使いやすいか（運転中・同乗者操作・片手操作）
- スマホ片手操作（タップ領域・到達性・文字サイズ）
- コース作成UXの分かりやすさ
- 周辺検索UXの分かりやすさ（アプリ内POIとGoogle導線の役割が伝わるか）
- 保存/再開の安心感
- エラー・0件時の逃げ道が機能しているか
- 外部Google遷移からアプリへ戻れるか
- 「また使いたい」と思えるか
- 無料の地図アプリとの差別化ができているか
- 有料商品として訴求できる機能は何か
- 販売ページで誤解を生みうる仕様（できないことを期待させないか）
- 期待値を下げる不足機能

---

## 9. 機能提案の監査

「こんな機能があったらいい」も積極的に出してください。
ただし単なるアイデア列挙ではなく、**現在のコード/UXとのギャップ**として提示し、次に分類してください。

| 区分 | 意味 |
|---|---|
| **SELL-BEFORE** | 販売前に必要 |
| **POST-LAUNCH** | 販売後 v1.2 候補 |
| **FUTURE** | 将来候補 |

---

## 10. パッケージ構成

```
src/                     アプリ本体（React + TypeScript）
public/                  配信アセット
  data/poi/*.json        POI静的キャッシュ 1,235ファイル
e2e/                     Playwright E2E
scripts/                 データ生成・検証・QAデプロイ
docs/                    FACILITY_DATA.md / PRODUCT_HANDOFF_PLAN.md
README.md                利用者・運用者向け説明
PRODUCT_ARCHITECTURE.md  製品版アーキテクチャ方針
package.json / package-lock.json / vite.config.ts / tsconfig*.json / playwright.config.ts / index.html
astra-audit/ASTRA_AUDIT_CONTEXT.md  本ファイル
astra-audit/evidence/    RC2 HEADで採取した証拠（TypeScript/Vitest/git）
```

除外したもの: `node_modules` / `dist` / ビルド成果物 / キャッシュ / カバレッジ / 巨大ログ /
一時ファイル / 過去の監査ZIP / Owner のスクラッチファイル。
`.env` 等の秘密情報ファイルはリポジトリに存在せず、同梱していません（§11）。

---

## 11. セキュリティ・個人情報

パッケージ作成前にスキャンを実施しました。

- 追跡ファイルに `.env` / `*.pem` / `*.key` / secret / credential / password / token を名前に持つファイルは**存在しません**。
- 内容スキャンでの一致は `public/data/poi/*.json` 4件のみで、いずれも
  **OpenStreetMap由来の店名**（例: `Secret Fruits`）であり、認証情報ではありません。
- メールアドレス等の個人情報は `src` / `scripts` / `e2e` に検出されませんでした。
- 顧客データは含まれていません。
- 本アプリはバックエンドを持たず、訪問記録等はすべて端末の localStorage にのみ保存されます
  （`src/lib/storage.ts`）。この設計の妥当性も監査対象としてください。
