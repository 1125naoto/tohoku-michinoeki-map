import { expect, test, type Page } from '@playwright/test';
import { useNationwideSelection } from './helpers';

/**
 * 公開前UX整理で初回起動に地域選択画面（「どこを旅しますか？」）を追加したため、
 * 全国地図を前提にした既存シナリオでは「全国を見る」選択済みの状態から開始する。
 */
test.beforeEach(async ({ page }) => {
  await useNationwideSelection(page);
});

/**
 * 実旅行対応 Route Planner V2: 自由地点（アプリ未登録のホテル・飲食店等）・
 * 別の最終目的地の指定のE2Eシナリオ。manual-route.spec.tsと同じ手法
 * （OSRM/GSI住所検索APIへの実通信を中断し、概算/固定応答で決定的に検証する）。
 */

const ST_A = 'mne-19038'; // 季の里天栄
const ST_B = 'mne-19029'; // たまかわ
const ST_C = 'mne-19033'; // ひらた
const COORDS: Record<string, [number, number]> = {
  [ST_A]: [37.2436603, 140.2447857],
  [ST_B]: [37.2228324, 140.4181372],
  [ST_C]: [37.2505454, 140.5600321],
};

async function closeBanners(page: Page) {
  const banner = page.getByTestId('a2hs-banner');
  if (await banner.isVisible().catch(() => false)) await page.getByTestId('a2hs-close').click();
  const legend = page.getByTestId('legend-panel');
  if (await legend.isVisible().catch(() => false)) await page.getByTestId('legend-toggle').click();
}

async function enterManualSelect(page: Page) {
  await page.getByTestId('tab-route').click();
  await expect(page.getByTestId('course-mode-auto')).toBeVisible();
  await page.getByTestId('course-mode-manual').click();
  await expect(page.getByTestId('map-root')).toBeVisible();
  await expect(page.getByTestId('route-select-bar')).toBeVisible();
}

async function waitForCenteredMarkerSettled(page: Page, id: string) {
  await page.waitForFunction(
    (sid) => {
      const el = document.querySelector(`[data-sid="${sid}"]`);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const atPoint = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return atPoint != null && atPoint.closest(`[data-sid="${sid}"]`) != null;
    },
    id,
    { timeout: 10000 },
  );
}

async function avoidSelectBarOverlap(page: Page, id: string) {
  const hasPan = await page.evaluate(() => typeof (window as unknown as { __panMapBy?: unknown }).__panMapBy === 'function');
  if (!hasPan) return;
  for (let i = 0; i < 5; i++) {
    const markerBox = await page.locator(`[data-sid="${id}"]`).boundingBox();
    const barBox = await page.getByTestId('route-select-bar').boundingBox().catch(() => null);
    if (!markerBox || !barBox) return;
    const markerCenterY = markerBox.y + markerBox.height / 2;
    const overlap = markerCenterY + markerBox.height / 2 + 8 - barBox.y;
    if (overlap <= 0) return;
    await page.evaluate((dy) => (window as unknown as { __panMapBy: (dx: number, dy: number) => void }).__panMapBy(0, dy), overlap);
    await page.waitForTimeout(150);
  }
}

async function tapStation(page: Page, id: string) {
  const coord = COORDS[id];
  if (coord) {
    await page.waitForFunction(() => typeof (window as unknown as { __setMapView?: unknown }).__setMapView === 'function', { timeout: 20000 });
    await page.evaluate(
      ([lat, lng]) => (window as unknown as { __setMapView: (a: number, b: number, c: number) => void }).__setMapView(lat, lng, 12),
      coord,
    );
    await page.waitForTimeout(300);
    await avoidSelectBarOverlap(page, id);
    await waitForCenteredMarkerSettled(page, id);
  }
  await page.locator(`[data-sid="${id}"]`).click();
}

async function pickOriginStation(page: Page, id: string) {
  await page.getByRole('button', { name: '道の駅から', exact: true }).click();
  await page.getByLabel('出発する道の駅').selectOption(id);
  await expect(page.getByTestId('origin-label')).toBeVisible();
}

async function advanceToRouteDetail(page: Page, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.getByTestId('route-detail').isVisible().catch(() => false)) return;
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
  throw new Error('route-detail に到達しませんでした');
}

/** 国土地理院 住所検索APIへの実通信を止め、固定の座標を返す（既存のGSI検索と同じ仕組みを使う） */
async function mockGeocode(page: Page, lat: number, lng: number, title: string) {
  await page.route('**msearch.gsi.go.jp/address-search/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ geometry: { coordinates: [lng, lat] }, properties: { title } }]),
    }),
  );
}

