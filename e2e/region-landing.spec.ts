import { expect, test, type Page } from '@playwright/test';
import stationsRaw from '../src/data/stations.json' with { type: 'json' };
import { AREA_SELECTION_KEY, useNationwideSelection } from './helpers';

/**
 * 公開前UX整理: 初回起動を全国地図ではなく「どこを旅しますか？」の地域選択にする。
 *
 * 全国1,237施設をいきなり地図に出すと初見では情報量が多すぎるため、初回（地域未選択）
 * のみ地域選択を入口にし、一度選んだら次回は前回の状態から再開する。
 * 既存の複数都道府県選択・訪問記録・保存ルートは一切変更しない。
 */

const OPEN_STATIONS = (
  stationsRaw as { stations: { id: string; name: string; pref: string; status: string }[] }
).stations.filter((s) => s.status === 'open');

const HOKKAIDO = OPEN_STATIONS.find((s) => s.pref === '北海道')!;
const AOMORI = OPEN_STATIONS.find((s) => s.pref === '青森県')!;
const FUKUSHIMA = OPEN_STATIONS.find((s) => s.pref === '福島県')!;

/** 地図上に該当駅のマーカーが出ているか（＝その駅が表示対象に含まれているか） */
function marker(page: Page, id: string) {
  return page.locator(`[data-sid="${id}"]`);
}

async function closeBanners(page: Page) {
  const banner = page.getByTestId('a2hs-banner');
  if (await banner.isVisible().catch(() => false)) await page.getByTestId('a2hs-close').click();
  const legend = page.getByTestId('legend-panel');
  if (await legend.isVisible().catch(() => false)) await page.getByTestId('legend-toggle').click();
}

