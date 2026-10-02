# 道の駅ナビ — Google Maps周辺検索 & iPhone復帰白画面 Root Cause Audit

このドキュメントはZIPのroot直下に置かれています。commitはされていません（監査専用資料）。
**今回は修正を行っていません。原因調査の事実整理のみです。**

Claude自身の**推測**と**確認済み事実**を明確に分離して記載します。
「確認済み事実」＝実際にコードを読んで確認した内容、または実機で観測された報告そのもの。
「Claudeの推測（未確認）」＝上記の事実から導いた仮説で、Fableに独立検証してほしい内容。

---

## 1. 製品概要（短く）

道の駅ナビ（michinoeki-nav）: 日本全国の道の駅を巡る車旅向けPWA。バックエンドサーバーなし、
全データはlocalStorageのみ。周辺スポット検索はOpenStreetMap/Overpass由来（static cache優先）。
Google Mapsとは「発見用途のアプリ内候補表示」＋「詳細探索はGoogle Mapsへ」という役割分担。

## 2. SOURCE HEAD（事実）

```
branch: feat/nationwide-poi-cache
HEAD (full):  215b12250c96e5a2c894170222a820cc6b884c47
HEAD (short): 215b12250c96
```

このHEADは、直前のセッションで実装した「周辺スポットを大分類＋Googleマップ詳細探索へ
簡素化」の変更（コミット `215b122`）を含む。**この変更で新設した「Googleマップでもっと
探す」CTAが、今回報告されたBUG 1の直接の対象箇所である。** BUG 2（iPhone白画面）は
このCTA経由のナビゲーションで発生したと報告されており、関連の可能性がある。

diff: `fable-audit/rootcause-evidence/diff_poi_ux_commit_215b122.txt`
（コミット全体: `fable-audit/rootcause-evidence/full_commit_215b122.txt`）

## 3. QA URL（固定・事実）

```
https://1125naoto.github.io/tohoku-michinoeki-map-qa/
```

専用リポジトリ `1125naoto/tohoku-michinoeki-map-qa`。Production/NAMIとは別リポジトリ。
ビルドフラグ: `DEPLOY_BASE=/tohoku-michinoeki-map-qa/`、`VITE_STORAGE_NS=qa`。

## 4. Owner実機環境（確認済み事実のみ・未確認事項は§13）

- 端末: iPhone（Owner申告）
- 発生画面: 固定QA URL（上記）
- **未確認**: Owner側がこのURLを通常のSafariタブで開いていたか、ホーム画面に追加した
  スタンドアロンPWAとして開いていたかは、今回のOwner報告には明記されていない
  （§13参照。動作診断パネルの「表示形態」欄で本来判別できるが、今回そのスクリーン
  ショットは取得していない）。

---

## 5. BUG 1: Google Mapsでの検索が現在地/自宅付近になる

### 5.1 再現手順（Owner報告どおり）

1. 道の駅を選択（地図上のマーカーをタップ、または「道の駅を選ぶ」から選択）
2. 「🔍 周辺スポット」を開く
3. 大分類（例: すべて/グルメ/観光/温泉・休憩/宿泊）を選ぶ、または未選択のまま
4. 「Googleマップでもっと◯◯を探す」ボタンを押す

### 5.2 期待結果（Owner申告）

選択した道の駅の周辺をGoogle Mapsで検索してほしい。

### 5.3 実際の結果（Owner申告）

Ownerの自宅/現在地付近を中心とした検索になる。Google Mapsの検索欄には
「周辺スポット 37.222832,140...」のような文字列が表示された。

### 5.4 確認済み事実

- `37.222832,140...` は **道の駅たまかわ（mne-19029, lat=37.2228324, lng=140.4181372）
  の実際の座標と一致する**（§「実際の生成URL」参照）。つまりOwnerがGoogle Mapsの検索欄で
  見た文字列自体には、道の駅の正しい座標が含まれていた。