test.describe('自由地点・最終目的地の指定', () => {
  test.use({ serviceWorkers: 'block' });

  test('CASE3: 道の駅2件→③別の最終目的地(ホテル)を指定すると、そこがゴールになる', async ({ page }) => {
    test.setTimeout(120000);
    await page.route('**router.project-osrm.org/**', (route) => route.abort());
    await mockGeocode(page, 38.24, 140.34, '山形県山形市testtown1-2-3');
    await page.goto('/');
    await closeBanners(page);
    await enterManualSelect(page);

    await tapStation(page, ST_A);
    await tapStation(page, ST_B);
    await expect(page.getByTestId('route-select-count')).toContainText('2駅選択中');

    // 自由地点（自由地点を追加）を経由地一覧から追加できる
    await page.getByTestId('route-select-show-list').click();
    await page.getByTestId('route-select-add-custom').click();
    await page.getByTestId('custom-stop-name').fill('○○ホテル');
    await page.getByTestId('custom-stop-address').fill('山形県山形市testtown1-2-3');
    await page.getByTestId('custom-stop-search').click();
    await expect(page.getByTestId('custom-stop-resolved')).toBeVisible();
    await page.getByTestId('custom-stop-confirm').click();
    await expect(page.getByTestId('route-select-row')).toHaveCount(3, { timeout: 15000 });
    await page.getByTestId('route-select-sheet-close').click();

    await page.getByTestId('route-select-create').click();
    await pickOriginStation(page, ST_A);
    await page.getByTestId('budget-unlimited').click();

    // ③別の最終目的地を指定
    await page.getByTestId('end-mode-custom').click();
    await page.getByTestId('custom-stop-name').fill('△△旅館');
    await page.getByTestId('custom-stop-address').fill('福島県福島市testtown9-9-9');
    await page.route('**msearch.gsi.go.jp/address-search/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ geometry: { coordinates: [140.47, 37.76] }, properties: { title: '福島県福島市testtown9-9-9' } }]),
      }),
    );
    await page.getByTestId('custom-stop-search').click();
    await expect(page.getByTestId('custom-stop-resolved')).toBeVisible();
    await page.getByTestId('custom-stop-confirm').click();
    await expect(page.getByTestId('final-destination-summary')).toContainText('△△旅館');

    await page.getByTestId('manual-submit').click();
    await advanceToRouteDetail(page);
    await expect(page.getByTestId('route-detail')).toBeVisible();

    // タイムラインの最後の地点が最終目的地（自由地点）になっている
    const rows = page.locator('[data-testid="route-timeline"] li');
    const lastRow = rows.last();
    await expect(lastRow).toContainText('△△旅館');
    await expect(lastRow).toContainText('自由地点');
    // 「へ帰着」（出発地点へ戻る）表記が出ていない = 最終目的地がゴールで、そこからさらに戻っていない
    await expect(page.getByTestId('route-timeline')).not.toContainText('へ帰着');
  });

  test('CASE3後: 自由地点を含むコースをGoogleマップで開くリンクが生成される（住所テキストではなく生の座標を使う）', async ({ page }) => {
    test.setTimeout(120000);
    await page.route('**router.project-osrm.org/**', (route) => route.abort());
    await mockGeocode(page, 38.24, 140.34, 'testhotel');
    await page.goto('/');
    await closeBanners(page);
    await enterManualSelect(page);
    await tapStation(page, ST_A);
    await tapStation(page, ST_B);
    await page.getByTestId('route-select-create').click();
    await pickOriginStation(page, ST_A);
    await page.getByTestId('budget-unlimited').click();
    await page.getByTestId('end-mode-custom').click();
    await page.getByTestId('custom-stop-address').fill('山形県山形市testtown1-2-3');
    await page.getByTestId('custom-stop-search').click();
    await expect(page.getByTestId('custom-stop-resolved')).toBeVisible();
    await page.getByTestId('custom-stop-confirm').click();
    await page.getByTestId('manual-submit').click();
    await advanceToRouteDetail(page);

    await page.getByTestId('gmaps-open').click();
    await expect(page.getByTestId('gmaps-segment')).toHaveCount(1); // 3地点なので分割されない
    const href = await page.getByTestId('gmaps-segment-link').getAttribute('href');
    expect(href).toContain('https://www.google.com/maps/dir/?api=1');
    expect(href).toContain('38.240000'); // 自由地点は生の座標を使う（テキスト住所ではない）
  });
});
