# 道の駅ナビ（michinoeki-nav / tohoku-michinoeki-map）— Fable 5.1 最終販売・公開可否監査コンテキスト

このドキュメントはZIPのroot直下に置かれています。commitはされていません（監査専用資料）。

---

## 0. このドキュメントの使い方（Fableへ）

このプロジェクトはClaude（このセッションのエージェント）が長期間にわたり実装・自己修正・自己テストしてきました。
**Claudeの「修正した」「解消した」という報告を鵜呑みにせず**、同梱されている実際のソースコード・テストコード・
生成済み監査データ（`fable-audit/evidence/`）を直接読み、現在のHEADで本当に問題が解消されているかを
独立して再確認してください。矛盾や誇張、隠された問題を見つけたら遠慮なく指摘してください。

---

## 1. 製品目的・対象ユーザー

- 製品名: 道の駅ナビ（英名: michinoeki-nav）
- 目的: 日本全国の「道の駅」（国土交通省登録の道路休憩施設）を巡る旅行者向けの、無料・広告なし・APIキー課金なしの
  ルート計画PWA（Progressive Web App）。
- 対象ユーザー: 車で道の駅を巡る一般の旅行者（日本語ユーザー、主にスマートフォン=iPhoneでの利用を想定）。
- 収益化モデル: 未定（今回の監査は「一般公開してよいか」の判定が目的で、課金モデルの評価は範囲外）。
- ポリシー: Google Places APIなど有料APIは一切導入していない。使用する外部データ・APIはすべて無料・
  APIキー不要（OpenStreetMap/Overpass API、国土地理院 住所検索API、OSRM公開デモ、Google Maps URLs
  （課金なしの「リンクを開くだけ」方式）のみ）。

---

## 2. 現在のHEAD（事実）

```
branch: feat/nationwide-poi-cache
HEAD (full):  3d6408421d4544df7e295093a6695c1072a0db1d
HEAD (short): 3d6408421d45
author: 1972naoto1125 <aoshanzhiren08@gmail.com>
```

このコミットに至るまでのcommit履歴は `fable-audit/evidence/git_log_recent40.txt` に、
直近のPublic Release Readiness Gate（コミット `a34a173`）以降の差分統計は
`fable-audit/evidence/diff_stat_since_last_astra_gate_a34a173.txt` に、その間のコミット一覧は
`fable-audit/evidence/commits_since_last_astra_gate_a34a173.txt` に、それぞれ実データとして同梱しています。

**このZIPは `main` ブランチではありません。** `main` へはまだmergeされていません（後述§12）。

---

## 3. アーキテクチャ概要

- フロントエンド: React + TypeScript + Vite。PWA（vite-plugin-pwa、Workbox generateSW）。
- 状態管理: React useState/useCallback中心。バックエンドサーバーなし。すべての永続データは
  この端末の localStorage のみ（§10参照）。
- ルーティング/所要時間計算: OSRM公開デモ（`router.project-osrm.org`）に実道路時間を問い合わせ、
  失敗時は直線距離＋速度モデルによる概算にフォールバック。
- 周辺POI検索: OpenStreetMap Overpass API（3つの無料公開ミラーへstagger-race + フェイルオーバー）。
  事前生成した全国static cache（`public/data/poi/*.json`、1235ファイル）を第一優先で使い、
  欠落/不完全な場合のみライブ取得へフォールバックする「static-cache-first」設計。
- 地図: Leaflet + OpenStreetMapタイル。
- 外部ナビゲーション連携: Google Maps URLs（`https://www.google.com/maps/dir/?api=1...`）を
  新規タブで開くだけ。APIキー・課金なし。

### 主要ディレクトリ
```
src/               … アプリ本体（TypeScript/React）
src/lib/            … ルーティング計算・POI分類・Google Maps URL生成・storage等のロジック層
src/components/     … UIコンポーネント
src/data/           … 全国道の駅マスターデータ（stations.json、1237施設）
src/product/        … 商用化レイヤー（地方区分・entitlement・feature flag等）
public/data/poi/    … 全国1235駅分のPOI static cache（事前生成JSON）
scripts/            … POI取得・分類・監査・QAデプロイ等の運用スクリプト（Python/PowerShell/Node）
e2e/                … Playwright E2Eテスト（iPhone実機相当のエミュレーション中心）
.github/workflows/  … GitHub Actions（本番デプロイ・POI cache定期更新）
docs/               … 製品ドキュメント
```