- 現在のCTA実装（`src/lib/gmaps.ts` `categoryDetailSearchUrl`）は、カテゴリの検索語
  （例:「飲食店」）と検索地点の緯度経度を**1つのqueryパラメータに連結した文字列**として
  Google Maps URLs（`/maps/search/?api=1&query=`）へ渡している。
  ```ts
  export function categoryDetailSearchUrl(keyword: string, origin: LatLng): string {
    const q = `${keyword} ${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  }
  ```
  生成される実際のqueryは `飲食店 37.222832,140.418137` のような文字列（実際の生成URL
  一覧は `fable-audit/rootcause-evidence/actual_generated_urls_tamakawa.txt` 参照）。
- 検索地点(`searchOrigin`)自体がコード上どこで設定されるかは`src/App.tsx`で確認した。
  道の駅シートの「🔍 周辺スポット」ボタン(`onSearchNearby`)は選択中の駅の`lat`/`lng`を
  直接渡しており（`searchNearbyFor({ lat: selected.lat, lng: selected.lng, ... })`）、
  コード上は選択した駅の座標が正しく`searchOrigin`に入り、CTAの`onGoogleDetailSearch`は
  その`searchOrigin`をそのまま`categoryDetailSearchUrl`へ渡している
  （`src/App.tsx`内、`onGoogleDetailSearch`のコールバック実装参照）。
- 比較: 同じ「search/?api=1&query=」方式でも、既存の単一施設リンク
  （`stationSearchUrl`、StationSheet.tsxの「Googleマップで開く」）は
  **名称+住所のテキストのみ**をqueryに使っており、座標を含めていない。
  こちらについては今回、実機不具合の報告を受けていない。
- また、完成ルートのGoogle Maps分割ナビ（`directionsSegments`、RouteResults.tsxの
  「Googleマップで◯◯のルートを開く」）は`search/?api=1&query=`ではなく
  `dir/?api=1&origin=...&destination=...`という**構造化されたパラメータ**を使っており、
  こちらも今回、実機不具合の報告を受けていない。

### 5.5 Claudeの推測（未確認・Fableに検証してほしい）

- Google Maps URLs公式ドキュメントの`query`パラメータの用例は、「検索語（テキスト）」
  または「緯度経度のペア」のいずれかであり、**両者を1つの文字列に連結した用例は
  公式ドキュメントには見当たらない**（Claudeが確認した範囲）。
- 上記の事実（座標自体は正しくqueryに入っているのに、Google Maps側の検索結果は
  現在地/自宅付近になる）から、Google Maps側が「keyword + 座標」という非公式な形式の
  queryを、位置バイアスとしてではなく**自由テキストの検索語**として解釈し、既知の
  地名・施設名として解決できないため、フォールバックとして**端末の実際の現在地**を
  中心に検索した可能性がある、とClaudeは推測する。**この推測はFableに独立検証して
  ほしい。** 確定した原因ではない。

---

## 6. BUG 2: Google Mapsから戻るとiPhoneで白画面になる

### 6.1 再現手順（Owner報告どおり）

1. （BUG 1の手順、またはアプリ内の何らかのGoogle Maps連携から）Google Mapsへ移動
2. iPhoneで「戻る」操作を行う

### 6.2 実際の結果（Owner申告）

道の駅ナビの元画面へ正常に復帰できず、画面が真っ白になる。上部には
「検索/Webサイト名入力」（＝空のアドレスバーのプレースホルダー文言）のみが表示される。

### 6.3 確認済み事実: 外部ナビゲーションの実装方式一覧

コードベース全体を検索し、外部URLを開く箇所とその方式を洗い出した（事実）。

| 箇所 | 方式 | ファイル |
|---|---|---|
| 今回新設のPOIカテゴリCTA（「Googleマップでもっと探す」） | `window.open(url, '_blank')`（失敗時のみ`location.assign`） | `src/App.tsx` `openExternal` |
| POI検索失敗時のフォールバック（既存・変更なし） | 同上（`openExternal`を共用） | `src/App.tsx` |
| 旅行中の公式URLを開く（`openOfficial`） | 同上の実装パターン（別関数として独立定義） | `src/App.tsx` |
| 単一駅の「Googleマップで開く」（`link-gmap`） | `<a href target="_blank" rel="noopener noreferrer">` | `src/components/StationSheet.tsx` |
| 単一駅の「公式情報を見る」（`link-official`） | 同上 | `src/components/StationSheet.tsx` |
| 完成ルートのGoogle Maps分割ナビ（`gmaps-segment-link`） | 同上 | `src/components/RouteResults.tsx` |
| POI詳細の「Googleマップで評価・口コミを見る」 | `onClick`経由（呼び出し元は`openExternal`と同一パターンをApp.tsx内で使用） | `src/components/PoiDetailSheet.tsx`（onGoogleSearchはApp.tsxで実装） |
| POI詳細の出典リンク | `<a href target="_blank" rel="noopener noreferrer">` | `src/components/PoiDetailSheet.tsx` |
| ルート結果の出発地点ナビ等 | `<a href target="_blank" rel="noopener noreferrer">` | `src/components/ManualRouteBuilder.tsx` |
| OSM著作権表示リンク | `<a href target="_blank" rel="noopener noreferrer">` | `src/components/MapView.tsx` |

**事実として重要な点**: BUG 1の対象である「Googleマップでもっと探す」CTAは
`window.open()`を使うJS実装であり、これまで実機不具合の報告が無かった他のGoogle Maps
リンク（単一駅・完成ルート）はすべて**素のHTML `<a target="_blank">`**を使っている。
この違いは今回の調査で新たに確認された事実である。

### 6.4 確認済み事実: PWA/Service Worker構成

`vite.config.ts`（VitePWAプラグイン設定）:

```
display: 'standalone'
start_url: DEPLOY_BASE  // 例: /tohoku-michinoeki-map-qa/
scope: DEPLOY_BASE
registerType: 'autoUpdate'
skipWaiting: true
clientsClaim: true
navigateFallback: `${DEPLOY_BASE}index.html`
```

`src/main.tsx`のService Worker登録ロジック（事実、抜粋）:

```js
if ('serviceWorker' in navigator) {
  const hadController = navigator.serviceWorker.controller != null;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then((reg) => {
      const check = () => reg.update().catch(() => {});
      check();
      setInterval(check, 60 * 1000);
      window.addEventListener('focus', check);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    });
  });
}
```

**事実**: アプリがフォアグラウンドへ復帰する（`focus`／`visibilitychange`で`visible`）
たびに、Service Workerの更新確認(`reg.update()`)が走る設計になっている。新しいSWが
見つかった場合は`skipWaiting`+`clientsClaim`により即座に制御が切り替わり、その結果
`controllerchange`が発火して**`location.reload()`が自動的に1回実行される**
（`hadController`が真の場合のみ、つまり「このページが既にSW制御下だった」場合のみ）。

`display: 'standalone'`のため、ホーム画面に追加されたPWAとして起動している場合、
iOSでは外部URL（google.com/maps等）への遷移はPWAコンテナ内では完結せず、
Safari（またはネイティブGoogleマップアプリへのUniversal Linkハンドオフ）を
経由することが一般的に知られている（Claudeの一般的なiOS知識。今回このアプリ固有の
実機ログでの確認はしていない）。

### 6.5 Claudeの推測（未確認・Fableに検証してほしい）

- `window.open(url, '_blank')`がiOSのstandalone PWAコンテキストから呼ばれた場合、
  デスクトップブラウザのような「同一ウィンドウ内の新規タブ」ではなく、Safari側に
  新しいブラウザタブ（またはネイティブGoogleマップアプリへの直接ハンドオフ）を
  生成する可能性がある。Googleマップ側がUniversal Linkでネイティブアプリへ即座に
  遷移した場合、その新規タブ自体は実質的に空のまま取り残される可能性がある。
  ユーザーが「戻る」操作をした際、この空のタブ（またはその前段階の状態）を
  見ている可能性がある、とClaudeは推測する。
- 上記に加えて、アプリへの復帰時（`focus`/`visibilitychange`）に無条件でSW更新確認が
  走り、新しいビルドが存在すれば`location.reload()`が自動発火する設計になっている。
  仮にBUG 1のGoogle Maps遷移が「同一タブの遷移」に近い挙動をしていた場合、
  戻ってきた瞬間にこの自動リロードが働き、その時点のページ/履歴状態によっては
  正しくアプリが再初期化されない可能性がある、とClaudeは推測する。
- **これら2つの推測は検証していない。BUG 2がBUG 1由来のタブ挙動によるものか、
  SW自動更新ロジックによるものか、あるいは両方の複合か、iOSのUniversal Link
  ハンドオフ自体の一般的な既知動作か、Fableに切り分けてほしい。**

---

## 7. BUG 1とBUG 2は同一原因か

Claudeは判定していない。§5・§6で確認した事実（BUG 1はURLのquery形式起因の可能性、
BUG 2はwindow.open方式+SW自動更新起因の可能性）は、**別々の原因である可能性も、
「window.open経由の非標準的なナビゲーション」という共通点で繋がっている可能性も
どちらもありうる**。Fableに質問として明示する（§9-5）。

---

## 8. 既存tests（事実）

- `src/lib/gmaps.test.ts`: `categoryDetailSearchUrl`のURL生成・有料API不使用を
  確認するunit testを追加済み（コミット215b122）。**ただし、生成されたURLをGoogle Maps
  自身がどう解釈するかは検証していない**（unit testの対象外・検証不可能）。
- `e2e/poi.spec.ts`: 新設CTAの**表示・文言**を確認するE2Eテストを追加済み
  （コミット215b122）。**ボタンを実際にクリックして開くポップアップ/タブの挙動・
  URLは検証していない**（既存のGoogle Maps系リンクすべてについて、`window.open`や
  ポップアップイベントを検証するE2Eテストはコードベース全体に1件も無いことを
  確認した＝テストの構造的な空白）。
- iOS実機・standalone PWAモードでの`window.open`挙動、Service Workerの
  `focus`/`visibilitychange`トリガーによる自動リロード挙動を検証するテストは
  存在しない。

---

## 9. 未確認事項（Claudeが今回確認できなかったこと）

1. Owner実機がSafari通常タブかホーム画面PWA(standalone)かの確認
   （動作診断パネルの「表示形態」欄で判別可能だが、今回未取得）。
2. Owner実機でGoogle Mapsアプリがインストールされているか
   （インストール済みだとUniversal Linkでネイティブアプリへ直接遷移する可能性が
   高くなり、挙動が変わりうる）。
3. BUG 1発生時、実際にポップアップブロック（`window.open`が`null`を返し
   `location.assign`にフォールバックした）が起きていたかどうか。
4. BUG 2発生時、Service Workerの新バージョンが実際に存在し
   `controllerchange`→`location.reload()`が発火したかどうか（Safariの
   デベロッパツール等でのログが無いと確認不能）。
5. BUG 1・BUG 2がQA環境固有か、Production/NAMIでも同様の構造（同じ
   `openExternal`/`categoryDetailSearchUrl`実装）で発生しうるか
   （Production/NAMIは今回未deployのため、実機未検証）。
6. iOS Safariのバージョン、Owner端末のiOSバージョン。

---

## 10. Fableへの質問（そのまま独立判定してほしい）

1. なぜ指定した道の駅ではなく現在地/自宅付近のGoogle Maps検索になるのか？
2. 現在のGoogle Maps URL（`query=キーワード 緯度,経度`という連結形式）は、
   Maps URL仕様上どう解釈されるのか？
3. 選択した道の駅を検索中心としてカテゴリ検索するには、どのURL構造が適切か？
4. なぜGoogle Mapsから戻るとiPhoneで白画面になるのか？
5. BUG 1とBUG 2は同一原因か、独立した2つの問題か？
6. iOS Safari / in-app browser / PWA(standalone)のどの挙動が関係している
   可能性が高いか？
7. 最小修正案は何か？
8. その修正で壊れる可能性のある既存機能は何か
   （単一駅リンク・完成ルートのGoogle Maps分割ナビ・POI検索失敗時のフォールバック等、
   同じ`openExternal`や似た実装を使う既存の動いている機能への影響を含めて）？
9. Google Places APIを使わず、Maps URLだけで安全に実現できるか？
10. 修正後に必須となる回帰テストは何か？
