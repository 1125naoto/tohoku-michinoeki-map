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
 * 「↻ 最初からやり直す」の逃げ道E2Eシナリオ。
 * ルート作成途中（道の駅選択のみ／POI追加後／自由地点追加後／最終目的地指定後／
 * 計算完了後／Googleマップ分割ナビ表示中）のどの段階からでも、確認ダイアログを
 * 経て安全に「作成中のルート」だけを初期化できることを確認する。
 * 訪問記録・スタンプ・保存済みルート等の永続データは一切消えないことも確認する。
 */

const ST_A = 'mne-19038'; // 季の里天栄
const ST_B = 'mne-19029'; // たまかわ
const COORDS: Record<string, [number, number]> = {
  [ST_A]: [37.2436603, 140.2447857],
  [ST_B]: [37.2228324, 140.4181372],
};

async function closeBanners(page: Page) {
  const banner = page.getByTestId('a2hs-banner');
  if (await banner.isVisible().catch(() => false)) await page.getByTestId('a2hs-close').click();
  const legend = page.getByTestId('legend-panel');
  if (await legend.isVisible().catch(() => false)) await page.getByTestId('legend-toggle').click();
}

/**
 * route-select-bar（今回↻ やり直すボタンを追加）が対象マーカーと重なっている場合、
 * 重ならなくなるまでE2E専用フック(__panMapBy)で地図を上へずらす
 * （manual-route.spec.tsのavoidSelectBarOverlapと同じ対策）。
 */
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

async function enterManualSelect(page: Page) {
  await page.getByTestId('tab-route').click();
  await expect(page.getByTestId('course-mode-auto')).toBeVisible();
  await page.getByTestId('course-mode-manual').click();
  await expect(page.getByTestId('route-select-bar')).toBeVisible();
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

async function mockGeocode(page: Page, lat: number, lng: number, title: string) {
  await page.route('**msearch.gsi.go.jp/address-search/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ geometry: { coordinates: [lng, lat] }, properties: { title } }]),
    }),
  );
}

/** リセット後、方式選択画面へ戻っており、下書きが残っていないことを共通確認する */
async function expectResetToChooseScreen(page: Page) {
  await expect(page.getByTestId('course-mode-auto')).toBeVisible();
  await expect(page.getByTestId('course-mode-manual')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('dialog', { name: '前回の続きがあります' })).toHaveCount(0);
}

