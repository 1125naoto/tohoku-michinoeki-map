import { expect, test, type Page } from '@playwright/test';

/** しちのへ（青森県七戸町）: 実在の駅IDで詳細カードをディープリンク表示 */
const STATION_ID = 'mne-18900';
const STATION_NAME = 'しちのへ';
const VISITS_KEY = 'tohoku-me:visits:v1';

async function gotoStation(page: Page, id = STATION_ID) {
  await page.goto(`/#station=${id}`);
  await expect(page.getByTestId('station-sheet')).toBeVisible();
}

/** 初回自動展開される凡例がマーカーに重ならないよう閉じる */
async function closeLegend(page: Page) {
  const panel = page.getByTestId('legend-panel');
  if (await panel.isVisible().catch(() => false)) {
    await page.getByTestId('legend-toggle').click();
    await expect(panel).toBeHidden();
  }
}

test.describe('地図と詳細カード @smoke', () => {
  test('地図が表示され、帰属表示・達成率ヘッダーがある', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('map-root')).toBeVisible();
    await expect(page.locator('.leaflet-control-attribution')).toContainText('OpenStreetMap');
    await expect(page.getByTestId('stats-visited')).toContainText('0／182駅');
    await expect(page.getByTestId('stats-percent')).toContainText('0％');
    // 横スクロールが発生していない
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('道の駅マーカーまたはクラスタが描画される', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.cluster-pill, .rs-marker').first()).toBeVisible({ timeout: 15000 });
  });

  test('クラスタは紺色ピルで「N駅」表示、タップで範囲へズーム @smoke', async ({ page }) => {
    await page.goto('/');
    const pill = page.locator('.cluster-pill').first();
    await expect(pill).toBeVisible({ timeout: 15000 });
    await expect(pill).toHaveText(/^\d+駅$/);
    const before = await page.locator('.cluster-pill').count();
    await pill.click();
    await page.waitForTimeout(1500);
    const after =
      (await page.locator('.cluster-pill').count()) + (await page.locator('.rs-marker').count());
    expect(after).toBeGreaterThanOrEqual(before);
  });

  test('地域・表示フィルターがグループ分けされている @smoke', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('toolbar', { name: '地域で絞り込み' })).toBeVisible();
    await expect(page.getByRole('toolbar', { name: '表示状態で絞り込み' })).toBeVisible();
    await expect(page.locator('.fg-label').nth(0)).toHaveText('地域');
    await expect(page.locator('.fg-label').nth(1)).toHaveText('表示');
  });

  test('凡例: 初回は自動展開、折りたたみでき、2回目以降は閉じている @smoke', async ({ page }) => {
    await page.goto('/');
    const panel = page.getByTestId('legend-panel');
    await expect(panel).toBeVisible(); // 初回のみ自動展開
    await expect(panel).toContainText('行きたい');
    await expect(panel).toContainText('スタンプ取得済み');
    await expect(panel).toContainText('道の駅の件数');
    await page.getByTestId('legend-toggle').click();
    await expect(panel).toBeHidden();
    await page.reload();
    await expect(page.getByTestId('legend-panel')).toBeHidden(); // 毎回大きな説明は出さない
    await page.getByTestId('legend-toggle').click();
    await expect(page.getByTestId('legend-panel')).toBeVisible();
  });
});

