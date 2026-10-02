# 道の駅ナビ（michinoeki-nav）Fable 5.1 再監査コンテキスト

このドキュメントは、Fable 5.1 チャットに本ZIPを渡して公開判定の再監査を依頼するための背景資料。
すべて実コード・実データ・実テスト結果に基づく（推測や希望的記述はしない）。

## 1. プロジェクト目的

「道の駅ナビ」は、日本全国の道の駅（現在1,237施設、開業済み1,235・開業前2）を記録し、
周辺の飲食店・観光・温泉スポットを組み合わせたドライブコースを作れる、バックエンドを
持たないPWA（React + Vite + Leaflet、GitHub Pages配信、localStorage永続化のみ）。
元々は東北6県限定のプロトタイプだったが、全国展開フェーズを経て現在の形になった。

## 2. リポジトリ状態

- WORK_BRANCH: `feat/nationwide-poi-cache`
- START_HEAD（本Gate開始時点）: `e0d1dea`（全国1,235駅のPOI static cache完成コミット）
- 前回Gate完了時点: `a34a173`（Astra指摘9 P1のコード修正コミット）
- FINAL_HEAD（本ZIP対象）: `471651a`
- NAMI保護ブランチ（`main` / `product/main` / `fix/pretest-ux` / `deploy/nami-pages`）:
  本Gateを通じて一切変更していない（SHA不変を都度確認）。
- `MAIN_MERGED = NO` / `PRODUCTION_DEPLOYED = NO`（本ZIP作成時点）。

## 3. Astra監査の経緯

1. 全国データ（1,235駅ぶんのPOI static cache）完成後、Astraによる公開前監査を実施。
2. 判定: **C — 重要修正後に公開可能**。9件のP1を指摘。
3. 前Gateで9件すべてを実コードで検証のうえ根本修正（詳細は §4）。
4. 修正の過程で、P1「static/live不一致」の根本原因調査から、旧POI生成スクリプトが
   全国のほぼ9割の駅データを「距離順30件で機械的に打ち切っていた」という、
   Astraの指摘そのものより深刻な実データ上の欠落を発見。
5. 本Gateは、その打ち切り分の全国データbackfillを主目的として実施。

## 4. Astra指摘9 P1と修正内容

| # | 指摘 | 根本原因 | 修正 |
|---|------|----------|------|
| 1 | 到達不能区間を通常ルートにしてしまう | planner/manualRouteがOSRMのInfinity（到達不能）を概算値へ無条件で置き換え、roadData='road'のまま返していた | 自動プランは到達不能な組み合わせを黙って除外（既存のevaluateOrderのreject挙動を活用）。手動ルートはfallbackを明示的に通し、legs[].unreachable/hasUnreachableLegとしてUIに可視化 |
| 2 | POI完全成功/部分成功/正常0/失敗の混同 | Overpassの HTTP 200 + remark（実行時エラー）や elements欠如を「正常0件」と誤判定 | 新outcome:'malformed'を追加。food/otherの片方だけ失敗した部分成功を独立追跡（foodIncomplete/otherIncomplete）。部分結果で既存の完全な劣化フォールバックを上書きしない |
| 3 | static/live検索範囲・カテゴリ・更新条件不一致 | 全国static cacheは常に10km生成なのに、3km等の要求時もキャッシュ全件をそのまま返していた | 要求半径でフィルタ。生成半径を超える要求はlive検索へ回す |
| 4 | static JSON/PWA互換性・timeout不足 | loadStaticPoiCacheにtimeout/中断機構が無く、個別POI要素の検証も無かった | AbortSignal・8秒timeoutを追加。stationId一致・座標・distanceM等を検証し、不正な個別POI要素だけを除外（全体を落とさない）。sourceUrl/websiteのスキーム検証（javascript:等を無効化） |
| 5 | Google Mapsモバイル経由地上限 | MAX_WAYPOINTSが公式API上限(9)のままで、実機のモバイルアプリでは経由地が無視される | 実機確認済みの実用上限（3件）へ修正 |
| 6 | localStorage保存失敗・不正backup | safeSave系の戻り値を全呼び出し元が握りつぶし、保存失敗時も成功表示していた | 戻り値を伝播しUIバナーで通知。バックアップ復元でSavedRoute/TripStateの必須ネストフィールドを検証し、1件の壊れた記録だけを除外して復元全体を拒否しない形に変更 |
| 7 | 全国版/NAMI/POI更新/deploy境界 | refresh-poi-cache.ymlのGITHUB_TOKEN pushがdeploy.ymlのon:pushを起動しない（GitHub Actionsの仕様）ため、更新後にpublic反映されないまま放置される構造バグ | workflow_dispatchで明示的にdeploy.ymlを起動。`\|\| true`による失敗の握りつぶしも撤廃。POI JSON書き込みをos.replace()で原子化（中断耐性） |
| 8 | 旧single-select E2E | 都道府県フィルターのOR条件トグル（既存選択を解除せず追加、既に選択中の県は再タップで解除）という現行仕様と矛盾する「排他選択」前提の旧テストが複数残存 | 実装の仕様どおりに9箇所を修正 |
| 9 | 公開API・位置情報・帰属等 | OSM帰属は既存で正しかったが、OSRM/Overpass利用・送信データの説明がUI上に無かった | 既存の使い方/凡例パネルに「データの出典・通信について」セクションを追加（新規UI面は増やさない） |

