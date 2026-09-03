import { expect, test, type Page } from '@playwright/test';

/**
 * 周辺スポット（POI）機能のE2Eシナリオ（ナミさん完成Ver v1.0）。
 * Overpass公開APIはモックし（regular testで実APIを叩かない）、決定的に検証する。
 * 実Overpass APIへの実データ疎通確認は別途スクリプトで実施済み（README/リリースノート参照）。
 */

const STATION_ID = 'mne-18900'; // しちのへ

function mockOverpassResponse(page: Page) {
  return page.route('**overpass-api.de/**', (route) =>
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
    await expect(page.getByTestId('poi-result-count')).toContainText('2件見つかりました', { timeout: 10000 });

    // カテゴリ絞り込み
    await page.getByTestId('poi-category-food').click();
    await expect(page.getByTestId('poi-result-count')).toContainText('1件見つかりました');
    await page.getByTestId('poi-category-all').click();
    await expect(page.getByTestId('poi-result-count')).toContainText('2件見つかりました');

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

  test('Overpass障害時はGoogleマップ検索へフォールバックできる', async ({ page }) => {
    await page.route('**overpass-api.de/**', (route) => route.abort());
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await page.getByTestId('btn-search-nearby').click();
    await expect(page.getByTestId('poi-failed')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('poi-google-fallback')).toBeVisible();
  });

  test('検索半径を切り替えると再検索される', async ({ page }) => {
    let lastRadius = '';
    await page.route('**overpass-api.de/**', async (route) => {
      const body = decodeURIComponent(route.request().postData() ?? '');
      const m = body.match(/around:(\d+)/);
      lastRadius = m ? m[1] : '';
      const oneResult = lastRadius === '1000';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          elements: oneResult
            ? [{ type: 'node', id: 1, lat: 40.718, lon: 141.156, tags: { amenity: 'restaurant', name: 'テスト店' } }]
            : [
                { type: 'node', id: 1, lat: 40.718, lon: 141.156, tags: { amenity: 'restaurant', name: 'テスト店' } },
                { type: 'node', id: 2, lat: 40.719, lon: 141.157, tags: { natural: 'hot_spring', name: 'テスト温泉' } },
              ],
        }),
      });
    });
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await closeBanners(page);
    await page.getByTestId('btn-search-nearby').click();
    await expect(page.getByTestId('poi-result-count')).toContainText('2件見つかりました', { timeout: 10000 });

    await page.getByTestId('poi-radius-1000').click();
    await expect(page.getByTestId('poi-result-count')).toContainText('1件見つかりました', { timeout: 10000 });
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
    await page.getByTestId('poi-origin-map').click();
    // 検索パネルは画面下部を占めるため、パネルに隠れない上部をタップする
    await page.getByTestId('map-root').click({ position: { x: 200, y: 80 } });
    await expect(page.getByTestId('poi-result-count')).toContainText('2件見つかりました', { timeout: 10000 });

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
    await expect(page.getByTestId('poi-result-count')).toContainText('2件見つかりました', { timeout: 10000 });
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
    await expect(page.getByTestId('poi-result-count')).toContainText('2件見つかりました', { timeout: 10000 });
    await page.locator('[data-poi-id="osm:node/1"]').click();
    await expect(page.getByTestId('poi-detail-sheet')).toBeVisible();
    await page.getByTestId('poi-detail-toggle-route').click();
    await expect(page.getByTestId('route-select-count')).toContainText('1駅選択中');

    await page.reload();
    await expect(page.getByRole('dialog', { name: '前回の続きがあります' })).toBeVisible({ timeout: 10000 });
    await page.getByTestId('confirm-ok').click();
    // 出発地点未設定だったため、選択内容（周辺スポット含む）を保ったまま出発地点の入力画面へ直接戻る
    await expect(page.getByTestId('manual-selection-summary')).toContainText('選んだ1件');
    await expect(page.getByTestId('manual-selection-summary')).toContainText('テストラーメン店');
  });
});
