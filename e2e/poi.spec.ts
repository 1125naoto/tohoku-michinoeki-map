import { expect, test, type Page } from '@playwright/test';
import stationsRaw from '../src/data/stations.json' with { type: 'json' };
import { useNationwideSelection } from './helpers';

/**
 * 公開前UX整理で初回起動に地域選択画面（「どこを旅しますか？」）を追加したため、
 * 全国地図を前提にした既存シナリオでは「全国を見る」選択済みの状態から開始する。
 */
test.beforeEach(async ({ page }) => {
  await useNationwideSelection(page);
});

/**
 * 周辺スポット（POI）機能のE2Eシナリオ（ナミさん完成Ver v1.0）。
 * Overpass公開APIはモックし（regular testで実APIを叩かない）、決定的に検証する。
 * 実Overpass APIへの実データ疎通確認は別途スクリプトで実施済み（README/リリースノート参照）。
 */

const STATION_ID = 'mne-18900'; // しちのへ

/** 都道府県フィルターの期待値をテスト側でもハードコードせず、実データから動的に算出する */
const OPEN_STATIONS = (stationsRaw as { stations: { id: string; name: string; pref: string; status: string }[] }).stations.filter(
  (s) => s.status === 'open',
);
const PREFS_IN_DATA = [...new Set(OPEN_STATIONS.map((s) => s.pref))];

/**
 * 3件（食べる1・温泉1・観光1）を返す。MIN_AUTO_RESULTS(3)以上にしてあるのは、
 * 既定の検索範囲(3km)で自動範囲拡張（searchNearbyPoisAuto）が発動しないようにするため
 * （範囲拡張そのものはoverpass.test.tsで別途検証済み。ここでは無関係な再検索の増殖を避ける）。
 */
function mockOverpassResponse(page: Page) {
  return page.route('**/api/interpreter', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        elements: [
          {
            type: 'node',
            id: 1,
            lat: 40.718,
            lon: 141.156,
            tags: { amenity: 'restaurant', cuisine: 'ramen', name: 'テストラーメン店' },
          },
          {
            type: 'node',
            id: 2,
            lat: 40.719,
            lon: 141.157,
            tags: { natural: 'hot_spring', name: 'テスト温泉' },
          },
          {
            type: 'node',
            id: 3,
            // 既存2件の近くに置く（離しすぎるとfitBoundsのズームが変わり、
            // 狭いiPhone幅ではマーカーが検索パネルの下に隠れてクリックできなくなるため）。
            // ただしnode1とnode2のちょうど中点（旧: 40.7185, 141.1565）だと、全件並列実行時の
            // 負荷でfitBoundsの着地が微妙にずれた際にnode1のマーカーと視覚的に重なり、
            // クリックがnode3側に奪われて不安定になることを実際に確認したため、
            // node1からの距離を離して重ならないようにする。
            lat: 40.7195,
            lon: 141.1575,
            tags: { tourism: 'viewpoint', name: 'テスト展望台' },
          },
        ],
      }),
    }),
  );
}

async function closeBanners(page: Page) {
  const banner = page.getByTestId('a2hs-banner');
  if (await banner.isVisible().catch(() => false)) await page.getByTestId('a2hs-close').click();
  const legend = page.getByTestId('legend-panel');
  if (await legend.isVisible().catch(() => false)) await page.getByTestId('legend-toggle').click();
}