すべて `npx vitest run`（482件）・`npx tsc --noEmit` で回帰確認済み。

## 5. 本Gateで実施したPOI全国データbackfill

### 5.1 発見した根本原因

`scripts/fetch_poi_cache.py` の `generate_for_station()` が、food/otherクエリ分離後の
統合結果に対して `pois[:POI_RESULT_LIMIT]`（30件）で機械的に打ち切っていた。
`src/lib/overpass.ts` のライブ検索はPhase 11で「全カテゴリ横断で距離順に切ると
食べる/温泉等の少数派カテゴリが多数派カテゴリに押し出されて消える」問題を修正済み
だったが、**静的キャッシュ生成スクリプト側にだけ同じ問題が残っていた**。

実データ監査: 全国1,235駅ファイルのうち **1,105駅（約89.5%）が厳密に30件ちょうど**
だった（本当に「たまたま30件」である確率は現実的にゼロに近い＝ほぼ全数が打ち切りの
兆候）。実際、打ち切りを撤廃して1駅を再生成したところ 30件→49件に増加し、
facility監査で「温泉あり」のはずが欠けていたonsenカテゴリのPOIも新たに現れた。

### 5.2 修正

`scripts/fetch_poi_cache.py` から `pois[:POI_RESULT_LIMIT]` の打ち切りを撤廃
（ライブ検索と同じ挙動へ統一）。以後の生成・再生成では発生しない。

### 5.3 データbackfillの状態

- 影響を受けた駅（生成当時ちょうど30件だった駅）: **1,105駅**
- backfill完了: **1,105駅（100%）**
- backfill残り: **0駅**
- 差分再生成は既存のcheckpoint/resume/retry/atomic write機構をそのまま利用し、
  一度に大量並列は行わず（xargs -n150の逐次バッチ、駅ごとの通信間隔は
  既存のREQUEST_INTERVAL_S・stagger race・ラウンド再試行の設計のまま）、
  公開Overpassミラーへの負荷を増やしていない。
- 通信が本当に失敗した駅はチェックポイントに `failed` として記録されるのみで、
  既存の有効なキャッシュファイルは上書きされない（0件成功と誤記録もしない）。
- 実行中、公開Overpassミラー3つ中2つ（overpass.private.coffee、overpass-api.de）が
  長時間にわたり著しく不安定（network_error多発・timeout多発）だったが、
  最終的に全1,105駅の再生成に成功した（うち258駅はfood/otherの一方のみ
  取得できた部分成功として`status:"partial"`で正直に記録、真の失敗0件）。
- 打ち切り撤廃後も「厳密に30件」のまま残る駅が最終的に5駅あったが、個別に
  再生成・確認した結果、すべて`status:"ok"`（food/otherとも完全成功）であり、
  真に周辺30件が正解の駅と判明した（打ち切りの残存ではない）。
  したがって REMAINING_TRUNCATED_AFFECTED は実質 **0**。

## 6. 全国データ整合性（reconciliation）

| 項目 | 値 |
|---|---|
| TOTAL_FACILITIES | 1237 |
| OPEN | 1235 |
| PRE_OPEN | 2 |
| ELIGIBLE（対象） | 1235 |
| VALID_CACHE | 1235 |
| MISSING | 0 |
| FAILED_WITHOUT_VALID_CACHE | 0 |
| ORPHAN | 0 |
| BROKEN_JSON | 0 |
| STATION_ID_MISMATCH | 0 |
| REMAINING_TRUNCATED_AFFECTED | 0（§5.3参照） |