---

## 4. 全国道の駅データ（項目A）

- 収録数: **1237施設**（47都道府県すべて収録済み。「安達 上下線」等の上下線分離施設を2施設と数える運用）。
- 各施設: 正式名称・読み・都道府県・市区町村・住所・緯度経度・営業状態(status)・公式URL・情報源URL・
  データ確認日を保持。
- テスト（`src/data/stations.test.ts`、122件）で以下を機械的に検証済み:
  - 収録都道府県が正しい47都道府県のいずれかであること
  - 緯度経度が数値として妥当であること、都道府県ごとの想定範囲から明らかに外れていないこと
  - 同一施設の重複登録がないこと（近接150m以内、または同一都道府県内の同名駅チェック）
  - ダミー・TODO・仮データ・placeholder文字列が残っていないこと
  - 開業前(upcoming)施設がルート候補から正しく除外されること
  - データ確認日・情報源が全件に記録されていること

---

## 5. 施設情報（項目B）

- `data/facility-audit.json`: 道の駅自体が持つ設備（RVパーク・温泉）の監査データ。
  「情報が無い」を「無い」に丸めない方針（unknown区分を持つ）。
- RVパーク判定は「onsite/integrated/adjacent/nearby/unrelated」の関係性を区別し、
  ユーザー向け「RVパークあり」フィルターにはonsite/integratedのみを含める設計
  （隣接別施設を誤って含めない）。

---

## 6. 周辺POI（項目C）・食カテゴリ分類（項目D）

### POI truncationの根本修正（過去のAstra P1「static radius / global 30 cap問題」に対応）

- **過去の問題**: 全国cache生成時、POI取得結果を一律30件で切り捨てる`POI_RESULT_LIMIT`が
  取得ロジック自体に混入しており、実際にはもっと多くのPOIが存在する駅でも常に30件しか
  cacheされていなかった（truncation）。
- **修正**: `POI_RESULT_LIMIT`（30件）は表示側の「すべて」表示の上限としてのみ残し、
  cache生成・取得ロジック自体からは撤廃。food/other別々のOverpassクエリ・専用上限
  （`FOOD_ELEMENT_LIMIT=100` / `OTHER_ELEMENT_LIMIT=80`）へ再設計。
- **現在の全国集計**（`scripts/poi_cache_audit.py`を今回のHEADで再実行して確認。
  生データは `fable-audit/evidence/` 配下ではなく `data/poi_cache_audit_result.json`
  としてリポジトリ本体に同梱・commit済み）:

```
eligible cache:              1235駅（生成対象1235駅すべてでcacheファイルが存在）
missing:                     0
failed_without_valid_cache:  0
zeroTotalCount（真の0件候補）: 2
partial（food/otherの片方のみ）: 258
```

- POI総数の推移: **43,814件 → 114,376件**（truncation修正前後）。
- food（飲食）POI総数: **51,534件**（全国合計）。

### 食カテゴリ分類の追加修正（Owner実機QAで発見）

- **発見経緯**: Owner実機（iPhone）で「道の駅ふくしま・10km圏・食べる→洋食」を検索したところ
  **0件**になった。単純な「該当店舗なし」と決めつけず監査した。
- **根本原因**: 洋食(`yoshoku`)判定が`cuisine=western`タグの有無だけに依存しており、
  実データ監査（福島市街地10km圏の実測133件）で`cuisine=western`タグ自体がほぼ使われて
  いないことが判明。全国`food_other`（未分類）26,476件の店名分布を監査した結果、
  店名にジャンルが明記されているのに未分類のまま埋もれている店が大量に存在した。
- **修正**: `classifyFoodGenre()`（`src/lib/poi.ts` と `scripts/fetch_poi_cache.py` の
  重複実装両方）へ、高確度な店名ベースの補助判定を追加（「レストラン」のような
  曖昧語は意図的に対象外。既存のラーメン/寿司/焼肉の店名判定と同じ設計方針）。
- **再分類結果**: 全国1235駅中 **673駅・2161件** を、Overpass再取得なし（既存cacheの
  `name`フィールドのみを使うオフライン再分類）で再分類:
  - 食堂(shokudo) +1188
  - 居酒屋(izakaya) +601
  - 洋食(yoshoku) +258
  - イタリアン(italian) +114