test.describe('周辺スポット検索', () => {
  test.use({ serviceWorkers: 'block' });

  test('駅の周辺検索→詳細表示→ルートに追加が一連で動く', async ({ page }) => {
    await mockOverpassResponse(page);
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    const legend = page.getByTestId('legend-panel');
    if (await legend.isVisible().catch(() => false)) {
      await page.getByTestId('legend-toggle').click();
      await expect(legend).toBeHidden();
    }
    await page.getByTestId('btn-search-nearby').click();

    await expect(page.getByTestId('poi-search-panel')).toBeVisible();
    // 既定カテゴリーは「すべて」のため、最初から食べる・温泉・観光の3件が見える
    await expect(page.getByTestId('poi-result-count')).toContainText('3件見つけました', { timeout: 10000 });

    // カテゴリ絞り込み（食べるに絞ると1件、すべてに戻すと3件）
    await page.getByTestId('poi-category-food').click();
    await expect(page.getByTestId('poi-result-count')).toContainText('1件見つけました');
    await page.getByTestId('poi-category-all').click();
    await expect(page.getByTestId('poi-result-count')).toContainText('3件見つけました');

    // 地図上のマーカーをタップ→詳細シート
    const marker = page.locator('[data-poi-id="osm:node/1"]');
    await marker.click();
    await expect(page.getByTestId('poi-detail-sheet')).toBeVisible();
    await expect(page.getByTestId('poi-detail-sheet')).toContainText('テストラーメン店');
    await expect(page.getByTestId('poi-detail-sheet')).toContainText('食べる');

    // 滞在時間を変更（既定45分→90分）→ 後の混合ルートの内訳に反映される
    await page.getByTestId('poi-detail-sheet').getByRole('button', { name: '90分' }).click();

    // ルートに追加（未選択モードから暗黙的に選択モードへ入る）
    await page.getByTestId('poi-detail-toggle-route').click();
    await expect(page.getByTestId('route-select-bar')).toBeVisible();
    await expect(page.getByTestId('route-select-count')).toContainText('1駅選択中');

    // 番号バッジが地図上に表示される
    await expect(page.locator('.poi-marker .rs-route-num').first()).toHaveText('1');

    // 訪問記録は変化していない
    await expect(page.getByTestId('stats-visited')).toContainText('0／1237駅');

    // 道の駅も追加して混合ルートを作成する
    await page.getByTestId('poi-detail-close').click();
    await page.getByTestId('poi-panel-close').click();
    await expect(page.getByTestId('poi-search-panel')).toHaveCount(0);
    await page.route('**router.project-osrm.org/**', (route) => route.abort());
    // __setMapView is defined を待つ (Phase 10 hardening)
    await page.waitForFunction(() => typeof (window as unknown as { __setMapView?: unknown }).__setMapView === 'function', { timeout: 20000 });
    await page.evaluate(
      ([lat, lng]) => (window as unknown as { __setMapView: (a: number, b: number, c: number) => void }).__setMapView(lat as number, lng as number, 14),
      [40.7168253, 141.1552503],
    );
    await page.waitForTimeout(300);
    await page.locator(`[data-sid="${STATION_ID}"]`).click();
    await expect(page.getByTestId('route-select-count')).toContainText('2駅選択中');

    await page.getByTestId('route-select-create').click();
    await page.getByRole('button', { name: '道の駅から', exact: true }).click();
    await page.getByLabel('出発する道の駅').selectOption(STATION_ID);
    await page.getByTestId('manual-submit').click();

    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (await page.getByTestId('route-detail').isVisible().catch(() => false)) break;
      let clicked = false;
      for (const tid of ['order-review-keep', 'hours-review-continue', 'route-card-manual']) {
        const btn = page.getByTestId(tid);
        if (await btn.isVisible().catch(() => false)) {
          await btn.click();
          clicked = true;
          break;
        }
      }
      if (!clicked) await page.waitForTimeout(300);
    }
    await expect(page.getByTestId('route-detail')).toBeVisible({ timeout: 5000 });
    // 道の駅+周辺スポットの両方が行程に含まれる
    const names = await page.locator('[data-testid="route-timeline"] li:has(.badge) b').allTextContents();
    expect(names.join(' ')).toContain('しちのへ');
    expect(names.join(' ')).toContain('テストラーメン店');
    // POIは達成率に反映されない（道の駅1件のみ新しく制覇の対象）
    await expect(page.getByTestId('route-detail')).toContainText('新しく1駅');

    // 予想時間の内訳: 変更した滞在時間（90分）が食べる欄に反映されている
    await expect(page.getByTestId('time-breakdown')).toBeVisible();
    await expect(page.getByTestId('time-breakdown')).toContainText('食事');
    await expect(page.getByTestId('breakdown-total')).toBeVisible();
    await expect(page.getByTestId('breakdown-margin')).toBeVisible();
  });

  test('検索方法は「道の駅を選ぶ」「現在地」のみで、「地図で指定」は表示されない', async ({ page }) => {
    await page.goto('/');
    await closeBanners(page);
    await page.getByTestId('poi-search-open').click();
    await expect(page.getByTestId('poi-search-panel')).toBeVisible();
    await expect(page.getByTestId('poi-origin-mode-station')).toBeVisible();
    await expect(page.getByTestId('poi-origin-mode-current')).toBeVisible();
    await expect(page.getByTestId('poi-origin-mode-map')).toHaveCount(0);
    await expect(page.getByTestId('poi-origin-map')).toHaveCount(0);
  });

  test('道の駅を選ぶ: 都道府県で絞り込むと、その県の道の駅だけが選べる（県を切り替えても前の県の駅が残らない）', async ({ page }) => {
    // 収録済みの全都道府県（件数はデータから動的に算出。地方追加のたびに増える）を
    // 1件ずつ実操作で検証するため、既定の60秒では環境負荷時に不足しうる
    // （screens.spec.tsの複数画面撮影と同じ理由）
    test.setTimeout(120_000);
    await page.goto('/');
    await closeBanners(page);
    await page.getByTestId('poi-search-open').click();
    await expect(page.getByTestId('poi-search-panel')).toBeVisible();
    await expect(page.getByTestId('poi-origin-mode-station')).toHaveClass(/active/);

    const prefSelect = page.getByTestId('poi-origin-pref-select');
    const stationSelect = page.getByTestId('poi-origin-station-select');
    await expect(prefSelect).toBeVisible();

    // 都道府県一覧が実データと一致する（ハードコードした県名リストと比較するのではなく、
    // 実際のデータから動的に算出した一覧と比較する）
    const prefOptions = await prefSelect.locator('option').allTextContents();
    expect([...prefOptions].sort()).toEqual([...PREFS_IN_DATA].sort());

    for (const pref of PREFS_IN_DATA) {
      await prefSelect.selectOption(pref);
      const expectedIds = OPEN_STATIONS.filter((s) => s.pref === pref).map((s) => s.id);
      const otherIds = OPEN_STATIONS.filter((s) => s.pref !== pref).map((s) => s.id);

      const optionValues = await stationSelect.locator('option').evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value));
      // プレースホルダー("")を除き、選択中の県の駅だけが候補になっている
      const stationValues = optionValues.filter((v) => v !== '');
      expect(new Set(stationValues)).toEqual(new Set(expectedIds));
      // 前の県（他県）の駅が一切残っていないこと。
      // 以前は他県の全駅を1件ずつexpect()していたが、これは「収録駅数×都道府県数」に
      // 比例してPlaywrightのexpect呼び出しが数万回（989駅・35県で約3.3万回）に膨らみ、
      // iPhoneではテスト自体が120秒を超える原因になっていた（実測で特定）。
      // 判定内容は変えずに、素のJSで1回の比較へ集約する。
      const otherIdSet = new Set(otherIds);
      const leaked = stationValues.filter((v) => otherIdSet.has(v));
      expect(leaked, `${pref}を選択中に他県の駅が残っている`).toEqual([]);
    }
  });

  test('道の駅を選ぶ: 都道府県→道の駅の順に選ぶと検索地点が確定し、通常どおり検索できる', async ({ page }) => {
    await mockOverpassResponse(page);
    await page.goto('/');
    await closeBanners(page);
    await page.getByTestId('poi-search-open').click();
    await expect(page.getByTestId('poi-search-panel')).toBeVisible();

    const station = OPEN_STATIONS.find((s) => s.id === STATION_ID)!;
    await page.getByTestId('poi-origin-pref-select').selectOption(station.pref);
    await page.getByTestId('poi-origin-station-select').selectOption(STATION_ID);
    await expect(page.getByTestId('poi-search-origin')).toContainText(`道の駅${station.name}`);

    await page.getByTestId('poi-do-search').click();
    await expect(page.getByTestId('poi-result-count')).toContainText('3件見つけました', { timeout: 10000 });
  });

  test('Overpass障害時はGoogle Web検索へフォールバックできる（駅originはWeb検索、Google Mapsはsecondary）', async ({ page }) => {
    const station = OPEN_STATIONS.find((s) => s.id === STATION_ID)!;
    await page.route('**/api/interpreter', (route) => route.abort());
    // このテストは「事前生成キャッシュも無い・Overpassも全滅」という最悪ケースを検証したいため、
    // 静的キャッシュ側も明示的に404にする（本駅は実際には事前生成済みのため、放置すると
    // 静的キャッシュに救われて意図と異なるテストになってしまう）
    await page.route(`**/data/poi/${STATION_ID}.json`, (route) => route.fulfill({ status: 404 }));
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await page.getByTestId('btn-search-nearby').click();
    await expect(page.getByTestId('poi-failed')).toBeVisible({ timeout: 15000 });
    // 駅originの場合、fallbackはGoogle Web検索へ統一（Fable最終設計）
    await expect(page.getByTestId('poi-google-fallback')).toBeVisible();
    await expect(page.getByTestId('poi-google-fallback')).toContainText('Googleで');
    await expect(page.getByTestId('poi-google-fallback')).toContainText('探す');
    // Fable Root Cause Audit BUG2修正の回帰: フォールバックCTAもネイティブアンカーで開く
    await expect(page.getByTestId('poi-google-fallback')).toHaveAttribute('target', '_blank');
    await expect(page.getByTestId('poi-google-fallback')).toHaveAttribute('rel', /noopener/);
    const fallbackHref = await page.getByTestId('poi-google-fallback').getAttribute('href');
    expect(fallbackHref ?? '').toContain('https://www.google.com/search?q=');
    const decFallback = decodeURIComponent(fallbackHref ?? '');
    expect(decFallback).toContain(`道の駅${station.name}`);
    expect(decFallback).not.toMatch(/\d{1,3}\.\d{6},\d{1,3}\.\d{6}/);
    // Google Maps secondary CTA（道の駅の詳細・ナビ専用）も引き続き表示される
    await expect(page.getByTestId('poi-failed-google-maps')).toBeVisible();
    await expect(page.getByTestId('poi-failed-google-maps')).toHaveAttribute('target', '_blank');
    const mapsFallbackHref = await page.getByTestId('poi-failed-google-maps').getAttribute('href');
    expect(decodeURIComponent(mapsFallbackHref ?? '')).toContain(`道の駅${station.name}`);
    // 「周辺を検索」案内文は画面上に残っていない
    await expect(page.getByText('「周辺を検索」')).toHaveCount(0);
  });

  test('公開前UX整理: 駅詳細のPRIMARYは「周辺を探す」1つで、Google Web検索はアプリ内候補のあとの補助導線になる', async ({
    page,
  }) => {
    const station = OPEN_STATIONS.find((s) => s.id === STATION_ID)!;
    await mockOverpassResponse(page);
    // 事前生成の静的POIキャッシュではなくモックしたOverpass応答で決定的に検証する
    // （0件カテゴリ・件数を固定するため。静的キャッシュ自体の検証は別テスト）
    await page.route(`**/data/poi/${STATION_ID}.json`, (route) => route.fulfill({ status: 404 }));
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await closeBanners(page);

    // CASE 8: 駅を選んだ段階で見えるのは「周辺を探す」というPRIMARY導線ひとつだけ。
    // この時点でPOIカテゴリUIもGoogle Web検索も出さない（どちらを使うか考えさせない）
    const primary = page.getByTestId('btn-search-nearby');
    await expect(primary).toContainText('周辺の観光・グルメ・温泉・宿を探す');
    await expect(primary).toHaveClass(/btn-primary/);
    await expect(page.getByTestId('poi-category-tabs')).toHaveCount(0);
    await expect(page.getByTestId('poi-web-search')).toHaveCount(0);
    await expect(page.getByTestId('poi-google-detail-search')).toHaveCount(0);

    await primary.click();
    await expect(page.getByTestId('poi-search-panel')).toBeVisible();

    // CASE 9: 押した後に初めて既存のPOIカテゴリUI（食べる/観光/温泉・休憩/宿泊/すべて）が出る
    await expect(page.getByTestId('poi-category-tabs')).toBeVisible();
    for (const c of ['food', 'tourism', 'onsen', 'lodging']) {
      await expect(page.getByTestId(`poi-category-${c}`)).toBeVisible();
    }
    await expect(page.getByTestId('poi-category-all')).toBeVisible();

    // CASE 12: Google Mapsは検索ではなく「道の駅そのもの」の導線として維持され、
    // Google Web検索と混同しない位置（この道の駅について）に置かれる
    const maps = page.getByTestId('poi-google-detail-search');
    await expect(maps).toBeVisible();
    await expect(maps).toContainText('道の駅の詳細・ナビを見る');
    await expect(page.getByTestId('poi-station-links')).toContainText('この道の駅について');
    const mapsHrefBefore = await maps.getAttribute('href');
    expect(decodeURIComponent(mapsHrefBefore ?? '')).toContain(`道の駅${station.name}`);
    expect(mapsHrefBefore ?? '').not.toMatch(/%20\d{1,3}\.\d{6}%2C\d{1,3}\.\d{6}/);
    expect(decodeURIComponent(mapsHrefBefore ?? '')).not.toContain('飲食店');
    await expect(page.getByText('「周辺を検索」')).toHaveCount(0);

    // 駅詳細のPRIMARYから開いた場合は検索地点が確定しているため、そのまま
    // アプリ内POIの候補一覧が出る（ここが主役）
    await expect(page.getByTestId('poi-result-count')).toContainText('3件見つけました', { timeout: 15000 });
    await expect(page.getByTestId('poi-result-list')).toBeVisible();

    // CASE 10: アプリ内候補を表示した「あと」に、補助導線としてGoogle Web検索が出る
    const web = page.getByTestId('poi-web-search');
    await expect(web).toBeVisible();
    await expect(web).toContainText('Googleで');
    await expect(web).toContainText('もっと詳しく探す');
    await expect(page.getByTestId('poi-more-google')).toContainText('アプリ内の候補で足りないとき');
    // DOM順でも結果一覧より後ろ（アプリ内候補が先、Googleは補助）
    const webComesAfterList = await page.evaluate(() => {
      const list = document.querySelector('[data-testid="poi-result-list"]');
      const link = document.querySelector('[data-testid="poi-web-search"]');
      if (!list || !link) return false;
      return (list.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    });
    expect(webComesAfterList).toBe(true);

    // CASE 13: Fable Root Cause Audit BUG2修正の回帰。両CTAともネイティブアンカーで開く
    for (const testid of ['poi-web-search', 'poi-google-detail-search']) {
      await expect(page.getByTestId(testid)).toHaveAttribute('target', '_blank');
      await expect(page.getByTestId(testid)).toHaveAttribute('rel', /noopener/);
      await expect(page.getByTestId(testid)).toHaveAttribute('rel', /noreferrer/);
    }

    // CASE 11: Google Web検索のURLはb22797cの既存仕様と完全一致（クエリ生成は未変更）
    expect(decodeURIComponent((await web.getAttribute('href')) ?? '')).toBe(
      `https://www.google.com/search?q=道の駅${station.name} 周辺 観光 グルメ 温泉 宿泊`,
    );

    await page.getByTestId('poi-category-food').click();
    // 食べるの細分類チップ(ラーメン/食堂/洋食/寿司/焼肉等)は一般ユーザーUIから撤去済み
    await expect(page.getByTestId('poi-subcategory-chips')).toHaveCount(0);
    await expect(page.getByTestId('poi-web-search')).toContainText('周辺の飲食店をもっと詳しく探す');
    expect(decodeURIComponent((await page.getByTestId('poi-web-search').getAttribute('href')) ?? '')).toBe(
      `https://www.google.com/search?q=道の駅${station.name} 周辺 飲食店`,
    );
    // Google Maps CTAはカテゴリを切り替えても不変（駅を開くだけの設計のため）
    expect(await page.getByTestId('poi-google-detail-search').getAttribute('href')).toBe(mapsHrefBefore);

    await page.getByTestId('poi-category-tourism').click();
    // 観光は細分類チップを引き続き残す（撤去対象は食べるのみ）
    await expect(page.getByTestId('poi-subcategory-chips')).toBeVisible();
    await expect(page.getByTestId('poi-web-search')).toContainText('周辺の観光スポットをもっと詳しく探す');
    expect(decodeURIComponent((await page.getByTestId('poi-web-search').getAttribute('href')) ?? '')).toBe(
      `https://www.google.com/search?q=道の駅${station.name} 周辺 観光スポット`,
    );

    await page.getByTestId('poi-category-onsen').click();
    await expect(page.getByTestId('poi-web-search')).toContainText('周辺の温泉をもっと詳しく探す');
    expect(decodeURIComponent((await page.getByTestId('poi-web-search').getAttribute('href')) ?? '')).toBe(
      `https://www.google.com/search?q=道の駅${station.name} 周辺 温泉`,
    );

    // 宿泊はこのモックデータでは該当POIが無く0件表示になるため、0件時のGoogle Web検索
    // fallback側でクエリ仕様を確認する（URL生成はカテゴリ問わず同一のwebsearch.ts）
    await page.getByTestId('poi-category-lodging').click();
    await expect(page.getByTestId('poi-empty')).toBeVisible();
    const lodgingFallback = page.getByTestId('poi-empty-google-fallback');
    await expect(lodgingFallback).toBeVisible();
    expect(decodeURIComponent((await lodgingFallback.getAttribute('href')) ?? '')).toBe(
      `https://www.google.com/search?q=道の駅${station.name} 周辺 ホテル 旅館`,
    );

    // Google Maps CTAは最後まで不変
    expect(await page.getByTestId('poi-google-detail-search').getAttribute('href')).toBe(mapsHrefBefore);
  });

  test('検索半径を切り替えると再検索される', async ({ page }) => {
    let lastRadius = '';
    await page.route('**/api/interpreter', async (route) => {
      const body = decodeURIComponent(route.request().postData() ?? '');
      const m = body.match(/around:(\d+)/);
      lastRadius = m ? m[1] : '';
      const oneKm = lastRadius === '1000';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          // どちらもMIN_AUTO_RESULTS(3)以上にして自動範囲拡張を発動させない
          // （半径による再検索そのものを検証するテストのため。カテゴリーは既定「食べる」に含まれる要素で揃える）
          elements: oneKm
            ? [
                { type: 'node', id: 1, lat: 40.718, lon: 141.156, tags: { amenity: 'restaurant', name: 'テスト店1' } },
                { type: 'node', id: 2, lat: 40.7181, lon: 141.1561, tags: { amenity: 'cafe', name: 'テスト店2' } },
                { type: 'node', id: 3, lat: 40.7182, lon: 141.1562, tags: { amenity: 'fast_food', name: 'テスト店3' } },
              ]
            : [
                { type: 'node', id: 1, lat: 40.718, lon: 141.156, tags: { amenity: 'restaurant', name: 'テスト店1' } },
                { type: 'node', id: 2, lat: 40.719, lon: 141.157, tags: { amenity: 'cafe', name: 'テスト店2' } },
                { type: 'node', id: 3, lat: 40.72, lon: 141.158, tags: { amenity: 'fast_food', name: 'テスト店3' } },
                { type: 'node', id: 4, lat: 40.721, lon: 141.159, tags: { amenity: 'bar', name: 'テスト店4' } },
              ],
        }),
      });
    });
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await closeBanners(page);
    await page.getByTestId('btn-search-nearby').click();
    await expect(page.getByTestId('poi-result-count')).toContainText('4件見つけました', { timeout: 10000 });

    await page.getByTestId('poi-radius-1000').click();
    await expect(page.getByTestId('poi-result-count')).toContainText('3件見つけました', { timeout: 10000 });
    expect(lastRadius).toBe('1000');
  });

  test('選択モード中は詳細シートを経由せずマーカー直接タップで周辺スポットを選択できる', async ({ page }) => {
    await mockOverpassResponse(page);
    await page.goto('/');
    await closeBanners(page);
    await page.getByTestId('tab-route').click();
    await page.getByTestId('course-mode-manual').click();
    await expect(page.getByTestId('route-select-bar')).toBeVisible();

    await page.getByTestId('poi-search-open').click();
    await expect(page.getByTestId('poi-search-panel')).toBeVisible();
    // 「地図で指定」は廃止済みのため、道の駅選択で検索地点を確定する（都道府県を明示的に選ぶ）
    await page.getByTestId('poi-origin-pref-select').selectOption('青森県');
    await page.getByTestId('poi-origin-station-select').selectOption(STATION_ID);
    await expect(page.getByTestId('poi-search-origin')).toContainText('しちのへ');
    await page.getByTestId('poi-do-search').click();
    // 既定カテゴリー「すべて」のため、食べる・温泉・観光の3件が見える
    await expect(page.getByTestId('poi-result-count')).toContainText('3件見つけました', { timeout: 10000 });

    // 詳細シートを開かずに直接マーカーをタップ→即座に選択に追加される
    const marker = page.locator('[data-poi-id="osm:node/1"]');
    await marker.click();
    await expect(page.getByTestId('poi-detail-sheet')).toHaveCount(0);
    await expect(page.getByTestId('route-select-count')).toContainText('1駅選択中');
    await expect(marker.locator('.rs-route-num')).toHaveText('1');

    // もう一度タップすると選択解除される
    await marker.click();
    await expect(page.getByTestId('route-select-count')).toContainText('0駅選択中');
  });

  test('旅行中の周辺スポットは「到着／次へ」で進み、道の駅の達成率・スタンプ数に影響しない', async ({ page }) => {
    await mockOverpassResponse(page);
    await page.route('**router.project-osrm.org/**', (route) => route.abort());
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await closeBanners(page);
    await page.getByTestId('btn-search-nearby').click();
    await expect(page.getByTestId('poi-result-count')).toContainText('3件見つけました', { timeout: 10000 });
    await page.locator('[data-poi-id="osm:node/1"]').click();
    await expect(page.getByTestId('poi-detail-sheet')).toBeVisible();
    await page.getByTestId('poi-detail-toggle-route').click();
    await expect(page.getByTestId('route-select-count')).toContainText('1駅選択中');
    await page.getByTestId('poi-detail-close').click();
    await page.getByTestId('poi-panel-close').click();
    await expect(page.getByTestId('poi-search-panel')).toHaveCount(0);

    // __setMapView is defined を待つ (Phase 10 hardening)
    await page.waitForFunction(() => typeof (window as unknown as { __setMapView?: unknown }).__setMapView === 'function', { timeout: 20000 });
    await page.evaluate(
      ([lat, lng]) => (window as unknown as { __setMapView: (a: number, b: number, c: number) => void }).__setMapView(lat as number, lng as number, 14),
      [40.7168253, 141.1552503],
    );
    await page.waitForTimeout(300);
    await page.locator(`[data-sid="${STATION_ID}"]`).click();
    await expect(page.getByTestId('route-select-count')).toContainText('2駅選択中');

    await page.getByTestId('route-select-create').click();
    await page.getByRole('button', { name: '道の駅から', exact: true }).click();
    await page.getByLabel('出発する道の駅').selectOption(STATION_ID);
    await page.getByTestId('manual-submit').click();

    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (await page.getByTestId('route-detail').isVisible().catch(() => false)) break;
      let clicked = false;
      for (const tid of ['order-review-keep', 'hours-review-continue', 'route-card-manual']) {
        const btn = page.getByTestId(tid);
        if (await btn.isVisible().catch(() => false)) {
          await btn.click();
          clicked = true;
          break;
        }
      }
      if (!clicked) await page.waitForTimeout(300);
    }
    await expect(page.getByTestId('route-detail')).toBeVisible({ timeout: 5000 });
    await page.getByTestId('trip-start').click();
    await expect(page.getByTestId('trip-view')).toBeVisible();

    // 最初の停車地点（順序次第で駅かPOIか変わりうるため、両パターンに対応して進める）
    for (let i = 0; i < 2; i++) {
      if (await page.getByTestId('trip-poi-arrived').isVisible().catch(() => false)) {
        await page.getByTestId('trip-poi-arrived').click();
        await expect(page.getByTestId('trip-poi-arrived')).toContainText('到着済み');
        await page.getByTestId('trip-poi-next').click();
        // 周辺スポットの到着は道の駅の達成率に影響しない
        await expect(page.getByTestId('stats-visited')).toContainText('0／1237駅');
      } else if (await page.getByTestId('trip-arrived').isVisible().catch(() => false)) {
        await page.getByTestId('trip-arrived').click();
        await expect(page.getByTestId('stats-visited')).toContainText('1／1237駅');
      }
    }
  });

  test('道路の希望「一般道を優先」を選ぶと警告文が表示される', async ({ page }) => {
    await page.goto('/');
    await closeBanners(page);
    await page.getByTestId('tab-route').click();
    await page.getByTestId('course-mode-auto').click();
    await expect(page.getByTestId('roadpref-fast')).toBeVisible();
    await expect(page.getByTestId('roadpref-note')).toHaveCount(0);

    await page.getByTestId('roadpref-no-tolls').click();
    await expect(page.getByTestId('roadpref-note')).toBeVisible();
    await expect(page.getByTestId('roadpref-general-warn')).toHaveCount(0);

    await page.getByTestId('roadpref-no-highway').click();
    await expect(page.getByTestId('roadpref-general-warn')).toContainText(
      '予想時間は通常の道路条件による目安です。Googleマップで一般道優先にすると、実際の時間が長くなる場合があります',
    );
  });

  test('選択下書き（周辺スポット含む）を保存した状態で再読み込みしても再開できる', async ({ page }) => {
    await mockOverpassResponse(page);
    await page.route('**router.project-osrm.org/**', (route) => route.abort());
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await closeBanners(page);
    await page.getByTestId('btn-search-nearby').click();
    await expect(page.getByTestId('poi-result-count')).toContainText('3件見つけました', { timeout: 10000 });
    // node1/node3はfixture上ごく近接しており(mockOverpassResponse内のコメント参照)、全件並列実行時の
    // 負荷でfitBoundsの着地がずれるとnode3がnode1の地図マーカーを一時的に覆うことがある
    // （地図マーカー自体のクリックは別テストで検証済み）。ここでの目的は
    // 「ルートに追加した状態がreload後も再開できるか」であり対象がnode1であることが重要なため、
    // 地図マーカーではなく一覧から名前で特定してタップし、対象の曖昧さを無くす。
    await page
      .getByTestId('poi-result-row')
      .filter({ hasText: 'テストラーメン店' })
      .getByTestId('poi-result-open')
      .click();
    await expect(page.getByTestId('poi-detail-sheet')).toBeVisible();
    await expect(page.getByTestId('poi-detail-sheet')).toContainText('テストラーメン店');
    await page.getByTestId('poi-detail-toggle-route').click();
    await expect(page.getByTestId('route-select-count')).toContainText('1駅選択中');

    await page.reload();
    await expect(page.getByRole('dialog', { name: '前回の続きがあります' })).toBeVisible({ timeout: 10000 });
    await page.getByTestId('confirm-ok').click();
    // 出発地点未設定だったため、選択内容（周辺スポット含む）を保ったまま出発地点の入力画面へ直接戻る
    await expect(page.getByTestId('manual-selection-summary')).toContainText('選んだ1件');
    await expect(page.getByTestId('manual-selection-summary')).toContainText('テストラーメン店');
  });

  test('1つ目のOverpass接続先が429でも、2つ目の接続先へ切り替えて成功する', async ({ page }) => {
    // 現在地検索はfood/otherを並行した別クエリで取得するため(overpass.ts参照)、
    // 「1本目失敗→2本目成功」の判定は呼び出し順ではなく接続先(URL)ごとに行う
    // （呼び出し順で判定するとfood/otherどちらの1本目かが原理的に確定できず壊れやすい）。
    const okBody = JSON.stringify({
      elements: [
        { type: 'node', id: 1, lat: 40.718, lon: 141.156, tags: { amenity: 'restaurant', name: 'テスト店1' } },
        { type: 'node', id: 2, lat: 40.719, lon: 141.157, tags: { amenity: 'cafe', name: 'テスト店2' } },
        { type: 'node', id: 3, lat: 40.72, lon: 141.158, tags: { amenity: 'fast_food', name: 'テスト店3' } },
      ],
    });
    await page.route('**/api/interpreter', async (route) => {
      if (route.request().url().includes('private.coffee')) {
        await route.fulfill({ status: 429, contentType: 'text/plain', body: 'rate limited' });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: okBody });
    });
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await closeBanners(page);
    await page.getByTestId('btn-search-nearby').click();
    await expect(page.getByTestId('poi-result-count')).toContainText('3件見つけました', { timeout: 10000 });
  });

  test('1つ目のOverpass接続先が504でも、2つ目の接続先へ切り替えて成功する', async ({ page }) => {
    const okBody = JSON.stringify({
      elements: [
        { type: 'node', id: 1, lat: 40.718, lon: 141.156, tags: { amenity: 'restaurant', name: 'テスト店1' } },
        { type: 'node', id: 2, lat: 40.719, lon: 141.157, tags: { amenity: 'cafe', name: 'テスト店2' } },
        { type: 'node', id: 3, lat: 40.72, lon: 141.158, tags: { amenity: 'fast_food', name: 'テスト店3' } },
      ],
    });
    await page.route('**/api/interpreter', async (route) => {
      if (route.request().url().includes('private.coffee')) {
        await route.fulfill({ status: 504, contentType: 'text/plain', body: 'gateway timeout' });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: okBody });
    });
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await closeBanners(page);
    await page.getByTestId('btn-search-nearby').click();
    await expect(page.getByTestId('poi-result-count')).toContainText('3件見つけました', { timeout: 10000 });
  });

  test('すべての接続先が失敗した場合はGoogle Web検索へフォールバックできる（もう一度試す・検索範囲を変更も表示）', async ({ page }) => {
    await page.route('**/api/interpreter', (route) => route.abort());
    // 事前生成キャッシュも無い状況を明示的に模す（本駅は実際には事前生成済みのため）
    await page.route(`**/data/poi/${STATION_ID}.json`, (route) => route.fulfill({ status: 404 }));
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await closeBanners(page);
    await page.getByTestId('btn-search-nearby').click();
    await expect(page.getByTestId('poi-failed')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('poi-failed')).toContainText('周辺情報を取得できませんでした');
    await expect(page.getByTestId('poi-retry')).toBeVisible();
    await expect(page.getByTestId('poi-expand-radius')).toBeVisible();
    await expect(page.getByTestId('poi-google-fallback')).toBeVisible();
    const href = await page.getByTestId('poi-google-fallback').getAttribute('href');
    expect(href ?? '').toContain('https://www.google.com/search?q=');
  });

  test('0件の場合は通信失敗と別の表示になり、範囲を広げる・Google Web検索の案内が出る', async ({ page }) => {
    await page.route('**/api/interpreter', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elements: [] }) }),
    );
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await closeBanners(page);
    await page.getByTestId('btn-search-nearby').click();
    await expect(page.getByTestId('poi-empty')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('poi-empty')).toContainText('この範囲では周辺スポットが見つかりませんでした');
    await expect(page.getByTestId('poi-failed')).toHaveCount(0);
    await expect(page.getByTestId('poi-expand-radius')).toBeVisible();
    // 「押したのに何も起きない」を防ぐため、Google Web検索へのフォールバック導線も出る
    await expect(page.getByTestId('poi-empty-google-fallback')).toBeVisible();
    const href = await page.getByTestId('poi-empty-google-fallback').getAttribute('href');
    expect(href ?? '').toContain('https://www.google.com/search?q=');
    // 「周辺を検索」案内文は画面上に残っていない
    await expect(page.getByText('「周辺を検索」')).toHaveCount(0);
  });

  test('実機で報告された不具合の回帰: 旧ビルドが端末に保存した旧分類の前回結果があっても、新ビルドでは静的キャッシュの正しい分類でラーメンが表示される', async ({
    page,
  }) => {
    // 根本原因の再現: 旧ビルド(subcategoriesなし・ラーメン店がfood_other分類)が
    // localStorage('tohoku-me:poi-last-ok:v1')に保存した前回結果が、新ビルドでも
    // 静的キャッシュより優先され、Overpassが失敗すると「すべては出るがラーメンは0件」になっていた。
    // 検証は実際の静的キャッシュ(mne-18900: ラーメン2件)を使う。
    await page.addInitScript(() => {
      const key = '40.7168,141.1553:3000'; // しちのへ(40.7168253,141.1552503)・既定3km
      const oldPoi = (id: number, name: string) => ({
        id: `osm:node/${id}`,
        category: 'food',
        subcategory: 'food_other', // 旧分類（実際はラーメン店）
        name,
        lat: 40.717,
        lng: 141.155,
        address: null,
        openingHoursRaw: null,
        phone: null,
        website: null,
        distanceM: 100,
        source: 'overpass',
        sourceUrl: `https://www.openstreetmap.org/node/${id}`,
      });
      localStorage.setItem(
        'tohoku-me:poi-last-ok:v1',
        JSON.stringify({ [key]: { at: Date.now(), pois: [oldPoi(1, 'けいじ'), oldPoi(2, 'ラーメンの里 るんるん'), oldPoi(3, '想い出寿司')] } }),
      );
    });
    await page.route('**/api/interpreter', (route) => route.abort()); // 実機と同じくOverpass失敗
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await closeBanners(page);
    await page.getByTestId('btn-search-nearby').click();
    await expect(page.getByTestId('poi-result-count')).toBeVisible({ timeout: 10000 });

    await page.getByTestId('poi-category-food').click();
    // 公開前UX整理でラーメン等の細分類チップは撤去したため、細分類フィルタではなく
    // 食べるカテゴリ全体の一覧行テキストで「静的キャッシュの正しい分類（ラーメン）」が
    // 使われていることを確認する（旧v1結果のfood_other分類が優先されていないこと）。
    await expect(page.getByTestId('poi-result-row')).toHaveCount(3, { timeout: 10000 });
    await expect(page.getByTestId('poi-result-row')).toContainText(['けいじ', 'ラーメンの里 るんるん', '想い出寿司']);
    const ramenRow = page.getByTestId('poi-result-row').filter({ hasText: 'ラーメンの里 るんるん' });
    await expect(ramenRow).toContainText('ラーメン'); // SUBCATEGORY_LABELとして表示される（food_otherのままではない）
    await expect(page.locator('.poi-marker')).toHaveCount(3);
    // 旧キーは削除されている
    const legacy = await page.evaluate(() => localStorage.getItem('tohoku-me:poi-last-ok:v1'));
    expect(legacy).toBeNull();
  });

  test('実機で報告された不具合の回帰: 細分類(温泉)が0件でも「温泉・休憩」自体が0件と誤表示しない', async ({ page }) => {
    // 温泉・休憩3件（すべて日帰り温泉相当。bath:type=onsen由来の「温泉」は無し）+ 宿泊1件、を用意する。
    // 「温泉」を選ぶと0件になるが、「温泉・休憩」自体には3件あるため、
    // 「「温泉・休憩」では見つかりませんでした」という誤った表示にならないことを確認する。
    // （公開前UX整理で食べるの細分類チップは撤去したため、細分類チップが引き続き残る
    // カテゴリ(温泉・休憩)で同じ回帰を確認する。App.tsx/PoiSearchPanel.tsxの
    // 空表示ロジック自体はカテゴリ非依存の共通コードのため、検証の対象範囲は変わらない）
    await page.route('**/api/interpreter', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          elements: [
            { type: 'node', id: 1, lat: 40.7171, lon: 141.1553, tags: { amenity: 'public_bath', name: '浴場A' } },
            { type: 'node', id: 2, lat: 40.7172, lon: 141.1554, tags: { amenity: 'public_bath', name: '浴場B' } },
            { type: 'node', id: 3, lat: 40.7173, lon: 141.1555, tags: { amenity: 'public_bath', name: '浴場C' } },
            { type: 'node', id: 4, lat: 40.7174, lon: 141.1556, tags: { tourism: 'hotel', name: 'テストホテル' } },
          ],
        }),
      }),
    );
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await closeBanners(page);
    await page.getByTestId('btn-search-nearby').click();
    await expect(page.getByTestId('poi-result-count')).toContainText('4件見つけました', { timeout: 10000 });

    await page.getByTestId('poi-category-onsen').click();
    await expect(page.getByTestId('poi-result-count')).toContainText('3件見つけました');
    await page.getByTestId('poi-subcategory-onsen').click();

    await expect(page.getByTestId('poi-empty')).toBeVisible({ timeout: 10000 });
    // 「「温泉・休憩」では見つかりませんでした」という誤った表示にならないこと
    await expect(page.getByTestId('poi-empty')).not.toContainText('「温泉・休憩」では見つかりませんでした');
    // 正しくは「温泉」が見つからなかった旨と、「温泉・休憩」内の他ジャンルには3件ある旨
    await expect(page.getByTestId('poi-empty')).toContainText('「温泉」では見つかりませんでした');
    await expect(page.getByTestId('poi-empty')).toContainText('「温泉・休憩」の他の絞り込みでは3件見つかっています');

    // 「「温泉・休憩」の他のジャンルを見る」ボタンで細分類だけがリセットされ、3件（カテゴリ全体）に戻る
    await page.getByTestId('poi-show-all-subcategories').click();
    await expect(page.getByTestId('poi-result-count')).toContainText('3件見つけました');
    await expect(page.getByTestId('poi-category-onsen')).toHaveClass(/active/);
  });

  test('検索結果一覧が表示され、並び替えができる', async ({ page }) => {
    await page.route('**/api/interpreter', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          elements: [
            { type: 'node', id: 1, lat: 40.72, lon: 141.16, tags: { amenity: 'restaurant', name: 'いろは食堂' } },
            { type: 'node', id: 2, lat: 40.718, lon: 141.156, tags: { amenity: 'cafe', name: 'あかさたな珈琲' } },
          ],
        }),
      }),
    );
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await closeBanners(page);
    await page.getByTestId('btn-search-nearby').click();
    await expect(page.getByTestId('poi-result-count')).toContainText('2件見つけました', { timeout: 10000 });
    await expect(page.getByTestId('poi-result-list')).toBeVisible();
    await expect(page.getByTestId('poi-result-row')).toHaveCount(2);
    // 既定は近い順: あかさたな珈琲（近い）が先
    const rowsByDistance = await page.getByTestId('poi-result-row').allTextContents();
    expect(rowsByDistance[0]).toContain('あかさたな珈琲');

    await page.getByTestId('poi-sort-name').click();
    const rowsByName = await page.getByTestId('poi-result-row').allTextContents();
    expect(rowsByName[0]).toContain('あかさたな珈琲'); // 五十音順でも「あ」が先

    // 一覧の➕からルートに追加できる
    await page.getByTestId('poi-result-toggle').first().click();
    await expect(page.getByTestId('route-select-bar')).toBeVisible();
    await expect(page.getByTestId('route-select-count')).toContainText('1駅選択中');

    // 一覧の行タップで詳細シートが開く
    await page.getByTestId('poi-result-open').nth(1).click();
    await expect(page.getByTestId('poi-detail-sheet')).toBeVisible();
  });

  test('30分以内の再検索は前回取得した結果として表示される', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/interpreter', async (route) => {
      calls++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        // MIN_AUTO_RESULTS(3)以上にして自動範囲拡張を発動させない（このテストの目的は
        // 「同一条件の再検索がキャッシュから返る」ことの検証であり、拡張の有無ではないため）
        body: JSON.stringify({
          elements: [
            { type: 'node', id: 1, lat: 40.718, lon: 141.156, tags: { amenity: 'restaurant', name: 'テスト店1' } },
            { type: 'node', id: 2, lat: 40.719, lon: 141.157, tags: { amenity: 'cafe', name: 'テスト店2' } },
            { type: 'node', id: 3, lat: 40.72, lon: 141.158, tags: { amenity: 'fast_food', name: 'テスト店3' } },
          ],
        }),
      });
    });
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await closeBanners(page);
    await page.getByTestId('btn-search-nearby').click();
    await expect(page.getByTestId('poi-result-count')).toContainText('3件見つけました', { timeout: 10000 });
    // 現在地/駅検索1回につきfood/otherの並行2クエリぶん呼ばれる
    expect(calls).toBe(2);

    // 検索パネルを閉じる（起点情報も破棄される設計）→ 同じ駅のURLハッシュへ変更して開き直す
    // （hashchangeで駅シートが開く。page.goto()での再読み込みはページ内メモリキャッシュも消してしまうため使わない。
    // 通常タップは訪問状態を循環させてしまうため、シートを開き直す手段としては使えない）
    await page.getByTestId('poi-panel-close').click();
    await page.evaluate((id) => {
      location.hash = `#station=${id}`;
    }, STATION_ID);
    await expect(page.getByTestId('station-sheet')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('btn-search-nearby').click();
    await expect(page.getByTestId('poi-result-count')).toContainText('前回取得した周辺スポットを表示しています', { timeout: 10000 });
    expect(calls).toBe(2);
  });

  test('stale-while-revalidate: 端末保存の前回成功結果があれば、今回の通信が全滅しても表示を維持する', async ({
    page,
  }) => {
    // 1回目: 成功させ、端末保存(localStorage)の劣化フォールバックにも書き込ませる
    await mockOverpassResponse(page);
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await closeBanners(page);
    await page.getByTestId('btn-search-nearby').click();
    await expect(page.getByTestId('poi-result-count')).toContainText('件見つけました', { timeout: 10000 });

    // ページを完全に再読み込みして、ページ内メモリキャッシュ(30分)だけを消す
    // （端末保存の劣化フォールバックはlocalStorageのため生き残る）
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await closeBanners(page);

    // 2回目: 今回は全接続先が失敗する状況を模す
    await page.unroute('**/api/interpreter');
    await page.route('**/api/interpreter', (route) => route.abort());
    await page.getByTestId('btn-search-nearby').click();

    // 通信を待たず即座に前回結果が表示される（stale-while-revalidateの「即表示」）。
    // 裏の再取得は route.abort() により即座に全滅するため「更新中」表示は一瞬で消えうる
    // （その一瞬の表示自体はoverpass.test.tsのユニットテストで検証済み）。
    await expect(page.getByTestId('poi-result-count')).toContainText('前回取得した周辺スポットを表示しています', {
      timeout: 5000,
    });

    // 裏の再取得が全滅しても、表示は「失敗しました」に切り替わらず、前回結果を見せ続ける
    // （何も表示されない/失敗表示に化けることがない、という要求の直接的な検証）
    await page.waitForTimeout(2000);
    await expect(page.getByTestId('poi-result-count')).toContainText('前回取得した周辺スポットを表示しています');
    await expect(page.getByTestId('poi-failed')).toBeHidden();
    await expect(page.getByTestId('poi-result-list')).toBeVisible();
  });

  test('事前生成された静的POIキャッシュ: Overpassが全滅していても道の駅起点の検索なら実POI一覧が表示される', async ({
    page,
  }) => {
    // 事前生成キャッシュ(scripts/fetch_poi_cache.pyが生成するpublic/data/poi/<id>.json)を模す。
    // このテストの目的は「Overpassの生死に関係なく、事前生成データがあれば必ず一覧が出る」ことの検証のため、
    // Overpass自体は最初から全滅させる。
    await page.route('**/api/interpreter', (route) => route.abort());
    await page.route(`**/data/poi/${STATION_ID}.json`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          stationId: STATION_ID,
          lat: 40.718,
          lng: 141.156,
          radiusM: 10000,
          generatedAt: '2026-09-05T00:00:00Z',
          pois: [
            {
              id: 'osm:node/100',
              category: 'food',
              subcategory: 'shokudo',
              name: '事前キャッシュ食堂',
              lat: 40.719,
              lng: 141.157,
              address: null,
              openingHoursRaw: null,
              phone: null,
              website: null,
              distanceM: 120,
              source: 'overpass',
              sourceUrl: 'https://www.openstreetmap.org/node/100',
            },
            {
              id: 'osm:node/101',
              category: 'onsen',
              subcategory: 'higaeri_onsen',
              name: '事前キャッシュ温泉',
              lat: 40.72,
              lng: 141.158,
              address: null,
              openingHoursRaw: null,
              phone: null,
              website: null,
              distanceM: 300,
              source: 'overpass',
              sourceUrl: 'https://www.openstreetmap.org/node/101',
            },
          ],
        }),
      }),
    );

    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await closeBanners(page);
    await page.getByTestId('btn-search-nearby').click();

    // Overpassは全滅させているにもかかわらず、事前生成キャッシュにより実POI一覧が即座に表示される
    // （静的キャッシュもfromCache扱いのため「前回取得した周辺スポットを表示しています」の文言になる）
    await expect(page.getByTestId('poi-result-count')).toContainText('前回取得した周辺スポットを表示しています', {
      timeout: 5000,
    });
    await expect(page.getByTestId('poi-failed')).toBeHidden();
    const rows = page.locator('[data-testid="poi-result-row"]');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('事前キャッシュ');
  });

  test('事前生成キャッシュが無い駅（未生成）では通常どおりOverpass検索に進む', async ({ page }) => {
    // 静的キャッシュが404(未生成)の場合はnullとして扱われ、通常のOverpass検索フローに
    // 何の影響も与えないことを確認する（事前キャッシュが「無いと壊れる」設計になっていないこと）。
    await page.route(`**/data/poi/${STATION_ID}.json`, (route) => route.fulfill({ status: 404 }));
    await mockOverpassResponse(page);
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await closeBanners(page);
    await page.getByTestId('btn-search-nearby').click();
    await expect(page.getByTestId('poi-result-count')).toContainText('3件見つけました', { timeout: 10000 });
  });

  test('現在地の取得に失敗した場合はOverpass通信失敗とは別の案内になる（Googleへは飛ばさない）', async ({ page }) => {
    // ヘッドレスブラウザの権限プロンプトは自動応答されず無期限に待つことがあるため、
    // navigator.geolocationを決定的に「拒否」で応答するようスタブする
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'geolocation', {
        value: {
          getCurrentPosition: (_ok: unknown, err: (e: { code: number; message: string }) => void) =>
            setTimeout(() => err({ code: 1, message: 'User denied Geolocation' }), 50),
        },
        configurable: true,
      });
    });
    await page.goto('/');
    await closeBanners(page);
    await page.getByTestId('tab-route').click();
    await page.getByTestId('course-mode-manual').click();
    await page.getByTestId('poi-search-open').click();
    await expect(page.getByTestId('poi-search-panel')).toBeVisible();
    await page.getByTestId('poi-origin-mode-current').click();
    await page.getByTestId('poi-origin-current').click();
    await expect(page.getByTestId('poi-geo-failed')).toBeVisible({ timeout: 15000 });
    // code:1(PERMISSION_DENIED)かつSecure Context(127.0.0.1は例外扱い)のため、
    // 「許可されていません」という権限拒否専用の案内文になる
    await expect(page.getByTestId('poi-geo-failed')).toContainText('位置情報の利用が許可されていません');
    await expect(page.getByTestId('poi-failed')).toHaveCount(0);
    await expect(page.getByTestId('poi-google-fallback')).toHaveCount(0);
    // 「地図で指定」は廃止済みのため、代替導線は「もう一度試す」「道の駅を選ぶ」のみ
    await expect(page.getByTestId('poi-geo-retry')).toBeVisible();
    await expect(page.getByTestId('poi-geo-use-station')).toBeVisible();
    // 現在地が拒否されても検索パネルは閉じない
    await expect(page.getByTestId('poi-search-panel')).toBeVisible();

    // 現在地拒否後、道の駅を選ぶ方法へ切り替えて検索を続けられる
    await page.getByTestId('poi-geo-use-station').click();
    await expect(page.getByTestId('poi-origin-station-select')).toBeVisible();
  });

  test('現在地取得: POSITION_UNAVAILABLE(code:2)は権限拒否とは異なる「電波状況」の案内になる', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'geolocation', {
        value: {
          getCurrentPosition: (_ok: unknown, err: (e: { code: number; message: string }) => void) =>
            setTimeout(() => err({ code: 2, message: 'Position unavailable' }), 50),
        },
        configurable: true,
      });
    });
    await page.goto('/');
    await closeBanners(page);
    await page.getByTestId('poi-search-open').click();
    await expect(page.getByTestId('poi-search-panel')).toBeVisible();
    await page.getByTestId('poi-origin-mode-current').click();
    await page.getByTestId('poi-origin-current').click();
    await expect(page.getByTestId('poi-geo-failed')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('poi-geo-failed')).toContainText('電波状況の良い場所');
  });

  test('現在地取得: TIMEOUT(code:3)は権限拒否とは異なる「時間がかかっています」の案内になる', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'geolocation', {
        value: {
          getCurrentPosition: (_ok: unknown, err: (e: { code: number; message: string }) => void) =>
            setTimeout(() => err({ code: 3, message: 'Timeout expired' }), 50),
        },
        configurable: true,
      });
    });
    await page.goto('/');
    await closeBanners(page);
    await page.getByTestId('poi-search-open').click();
    await expect(page.getByTestId('poi-search-panel')).toBeVisible();
    await page.getByTestId('poi-origin-mode-current').click();
    await page.getByTestId('poi-origin-current').click();
    await expect(page.getByTestId('poi-geo-failed')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('poi-geo-failed')).toContainText('時間がかかっています');
  });

  test('公開版と同じ手順: ボタンを1回タップ→通信前にパネル表示→道の駅を選んで検索→アプリ内に実データ表示（Google未経由）', async ({ page }) => {
    const overpassCalls: string[] = [];
    await page.route('**/api/interpreter', async (route) => {
      overpassCalls.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          elements: [
            { type: 'node', id: 1, lat: 40.718, lon: 141.156, tags: { amenity: 'restaurant', cuisine: 'ramen', name: 'テストラーメン店' } },
          ],
        }),
      });
    });
    // 公開版と同じ初期状態（バナー等は開いたまま）で地図を表示
    await page.goto('/');
    await expect(page.getByTestId('map-root')).toBeVisible();
    const appOrigin = new URL(page.url()).origin;

    // 「周辺スポット」を1回タップ（実クリックイベント。内部関数呼び出しではない）
    await page.getByTestId('poi-search-open').click();

    // API通信前に検索パネルが即座に表示される
    await expect(page.getByTestId('poi-search-panel')).toBeVisible();
    expect(overpassCalls.length).toBe(0);

    // 「食べる／観光／温泉・休憩／宿泊」が見える
    await expect(page.getByTestId('poi-category-food')).toBeVisible();
    await expect(page.getByTestId('poi-category-tourism')).toBeVisible();
    await expect(page.getByTestId('poi-category-onsen')).toBeVisible();
    await expect(page.getByTestId('poi-category-lodging')).toBeVisible();

    // 道の駅選択欄が見える（初期タブ）
    await expect(page.getByTestId('poi-origin-station-select')).toBeVisible();

    // 1km/3km/5km/10kmが見える
    await expect(page.getByTestId('poi-radius-1000')).toBeVisible();
    await expect(page.getByTestId('poi-radius-3000')).toBeVisible();
    await expect(page.getByTestId('poi-radius-5000')).toBeVisible();
    await expect(page.getByTestId('poi-radius-10000')).toBeVisible();

    // 道の駅しちのへを選ぶ
    await page.getByTestId('poi-origin-pref-select').selectOption('青森県');
    await page.getByTestId('poi-origin-station-select').selectOption(STATION_ID);
    expect(overpassCalls.length).toBe(0); // 地点選択だけでは通信しない

    // すべて・3kmはすでに既定値のまま、検索を実行
    await expect(page.getByTestId('poi-category-all')).toHaveClass(/active/);
    await expect(page.getByTestId('poi-radius-3000')).toHaveClass(/active/);
    await page.getByTestId('poi-do-search').click();

    // fixture結果が地図と一覧の両方へ表示される
    await expect(page.getByTestId('poi-result-count')).toContainText('1件見つけました', { timeout: 10000 });
    await expect(page.getByTestId('poi-result-list')).toBeVisible();
    await expect(page.getByTestId('poi-result-row')).toHaveCount(1);
    await expect(page.locator('[data-poi-id="osm:node/1"]')).toHaveCount(1);
    await expect(page.getByTestId('poi-result-row')).toContainText('テストラーメン店');

    // Googleマップへ遷移していない（このアプリと同じオリジンのまま）
    expect(new URL(page.url()).origin).toBe(appOrigin);
    expect(page.url()).not.toContain('google.com');

    // 検索結果をルートへ追加
    await page.getByTestId('poi-result-toggle').first().click();
    await expect(page.getByTestId('route-select-bar')).toBeVisible();
    await expect(page.getByTestId('route-select-count')).toContainText('1駅選択中');

    // POIで達成率が変わらない
    await expect(page.getByTestId('stats-visited')).toContainText('0／1237駅');
  });

  test('全画面モードでも周辺スポット検索が使える', async ({ page }) => {
    await mockOverpassResponse(page);
    await page.goto('/');
    await closeBanners(page);
    await page.getByTestId('fullscreen-btn').click();
    await expect(page.getByTestId('fullscreen-exit')).toBeVisible();
    await expect(page.getByTestId('poi-search-open')).toBeVisible();
    await page.getByTestId('poi-search-open').click();
    await expect(page.getByTestId('poi-search-panel')).toBeVisible();
    await page.getByTestId('poi-origin-pref-select').selectOption('青森県');
    await page.getByTestId('poi-origin-station-select').selectOption(STATION_ID);
    await page.getByTestId('poi-do-search').click();
    await expect(page.getByTestId('poi-result-count')).toContainText('3件見つけました', { timeout: 10000 });
  });

  test('iPhone相当でタップ領域が44px以上あり、横スクロールが発生しない', async ({ page }) => {
    await mockOverpassResponse(page);
    await page.goto('/');
    await closeBanners(page);
    const searchOpenBox = await page.getByTestId('poi-search-open').boundingBox();
    expect(searchOpenBox!.height).toBeGreaterThanOrEqual(44);
    await page.getByTestId('poi-search-open').click();
    await expect(page.getByTestId('poi-search-panel')).toBeVisible();

    const doSearchBox = await page.getByTestId('poi-do-search').boundingBox();
    expect(doSearchBox!.height).toBeGreaterThanOrEqual(44);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await page.getByTestId('poi-origin-pref-select').selectOption('青森県');
    await page.getByTestId('poi-origin-station-select').selectOption(STATION_ID);
    await page.getByTestId('poi-do-search').click();
    await expect(page.getByTestId('poi-result-count')).toContainText('3件見つけました', { timeout: 10000 });
    const rowToggleBox = await page.getByTestId('poi-result-toggle').first().boundingBox();
    expect(rowToggleBox!.height).toBeGreaterThanOrEqual(44);
    const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow2).toBeLessThanOrEqual(0);
  });

  test('「🔍 周辺スポット」ボタンがホーム画面追加バナーに隠れて押せなくなる不具合の回帰確認', async ({ page }) => {
    // 実際に公開版で確認された不具合: 初回訪問時のa2hs-banner（ホーム画面に追加の案内）が
    // 周辺スポットボタンを完全に覆い隠し、実タップが無反応になっていた。
    await mockOverpassResponse(page);
    await page.goto('/');
    // バナーを閉じずに（初回訪問と同じ状態で）実タップする
    const legend = page.getByTestId('legend-panel');
    if (await legend.isVisible().catch(() => false)) await page.getByTestId('legend-toggle').click();
    await expect(page.getByTestId('a2hs-banner')).toBeVisible();
    const btnBox = await page.getByTestId('poi-search-open').boundingBox();
    const bannerBox = await page.getByTestId('a2hs-banner').boundingBox();
    // ボタンとバナーの矩形が重ならないこと
    const overlaps =
      btnBox!.x < bannerBox!.x + bannerBox!.width &&
      btnBox!.x + btnBox!.width > bannerBox!.x &&
      btnBox!.y < bannerBox!.y + bannerBox!.height &&
      btnBox!.y + btnBox!.height > bannerBox!.y;
    expect(overlaps).toBe(false);
    // 収録駅が約1000件まで増えた結果、iPhone(WebKit)では初期描画のあとに
    // アニメーションフレームが最大4秒ほど飛ぶことが実測で判明している
    // （ボタンの矩形自体は120フレーム連続で完全に不動で、レイアウトは安定している）。
    // Playwrightのクリックは「2フレーム連続で同じ矩形」を待つ仕様のため、このフレーム
    // 飛びに当たると5秒では足りずタイムアウトすることがあった。本テストの主眼である
    // 「バナーに覆われて押せない」不具合の回帰は直前の重なり判定とクリック成否で
    // 担保されるため、判定内容は変えずに待ち時間だけ実測値に合わせて広げる。
    await page.getByTestId('poi-search-open').click({ timeout: 30000 });
    await expect(page.getByTestId('poi-search-panel')).toBeVisible();
  });
});