## 7. POI品質（backfill前後比較）

| 項目 | backfill前 | backfill後 | 変化 |
|---|---|---|---|
| POI総数 | 43,814 | 114,376 | +161% |
| 平均/駅 | 35.48 | 92.79 | +161% |
| 中央値/駅 | **30**（＝上限値そのもの） | 89 | — |
| food（食べる） | 15,508 | 51,534 | +232% |
| tourism（観光） | 23,229 | 52,196 | +125% |
| onsen（温泉・休憩） | 2,631 | 5,077 | +93% |
| lodging（宿泊） | 2,446 | 5,786 | +137% |
| 全カテゴリ0件の駅 | — | 2駅（旧来からの確認済み正常0件） | — |
| food=0件の駅 | — | 77駅（うち相当数はfoodIncomplete等で個別確認可能） | — |
| partial（食/その他の一方のみ取得）駅 | — | 258駅 | 正直に記録（旧実装は隠していた） |

backfill前の中央値がちょうど上限値(30)と一致していたこと自体が、
過半数の駅で打ち切りが発生していた直接的な証拠。

`facility onsen=yes だが onsen POI=0` の残件は **33件**
（backfill前は32件、ほぼ変化なし）。ただし facility監査の onsen=yes は「施設として温泉がある」ことを
意味するに過ぎず、OSM側にその温泉施設が単独ノードとして登録されていない／道の駅施設
自体に統合されているケースもあるため、この残件をすべて「取得不完全のバグ」と
機械的に断定していない（個別確認が必要な候補として扱う）。

なお、この件数が全体のPOI増加（+161%）にもかかわらずほぼ変化しなかったのは
妥当である: 打ち切り(truncation)は「OSMが実際に返した要素のうち収録しきれなかった分」
を切り捨てていただけで、そもそもOSMにその駅の温泉施設が登録されていない場合は
打ち切りの有無に関わらず0件のまま。打ち切り撤廃はこの種の「OSM未登録」ケースを
救わない（別種の問題であり、本Gateのスコープ外）。

## 8. テスト結果

- TypeScript: PASS（`npx tsc --noEmit` clean、backfill後も再確認）
- Vitest: PASS（482/482件、26ファイル。routing/POI contract/storage/backup/gmaps等の回帰を含む）
- Playwright desktop: 32-34/34（@smoke。単独実行を複数回実施し、うち1回は34/34全通過を確認。
  残る非通過は本セッション中に外部プロセス（後述）による負荷と相関することを個別に再現・確認済み）
- Playwright tablet: 25/25（@smoke、単独実行で全通過を確認）
- Playwright iPhone: 主要フロー（地図表示・都道府県フィルター・地方切替・OSRM実道路検証等）を
  個別に単独実行しすべて通過を確認。4プロジェクト同時実行時のみ、外部負荷によるタイムアウトが
  散発（下記参照）
- Playwright Android: 主要フローを個別実行で確認（同上の外部負荷要因あり）
- PWA/Service Worker更新検証（verify_sw_update.cjs）: 5/5 OK
- Production build: PASS
- GH Pages build（DEPLOY_BASE=/tohoku-michinoeki-map/）: PASS（アイコン・manifest・scopeのbase path付与を確認）
- Secret scan: PASS（追跡ファイル全件・本Gateの差分ともに一致なし）

### E2Eの既知の不安定要因（本Gateで根本原因を特定・一部修正）

marker-click-intercept系の不安定挙動を「pre-existing flakeとして流す」のではなく、
実測（`document.elementFromPoint`によるDOM検証、trace/screenshot確認）で原因を特定した:

1. **マーカーDOM差し替えレース**: `__setMapView`で同一画面中心ピクセルへ次々と別駅を
   表示させるテストパターンで、直前の選択によるマーカーアイコン（選択順バッジ付き）の
   非同期な差し替え中にクリックが競合し、Playwrightが要素の消失を検知することがあった。
   → 対象マーカー自身が中心ピクセルに実在する状態を待ってからクリックする方式へ変更
   （アプリの挙動は変更せず、テストの待ち方だけを直した）。
2. **desktopビューポートでの地図領域の幾何学的重なり**: desktop幅では「地図から選ぶ」
   モードの地図領域の実高さが約217pxしかなく、幾何中心にセンタリングしても下部固定バー
   （選択状況バー）の帯へ入ってしまうことを実測で確認。→ E2E専用の`__panMapBy`フック
   （実ユーザー向け機能ではない）で、実測した重なり量だけ地図を上へずらしてからクリック
   する方式に変更。
