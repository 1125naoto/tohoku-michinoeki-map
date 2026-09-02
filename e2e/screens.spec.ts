import { expect, test } from '@playwright/test';

/**
 * 実画面検証（仕様§19）: 各ビューポートでスクリーンショットを取得し、
 * 横スクロールなど機械的に検出できるレイアウト問題を検証する。
 * スクリーンショットは e2e/screenshots/ に保存（目視確認用・gitignore対象）。
 */

const shot = (page: import('@playwright/test').Page, name: string, project: string) =>
  page.screenshot({ path: `e2e/screenshots/${project}-${name}.png`, fullPage: false });

async function noHorizontalScroll(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test('主要画面のスクリーンショット @smoke', async ({ page }, testInfo) => {
  const p = testInfo.project.name;

  // 1. 地図初期表示（訪問0件）
  await page.goto('/');
  await page.waitForSelector('.leaflet-tile-loaded', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);
  await shot(page, '01-map', p);
  await noHorizontalScroll(page);

  // 2. ピン密集地域（拡大: 仙台近郊）+ 地図拡大縮小
  await page.getByTestId('chip-宮城県').click();
  await page.waitForTimeout(1200);
  await shot(page, '02-cluster-miyagi', p);

  // 3. 詳細カード
  await page.goto('/#station=mne-18900');
  await expect(page.getByTestId('station-sheet')).toBeVisible();
  await shot(page, '03-station-sheet', p);
  await noHorizontalScroll(page);

  // 4. 長い駅名
  await page.goto('/#station=mne-19890');
  await expect(page.getByTestId('station-sheet')).toBeVisible();
  await shot(page, '04-long-name', p);
  await noHorizontalScroll(page);

  // 5. ルート条件入力
  await page.goto('/');
  await page.getByTestId('tab-route').click();
  await shot(page, '05-planner-form', p);
  await noHorizontalScroll(page);

  // 6. ルート結果
  await page.getByRole('button', { name: '道の駅から' }).click();
  await page.getByLabel('出発する道の駅').selectOption('mne-18900');
  await page.getByTestId('plan-submit').click();
  await expect(page.getByTestId('route-card-max')).toBeVisible({ timeout: 20000 });
  await shot(page, '06-route-results', p);
  await page.getByTestId('route-card-max').click();
  await expect(page.getByTestId('route-detail')).toBeVisible();
  await shot(page, '07-route-detail', p);
  await noHorizontalScroll(page);

  // 7. 旅行中画面
  await page.getByTestId('trip-start').click();
  await expect(page.getByTestId('trip-view')).toBeVisible();
  await shot(page, '08-trip', p);
  await noHorizontalScroll(page);

  // 8. 達成率100%
  const ids = await page.evaluate(() => (window as unknown as { __stationIds?: string[] }).__stationIds);
  await page.evaluate(
    ([idList]) => {
      const now = new Date().toISOString();
      const map: Record<string, unknown> = {};
      for (const id of idList as string[]) {
        map[id] = { status: 'visited', visitedAt: now, stamp: true, stampAt: now, updatedAt: now };
      }
      localStorage.setItem('tohoku-me:visits:v1', JSON.stringify(map));
      localStorage.removeItem('tohoku-me:trip:v1');
    },
    [ids] as const,
  );
  await page.reload();
  await expect(page.getByTestId('stats-percent')).toContainText('100％');
  await page.waitForTimeout(800);
  await shot(page, '09-complete-100', p);

  // 9. オフライン状態
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.getByTestId('offline-banner')).toBeVisible();
  await shot(page, '10-offline', p);
  await noHorizontalScroll(page);
});