- **福島の実例**: 洋食 0件 → 1件（「ビストロ波平」約7.5km）。Owner実機（iPhone、
  固定QA URL経由）で最終確認済み。
- **全国分類率**: 48.62% → 52.82%（food_other以外への分類率）。
  OTHER/UNKNOWN率: 51.38% → 47.18%。
- **既知の残存P2（隠さず報告）**: 道の駅ふくしま・10km圏の実測food総数は133件だが、
  1駅あたりのfood取得上限は100件（`FOOD_ELEMENT_LIMIT=100`）であるため、
  33件は現在も未取得のまま。今回の0件バグ自体はこの上限とは無関係に
  分類ロジック側の問題だったため対応済みだが、この取得上限そのものは
  引き続き残る制約。**これはP1として緊急対応した箇所ではなく、公開判定に
  おいてP2（許容範囲）かブロッカーかをFableに判断してほしい項目の一つ。**

---

## 7. Route Planner（項目E）

### データモデル

`RouteStop`（1立ち寄り地点）は3種類の地点種別を扱える:

1. **station**（道の駅）: 既存の道の駅マスターデータをそのまま使用。
2. **POI**（アプリ内周辺スポット）: 事前生成cacheまたはライブ取得したPoiオブジェクトを
   `RouteStop.poi`として保持。「➕ ルートに追加」CTAはPOI詳細シートに既に実装済み。
3. **custom**（自由地点）: アプリに登録されていないホテル・旅館・飲食店・観光地・自宅等。
   `RouteStop.custom = { name, address, lat, lng }`。

### 自由地点の座標解決

- 既存の出発地点住所検索と**同一の仕組み**（国土地理院 住所検索API・
  `https://msearch.gsi.go.jp/address-search/AddressSearch` ・無料・APIキー不要・
  `src/lib/geocode.ts`）を再利用。
- **新規の有料API（Google Places等）は一切追加していない。**
- レート制限（最低1.5秒間隔）を既存の実装がそのまま担保。

### 可能な旅行例（実装確認済み）

```
出発 → 道の駅 → 食事POI → 道の駅 → 観光POI → 自由地点 → ホテル(最終目的地)
```

### 終了方法（3択）

1. 最後の地点で終了
2. 出発地点へ戻る（returnToStart）
3. 別の最終目的地を指定（custom final destination）

- custom final destinationは順序最適化(2-opt)の対象から除外し、常に最終地点として固定
  （`ManualMatrixResult.finalCandidate`を別枠で保持し、確定順序の末尾へ追加する設計）。
- custom final destinationを指定した場合、`returnToStart`は強制的に無効化される
  （両立させない。排他を単体テストで確認済み — `src/lib/manualRoute.test.ts`
  「③別の最終目的地を指定」ブロック参照）。

### 出発地点は自由地点/POI/最終目的地の変更・リセットで保持される

現状のUXを監査した上で、出発地点(origin)は「作成中のルートのリセット」処理
（`discardCurrentCourse`）が意図的に触れない設計にしている（再入力の手間を避けるため）。

---

## 8. Google Maps handoff（項目F）

### 過去の実機不具合と根本原因

Owner実機（iPhone）で、複数区間に分割されたGoogleマップ案内のうち「区間1/2」が
住所は表示されるがその先ほぼ反応しない、という不具合が報告された。

**根本原因**: Google Maps URLsの`waypoints`パラメータは、Google公式ドキュメントの例
（`waypoints=A|B|C`）では地点の区切り文字`|`を生のまま使う仕様だが、旧実装では
地点列全体を1つの文字列へ結合してから`encodeURIComponent()`していたため、
実際に生成されるURLでは`|`が`%7C`へ二重エンコードされていた。経由地(waypoints)が
存在する区間だけ、iPhoneのGoogleマップアプリ側の解析に失敗していたと推測される
（経由地なしの単純な2点間ルートだった「区間2/2」は問題なく動作していたことと符合）。

**修正**: 地点ごとに個別に`encodeURIComponent()`し、区切りは生の`|`で連結する形へ変更
（`src/lib/gmaps.ts` `directionsSegments()`/`directionsUrls()`）。