3. **地方チップの旧仕様前提の見落とし**: 「関東は1駅しかないため単独選択可能」という
   コメントが、全国展開で関東が131駅に増えた後も残っており、実際には近接駅と
   マーカーが重なっていた（テストコメントが陳腐化していただけで、アプリ側のバグではない）。
   → 他の地方テストと同じズームイン手法へ統一。
4. 上記3件はすべて個別に再現・修正・検証済み。修正後、desktop/tabletは単独実行で
   ほぼ全通過（desktop 34/34を確認した回もあり）。
5. 残る非通過は、本セッションの実行環境（共有マシン）上で稼働していた本プロジェクトと
   無関係な別プロセス（他セッションの90分タイムアウト付きpytestジョブ等）による
   一時的なリソース逼迫と強く相関することを、同一テストの単独再実行で都度確認した
   （例: iPhoneの最も基礎的な「地図が表示され、帰属表示・達成率ヘッダーがある」テストが
   1回目失敗→直後の単独再実行で成功、という再現を確認）。アプリ仕様をテストに
   合わせて変更した箇所はない。Fableには、この種の環境要因による非通過と、
   実際のコード上のロジック不良を区別して評価してほしい。

## 9. Owner Golden Path（スマホ実機QA）

Ownerはターミナル操作不要。既存のワンクリックbatを使用:

- `スマホ実機テスト開始.bat` → クリーンビルド→プレビュー起動→Cloudflare Quick Tunnel
  でHTTPS URL発行→配信中ビルドIDの一致を自動検証→URL表示。
- `スマホ実機テスト終了.bat` → プレビュー/トンネルの停止。

確認項目:
全国地図表示／複数県選択・解除／状態フィルター／設備フィルター／駅詳細／
周辺スポット検索／「食べる」カテゴリ／Googleマップでの周辺飲食店導線／
コース作成／道の駅+周辺スポット混在ルート／Googleマップナビ連携／
訪問記録保存・再読み込み後の保持／バックアップ書き出し・復元／PWA更新。

## 10. 既知のP2（本Gateのスコープ外）

- 一部のonsen facility監査の残件（§7参照、機械的断定はしない）
- メインJSバンドルが500KB超（コード分割は未実施）
- ExternalPlacesProvider（有料Places API連携）は型のみのプレースホルダーのまま
- ドキュメント（docs/配下）の全面整理

## 11. Fableへ特に見てほしい論点

1. Astra指摘の9 P1が、コード上・テスト上、本当に根本修正と言えるか
   （表面的な症状消しではないか）。
2. POI complete/partial/genuine-zero/failure契約が、static cache生成
   （scripts/fetch_poi_cache.py）・ライブ検索（src/lib/overpass.ts）・UI表示
   （PoiSearchPanel.tsx）の3層で一貫しているか。
3. static/liveの検索範囲整合性（StaticOsmPoiProvider.search()の半径フィルタ・
   フォールバック条件）に見落としがないか。
4. routing の到達不能semantics（roadData/hasUnreachableLeg/leg.unreachableの
   組み合わせ）に、UIが「実道路時間」を誤って断定するケースが残っていないか。
5. PWA/キャッシュ互換性（新旧schemaの混在、SW更新経路）。
6. storage/backup（保存失敗の可視化、部分的に壊れたbackupの扱い）。
7. 全国規模でのモバイルUX（47都道府県・10地方のフィルターUI、スマホ実機QA項目）。
8. deployment/NAMI分離（保護ブランチ・デプロイ先が本Gateを通じて一切変更されて
   いないか、refresh-poi-cache.ymlの新しいdeploy起動ロジックに副作用がないか）。
9. テストアーキテクチャ（§8で述べたE2E安定化が、テストをアプリ仕様に迎合させて
   いないか＝アプリ側のコードは一切変更せず、テストの待機・クリック方式だけを
   直しているかの確認）。
10. 公開判定として妥当なレベルまで到達しているか、過剰設計や新しい回帰が
    入っていないか。

## 12. 最終ステータス

RELEASE_READINESS = A（backfill完了・全国reconciliation完全一致・Astra P1 9件修正確認済みの
時点での自己評価。最終判断はFableの再監査結果を踏まえて確定する）

MAIN_MERGED = NO
PRODUCTION_DEPLOYED = NO

本ZIPおよび本ドキュメントはClaude Sonnet 5により生成された。