test.describe('地域選択（どこを旅しますか？）', () => {
  test.use({ serviceWorkers: 'block' });

  test('CASE 1: 新規状態では地域選択画面が出る（全国地図をいきなり見せない）', async ({ page }) => {
    await page.goto('/');
    const landing = page.getByTestId('region-landing');
    await expect(landing).toBeVisible();
    await expect(landing).toContainText('どこを旅しますか？');
    // 10地方ブロックがタップしやすいカードで並ぶ
    for (const area of ['北海道', '東北', '関東', '北陸', '中部', '近畿', '中国', '四国', '九州', '沖縄']) {
      await expect(page.getByTestId(`region-card-${area}`)).toBeVisible();
    }
    // 「都道府県から選ぶ」と「全国を見る」も用意されている
    await expect(page.getByTestId('region-landing-prefecture-toggle')).toBeVisible();
    await expect(page.getByTestId('region-landing-nationwide')).toBeVisible();
    // 初回は「変更せずに戻る」は出ない（まだ選んでいないため戻り先がない）
    await expect(page.getByTestId('region-landing-cancel')).toHaveCount(0);
    // カードは実機で押しやすいサイズ（44px以上）
    const box = await page.getByTestId('region-card-東北').boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('CASE 2: 東北を選ぶと東北の道の駅だけが地図に出る', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('region-card-東北').click();
    await expect(page.getByTestId('region-landing')).toHaveCount(0);
    await expect(marker(page, AOMORI.id)).toHaveCount(1, { timeout: 15000 });
    await expect(marker(page, HOKKAIDO.id)).toHaveCount(0);
    // 既存の絞り込み状態（都道府県フィルター）と整合している
    await expect(page.getByTestId('filters-toggle')).toContainText('青森県');
    await expect(page.getByTestId('btn-change-region')).toContainText('東北');
  });

  test('CASE 3: 都道府県から選ぶ→福島県だけにできる（既存の47県選択UIを利用）', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('region-landing-prefecture-toggle').click();
    await expect(page.getByTestId('region-prefecture-groups')).toBeVisible();
    // 47県すべてが個別に選べる
    await expect(page.locator('[data-testid^="region-pref-"]')).toHaveCount(47);
    // 未選択のうちは確定できない
    await expect(page.getByTestId('region-landing-prefecture-confirm')).toBeDisabled();
    await page.getByTestId('region-pref-福島県').click();
    await page.getByTestId('region-landing-prefecture-confirm').click();
    await expect(page.getByTestId('region-landing')).toHaveCount(0);
    await expect(marker(page, FUKUSHIMA.id)).toHaveCount(1, { timeout: 15000 });
    await expect(marker(page, AOMORI.id)).toHaveCount(0);
    await expect(marker(page, HOKKAIDO.id)).toHaveCount(0);
  });

  test('CASE 4: 全国を見るを選ぶと全国が表示される', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('region-landing-nationwide').click();
    await expect(page.getByTestId('region-landing')).toHaveCount(0);
    await expect(marker(page, HOKKAIDO.id)).toHaveCount(1, { timeout: 15000 });
    await expect(marker(page, AOMORI.id)).toHaveCount(1);
    await expect(page.getByTestId('btn-change-region')).toContainText('全国');
  });

  test('CASE 5: 選択後にリロードすると地域選択画面を出さず前回状態から再開する', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('region-card-東北').click();
    await expect(marker(page, AOMORI.id)).toHaveCount(1, { timeout: 15000 });

    await page.reload();
    await expect(page.getByTestId('region-landing')).toHaveCount(0);
    await expect(marker(page, AOMORI.id)).toHaveCount(1, { timeout: 15000 });
    await expect(marker(page, HOKKAIDO.id)).toHaveCount(0);
    const saved = await page.evaluate((k) => localStorage.getItem(k), AREA_SELECTION_KEY);
    expect(saved ?? '').toContain('青森県');
  });

  test('CASE 6: 既存ユーザーの訪問済み・行きたい・スタンプ・保存ルートは地域選択で消えない', async ({ page }) => {
    await page.addInitScript(
      ([visitsKey, routesKey, ids]) => {
        const at = '2026-01-01T00:00:00.000Z';
        localStorage.setItem(
          visitsKey as string,
          JSON.stringify({
            [ids[0]]: { state: 'stamped', visitedAt: at, wishlistAt: null, stampAt: at, updatedAt: at },
            [ids[1]]: { state: 'wishlist', visitedAt: null, wishlistAt: at, stampAt: null, updatedAt: at },
            [ids[2]]: { state: 'visited', visitedAt: at, wishlistAt: null, stampAt: null, updatedAt: at },
          }),
        );
        localStorage.setItem(
          routesKey as string,
          JSON.stringify([
            { id: 'saved-1', name: '保存ルート', createdAt: at, done: false, route: { stops: [], legs: [] } },
          ]),
        );
      },
      ['tohoku-me:visits:v2', 'tohoku-me:routes:v1', [AOMORI.id, FUKUSHIMA.id, HOKKAIDO.id]] as const,
    );
    await page.goto('/');
    // 既存ユーザーでも（地域未選択なら）入口は地域選択
    await expect(page.getByTestId('region-landing')).toBeVisible();
    await page.getByTestId('region-card-東北').click();
    await expect(page.getByTestId('region-landing')).toHaveCount(0);

    const visits = await page.evaluate(() => localStorage.getItem('tohoku-me:visits:v2'));
    expect(visits ?? '').toContain('stamped');
    expect(visits ?? '').toContain('wishlist');
    expect(visits ?? '').toContain('visited');
    const routes = await page.evaluate(() => localStorage.getItem('tohoku-me:routes:v1'));
    expect(routes ?? '').toContain('saved-1');
  });

  test('CASE 7: 地図からいつでも地域選択へ戻れる（変更せずに戻ることもできる）', async ({ page }) => {
    await useNationwideSelection(page);
    await page.goto('/');
    await expect(page.getByTestId('region-landing')).toHaveCount(0);
    await closeBanners(page);

    await page.getByTestId('btn-change-region').click();
    await expect(page.getByTestId('region-landing')).toBeVisible();
    // 選び直さずに戻れる
    await page.getByTestId('region-landing-cancel').click();
    await expect(page.getByTestId('region-landing')).toHaveCount(0);
    await expect(marker(page, HOKKAIDO.id)).toHaveCount(1, { timeout: 15000 });

    // 改めて地域を変更すると地図の表示範囲も切り替わる
    await page.getByTestId('btn-change-region').click();
    await page.getByTestId('region-card-東北').click();
    await expect(marker(page, AOMORI.id)).toHaveCount(1, { timeout: 15000 });
    await expect(marker(page, HOKKAIDO.id)).toHaveCount(0);
  });

  test('駅への共有リンク(#station=...)で開いたときは地域選択画面で邪魔しない', async ({ page }) => {
    await page.goto(`/#station=${AOMORI.id}`);
    await expect(page.getByTestId('region-landing')).toHaveCount(0);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
  });
});