### station handoffの改善（もう一つの実機不具合）

「道の駅 鳥海 ふらっと」がGoogle Maps側で「身障者用駐車場」として表示される、という
実機不具合も報告された。根本原因は、道の駅の経路地点に生の緯度経度だけを渡していたため、
Google Maps側がその座標に最も近い無関係な別POI（駐車場の一区画等）を地点名として
表示・履歴記録することがあったため。既存の単一施設用リンク（`stationSearchUrl`/
`navToStationUrl`）は既に「名称+住所のテキスト検索」方式を使っており問題が起きて
いなかったため、経路上の道の駅地点もこの方式へ統一した。POI・自由地点・出発地点は
確実な公式住所を持たないため、引き続き生の座標を使う。

### モバイル経由地上限

- `MAX_WAYPOINTS = 3`（Google Maps URLs公式仕様上の上限は9だが、実機確認の結果
  モバイルアプリ側でより少ない数から経由地が無視される事象が確認されたため、
  保守的な値に固定）。
- 2/5/10/20地点での分割・区間連結性（前区間のdestination=次区間のorigin）・
  全地点の欠落なし・重複なしをunit testで確認（`src/lib/gmaps.test.ts`）。
- waypoints区切り文字が生の`|`のままであること（`%7C`に二重エンコードされていないこと）
  を明示的な回帰テストとして追加済み。

---

## 9. custom stop / custom final destination（項目G）・POI waypoint（項目H）

§7参照。POI waypoint（「➕ ルートに追加」CTA）は今回のRoute Planner V2作業より前から
既に実装済みだった機能で、今回は変更していない。

---

## 10. route reset/recovery UX（項目I）

### 発見された問題

Owner実機QAで、ルート作成途中に操作を間違えた場合に「どこまで戻ればいいか分からない」
「今どの状態か分からない」「次に何をすればいいか分からない」「面倒に感じる」という
UX課題が報告された。

### 対応

既存のreset関数（`App.tsx` `discardCurrentCourse`）が、既に「作成中のルートだけ」を
安全に初期化する設計として存在していた（訪問記録・スタンプ・行きたい・保存済みルート・
旅行中状態には一切触れない）。「このコースを取り消す」「最初から作り直す」の
確認ダイアログパターンも、ルート結果画面には既に実装済みだった。

不足していたのは:
1. `discardCurrentCourse`が自由地点(`selectedCustomStops`)のクリアを漏らしていた
   （Route Planner V2実装時の見落とし。今回修正）。
2. ルート作成の**早い段階**（地図で道の駅を選択中／POI・自由地点・最終目的地を
   設定中）からはこの「逃げ道」に到達できなかった。

**追加した箇所（新規UIは最小限、既存の安全な仕組みの再利用のみ）**:
- 地図下部の選択バー（`RouteSelectBar.tsx`）: 「↻ やり直す」
- 「地図から選ぶ」設定画面（`ManualRouteBuilder.tsx`）: 主CTA「🚗 このコースで作成」の下に
  「↻ 最初からやり直す」
- 結果画面（`RouteResults.tsx`）: 既存ボタンの表記を統一（機能は変更なし）

### リセット対象・保持されるもの

リセットされる: 選択中の道の駅・POI経由地・自由地点・最終目的地・returnToStart等の
route固有設定・計算済みルート・route draft・一時的な選択状態。

**保持される（絶対に消さない）**: 出発地点・訪問済み・行きたい・スタンプ取得済み・
道の駅マスターデータ・アプリ設定・POI cache・保存済みルート・バックアップ・
旅行中状態。

確認ダイアログあり（誤タップ防止。「訪問記録とスタンプ記録は消えません」の
明示的な補足文言つき）。

---

## 11. localStorage / backup / migration（項目J）

- すべての永続データはこの端末のlocalStorageのみ（バックエンドサーバーなし）。
- QA/staging環境は本番/NAMIと同一origin（`*.github.io`）上で共存するため、
  localStorageキーへ`VITE_STORAGE_NS`ビルドフラグによる名前空間サフィックス
  （例: `:ns-qa`）を付与し、環境間のデータ混線を防止（§13参照）。
- バックアップ: JSON書き出し/読み込み機能あり（`src/lib/backup.ts`）。
  `BACKUP_SCHEMA_VERSION`によるスキーマバージョン管理。
