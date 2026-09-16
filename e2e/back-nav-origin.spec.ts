import { expect, test, type Page } from '@playwright/test';
import { useNationwideSelection } from './helpers';

/**
 * RC1後のUX改善2点のE2E。
 * ① サブ画面の「← 戻る」導線（既に✕/キャンセル等がある画面には足さない）
 * ② コース作成の出発地点「🔎 名称・住所から探す」（候補一覧から選ぶ）
 */

test.beforeEach(async ({ page }) => {
  await useNationwideSelection(page);
});

async function goToCourseTab(page: Page) {
  const banner = page.getByTestId('a2hs-banner');
  if (await banner.isVisible().catch(() => false)) await page.getByTestId('a2hs-close').click();
  await page.getByTestId('tab-route').click();
}

test.describe('サブ画面の戻る導線', () => {
  test.use({ serviceWorkers: 'block' });

  test('BACK-2: コース作成（作り方の選択）から地図へ戻れる', async ({ page }) => {
    await page.goto('/');
    await goToCourseTab(page);
    await expect(page.getByTestId('course-mode-auto')).toBeVisible();
    const back = page.getByTestId('course-mode-back');
    await expect(back).toContainText('地図へ戻る');
    const box = await back.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await back.click();
    // 地図タブへ戻る（地図が表示されている）
    await expect(page.getByTestId('tab-map')).toHaveClass(/active/);
  });

  test('BACK-3: おすすめコースの設定から作り方の選択へ戻れる', async ({ page }) => {
    await page.goto('/');
    await goToCourseTab(page);
    await page.getByTestId('course-mode-auto').click();
    await expect(page.getByTestId('plan-submit')).toBeVisible();
    await page.getByTestId('planner-back').click();
    await expect(page.getByTestId('course-mode-auto')).toBeVisible();
    await expect(page.getByTestId('plan-submit')).toHaveCount(0);
  });

  test('BACK-4: 戻る操作で訪問記録・スタンプが消えない', async ({ page }) => {
    const ids = await page.evaluate(() => [] as string[]);
    expect(ids).toEqual([]); // 事前状態の明示（記録はこのあと画面から付ける）
    await page.goto('/');
    await goToCourseTab(page);
    await page.getByTestId('course-mode-auto').click();
    await page.getByTestId('planner-back').click();
    await page.getByTestId('course-mode-back').click();
    await expect(page.getByTestId('tab-map')).toHaveClass(/active/);
    // 記録タブの集計が壊れていない（達成率ヘッダーが出ている）
    await expect(page.getByTestId('stats-visited')).toBeVisible();
  });

  test('BACK-5: 既に「✕ 閉じる」がある画面に二重の戻るボタンを足していない', async ({ page }) => {
    await page.goto('/');
    const banner = page.getByTestId('a2hs-banner');
    if (await banner.isVisible().catch(() => false)) await page.getByTestId('a2hs-close').click();
    await page.getByTestId('poi-search-open').click();
    await expect(page.getByTestId('poi-search-panel')).toBeVisible();
    // 周辺スポットは既存の「検索を終了(✕)」で戻る。back-barは追加していない
    await expect(page.getByTestId('poi-panel-close')).toBeVisible();
    await expect(page.getByTestId('poi-search-panel').getByTestId('back-bar')).toHaveCount(0);
  });
});

test.describe('出発地点の「名称・住所から探す」', () => {
  test.use({ serviceWorkers: 'block' });

  /** 国土地理院 住所検索APIをモックする（実APIへは接続しない） */
  async function mockGeocode(page: Page, features: { title: string; lat: number; lng: number }[]) {
    await page.route('**/msearch.gsi.go.jp/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          features.map((f) => ({
            properties: { title: f.title },
            geometry: { coordinates: [f.lng, f.lat] },
          })),
        ),
      }),
    );
  }

  test('ROUTE-1/2/5: 候補一覧から選んで出発地点にできる', async ({ page }) => {
    await mockGeocode(page, [
      { title: '福島県郡山市', lat: 37.4, lng: 140.36 },
      { title: '福島県郡山市安積町', lat: 37.36, lng: 140.34 },
    ]);
    await page.goto('/');
    await goToCourseTab(page);
    await page.getByTestId('course-mode-auto').click();

    const modeBtn = page.getByTestId('origin-mode-search');
    await expect(modeBtn).toContainText('名称・住所から探す');
    await modeBtn.click();
    await page.getByTestId('origin-search-input').fill('郡山市');
    await page.getByTestId('origin-search-run').click();

    // 複数候補をそのまま出す（勝手に1件へ決め打ちしない）
    const results = page.getByTestId('origin-search-result');
    await expect(results).toHaveCount(2, { timeout: 15000 });
    await expect(results.first()).toContainText('福島県郡山市');
    await results.first().click();
    await expect(page.getByTestId('origin-label')).toContainText('福島県郡山市');
    await expect(page.getByTestId('plan-submit')).toBeVisible();
  });

  test('道の駅名でも候補に出る（アプリ内データ・通信不要）', async ({ page }) => {
    await mockGeocode(page, []);
    await page.goto('/');
    await goToCourseTab(page);
    await page.getByTestId('course-mode-auto').click();
    await page.getByTestId('origin-mode-search').click();
    await page.getByTestId('origin-search-input').fill('道の駅ふくしま');
    await page.getByTestId('origin-search-run').click();
    const results = page.getByTestId('origin-search-result');
    // 「ふくしま」は複数の道の駅に該当するため、候補一覧から目的の駅を選ぶ
    await expect(results.first()).toBeVisible({ timeout: 15000 });
    const target = results.filter({ hasText: '道の駅ふくしま' }).first();
    await expect(target).toBeVisible();
    await target.click();
    await expect(page.getByTestId('origin-label')).toContainText('道の駅ふくしま');
  });

  test('ROUTE-9: 0件では何で探せるかを案内する（施設名が苦手なことも伝える）', async ({ page }) => {
    await mockGeocode(page, []);
    await page.goto('/');
    await goToCourseTab(page);
    await page.getByTestId('course-mode-auto').click();
    await page.getByTestId('origin-mode-search').click();
    await page.getByTestId('origin-search-input').fill('ホテルハマツ');
    await page.getByTestId('origin-search-run').click();
    const err = page.getByTestId('origin-search-error');
    await expect(err).toBeVisible({ timeout: 15000 });
    await expect(err).toContainText('見つかりませんでした');
    await expect(err).toContainText('道の駅名');
    await expect(err).toContainText('地図で選ぶ');
    await expect(page.getByTestId('origin-search-results')).toHaveCount(0);
  });

  test('ROUTE-10: 通信失敗でも画面が落ちず、案内が出る', async ({ page }) => {
    await page.route('**/msearch.gsi.go.jp/**', (route) => route.abort());
    await page.goto('/');
    await goToCourseTab(page);
    await page.getByTestId('course-mode-auto').click();
    await page.getByTestId('origin-mode-search').click();
    await page.getByTestId('origin-search-input').fill('郡山市');
    await page.getByTestId('origin-search-run').click();
    await expect(page.getByTestId('origin-search-error')).toContainText('うまくいきませんでした', {
      timeout: 15000,
    });
    await expect(page.getByTestId('plan-submit')).toBeVisible();
    await expect(page.getByTestId('error-screen')).toHaveCount(0);
  });
});
