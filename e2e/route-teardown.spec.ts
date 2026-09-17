import { expect, test, type Page } from '@playwright/test';
import { useSelectedPrefectures } from './helpers';

/**
 * 公開前UX整理で初回起動に地域選択画面（「どこを旅しますか？」）を追加したため、
 * 全国地図を前提にした既存シナリオでは「全国を見る」選択済みの状態から開始する。
 */
test.beforeEach(async ({ page }) => {
  // 全国1,237件を描画したまま地図操作を繰り返すとテスト1件の描画コストが大きく、
  // 混雑時に60秒のテスト予算を使い切っていた（製品側の不具合ではない）。
  // 対象駅は青森県・福島県のみ（66駅）なので、検証内容を変えずに表示範囲を絞る。
  await useSelectedPrefectures(page, ['青森県', '福島県']);
});

/**
 * ルートの取り消し・作り直し・旅行終了・保存済みコース削除のE2Eシナリオ
 * （ナミさん完成Ver v1.0.1）。OSRM公開デモへの負荷を抑えるため、実道路時間の
 * 検証が主目的でないテストではrouter.project-osrm.orgへの通信を中断し、
 * 概算フォールバックで決定的に検証する。
 */

const STATION_ID = 'mne-18900'; // しちのへ
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

async function tapStation(page: Page, id: string) {
  const coord = COORDS[id];
  if (coord) {
    // __setMapView is defined を待つ (Phase 10 hardening)
    await page.waitForFunction(() => typeof (window as unknown as { __setMapView?: unknown }).__setMapView === 'function', { timeout: 20000 });
    await page.evaluate(
      ([lat, lng]) => (window as unknown as { __setMapView: (a: number, b: number, c: number) => void }).__setMapView(lat, lng, 12),
      coord,
    );
    await page.waitForTimeout(300);
  }
  await page.locator(`[data-sid="${id}"]`).click();
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

test.describe('コースの取り消し・作り直し（おすすめコース）', () => {
  test('このコースを取り消す→地図の線・番号・結果が消え、方式選択画面へ戻る', async ({ page }) => {
    await page.route('**router.project-osrm.org/**', (route) => route.abort());
    await page.goto('/');
    await closeBanners(page);
    await page.getByTestId('tab-route').click();
    await page.getByTestId('course-mode-auto').click();
    await page.getByRole('button', { name: '道の駅から' }).click();
    await page.getByLabel('出発する道の駅').selectOption(STATION_ID);
    await page.getByTestId('plan-submit').click();
    await expect(page.getByTestId('route-card-max')).toBeVisible({ timeout: 20000 });
    await page.getByTestId('route-card-max').click();
    await expect(page.getByTestId('route-detail')).toBeVisible();

    // 地図で順番を見る→ルート線・番号マーカーが地図上に出る
    await page.getByTestId('route-preview').click();
    await expect(page.getByTestId('map-root')).toBeVisible();
    await expect(page.locator('.leaflet-pane .leaflet-overlay-pane path')).toHaveCount(1, { timeout: 10000 });
    await expect(page.locator('.order-pin').first()).toBeVisible();

    // 地図上の「このコースを取り消す」から取り消せる
    await page.getByTestId('map-route-discard').click();
    await expect(page.getByRole('dialog', { name: 'コースを取り消しますか？' })).toBeVisible();
    await page.getByTestId('confirm-ok').click();

    // トースト表示・地図上の線と番号が消える・コース方式選択画面へ戻る
    await expect(page.getByTestId('route-action-toast')).toContainText('コースを取り消しました。訪問記録は残っています');
    await expect(page.locator('.order-pin')).toHaveCount(0);
    await expect(page.locator('.leaflet-pane .leaflet-overlay-pane path')).toHaveCount(0);
    await page.getByTestId('tab-route').click();
    await expect(page.getByTestId('course-mode-auto')).toBeVisible();
    await expect(page.getByTestId('course-mode-manual')).toBeVisible();
  });

  test('最初から作り直す→結果一覧画面から方式選択画面へ戻る', async ({ page }) => {
    await page.route('**router.project-osrm.org/**', (route) => route.abort());
    await page.goto('/');
    await closeBanners(page);
    await page.getByTestId('tab-route').click();
    await page.getByTestId('course-mode-auto').click();
    await page.getByRole('button', { name: '道の駅から' }).click();
    await page.getByLabel('出発する道の駅').selectOption(STATION_ID);
    await page.getByTestId('plan-submit').click();
    await expect(page.getByTestId('route-card-max')).toBeVisible({ timeout: 20000 });

    await page.getByTestId('route-restart').click();
    await expect(page.getByRole('dialog', { name: '最初から作り直しますか？' })).toBeVisible();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('route-action-toast')).toContainText('最初から作り直します。訪問記録は残っています');
    await expect(page.getByTestId('course-mode-auto')).toBeVisible();
  });
});