- 復元時の検証: 1件の壊れたレコード（訪問記録・保存ルート・自由地点等）で
  復元全体を拒否せず、不正な項目だけを個別に除外する設計
  （`isSavedRoute`/`isRouteStop`/`isRouteDraft`等の型ガード関数群）。
  壊れた自由地点(`custom`)を含むstopでも画面がクラッシュしないことを
  unit testで確認済み（`src/lib/backup.test.ts`）。
- 旧バージョンのデータ（`stopType`/`custom`/`selectedCustomStops`/`finalDestination`
  フィールドが存在しない旧保存データ・旧下書き）との後方互換を維持
  （省略時は`station`扱い、または空オブジェクト/nullとして扱うデフォルト値）。

---

## 12. PWA（項目K）

- vite-plugin-pwa（Workbox generateSW）によるService Worker自動生成。
- キャッシュ戦略: OSMタイルはCacheFirst、POI static cacheはStaleWhileRevalidate。
- QA環境と本番環境はビルド時の`DEPLOY_BASE`（パスprefix）で分離されており、
  Service Workerのスコープはパスベースのため、QAと本番のSWは互いのリクエストを
  奪い合わない設計（同一originでも共存可能）。

---

## 13. QA / Production release architecture（項目L）

- **Owner QA固定URL**: `https://1125naoto.github.io/tohoku-michinoeki-map-qa/`
- **専用リポジトリ**: `1125naoto/tohoku-michinoeki-map-qa`
  （本番の`tohoku-michinoeki-map`、NAMI版の`tohoku-michinoeki-nami`とは完全に別リポジトリ）
- QAビルドフラグ: `DEPLOY_BASE=/tohoku-michinoeki-map-qa/`、`VITE_STORAGE_NS=qa`
- Owner操作: `スマホ実機テスト開始.bat`をダブルクリックするだけ（PowerShell/cmd/npm/git等の
  操作は一切不要）。内部で`scripts/qa-deploy.ps1`がビルド→QA専用リポジトリへforce push→
  GitHub Pages反映確認まで自動実行し、常に同じ固定URLを表示する。
- 使い捨てのCloudflare Quick Tunnel（trycloudflare.com）は、頻繁なURL失効・接続不能
  （実際に発生した障害: Cloudflare Error 1033）が問題となったため、Owner標準QA運用からは
  廃止済み。緊急デバッグ用のフォールバックとしてのみ`scripts/pretest-start.ps1`を残置。
- **Production（`tohoku-michinoeki-map`）へは今回のセッションでも一切deployしていない**
  （build_type: workflow、GitHub Actions駆動、mainブランチのみへのdeployを許可する
  環境保護ルールが既に設定されている）。
- `main`ブランチへのmergeも未実施（現在の作業はすべて`feat/nationwide-poi-cache`
  ブランチ上）。

---

## 14. privacy / attribution（項目M）

- バックエンドサーバーが存在しないため、ユーザーの訪問記録・保存ルート・
  自由地点（住所等）は**この端末のlocalStorageにのみ保存され、どこにも送信されない**。
- 自由地点（ホテル・自宅等、機微になり得る情報）も同様にlocal-onlyであり、
  Google Mapsを開く操作をユーザーが明示的に行った場合にのみ、その操作に必要な
  情報（地点の名称・住所またはlat/lng）がGoogle側へ渡る（URLを新規タブで開くだけ、
  という一般的なWebの「外部リンク」と同じ挙動）。
- データ出典: OpenStreetMap（ODbLライセンス、Overpass API経由）、国土地理院
  （住所検索API）。各POIの詳細情報にはOSM要素へのsourceUrlを保持し、出典を明示。
- 評価・口コミ等、OSMに存在しないデータをアプリ内で捏造しない方針を一貫して維持。

---

## 15. NAMI版との隔離（項目N）

- NAMI版は完全に別のGitHubリポジトリ（`1125naoto/tohoku-michinoeki-nami`）・
  別のGitHub Pagesサイトとして運営されている。
- 今回のセッションを通じて、NAMIリポジトリへのpush・書き込みは一度も行っていない
  （読み取り専用の`git ls-remote`のみ）。
