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

/**
 * __setMapView後、画面（map-root）中央ピクセルの要素が対象駅のマーカーに実際に
 * 差し替わり終えている（Leafletの非同期アイコン再描画が完了している）ことを待つ
 * （Astra再監査Final Gate: e2e/manual-route.spec.ts の同名関数と同じ根本原因への対処。
 * 固定時間待機だけでは、直前の選択でマーカーアイコンが選択順バッジ付きへ非同期に
 * 差し替わっている途中にクリックが競合し、「element was detached from the DOM」を
 * 起こすことが実測で確認できたため）。
 */
/**
 * 対象マーカーが下部固定バー(.route-select-bar)の領域と重なっている場合、
 * 重ならなくなるまでE2E専用フック(__panMapBy)で地図を上へずらす
 * （e2e/manual-route.spec.ts の同名処理と同じ根本原因への対処）。
 */
async function avoidSelectBarOverlap(page: import('@playwright/test').Page, id: string) {
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

async function waitForCenteredMarkerSettled(page: import('@playwright/test').Page, id: string) {
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

test('主要画面のスクリーンショット @smoke', async ({ page }, testInfo) => {
  // 20画面以上を1テストで連続撮影するうえ、収録駅が約1000件に増えたことで
  // iPhone(WebKit)では1回の撮影・タップにそれぞれ数秒かかるようになったため、
  // 120秒でも足りずテスト全体の制限時間で落ちることがあった（マーカーは正しく
  // クリックできており、hit-target・アサーションはいずれも正常であることを実測で確認済み）。
  // 収録地方が増えるほど撮影対象も重くなるため、実測値に対して余裕を持たせる。
  test.setTimeout(300_000);
  const p = testInfo.project.name;

  // 1. 地図初期表示（訪問0件・初回は凡例+ホーム画面追加案内が表示された状態）
  await page.goto('/');
  await page.waitForSelector('.leaflet-tile-loaded', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);
  await shot(page, '01-map-firstrun-legend', p);
  await noHorizontalScroll(page);
  // 案内・凡例を閉じて通常状態の地図を記録
  if (await page.getByTestId('a2hs-banner').isVisible().catch(() => false)) {
    await page.getByTestId('a2hs-close').click();
  }
  if (await page.getByTestId('legend-panel').isVisible().catch(() => false)) {
    await page.getByTestId('legend-toggle').click();
  }
  await page.waitForTimeout(400);
  await shot(page, '01b-map', p);

  // 2. ピン密集地域（拡大: 仙台近郊）+ 地図拡大縮小
  if (!(await page.getByTestId('chip-宮城県').isVisible().catch(() => false))) {
    await page.getByTestId('filters-toggle').click();
  }
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

  // 5. コース作成方式の選択（おすすめコース／地図から選ぶ）
  await page.goto('/');
  await page.getByTestId('tab-route').click();
  await shot(page, '05-course-mode-picker', p);
  await noHorizontalScroll(page);

  // 5b. ルート条件入力（おすすめコース）
  await page.getByTestId('course-mode-auto').click();
  await shot(page, '05b-planner-form', p);

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

  // 6b. 地図から選ぶ: 選択モード→番号バッジ→選択一覧（このブロックではルート計算まで進めないためOSRM通信は発生しない）
  await page.goto('/');
  if (await page.getByTestId('a2hs-banner').isVisible().catch(() => false)) {
    await page.getByTestId('a2hs-close').click();
  }
  if (await page.getByTestId('legend-panel').isVisible().catch(() => false)) {
    await page.getByTestId('legend-toggle').click();
  }
  await page.getByTestId('tab-route').click();
  await page.getByTestId('course-mode-manual').click();
  await expect(page.getByTestId('route-select-bar')).toBeVisible();
  await shot(page, '06b-manual-select-mode', p);
  const manualStations: [string, number, number][] = [
    ['mne-19038', 37.2436603, 140.2447857],
    ['mne-19029', 37.2228324, 140.4181372],
    ['mne-19033', 37.2505454, 140.5600321],
  ];
  for (const [id, lat, lng] of manualStations) {
    // __setMapView is defined を待つ (Phase 10 hardening)
    await page.waitForFunction(() => typeof (window as unknown as { __setMapView?: unknown }).__setMapView === 'function', { timeout: 20000 });
    await page.evaluate(
      ([la, ln]) => (window as unknown as { __setMapView: (a: number, b: number, c: number) => void }).__setMapView(la as number, ln as number, 12),
      [lat, lng],
    );
    await page.waitForTimeout(250);
    await avoidSelectBarOverlap(page, id);
    await waitForCenteredMarkerSettled(page, id);
    await page.locator(`[data-sid="${id}"]`).click();
  }
  await expect(page.getByTestId('route-select-count')).toContainText('3駅選択中');
  await shot(page, '06c-manual-select-numbered', p);
  await page.getByTestId('route-select-show-list').click();
  await expect(page.getByTestId('route-select-sheet')).toBeVisible();
  await shot(page, '06d-manual-select-list', p);
  await page.getByTestId('route-select-sheet-close').click();
  await page.getByTestId('route-select-create').click();
  await page.getByRole('button', { name: '道の駅から', exact: true }).click();
  await page.getByLabel('出発する道の駅').selectOption('mne-19038');
  await shot(page, '06e-manual-settings', p);
  // 選択途中のまま離れると次回起動時に再開確認ダイアログが出るため、明示的にやめておく
  await page.getByTestId('manual-cancel').click();

  // 7. 旅行中画面
  await page.goto('/'); // コース作成方式の選択状態をリセットして「おすすめコース」へ戻る
  await page.getByTestId('tab-route').click();
  await page.getByTestId('course-mode-auto').click();
  await page.getByRole('button', { name: '道の駅から' }).click();
  await page.getByLabel('出発する道の駅').selectOption('mne-18900');
  await page.getByTestId('plan-submit').click();
  await expect(page.getByTestId('route-card-max')).toBeVisible({ timeout: 20000 });
  await page.getByTestId('route-card-max').click();
  await expect(page.getByTestId('route-detail')).toBeVisible();
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

test('営業状態のスクリーンショット（時刻固定） @smoke', async ({ page }, testInfo) => {
  const p = testInfo.project.name;
  // 営業中（JST 金曜10:00）。先にオーバーレイを閉じてからディープリンクする
  await page.clock.install({ time: new Date('2026-09-04T01:00:00Z') });
  await page.goto('/');
  if (await page.getByTestId('a2hs-banner').isVisible().catch(() => false))
    await page.getByTestId('a2hs-close').click();
  if (await page.getByTestId('legend-panel').isVisible().catch(() => false))
    await page.getByTestId('legend-toggle').click();
  await page.goto('/#station=mne-18900');
  await expect(page.getByTestId('hours-status')).toContainText('営業中');
  await page.waitForTimeout(600);
  await shot(page, '11-hours-open', p);
  // 営業時間の詳細展開
  await page.getByTestId('hours-detail-toggle').click();
  await shot(page, '12-hours-detail', p);

  // まもなく終了（JST 17:30）※同一ハッシュへのgotoはリロードされないためreloadで反映
  await page.clock.setFixedTime(new Date('2026-09-04T08:30:00Z'));
  await page.reload();
  await expect(page.getByTestId('hours-status')).toContainText('まもなく終了');
  await shot(page, '13-hours-closing', p);

  // 営業時間外（JST 23:00）
  await page.clock.setFixedTime(new Date('2026-09-04T14:00:00Z'));
  await page.reload();
  await expect(page.getByTestId('hours-status')).toContainText('営業時間外');
  await shot(page, '14-hours-closed', p);

  // 要確認
  await page.goto('/#station=mne-22686');
  await expect(page.getByTestId('hours-status')).toContainText('要確認');
  await shot(page, '15-hours-unknown', p);

  // 地図全画面モード
  await page.goto('/');
  await page.getByTestId('fullscreen-btn').click();
  await expect(page.getByTestId('fullscreen-exit')).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, '16-map-fullscreen', p);
  // 全画面＋詳細ボトムシート
  await page.goto('/#station=mne-18900');
  await expect(page.getByTestId('station-sheet')).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, '17-fullscreen-sheet', p);
  await page.getByTestId('sheet-x').click();
  await page.getByTestId('fullscreen-exit').click();
});