test.describe('↻ 最初からやり直す（逃げ道）', () => {
  test.use({ serviceWorkers: 'block' });

  test('CASE A: 道の駅を複数選択した途中からでもリセットできる（地図バーの↻ やり直す）', async ({ page }) => {
    test.setTimeout(90000);
    await page.route('**router.project-osrm.org/**', (route) => route.abort());
    await page.goto('/');
    await closeBanners(page);
    await enterManualSelect(page);
    await tapStation(page, ST_A);
    await tapStation(page, ST_B);
    await expect(page.getByTestId('route-select-count')).toContainText('2駅選択中');

    // 地図バーの3ボタンが横幅内に収まっている（重なり・はみ出しが無い）ことを確認
    const barBox = (await page.getByTestId('route-select-bar').boundingBox())!;
    const restartBox = (await page.getByTestId('route-select-restart').boundingBox())!;
    expect(restartBox.x).toBeGreaterThanOrEqual(barBox.x);
    expect(restartBox.x + restartBox.width).toBeLessThanOrEqual(barBox.x + barBox.width + 1);

    await page.getByTestId('route-select-restart').click();
    await expect(page.getByRole('dialog', { name: '最初から作り直しますか？' })).toBeVisible();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('route-action-toast')).toContainText('訪問記録は残っています');
    await expectResetToChooseScreen(page);
  });

  test('CASE B/C/D: POI・自由地点・最終目的地を追加した後の設定画面からもリセットできる', async ({ page }) => {
    test.setTimeout(120000);
    await page.route('**router.project-osrm.org/**', (route) => route.abort());
    await mockGeocode(page, 38.24, 140.34, 'testhotel');
    await page.goto('/');
    await closeBanners(page);
    await enterManualSelect(page);
    await tapStation(page, ST_A);
    await tapStation(page, ST_B);

    // 自由地点も追加しておく（CASE C相当）
    await page.getByTestId('route-select-show-list').click();
    await page.getByTestId('route-select-add-custom').click();
    await page.getByTestId('custom-stop-address').fill('山形県山形市testtown1-2-3');
    await page.getByTestId('custom-stop-search').click();
    await expect(page.getByTestId('custom-stop-resolved')).toBeVisible();
    await page.getByTestId('custom-stop-confirm').click();
    await expect(page.getByTestId('route-select-row')).toHaveCount(3, { timeout: 15000 });
    await page.getByTestId('route-select-sheet-close').click();

    await page.getByTestId('route-select-create').click();
    await pickOriginStation(page, ST_A);
    await page.getByTestId('budget-unlimited').click();

    // 最終目的地も指定しておく（CASE D相当）
    await page.getByTestId('end-mode-custom').click();
    await page.getByTestId('custom-stop-address').fill('福島県福島市testtown9-9-9');
    await page.getByTestId('custom-stop-search').click();
    await expect(page.getByTestId('custom-stop-resolved')).toBeVisible();
    await page.getByTestId('custom-stop-confirm').click();
    await expect(page.getByTestId('final-destination-summary')).toBeVisible();

    // 主CTA(このコースで作成)より下にあるが、探さないと見つからない場所ではない
    await expect(page.getByTestId('manual-request-restart')).toBeVisible();
    await page.getByTestId('manual-request-restart').click();
    await expect(page.getByRole('dialog', { name: '最初から作り直しますか？' })).toBeVisible();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('route-action-toast')).toContainText('訪問記録は残っています');
    await expectResetToChooseScreen(page);
  });

  test('CASE E/F: ルート計算完了後・Googleマップ分割ナビ表示中でも既存の「最初からやり直す」でリセットできる', async ({ page }) => {
    test.setTimeout(90000);
    await page.route('**router.project-osrm.org/**', (route) => route.abort());
    await page.goto('/');
    await closeBanners(page);
    await enterManualSelect(page);
    await tapStation(page, ST_A);
    await tapStation(page, ST_B);
    await page.getByTestId('route-select-create').click();
    await pickOriginStation(page, ST_A);
    await page.getByTestId('manual-submit').click();
    await advanceToRouteDetail(page);

    // Googleマップ分割ナビ（案内）を開いた状態でもボタンは引き続き操作できる
    await page.getByTestId('gmaps-open').click();
    await expect(page.getByTestId('gmaps-confirm')).toBeVisible();

    await page.getByTestId('route-restart').click();
    await expect(page.getByRole('dialog', { name: '最初から作り直しますか？' })).toBeVisible();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('route-action-toast')).toContainText('訪問記録は残っています');
    await expectResetToChooseScreen(page);
  });

  test('CANCEL: 確認ダイアログでキャンセルすると、作成中のルートは完全に維持される', async ({ page }) => {
    test.setTimeout(90000);
    await page.route('**router.project-osrm.org/**', (route) => route.abort());
    await page.goto('/');
    await closeBanners(page);
    await enterManualSelect(page);
    await tapStation(page, ST_A);
    await tapStation(page, ST_B);
    await expect(page.getByTestId('route-select-count')).toContainText('2駅選択中');

    await page.getByTestId('route-select-restart').click();
    await expect(page.getByRole('dialog', { name: '最初から作り直しますか？' })).toBeVisible();
    await page.getByTestId('confirm-cancel').click();

    // ダイアログが閉じ、選択状態がそのまま残っている
    await expect(page.getByRole('dialog', { name: '最初から作り直しますか？' })).toHaveCount(0);
    await expect(page.getByTestId('route-select-count')).toContainText('2駅選択中');
    await expect(page.getByTestId('route-select-bar')).toBeVisible();
  });

  test('訪問記録・スタンプ・保存済みルートは「最初からやり直す」で消えない', async ({ page }) => {
    test.setTimeout(120000);
    await page.route('**router.project-osrm.org/**', (route) => route.abort());
    await page.goto('/');
    await closeBanners(page);

    // 先に1件保存済みルートと1件の訪問記録を作っておく
    await page.getByTestId('tab-route').click();
    await page.getByTestId('course-mode-auto').click();
    await page.getByRole('button', { name: '道の駅から' }).click();
    await page.getByLabel('出発する道の駅').selectOption(ST_A);
    await page.getByTestId('plan-submit').click();
    await expect(page.getByTestId('route-card-max')).toBeVisible({ timeout: 20000 });
    await page.getByTestId('route-card-max').click();
    await page.getByTestId('route-save').click();
    await expect(page.getByTestId('route-saved')).toBeVisible();
    await page.getByTestId('trip-start').click();
    if (await page.getByTestId('trip-arrived').isVisible().catch(() => false)) {
      await page.getByTestId('trip-arrived').click();
    }
    const visitedBefore = await page.getByTestId('stats-visited').textContent();
    expect(visitedBefore).not.toContain('0／1237駅');
    const finishBtn = page.getByTestId('trip-finish-btn').first();
    await finishBtn.click();
    await page.getByTestId('trip-apply').click();

    // 新しく別のルート作成を始め、途中でリセット
    await page.getByTestId('tab-route').click();
    await page.getByTestId('course-mode-manual').click();
    await tapStation(page, ST_B);
    await expect(page.getByTestId('route-select-count')).toContainText('1駅選択中');
    await page.getByTestId('route-select-restart').click();
    await page.getByTestId('confirm-ok').click();

    // 訪問記録・保存済みルートは維持されている
    await expect(page.getByTestId('stats-visited')).toHaveText(visitedBefore!);
    await page.getByTestId('tab-records').click();
    await expect(page.getByTestId('saved-route')).toHaveCount(1);
  });
});