/**
 * 実地テストで報告された不具合の回帰: 「表示されているPOIが、細分類を押すと消える」問題。
 * 表示されているPOIの数だけでなく、地図マーカーの増減・復元も併せて確認する。
 * @smoke を付け、iphone(全件)に加えandroid/tablet/desktopでも実行する。
 */
test.describe('周辺スポット検索: 細分類フィルター', () => {
  test.use({ serviceWorkers: 'block' });

  function mockGenreFixture(page: Page) {
    return page.route('**/api/interpreter', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          elements: [
            // 食べる: ラーメン(cuisine由来) + ラーメン(店名のみ、cuisineタグ無し) + カフェ
            { type: 'node', id: 201, lat: 40.7171, lon: 141.1553, tags: { amenity: 'fast_food', cuisine: 'ramen', name: 'テスト屋台ラーメン' } },
            { type: 'node', id: 202, lat: 40.7172, lon: 141.1554, tags: { amenity: 'restaurant', name: 'らーめん花子' } },
            { type: 'node', id: 203, lat: 40.7173, lon: 141.1555, tags: { amenity: 'cafe', name: 'テストカフェ' } },
            // 温泉・休憩: 温泉由来の日帰り温泉(bath:type=onsen) + 温泉由来を示さない一般公衆浴場 + 足湯
            { type: 'node', id: 204, lat: 40.7174, lon: 141.1556, tags: { amenity: 'public_bath', 'bath:type': 'onsen', name: 'テスト温泉' } },
            { type: 'node', id: 205, lat: 40.7175, lon: 141.1557, tags: { amenity: 'public_bath', name: 'テスト浴場センター' } },
            { type: 'node', id: 206, lat: 40.7176, lon: 141.1558, tags: { amenity: 'foot_bath', name: 'テスト足湯' } },
            // 宿泊: ホテル
            { type: 'node', id: 207, lat: 40.7177, lon: 141.1559, tags: { tourism: 'hotel', name: 'テストホテル' } },
          ],
        }),
      }),
    );
  }

  test('食べる/温泉・休憩/宿泊の各細分類で、該当するPOIが正しく残る（データ上あるのに0件になる問題が無い）@smoke', async ({ page }) => {
    await mockGenreFixture(page);
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    const legend = page.getByTestId('legend-panel');
    if (await legend.isVisible().catch(() => false)) await page.getByTestId('legend-toggle').click();
    await page.getByTestId('btn-search-nearby').click();

    const resultCount = page.getByTestId('poi-result-count');
    const markers = page.locator('.poi-marker');

    // 5. 「すべて」で7件（食べる3・温泉3・宿泊1）
    await expect(resultCount).toContainText('7件見つけました', { timeout: 10000 });
    await expect(markers).toHaveCount(7);

    // 食べるカテゴリ: 3件（ラーメン2・カフェ1、内訳は分類の正しさを一覧の行テキストで確認する。
    // 公開前UX整理: 食べるの細分類チップ(ラーメン/カフェ等)は一般ユーザーUIから撤去したため、
    // ここでは細分類フィルタではなく、食べるカテゴリ全体の結果と各行の表示テキストで
    // 「データ上あるのに0件になる/誤分類される問題が無い」ことを確認する
    // （内部classificationロジック自体は変更していないため、一覧の行テキストには
    // 引き続き正しいジャンル名が出る）。
    await page.getByTestId('poi-category-food').click();
    await expect(resultCount).toContainText('3件見つけました');
    await expect(markers).toHaveCount(3);
    await expect(page.getByTestId('poi-result-row')).toContainText(['テスト屋台ラーメン', 'らーめん花子', 'テストカフェ']);
    await expect(page.getByTestId('poi-subcategory-chips')).toHaveCount(0);

    // 13. カテゴリをまたいで温泉・休憩へ切り替え: 3件
    await page.getByTestId('poi-category-onsen').click();
    await expect(resultCount).toContainText('3件見つけました');
    await expect(markers).toHaveCount(3);

    // 8. 温泉: bath:type=onsenの1件のみ（温泉由来を示さない公衆浴場は含まれない）
    await page.getByTestId('poi-subcategory-onsen').click();
    await expect(resultCount).toContainText('1件見つけました');
    await expect(page.getByTestId('poi-result-row')).toContainText('テスト温泉');
    await expect(markers).toHaveCount(1);

    // 9. 日帰り温泉: 公衆浴場2件とも残る（温泉由来かどうかに関わらず日帰り温泉としては両方該当）
    await page.getByTestId('poi-subcategory-higaeri_onsen').click();
    await expect(resultCount).toContainText('2件見つけました');
    await expect(page.getByTestId('poi-result-row')).toHaveCount(2);
    await expect(markers).toHaveCount(2);

    // 10. 足湯: 1件
    await page.getByTestId('poi-subcategory-ashiyu').click();
    await expect(resultCount).toContainText('1件見つけました');
    await expect(markers).toHaveCount(1);

    // 11. 宿泊: カテゴリをまたいで切り替え、1件
    await page.getByTestId('poi-category-lodging').click();
    await expect(resultCount).toContainText('1件見つけました');
    await expect(page.getByTestId('poi-result-row')).toContainText('テストホテル');
    await expect(markers).toHaveCount(1);

    // カテゴリの「すべて」に戻すと全7件に復元される
    await page.getByTestId('poi-category-all').click();
    await expect(resultCount).toContainText('7件見つけました');
    await expect(markers).toHaveCount(7);
  });
});