- NAMIリポジトリのmainブランチHEADは、セッション開始時からセッション終了時まで
  同一のコミットSHA（`f1e84b02a23dcad433d46532e760f5c6e1780845`）のまま変化していない
  ことを都度確認済み。このコミット自体もNAMI側の独立した定期実行GitHub Actions
  （`github-actions[bot]`による自動POIキャッシュ更新）由来であり、本セッションの
  作業とは無関係。

---

## 16. 公開後に重大事故になり得る残存リスク（項目O）— 隠さず報告

1. **POI取得上限（100件/駅・food）**: §6参照。都市部など飲食店密度が高いエリアでは、
   10km圏内の全食事スポットのうち一部が取得されないまま残る。
2. **OSRM公開デモへの依存**: 実道路時間の計算はOSRM公開デモ（無保証・混雑・停止の
   可能性あり）に依存しており、失敗時は概算モデルへフォールバックする設計だが、
   「実道路時間」表示の精度は外部サービスの可用性に左右される。
3. **今回のセッション中に発生した既知の未完走テスト**: 下記§17参照。
4. **バンドルサイズ警告**: `vite build`時に「一部チャンクが500KB超」の警告が出ている
   （コード分割は未実施）。機能上の問題ではないが、低速回線での初回読み込み速度に
   影響する可能性がある。
5. **1駅あたりPOI cacheの`partial`状態**: 258駅（全体の約21%）がfood/otherの
   片方のみ取得できた状態（`status: "partial"`）で保存されている。アプリ側は
   `foodIncomplete`/`otherIncomplete`フラグを正しく認識し、UIで「取得できていない
   可能性」を明示する設計になっているが、この状態のまま公開してよいかはFableの
   判断を仰ぎたい。

---

## 17. テスト状況（正直な報告）

### 確定的に確認できているもの（今回のHEADで再実行・再確認済み）

- TypeScript: クリーン（`fable-audit/evidence/typescript_check_result.txt`、exit code 0）
- Vitest: **511/511 passed**（`fable-audit/evidence/vitest_run_result.txt`、exit code 0。
  今回のセッションでこのFable監査パッケージを作る直前に、現在のHEADに対して
  再実行して確認したものであり、過去の自己申告の再掲ではない）

### Owner/Claude実機QA（E2E・実ブラウザ）で確認できたもの

- custom stop（自由地点）の追加・削除・並び替え
- custom final destination（③別の最終目的地を指定）→ ゴールになる・returnToStartとの排他
- mixed route（道の駅+POI+自由地点の混在）
- Google Mapsセグメンテーション（区切り文字修正・区間ラベルUI改善）の生成URL検証
- reset機能の一部（POI・自由地点・最終目的地を設定した状態からのリセット、
  永続データ保護）

### 正直に報告する未完走部分

**このセッションの終盤、共有マシン上で他の無関係な並行セッション（別プロジェクトの
pytest/mypy/Playwright実行等）による深刻な負荷が断続的に発生し、既存の
`e2e/manual-route.spec.ts`（11件）を1回のバッチで全件完走させることができなかった
（個別に区切って実行した範囲では回帰は確認されていない）。**

この負荷は本コードの問題ではないことを、**本セッションのコードを一切変更していない
既存のPlaywrightテスト**（`route-teardown.spec.ts`の単純な`tab-route`クリック1つ）
が、同じタイミングで60秒タイムアウトするという直接的な証拠で確認済み。

新規に追加した`e2e/custom-stop.spec.ts`（2件）は、ローカルビルド・ライブQA URLの
両方で完全にPASSしている。`e2e/route-restart-shortcut.spec.ts`（5件）のうち、
CASE B/C/D（POI・自由地点・最終目的地を含む設定画面からのリセット、永続データ保護）
はPASSを確認したが、CASE A・CANCEL・永続データ保護テストの一部は、上記と同じ
機械負荷により自動実行を完走できなかった。デプロイ済みのJSバンドルに該当機能の
コード（`route-select-restart`/`manual-request-restart`のtestid、「最初からやり直す」
の文言）が実際に含まれていることは、ブラウザを介さない直接のバンドル検査
（curlでHTTP取得してgrep）で確認済み。

**Fableへ**: この「未完走」を「問題なし」の言い換えとして使っていないか、
テストコード自体（`e2e/`配下、同梱）を読んで、この報告が妥当かご判断ください。

---

## 18. 過去のAstra監査P1一覧と現在の対応状況