test.describe('詳細カードの操作', () => {
  test('タップだけで外部遷移せず、カード内から状態変更とリンクができる', async ({ page }) => {
    await gotoStation(page);
    const sheet = page.getByTestId('station-sheet');
    await expect(sheet).toContainText(STATION_NAME);
    await expect(sheet).toContainText('青森県');
    // 外部リンクは別ボタンとして存在（自動遷移しない）
    const official = page.getByTestId('link-official');
    await expect(official).toHaveAttribute('href', /https?:\/\//);
    const gmap = page.getByTestId('link-gmap');
    await expect(gmap).toHaveAttribute('href', /google\.com\/maps\/search/);
    const href = await gmap.getAttribute('href');
    expect(decodeURIComponent(href!)).toContain(STATION_NAME);
  });

  test('未訪問→訪問済み→未訪問、行きたい、スタンプの遷移と即時反映', async ({ page }) => {
    await gotoStation(page);
    // 行きたい
    await page.getByTestId('btn-want').click();
    await expect(page.getByTestId('station-sheet')).toContainText('行きたい');
    // 訪問済み
    await page.getByTestId('btn-visited').click();
    await expect(page.getByTestId('station-sheet')).toContainText('訪問済み');
    await expect(page.getByTestId('stats-visited')).toContainText('1／182駅');
    // スタンプ（訪問とは別管理）
    await page.getByTestId('btn-stamp').click();
    await expect(page.getByTestId('station-sheet')).toContainText('スタンプ取得済み');
    // 再読み込み後も保持
    await page.reload();
    await expect(page.getByTestId('stats-visited')).toContainText('1／182駅');
    await gotoStation(page);
    await expect(page.getByTestId('station-sheet')).toContainText('スタンプ取得済み');
    // 未訪問に戻す
    await page.getByTestId('btn-reset').click();
    await expect(page.getByTestId('stats-visited')).toContainText('0／182駅');
  });

  test('ホバーで駅名ツールチップが表示される @smoke', async ({ page }) => {
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await closeLegend(page);
    const marker = page.locator(`[data-sid="${STATION_ID}"]`);
    await expect(marker).toBeVisible();
    await marker.hover();
    await expect(page.locator('.leaflet-tooltip.rs-tooltip')).toContainText(`道の駅 ${STATION_NAME}`);
  });

  test('同じ駅への2回目タップで公式HPが開き、閉じて再タップでは開かない', async ({ page, context }) => {
    let popups = 0;
    context.on('page', () => popups++);
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await closeLegend(page);
    const marker = page.locator(`[data-sid="${STATION_ID}"]`);
    await expect(marker).toBeVisible();
    // 選択中の同じ駅をもう一度タップ → 公式情報ページ（フォールバック含む）が新タブで開く
    const [popup] = await Promise.all([context.waitForEvent('page'), marker.click()]);
    await popup.waitForURL(/michi-no-eki\.jp|thr\.mlit\.go\.jp|mlit\.go\.jp|https?:\/\//, { timeout: 15000 }).catch(() => {});
    expect(popups).toBe(1);
    await popup.close();
    // ✕で閉じる → 次のタップは「選択のみ」で外部サイトは開かない
    await page.getByTestId('sheet-x').click();
    await expect(page.getByTestId('station-sheet')).toBeHidden();
    await marker.click();
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await page.waitForTimeout(800);
    expect(popups).toBe(1);
  });

  test('地図の何もない場所をタップすると詳細カードが閉じる', async ({ page }) => {
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await closeLegend(page);
    // 画面上部の海側（マーカーなし領域）をタップ
    await page.getByTestId('map-root').click({ position: { x: 30, y: 40 } });
    await expect(page.getByTestId('station-sheet')).toBeHidden();
  });

  test('長い駅名でもカードが崩れない', async ({ page }) => {
    // いいたて村の道の駅までい館（最長クラスの名称）
    await gotoStation(page, 'mne-19890');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('フィルターと達成率', () => {
  test('県別絞り込みと状態フィルターが動作する', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('chip-宮城県').click();
    await expect(page.getByTestId('chip-宮城県')).toHaveClass(/active/);
    // 東北全体へ戻す
    await page.getByTestId('chip-tohoku').click();
    await expect(page.getByTestId('chip-tohoku')).toHaveClass(/active/);
    // 状態フィルター: 訪問済みのみ → 0件でも落ちない
    await page.getByTestId('filter-visited').click();
    await expect(page.getByTestId('map-root')).toBeVisible();
    await page.getByTestId('filter-all').click();
  });

  test('県別グリッドの分母が自動計算されている @smoke', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('stats-toggle').click();
    await expect(page.getByTestId('pref-青森県')).toContainText('0／28駅');
    await expect(page.getByTestId('pref-岩手県')).toContainText('0／39駅');
    await expect(page.getByTestId('pref-宮城県')).toContainText('0／19駅');
    await expect(page.getByTestId('pref-秋田県')).toContainText('0／34駅');
    await expect(page.getByTestId('pref-山形県')).toContainText('0／24駅');
    await expect(page.getByTestId('pref-福島県')).toContainText('0／38駅');
  });

  test('達成率100%の表示', async ({ page }) => {
    // アプリが検証用に公開している window.__stationIds を使って全駅訪問済みを投入
    await page.goto('/');
    const ids = await page.evaluate(() => (window as unknown as { __stationIds?: string[] }).__stationIds);
    expect(ids && ids.length).toBe(182);
    await page.evaluate(
      ([key, idList]) => {
        const now = new Date().toISOString();
        const map: Record<string, unknown> = {};
        for (const id of idList as string[]) {
          map[id] = { status: 'visited', visitedAt: now, stamp: true, stampAt: now, updatedAt: now };
        }
        localStorage.setItem(key as string, JSON.stringify(map));
      },
      [VISITS_KEY, ids] as const,
    );
    await page.reload();
    await expect(page.getByTestId('stats-visited')).toContainText('182／182駅');
    await expect(page.getByTestId('stats-percent')).toContainText('100％');
  });
});

test.describe('堅牢性', () => {
  test('保存データが壊れていても画面が落ちない', async ({ page }) => {
    await page.addInitScript((key) => {
      localStorage.setItem(key, '{{{{ broken');
    }, VISITS_KEY);
    await page.goto('/');
    await expect(page.getByTestId('map-root')).toBeVisible();
    await expect(page.getByTestId('stats-visited')).toContainText('0／182駅');
  });

  test('オフライン状態の表示 @smoke', async ({ page, context }) => {
    await page.goto('/');
    // アプリのイベントリスナー登録完了（=地図描画済み）を待ってから発火する
    await expect(page.getByTestId('map-root')).toBeVisible();
    await expect(page.getByTestId('stats-visited')).toBeVisible();
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(page.getByTestId('offline-banner')).toBeVisible();
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByTestId('offline-banner')).toBeHidden();
  });

  test('住所検索サービス失敗時もエラーメッセージ表示で継続できる', async ({ page }) => {
    await page.route('**/msearch.gsi.go.jp/**', (route) => route.abort());
    await page.goto('/');
    await page.getByTestId('tab-route').click();
    await page.getByRole('button', { name: '住所・地名' }).click();
    await page.getByLabel('住所・地名').fill('郡山市');
    await page.getByRole('button', { name: '検索', exact: true }).click();
    await expect(page.locator('.msg.warn')).toContainText('接続できませんでした');
    // 画面は落ちていない
    await expect(page.getByTestId('plan-submit')).toBeVisible();
  });
});

test.describe('ルート提案から旅行中まで', () => {
  async function planFromStation(page: Page) {
    await page.goto('/');
    await page.getByTestId('tab-route').click();
    await page.getByRole('button', { name: '道の駅から' }).click();
    await page.getByLabel('出発する道の駅').selectOption(STATION_ID);
    await expect(page.getByTestId('origin-label')).toContainText('しちのへ');
    await page.getByTestId('plan-submit').click();
    await expect(page.getByTestId('route-card-max')).toBeVisible({ timeout: 20000 });
  }

  test('条件入力→3コース提案→概算注意→詳細表示 @smoke', async ({ page }) => {
    await planFromStation(page);
    await page.getByTestId('route-card-max').click();
    const detail = page.getByTestId('route-detail');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('所要時間は目安です');
    await expect(detail.getByTestId('route-timeline')).toContainText('を出発');
    await expect(detail.getByTestId('route-timeline')).toContainText('へ帰着');
    // Googleマップ連携: 注意表示→URL
    await page.getByTestId('gmaps-open').click();
    const confirmBox = page.getByTestId('gmaps-confirm');
    await expect(confirmBox).toContainText('概算');
    const link = confirmBox.locator('a').first();
    await expect(link).toHaveAttribute('href', /google\.com\/maps\/dir\/\?api=1&origin=/);
  });

  test('保存→再読み込み後も残る→削除確認', async ({ page }) => {
    await planFromStation(page);
    await page.getByTestId('route-card-max').click();
    await page.getByTestId('route-save').click();
    await expect(page.getByTestId('route-saved')).toBeVisible();
    await page.reload();
    await page.getByTestId('tab-records').click();
    await expect(page.getByTestId('saved-route').first()).toBeVisible();
    // 削除は確認ダイアログを必須とする
    await page.getByTestId('saved-delete').first().click();
    await expect(page.getByRole('dialog')).toContainText('削除');
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('saved-empty')).toBeVisible();
  });

  test('旅行中: 到着・訪問完了・スキップ・一括反映（自動訪問なし）', async ({ page }) => {
    await planFromStation(page);
    await page.getByTestId('route-card-max').click();
    await page.getByTestId('trip-start').click();
    await expect(page.getByTestId('trip-view')).toBeVisible();
    // ルートに含まれただけでは訪問済みにならない
    await expect(page.getByTestId('stats-visited')).toContainText('0／182駅');
    await expect(page.getByTestId('trip-remaining-stops')).toBeVisible();
    // 到着→訪問完了
    await page.getByTestId('trip-arrived').click();
    await page.getByTestId('trip-visited').click();
    await expect(page.getByTestId('stats-visited')).toContainText('1／182駅');
    // 次の駅をスキップ（残っていれば）
    const skip = page.getByTestId('trip-skip');
    if (await skip.isVisible().catch(() => false)) {
      await skip.click();
    }
    // 終了して一括反映画面へ
    const finishBtn = page.getByTestId('trip-finish-btn');
    if (await finishBtn.isVisible().catch(() => false)) {
      await finishBtn.click();
    }
    await expect(page.getByTestId('trip-finish')).toBeVisible();
    await page.getByTestId('trip-apply').click();
    // 旅行終了後もルートタブは正常
    await expect(page.getByTestId('route-pane')).toBeVisible();
    // 訪問記録は残っている
    await expect(page.getByTestId('stats-visited')).toContainText('1／182駅');
  });

  test('候補0件時の表示', async ({ page }) => {
    // 全駅訪問済みにして未訪問のみで検索
    await page.goto('/');
    const ids = await page.evaluate(() => (window as unknown as { __stationIds?: string[] }).__stationIds);
    await page.evaluate(
      ([key, idList]) => {
        const now = new Date().toISOString();
        const map: Record<string, unknown> = {};
        for (const id of idList as string[]) {
          map[id] = { status: 'visited', visitedAt: now, stamp: false, stampAt: null, updatedAt: now };
        }
        localStorage.setItem(key as string, JSON.stringify(map));
      },
      [VISITS_KEY, ids] as const,
    );
    await page.reload();
    await page.getByTestId('tab-route').click();
    await page.getByRole('button', { name: '道の駅から' }).click();
    await page.getByLabel('出発する道の駅').selectOption(STATION_ID);
    await page.getByTestId('plan-submit').click();
    await expect(page.getByTestId('route-empty')).toBeVisible();
    await expect(page.getByTestId('route-empty')).toContainText('見つかりませんでした');
  });
});