test.describe('コースの取り消し（地図から選ぶ）', () => {
  test('取り消し後、再読み込みしても選択中の下書きが復活しない', async ({ page }) => {
    await page.route('**router.project-osrm.org/**', (route) => route.abort());
    await page.goto('/');
    await closeBanners(page);
    await page.getByTestId('tab-route').click();
    await page.getByTestId('course-mode-manual').click();
    await expect(page.getByTestId('route-select-bar')).toBeVisible();
    await tapStation(page, ST_A);
    await tapStation(page, ST_B);
    await expect(page.getByTestId('route-select-count')).toContainText('2駅選択中');

    await page.getByTestId('route-select-create').click();
    await page.getByRole('button', { name: '道の駅から', exact: true }).click();
    await page.getByLabel('出発する道の駅').selectOption(ST_A);
    await page.getByTestId('manual-submit').click();
    await advanceToRouteDetail(page);

    await page.getByTestId('route-discard').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('course-mode-auto')).toBeVisible();

    // 再読み込みしても「前回の続きがあります」ダイアログが出ない = 下書きが残っていない
    await page.reload();
    await expect(page.getByRole('dialog', { name: '前回の続きがあります' })).toHaveCount(0);
  });
});

test.describe('旅行の終了', () => {
  test('この旅行を終了→訪問記録は残り、進行状況と地図上のルートは終了する', async ({ page }) => {
    await page.route('**router.project-osrm.org/**', (route) => route.abort());
    await page.goto('/');
    await closeBanners(page);
    await page.getByTestId('tab-route').click();
    await page.getByTestId('course-mode-manual').click();
    await tapStation(page, ST_A);
    await tapStation(page, ST_B);
    await page.getByTestId('route-select-create').click();
    await page.getByRole('button', { name: '道の駅から', exact: true }).click();
    await page.getByLabel('出発する道の駅').selectOption(ST_A);
    await page.getByTestId('manual-submit').click();
    await advanceToRouteDetail(page);

    await page.getByTestId('trip-start').click();
    await expect(page.getByTestId('trip-view')).toBeVisible();
    // 到着操作で1駅分の訪問記録を作る
    if (await page.getByTestId('trip-arrived').isVisible().catch(() => false)) {
      await page.getByTestId('trip-arrived').click();
    }
    await expect(page.getByTestId('stats-visited')).toContainText('1／1237駅');

    await page.getByTestId('trip-end-now').click();
    await expect(page.getByRole('dialog', { name: '旅行を終了しますか？' })).toBeVisible();
    await page.getByTestId('confirm-ok').click();

    await expect(page.getByTestId('route-action-toast')).toContainText('旅行を終了しました。訪問記録・スタンプ記録は残っています');
    // 訪問記録は維持される
    await expect(page.getByTestId('stats-visited')).toContainText('1／1237駅');
    // 旅行中状態が終了し、通常のコース作成方式選択画面に戻る
    await page.getByTestId('tab-route').click();
    await expect(page.getByTestId('course-mode-auto')).toBeVisible();
  });
});

test.describe('保存済みコースの削除', () => {
  test('削除すると一覧から消え、再読み込み後も復活しない。訪問記録は消えない', async ({ page }) => {
    await page.route('**router.project-osrm.org/**', (route) => route.abort());
    await page.goto('/');
    await closeBanners(page);
    await page.getByTestId('tab-route').click();
    await page.getByTestId('course-mode-auto').click();
    await page.getByRole('button', { name: '道の駅から' }).click();
    await page.getByLabel('出発する道の駅').selectOption(STATION_ID);
    await page.getByTestId('plan-submit').click();
    await expect(page.getByTestId('route-card-max')).toBeVisible({ timeout: 20000 });
    await page.getByTestId('route-card-max').click();
    await page.getByTestId('route-save').click();
    await expect(page.getByTestId('route-saved')).toBeVisible();

    // 別のコースを閲覧中の状態にしておく（削除対象と無関係）ため、いったんコースを取り消す
    await page.getByTestId('route-discard').click();
    await page.getByTestId('confirm-ok').click();

    await page.getByTestId('tab-records').click();
    await expect(page.getByTestId('saved-route')).toHaveCount(1);
    await page.getByTestId('saved-delete').click();
    await expect(page.getByRole('dialog', { name: 'この保存済みコースを削除しますか？' })).toBeVisible();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('saved-route')).toHaveCount(0);

    await page.reload();
    await page.getByTestId('tab-records').click();
    await expect(page.getByTestId('saved-route')).toHaveCount(0);
  });

  test('現在表示中のコースと同じ保存済みコースを削除すると2択ダイアログが出る', async ({ page }) => {
    await page.route('**router.project-osrm.org/**', (route) => route.abort());
    await page.goto('/');
    await closeBanners(page);
    await page.getByTestId('tab-route').click();
    await page.getByTestId('course-mode-auto').click();
    await page.getByRole('button', { name: '道の駅から' }).click();
    await page.getByLabel('出発する道の駅').selectOption(STATION_ID);
    await page.getByTestId('plan-submit').click();
    await expect(page.getByTestId('route-card-max')).toBeVisible({ timeout: 20000 });
    await page.getByTestId('route-card-max').click();
    await page.getByTestId('route-save').click();
    await expect(page.getByTestId('route-saved')).toBeVisible();

    // 保存直後、今表示している結果はまだ「現在表示中のコース」扱いではない
    // （新規作成の結果として表示されているだけ）ため、保存タブから開き直して紐付ける
    await page.getByTestId('tab-records').click();
    await page.getByTestId('saved-open').click();
    await expect(page.getByTestId('viewing-saved-badge')).toBeVisible();

    await page.getByTestId('tab-records').click();
    await page.getByTestId('saved-delete').click();
    await expect(page.getByTestId('delete-active-dialog')).toBeVisible();
    await page.getByTestId('delete-active-and-clear').click();
    await expect(page.getByTestId('saved-route')).toHaveCount(0);
    await expect(page.getByTestId('route-action-toast')).toBeVisible();
  });
});