以前のAstra監査で少なくとも以下がP1として指摘されていた。**Claudeの報告を信用せず、
現在のHEADのソースコード・テストコードから本当に解消されているか再確認してください。**

| # | 過去のP1指摘 | 現在の対応（Claude報告・要再検証） | 該当コード |
|---|---|---|---|
| 1 | routing unreachableを推定値として扱う問題 | `RouteLeg.unreachable`フラグを追加し、OSRM正常応答上の「到達不能」区間をUIで明示（`⚠️ 実道路接続なし・概算`バッジ）。到達不能区間を隠して概算値で上書き表示しない設計 | `src/lib/routeOrder.ts`, `src/lib/manualRoute.ts`, `src/components/RouteResults.tsx` |
| 2 | POI partial failureと正常zeroの混同 | `status: "partial"`、`foodIncomplete`/`otherIncomplete`フラグを導入し、「取得失敗」と「本当に0件」を区別。API failureを正常0件として保存しない | `scripts/fetch_poi_cache.py`, `src/lib/poiStaticCache.ts` |
| 3 | static radius / global 30 cap問題 | §6参照。POI_RESULT_LIMITを表示側専用に限定し、cache生成ロジックから撤廃。food/other別クエリ・別上限へ再設計 | `src/lib/overpass.ts`, `scripts/fetch_poi_cache.py` |
| 4 | Google Maps mobile waypoint上限 | §8参照。MAX_WAYPOINTS=3への固定に加え、今回waypoints区切り文字の二重エンコードという**新たな**根本原因を発見・修正 | `src/lib/gmaps.ts` |
| 5 | storage save failure / backup validation | 保存失敗の戻り値を呼び出し側が捨てずにハンドリング。バックアップ復元時、1件の壊れたレコードで全体を拒否せず個別除外する型ガードを導入 | `src/lib/storage.ts`, `src/lib/backup.ts` |
| 6 | static JSON / PWA compatibility | ビルド識別情報（buildId/commit/poiDataVersion）をUIの動作診断パネルに表示し、配信元と動作中バージョンの差分を検知できるようにした | `src/lib/buildInfo.ts`, `src/components/DiagnosticsPanel.tsx` |
| 7 | release/update path / deploy safety | QA/Production/NAMIを別リポジトリ・別origin相当（localStorage名前空間分離）で完全分離。QA固定URL化により使い捨てトンネル依存を排除 | `scripts/qa-deploy.ps1`, `src/lib/storageNamespace.ts` |
| 8 | 古いsingle-select E2E | 単一マーカー選択前提の古いE2Eヘルパーを、実測に基づく安定化パターン（`document.elementFromPoint`によるDOM差し替えレース対策等）へ置換 | `e2e/*.spec.ts` |
| 9 | public API/privacy/attribution | §14参照。OSM/国土地理院のみ使用、出典を保持、評価・口コミの捏造禁止を一貫維持 | `src/lib/poi.ts`, `src/lib/geocode.ts` |

---

## 19. Fableへ最終確認してほしい質問

1. この道の駅ナビを**一般ユーザーへ公開し、実際の旅行で使ってもらってよいか？**
2. 旅行中の実利用で、**データ消失・誤ルート・操作不能等の重大事故**につながる
   P0/P1が残っていないか？
3. 過去のAstra P1（§18の表）は、現在のHEADで**本当に**解消されているか？
4. POIのpartial/分類/100件上限等（§6, §16）は、**公開ブロッカー**かそれとも
   **公開後対応でよいP2**か？
5. Google Maps分割ナビは、実装・URL生成・状態遷移として安全か？
6. station/POI/customを混在させたroute modelに、重大な整合性問題がないか？
7. custom final destinationとreturn-to-startの排他は安全か（実装・テストとも）？
8. reset操作（↻ 最初からやり直す）で、永続データを誤って消去する経路がないか？
9. localStorage / backup / restore / migrationに公開ブロッカーがないか？
10. QA → Production のリリース工程に重大リスクがないか？
11. **公開後対応でよいP2**と**公開前必須修正**を明確に分離してほしい。
12. 最終判定を次のいずれかで出してほしい:
    - **A = 公開可能**
    - **B = 軽微修正後公開可能**
    - **C = 重要修正後公開可能**
    - **D = 公開不可**
