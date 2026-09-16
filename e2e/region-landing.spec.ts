import { expect, test, type Page } from '@playwright/test';
import stationsRaw from '../src/data/stations.json' with { type: 'json' };
import { AREA_SELECTION_KEY, useNationwideSelection } from './helpers';

/**
 * 公開前UX整理: 初回起動を全国地図ではなく「どこを旅しますか？」の地域選択にする。
 *
 * Owner実機QAで「東北6県すべてでもピンが多く見づらい」と確認されたため、
 * 地域ブロックを押しただけでは地図へ進まず、「何県を回りますか？」で県を
 * 複数選んでから地図へ進む2段階にしている。
 * 既存の複数都道府県選択・訪問記録・保存ルートは一切変更しない。
 */

const OPEN_STATIONS = (
  stationsRaw as { stations: { id: string; name: string; pref: string; status: string }[] }
).stations.filter((s) => s.status === 'open');

const HOKKAIDO = OPEN_STATIONS.find((s) => s.pref === '北海道')!;
const AOMORI = OPEN_STATIONS.find((s) => s.pref === '青森県')!;
const MIYAGI = OPEN_STATIONS.find((s) => s.pref === '宮城県')!;
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
    for (const area of ['北海道', '東北', '関東', '北陸', '中部', '近畿', '中国', '四国', '九州', '沖縄']) {
      await expect(page.getByTestId(`region-card-${area}`)).toBeVisible();
    }
    await expect(page.getByTestId('region-landing-prefecture-toggle')).toBeVisible();
    await expect(page.getByTestId('region-landing-nationwide')).toBeVisible();
    await expect(page.getByTestId('region-landing-cancel')).toHaveCount(0);
    const box = await page.getByTestId('region-card-東北').boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('CASE 2: 東北をタップしても地図へ行かず「何県を回りますか？」が出る', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('region-card-東北').click();
    // 地図へは進まない（地域選択画面のまま、第2ステップへ）
    await expect(page.getByTestId('region-landing')).toBeVisible();
    await expect(page.getByTestId('region-landing-area-title')).toContainText('何県を回りますか？');
    // この時点では地図へ進んでいない（地域選択画面が地図を覆ったまま）
    await expect(page.locator('.app.region-landing-open')).toHaveCount(1);
    await expect(marker(page, AOMORI.id)).toBeHidden();
    // 県を選ぶまで地図へ進めない
    await expect(page.getByTestId('area-prefecture-confirm')).toBeDisabled();
  });

  test('CASE 3: 東北の県選択画面に青森/岩手/宮城/秋田/山形/福島が既存の並びで出る', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('region-card-東北').click();
    const cards = page.locator('[data-testid^="area-pref-"]');
    await expect(cards).toHaveCount(6);
    await expect(cards).toContainText(['青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県']);
  });

  test('CASE 4: 福島だけ選んで確定すると福島の道の駅だけが出る', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('region-card-東北').click();
    await page.getByTestId('area-pref-福島県').click();
    // 選択中の県が視覚的に分かる
    await expect(page.getByTestId('area-pref-福島県')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('area-prefecture-selected')).toContainText('福島県');
    await page.getByTestId('area-prefecture-confirm').click();

    await expect(page.getByTestId('region-landing')).toHaveCount(0);
    await expect(marker(page, FUKUSHIMA.id)).toHaveCount(1, { timeout: 15000 });
    await expect(marker(page, MIYAGI.id)).toHaveCount(0);
    await expect(marker(page, AOMORI.id)).toHaveCount(0);
    await expect(marker(page, HOKKAIDO.id)).toHaveCount(0);
  });

  test('CASE 5: 福島＋宮城の2県を選ぶとその2県だけが出る', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('region-card-東北').click();
    await page.getByTestId('area-pref-福島県').click();
    await page.getByTestId('area-pref-宮城県').click();
    await expect(page.getByTestId('area-prefecture-selected')).toContainText('2県');
    await expect(page.getByTestId('area-prefecture-confirm')).toContainText('この2県で地図を見る');
    await page.getByTestId('area-prefecture-confirm').click();

    await expect(marker(page, FUKUSHIMA.id)).toHaveCount(1, { timeout: 15000 });
    await expect(marker(page, MIYAGI.id)).toHaveCount(1);
    await expect(marker(page, AOMORI.id)).toHaveCount(0);
    await expect(marker(page, HOKKAIDO.id)).toHaveCount(0);
  });

  test('CASE 6: 「東北すべてを見る」を押したときだけ東北6県が出る', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('region-card-東北').click();
    await page.getByTestId('area-select-all').click();

    await expect(page.getByTestId('region-landing')).toHaveCount(0);
    await expect(marker(page, AOMORI.id)).toHaveCount(1, { timeout: 15000 });
    await expect(marker(page, FUKUSHIMA.id)).toHaveCount(1);
    await expect(marker(page, HOKKAIDO.id)).toHaveCount(0);
    await expect(page.getByTestId('btn-change-region')).toContainText('東北');
  });

  test('CASE 7: 県選択画面から地域を選び直せる（アプリ内stateで戻る）', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('region-card-東北').click();
    await page.getByTestId('area-pref-福島県').click();
    await page.getByTestId('region-landing-back').click();
    // 地域カードの一覧へ戻る
    await expect(page.getByTestId('region-card-grid')).toBeVisible();
    await expect(page.getByTestId('region-landing-area-title')).toHaveCount(0);
    // 別の地域を選び直せる（前の地域の選択は持ち越さない）
    await page.getByTestId('region-card-北海道').click();
    await expect(page.getByTestId('area-prefecture-confirm')).toBeDisabled();
    await page.getByTestId('area-pref-北海道').click();
    await page.getByTestId('area-prefecture-confirm').click();
    await expect(marker(page, HOKKAIDO.id)).toHaveCount(1, { timeout: 15000 });
    await expect(marker(page, FUKUSHIMA.id)).toHaveCount(0);
  });

  test('CASE 8: 確定後にリロードすると地域選択画面を出さず前回の県から再開する', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('region-card-東北').click();
    await page.getByTestId('area-pref-福島県').click();
    await page.getByTestId('area-pref-宮城県').click();
    await page.getByTestId('area-prefecture-confirm').click();
    await expect(marker(page, FUKUSHIMA.id)).toHaveCount(1, { timeout: 15000 });

    await page.reload();
    await expect(page.getByTestId('region-landing')).toHaveCount(0);
    await expect(marker(page, FUKUSHIMA.id)).toHaveCount(1, { timeout: 15000 });
    await expect(marker(page, MIYAGI.id)).toHaveCount(1);
    await expect(marker(page, AOMORI.id)).toHaveCount(0);
    const saved = await page.evaluate((k) => localStorage.getItem(k), AREA_SELECTION_KEY);
    expect(saved ?? '').toContain('福島県');
    expect(saved ?? '').toContain('宮城県');
  });

  test('CASE 9: 既存ユーザーの訪問済み・行きたい・スタンプ・保存ルートは地域選択で消えない', async ({ page }) => {
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
    await expect(page.getByTestId('region-landing')).toBeVisible();
    await page.getByTestId('region-card-東北').click();
    await page.getByTestId('area-pref-福島県').click();
    await page.getByTestId('area-prefecture-confirm').click();
    await expect(page.getByTestId('region-landing')).toHaveCount(0);

    const visits = await page.evaluate(() => localStorage.getItem('tohoku-me:visits:v2'));
    expect(visits ?? '').toContain('stamped');
    expect(visits ?? '').toContain('wishlist');
    expect(visits ?? '').toContain('visited');
    const routes = await page.evaluate(() => localStorage.getItem('tohoku-me:routes:v1'));
    expect(routes ?? '').toContain('saved-1');
  });

  test('「都道府県から選ぶ」は全国47県から複数選べる（既存UIを維持）', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('region-landing-prefecture-toggle').click();
    await expect(page.getByTestId('region-prefecture-groups')).toBeVisible();
    await expect(page.locator('[data-testid^="region-pref-"]')).toHaveCount(47);
    await expect(page.getByTestId('region-landing-prefecture-confirm')).toBeDisabled();
    await page.getByTestId('region-pref-福島県').click();
    await page.getByTestId('region-landing-prefecture-confirm').click();

    await expect(page.getByTestId('region-landing')).toHaveCount(0);
    await expect(marker(page, FUKUSHIMA.id)).toHaveCount(1, { timeout: 15000 });
    await expect(marker(page, AOMORI.id)).toHaveCount(0);
  });

  test('「全国を見る」を選ぶと全国が表示される', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('region-landing-nationwide').click();
    await expect(page.getByTestId('region-landing')).toHaveCount(0);
    await expect(marker(page, HOKKAIDO.id)).toHaveCount(1, { timeout: 15000 });
    await expect(marker(page, AOMORI.id)).toHaveCount(1);
    await expect(page.getByTestId('btn-change-region')).toContainText('全国');
  });

  test('地図から地域選択へ戻れ、選び直さずに戻ると表示範囲が変わらない', async ({ page }) => {
    await useNationwideSelection(page);
    await page.goto('/');
    await expect(page.getByTestId('region-landing')).toHaveCount(0);
    await closeBanners(page);

    await page.getByTestId('btn-change-region').click();
    await expect(page.getByTestId('region-landing')).toBeVisible();
    // 県選択まで進んで選んでも、確定しなければ元の表示範囲は変わらない
    await page.getByTestId('region-card-東北').click();
    await page.getByTestId('area-pref-福島県').click();
    await page.getByTestId('region-landing-back').click();
    await page.getByTestId('region-landing-cancel').click();
    await expect(page.getByTestId('region-landing')).toHaveCount(0);
    await expect(page.getByTestId('btn-change-region')).toContainText('全国');
    await expect(marker(page, HOKKAIDO.id)).toHaveCount(1, { timeout: 15000 });
  });

  test('駅への共有リンク(#station=...)で開いたときは地域選択画面で邪魔しない', async ({ page }) => {
    await page.goto(`/#station=${AOMORI.id}`);
    await expect(page.getByTestId('region-landing')).toHaveCount(0);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
  });
});
