import { expect, test, type Page } from '@playwright/test';
import stationsRaw from '../src/data/stations.json' with { type: 'json' };

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
            // 既存2件のすぐ近くに置く（離しすぎるとfitBoundsのズームが変わり、
            // 狭いiPhone幅ではマーカーが検索パネルの下に隠れてクリックできなくなるため）
            lat: 40.7185,
            lon: 141.1565,
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
    await expect(page.getByTestId('stats-visited')).toContainText('0／182駅');

    // 道の駅も追加して混合ルートを作成する
    await page.getByTestId('poi-detail-close').click();
    await page.getByTestId('poi-panel-close').click();
    await expect(page.getByTestId('poi-search-panel')).toHaveCount(0);
    await page.route('**router.project-osrm.org/**', (route) => route.abort());
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
      // 前の県（他県）の駅が一切残っていない
      for (const otherId of otherIds) {
        expect(stationValues).not.toContain(otherId);
      }
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

  test('Overpass障害時はGoogleマップ検索へフォールバックできる', async ({ page }) => {
    await page.route('**/api/interpreter', (route) => route.abort());
    // このテストは「事前生成キャッシュも無い・Overpassも全滅」という最悪ケースを検証したいため、
    // 静的キャッシュ側も明示的に404にする（本駅は実際には事前生成済みのため、放置すると
    // 静的キャッシュに救われて意図と異なるテストになってしまう）
    await page.route(`**/data/poi/${STATION_ID}.json`, (route) => route.fulfill({ status: 404 }));
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await page.getByTestId('btn-search-nearby').click();
    await expect(page.getByTestId('poi-failed')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('poi-google-fallback')).toBeVisible();
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
    // 「地図で指定」は廃止済みのため、道の駅選択（既定の都道府県=青森県）で検索地点を確定する
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
        await expect(page.getByTestId('stats-visited')).toContainText('0／182駅');
      } else if (await page.getByTestId('trip-arrived').isVisible().catch(() => false)) {
        await page.getByTestId('trip-arrived').click();
        await expect(page.getByTestId('stats-visited')).toContainText('1／182駅');
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
    let calls = 0;
    await page.route('**/api/interpreter', async (route) => {
      calls++;
      if (calls === 1) {
        await route.fulfill({ status: 429, contentType: 'text/plain', body: 'rate limited' });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        // MIN_AUTO_RESULTS(3)以上にして自動範囲拡張による追加リクエストを避ける
        // （このテストの目的は「1接続先目の失敗→2接続先目への切替」を正確に2回で検証すること）
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
    expect(calls).toBe(2);
  });

  test('1つ目のOverpass接続先が504でも、2つ目の接続先へ切り替えて成功する', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/interpreter', async (route) => {
      calls++;
      if (calls === 1) {
        await route.fulfill({ status: 504, contentType: 'text/plain', body: 'gateway timeout' });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
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
    expect(calls).toBe(2);
  });

  test('すべての接続先が失敗した場合はGoogleマップ検索へフォールバックできる（もう一度試す・検索範囲を変更も表示）', async ({ page }) => {
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
  });

  test('0件の場合は通信失敗と別の表示になり、範囲を広げる・Googleマップの案内が出る', async ({ page }) => {
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
    // 「押したのに何も起きない」を防ぐため、Googleマップへのフォールバック導線も出る
    await expect(page.getByTestId('poi-empty-google-fallback')).toBeVisible();
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
    expect(calls).toBe(1);

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
    expect(calls).toBe(1);
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
    await expect(page.getByTestId('poi-geo-failed')).toContainText('現在地を取得できませんでした');
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
    await expect(page.getByTestId('stats-visited')).toContainText('0／182駅');
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
    await page.getByTestId('poi-search-open').click({ timeout: 5000 });
    await expect(page.getByTestId('poi-search-panel')).toBeVisible();
  });
});
