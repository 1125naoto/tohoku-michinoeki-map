import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** しちのへ（青森県七戸町）: 実在の駅IDで詳細カードをディープリンク表示 */
const STATION_ID = 'mne-18900';
const STATION_NAME = 'しちのへ';
const VISITS_KEY = 'tohoku-me:visits:v1';

async function gotoStation(page: Page, id = STATION_ID) {
  await page.goto(`/#station=${id}`);
  await expect(page.getByTestId('station-sheet')).toBeVisible();
}

/**
 * 地図整定待ち: ディープリンク直後は地図が数百ms遅れて最終位置に落ち着くため、
 * 固定座標で実クリックする前にマーカー位置が安定するのを待つ。
 */
async function stableBox(page: Page, locator: ReturnType<Page['locator']>) {
  let prev = await locator.boundingBox();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(350);
    const cur = await locator.boundingBox();
    if (prev && cur && Math.abs(cur.x - prev.x) < 1 && Math.abs(cur.y - prev.y) < 1) return cur;
    prev = cur;
  }
  return prev!;
}

/** スマホでは絞り込みが初期折りたたみのため、チップ操作前に展開する */
async function openFilters(page: Page) {
  const chip = page.getByTestId('chip-tohoku');
  if (!(await chip.isVisible().catch(() => false))) {
    await page.getByTestId('filters-toggle').click();
    await expect(chip).toBeVisible();
  }
}

/** 初回自動展開される凡例・ホーム画面追加バナーがマーカーに重ならないよう閉じる */
async function closeLegend(page: Page) {
  const banner = page.getByTestId('a2hs-banner');
  if (await banner.isVisible().catch(() => false)) {
    await page.getByTestId('a2hs-close').click();
    await expect(banner).toBeHidden();
  }
  const panel = page.getByTestId('legend-panel');
  if (await panel.isVisible().catch(() => false)) {
    await page.getByTestId('legend-toggle').click();
    await expect(panel).toBeHidden();
  }
}

/**
 * 「コース」タブへ入り、自動コース作成（おすすめコース）の画面まで進める。
 * タブを開くと毎回まず作成方式の選択画面（おすすめコース/地図から選ぶ）が出るため、
 * 従来どおりPlannerFormへ直接アクセスしたい既存テストはこのヘルパーを経由する。
 */
async function goToAutoPlanner(page: Page) {
  await page.getByTestId('tab-route').click();
  const picker = page.getByTestId('course-mode-auto');
  if (await picker.isVisible().catch(() => false)) {
    await picker.click();
  }
}

/** 凡例パネルを開く（閉じていれば開く。バナーが被らないよう先に閉じる） */
async function openLegendPanel(page: Page) {
  const banner = page.getByTestId('a2hs-banner');
  if (await banner.isVisible().catch(() => false)) {
    await page.getByTestId('a2hs-close').click();
    await expect(banner).toBeHidden();
  }
  const panel = page.getByTestId('legend-panel');
  if (!(await panel.isVisible().catch(() => false))) {
    await page.getByTestId('legend-toggle').click();
  }
  await expect(panel).toBeVisible();
  return panel;
}

/** 地図表示設定（マーカー表示/駅名表示）を凡例パネルから切り替える */
async function setMarkerMode(page: Page, mode: 'all' | 'cluster') {
  await openLegendPanel(page);
  await page.getByTestId(`setting-marker-${mode}`).click();
  await page.getByTestId('legend-toggle').click();
  await expect(page.getByTestId('legend-panel')).toBeHidden();
}

async function setLabelMode(page: Page, mode: 'auto' | 'always' | 'off') {
  await openLegendPanel(page);
  await page.getByTestId(`setting-label-${mode}`).click();
  await page.getByTestId('legend-toggle').click();
  await expect(page.getByTestId('legend-panel')).toBeHidden();
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

  test('クラスタは「まとめて表示」設定に切り替えると紺色ピルで「N駅」表示、タップで範囲へズーム @smoke', async ({ page }) => {
    await page.goto('/');
    await closeLegend(page);
    await setMarkerMode(page, 'cluster');
    const pill = page.locator('.cluster-pill').first();
    await expect(pill).toBeVisible({ timeout: 15000 });
    await expect(pill).toHaveText(/^\d+駅$/);
    await pill.click(); // タップで範囲へズーム（ズーム挙動はスクリーンショットで目視確認）
    await page.waitForTimeout(1500);
    await expect(page.locator('.cluster-pill, .rs-marker').first()).toBeVisible();
    // クラスタのタップでは訪問状態を変更しない
    await expect(page.getByTestId('stats-visited')).toContainText('0／182駅');
  });

  test('地域・表示フィルターがグループ分けされている @smoke', async ({ page }) => {
    await page.goto('/');
    await openFilters(page);
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
    // 初期状態は全駅個別表示のため、クラスタ（まとめ表示）の説明は出ない
    await expect(panel).not.toContainText('道の駅の件数');
    await expect(panel).toContainText('マーカー表示');
    await expect(panel).toContainText('駅名表示');
    // 「まとめて表示」に切り替えるとクラスタの説明が現れる
    await page.getByTestId('setting-marker-cluster').click();
    await expect(panel).toContainText('道の駅の件数');
    await page.getByTestId('setting-marker-all').click();
    await expect(panel).not.toContainText('道の駅の件数');
    // 操作説明: タップは詳細を開くだけで、状態は変えない
    await expect(panel).toContainText('道の駅マークを押すと詳細が開きます（訪問状態は変わりません）');
    await expect(panel).toContainText('詳細内のボタンから行えます');
    // 旧・タップで状態循環する仕様の案内を残さない
    await expect(panel).not.toContainText('2タップ');
    await expect(panel).not.toContainText('ダブルクリック');
    await expect(panel).not.toContainText('素早く');
    await expect(panel).not.toContainText('押すたびに');
    // 凡例の「訪問済み」サンプルが赤（旧・緑の定義が残っていない）
    const visitedSample = panel.locator('.rs-marker.visited');
    expect(await visitedSample.innerHTML()).toContain('#d83a34');
    expect(await panel.innerHTML()).not.toContain('#198754');
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

  test('詳細カードから排他状態を直接設定できる（行きたい/訪問/スタンプ/未訪問）', async ({ page }) => {
    await gotoStation(page);
    // 行きたい（達成数には含めない）
    await page.getByTestId('btn-want').click();
    await expect(page.getByTestId('station-sheet')).toContainText('行きたい');
    await expect(page.getByTestId('stats-visited')).toContainText('0／182駅');
    // 訪問済み
    await page.getByTestId('btn-visited').click();
    await expect(page.getByTestId('station-sheet')).toContainText('✓ 訪問済み');
    await expect(page.getByTestId('stats-visited')).toContainText('1／182駅');
    // スタンプ取得済み（達成数+スタンプ数に含める）
    await page.getByTestId('btn-stamp').click();
    await expect(page.getByTestId('station-sheet')).toContainText('スタンプ取得済み');
    await expect(page.getByTestId('stats-visited')).toContainText('1／182駅');
    await expect(page.getByTestId('stats-stamped')).toContainText('1');
    // 再読み込み後も保持
    await page.reload();
    await expect(page.getByTestId('stats-visited')).toContainText('1／182駅');
    await gotoStation(page);
    await expect(page.getByTestId('station-sheet')).toContainText('スタンプ取得済み');
    // 未訪問に戻す
    await page.getByTestId('btn-reset').click();
    await expect(page.getByTestId('stats-visited')).toContainText('0／182駅');
  });

  test('ホバーで駅名ツールチップが表示され、訪問状態は変わらない @smoke', async ({ page }) => {
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await page.getByTestId('sheet-x').click(); // シートがマーカーを覆う端末があるため閉じてからhover
    await closeLegend(page);
    const marker = page.locator(`[data-sid="${STATION_ID}"]`);
    await expect(marker).toBeVisible();
    await marker.hover();
    await expect(page.locator('.leaflet-tooltip.rs-tooltip')).toContainText(`道の駅 ${STATION_NAME}`);
    await page.waitForTimeout(500);
    await expect(page.getByTestId('stats-visited')).toContainText('0／182駅'); // hoverでは変更しない
  });

  /** マーカー背景色（2番目のrect）のfill属性とcomputed styleを取得 */
  const markerFill = (page: Page, sid: string) =>
    page.evaluate((id) => {
      const rect = document.querySelector(`.rs-marker[data-sid="${id}"] svg rect:nth-of-type(2)`);
      return rect ? { attr: rect.getAttribute('fill'), computed: getComputedStyle(rect).fill } : null;
    }, sid);

  test('マーカータップは詳細シートを開くだけで状態を変えない。シート内ボタンで状態変更すると色・達成数・スタンプ数・保存が即時反映される', async ({
    page,
  }) => {
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await page.getByTestId('sheet-x').click();
    await closeLegend(page);
    const marker = page.locator(`[data-sid="${STATION_ID}"]`);
    await expect(marker).toBeVisible();
    // 初期状態: 青 #1a4f9e
    expect((await markerFill(page, STATION_ID))?.attr).toBe('#1a4f9e');

    // マーカーをタップ→詳細シートが開くだけで色・達成数は変わらず、トーストも出ない
    await marker.click();
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await expect(page.getByTestId('station-sheet')).toContainText(STATION_NAME);
    await page.waitForTimeout(300);
    expect((await markerFill(page, STATION_ID))?.attr).toBe('#1a4f9e');
    await expect(page.getByTestId('stats-visited')).toContainText('0／182駅');
    await expect(page.getByTestId('tap-toast')).toBeHidden();

    // シート内「✓ 訪問済みにする」: 赤・訪問済み
    await page.getByTestId('btn-visited').click();
    await expect(page.getByTestId('tap-toast-msg')).toContainText('訪問済みに変更しました');
    await expect(page.getByTestId('tap-toast-name')).toContainText(STATION_NAME);
    await expect(page.getByTestId('stats-visited')).toContainText('1／182駅');
    await expect(page.locator(`.rs-marker.visited[data-sid="${STATION_ID}"]`)).toBeVisible({ timeout: 10000 });
    expect((await markerFill(page, STATION_ID))?.attr).toBe('#d83a34');

    // シート内「★ 行きたいにする」: オレンジ・行きたい（達成数から外れる）。シートは開いたまま
    await page.getByTestId('btn-want').click();
    await expect(page.getByTestId('tap-toast-msg')).toContainText('行きたいに変更しました');
    await expect(page.getByTestId('stats-visited')).toContainText('0／182駅');
    await expect(page.locator(`.rs-marker.want[data-sid="${STATION_ID}"]`)).toBeVisible({ timeout: 10000 });
    expect((await markerFill(page, STATION_ID))?.attr).toBe('#d9640a');

    // 元に戻す → 直前の訪問済みへ復元
    await expect(page.getByTestId('tap-toast-undo')).toBeVisible();
    await page.getByTestId('tap-toast-undo').click();
    await expect(page.getByTestId('stats-visited')).toContainText('1／182駅');
    expect((await markerFill(page, STATION_ID))?.attr).toBe('#d83a34');

    // シート内「印 スタンプ取得済みにする」: 訪問済みから直接スタンプへ（達成数+スタンプ数に加算）
    await page.getByTestId('btn-stamp').click();
    await expect(page.getByTestId('tap-toast-msg')).toContainText('スタンプ取得済みに変更しました');
    await expect(page.getByTestId('stats-visited')).toContainText('1／182駅');
    await expect(page.getByTestId('stats-stamped')).toContainText('1');
    await expect(page.locator(`.rs-marker.stamp[data-sid="${STATION_ID}"]`)).toBeVisible({ timeout: 10000 });
    expect((await markerFill(page, STATION_ID))?.attr).toBe('#6a3ab2');

    // シート内「未訪問に戻す」: 青・未訪問へ戻る（達成数・スタンプ数から外れる）
    await page.getByTestId('btn-reset').click();
    await expect(page.getByTestId('tap-toast-msg')).toContainText('未訪問に戻しました');
    await expect(page.getByTestId('stats-visited')).toContainText('0／182駅');
    await expect(page.getByTestId('stats-stamped')).toContainText('0');
    expect((await markerFill(page, STATION_ID))?.attr).toBe('#1a4f9e');

    // 再度「訪問済みにする」→ 再読み込み後も維持される
    await page.getByTestId('btn-visited').click();
    await expect(page.getByTestId('stats-visited')).toContainText('1／182駅');
    await page.reload();
    await expect(page.getByTestId('stats-visited')).toContainText('1／182駅');
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.locator(`.rs-marker.visited[data-sid="${STATION_ID}"]`)).toBeVisible({ timeout: 15000 });
    expect((await markerFill(page, STATION_ID))?.attr).toBe('#d83a34');
  });

  test('マーカーを連打しても状態は変わらない（詳細シートを開くだけ・誤タップでの色変化を防ぐ）', async ({
    page,
    context,
  }) => {
    let popups = 0;
    context.on('page', () => popups++);
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await page.getByTestId('sheet-x').click();
    await closeLegend(page);
    const marker = page.locator(`[data-sid="${STATION_ID}"]`);
    expect((await markerFill(page, STATION_ID))?.attr).toBe('#1a4f9e');
    // 何度連打しても、開くだけで状態は一切変わらない（旧仕様なら4回で1周してしまうはずの回数）
    for (let i = 0; i < 4; i++) {
      await marker.click();
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(400);
    expect((await markerFill(page, STATION_ID))?.attr).toBe('#1a4f9e');
    await expect(page.getByTestId('stats-visited')).toContainText('0／182駅');
    await expect(page.getByTestId('stats-stamped')).toContainText('0');
    await expect(page.getByTestId('tap-toast')).toBeHidden();
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    expect(popups).toBe(0);
  });

  test('別の駅を連続タップしても、それぞれ独立に詳細シートが開くだけで状態は変わらない', async ({ page, context }) => {
    let popups = 0;
    context.on('page', () => popups++);
    // 安達 上り線/下り線（約1km・同一ズームで両方DOMに存在）
    await page.goto('/#station=mne-19019');
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await page.getByTestId('sheet-x').click();
    await closeLegend(page);
    const a = page.locator('[data-sid="mne-19019"]');
    const b = page.locator('[data-sid="mne-19926"]');
    await expect(a).toBeVisible();
    // 短い間隔で別マーカーをタップ（重なり得るためヒットテストを迂回して発火）
    await a.dispatchEvent('click');
    await page.waitForTimeout(120);
    await b.dispatchEvent('click');
    await page.waitForTimeout(600);
    expect(popups).toBe(0);
    // どちらも状態は変わらず、最後にタップした駅の詳細シートが開いている
    await expect(page.getByTestId('stats-visited')).toContainText('0／182駅');
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await expect(page.getByTestId('tap-toast')).toBeHidden();
  });

  test('実ポインター操作: 詳細シートは色を変えず、シート内ボタンで青→赤→オレンジ→紫→青のフルサイクルとトーストの公式HP @smoke', async ({
    page,
    context,
  }, testInfo) => {
    const isTouch = testInfo.project.name !== 'desktop';
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await page.getByTestId('sheet-x').click();
    await closeLegend(page);
    const marker = page.locator(`[data-sid="${STATION_ID}"]`);
    await expect(marker).toBeVisible();
    const box = await stableBox(page, marker); // 地図の整定を待ってから実座標を確定
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // 実デバイス相当の入力（座標指定）: スマホ=touchscreen.tap / PC=mouse.click
    const tap = async () => (isTouch ? page.touchscreen.tap(cx, cy) : page.mouse.click(cx, cy));

    // 実ポインターでのマーカータップ: 詳細シートが開くだけで色は変わらない
    await tap();
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await page.waitForTimeout(400);
    expect((await markerFill(page, STATION_ID))?.attr).toBe('#1a4f9e');
    await expect(page.getByTestId('tap-toast')).toBeHidden();

    const expectStage = async (attr: string, computed: string, stats: string, stamped: string) => {
      await page.waitForTimeout(600);
      const fill = await markerFill(page, STATION_ID);
      expect(fill?.attr).toBe(attr);
      expect(fill?.computed).toBe(computed);
      await expect(page.getByTestId('stats-visited')).toContainText(stats);
      await expect(page.getByTestId('stats-stamped')).toContainText(stamped);
    };

    // シート内ボタンで色を変える（青→赤→オレンジ→紫→青）
    await page.getByTestId('btn-visited').click();
    await expectStage('#d83a34', 'rgb(216, 58, 52)', '1／182駅', '0');
    await page.getByTestId('btn-want').click();
    await expectStage('#d9640a', 'rgb(217, 100, 10)', '0／182駅', '0');
    await page.getByTestId('btn-stamp').click();
    await expectStage('#6a3ab2', 'rgb(106, 58, 178)', '1／182駅', '1');
    await page.getByTestId('btn-reset').click();
    await expectStage('#1a4f9e', 'rgb(26, 79, 158)', '0／182駅', '0');

    // トーストの「公式HP」ボタン → 中間画面なしで公式ページを直接開き、状態は変わらない
    await page.getByTestId('btn-visited').click(); // → 訪問済み(赤)・トースト表示
    await page.waitForTimeout(400);
    await expect(page.getByTestId('tap-toast')).toBeVisible();
    const lsBefore = await page.evaluate(() => localStorage.getItem('tohoku-me:visits:v2'));
    const popupPromise = context.waitForEvent('page', { timeout: 8000 }).catch(() => null);
    await page.getByTestId('tap-toast-official').click();
    const popup = await popupPromise;
    let landedUrl = '';
    if (popup) {
      await popup.waitForURL(/https?:\/\//, { timeout: 15000 }).catch(() => {});
      landedUrl = popup.url();
      await popup.close();
    } else {
      await page.waitForURL(/michi-no-eki\.jp|mlit\.go\.jp|shichinohe/, { timeout: 15000 });
      landedUrl = page.url();
      await page.goBack();
    }
    expect(landedUrl).toMatch(/https?:\/\//);
    await page.waitForTimeout(500);
    await expect(page.getByTestId('stats-visited')).toContainText('1／182駅'); // 公式HPで状態は変わらない
    const lsAfter = await page.evaluate(() => localStorage.getItem('tohoku-me:visits:v2'));
    expect(lsAfter).toBe(lsBefore);
  });

  test('マーカーを1回タップすると直接詳細シートが開く（トースト経由不要）', async ({ page }) => {
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await page.getByTestId('sheet-x').click();
    await closeLegend(page);
    await page.locator(`[data-sid="${STATION_ID}"]`).click();
    const sheet = page.getByTestId('station-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(STATION_NAME);
    await expect(page.getByTestId('tap-toast')).toBeHidden();
    // 詳細カード内の状態変更ボタン・リンク・周辺スポット導線等が使える
    await expect(sheet.getByTestId('btn-visited')).toBeVisible();
    await expect(sheet.getByTestId('link-official')).toBeVisible();
    await expect(sheet.getByTestId('link-gmap')).toBeVisible();
    await expect(sheet.getByTestId('btn-search-nearby')).toBeVisible();
  });

  test('地図の何もない場所をタップすると詳細カードが閉じる', async ({ page }) => {
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await closeLegend(page);
    // 上部のボタン（⛶全画面・凡例）を避けた空き領域をタップ
    await page.getByTestId('map-root').click({ position: { x: 200, y: 70 } });
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
    await openFilters(page);
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

  test('状態フィルターが排他状態と連動する（訪問済み⇔行きたいの移動）', async ({ page }) => {
    await gotoStation(page);
    await page.getByTestId('btn-visited').click(); // 詳細から訪問済みへ
    await page.getByTestId('sheet-x').click();
    await closeLegend(page);
    await openFilters(page);
    // 訪問済み一覧に出る / 未訪問一覧から消える
    await page.getByTestId('filter-visited').click();
    await expect(page.locator(`[data-sid="${STATION_ID}"]`)).toBeVisible({ timeout: 10000 });
    await page.getByTestId('filter-none').click();
    await expect(page.locator(`[data-sid="${STATION_ID}"]`)).toHaveCount(0);
    // 行きたいへ変更 → 訪問済み一覧から消え、行きたい一覧に出る
    await page.getByTestId('filter-all').click();
    await page.locator(`[data-sid="${STATION_ID}"]`).click(); // 詳細シートを開く
    await page.getByTestId('btn-want').click(); // visited → wishlist
    await page.getByTestId('sheet-x').click();
    await page.waitForTimeout(400);
    await page.getByTestId('filter-want').click();
    await expect(page.locator(`.rs-marker.want[data-sid="${STATION_ID}"]`)).toBeVisible({ timeout: 10000 });
    await page.getByTestId('filter-visited').click();
    await expect(page.locator(`[data-sid="${STATION_ID}"]`)).toHaveCount(0);
    await expect(page.getByTestId('stats-visited')).toContainText('0／182駅'); // 達成数から外れる
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
  // page.route によるネットワーク遮断がService Worker経由のfetchに効かないため、
  // このグループはSWを無効化して実行する（検証対象はUI側のエラー処理でSWとは無関係）
  test.use({ serviceWorkers: 'block' });

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
    await goToAutoPlanner(page);
    await page.getByRole('button', { name: '住所・地名' }).click();
    await page.getByLabel('住所・地名').fill('郡山市');
    await page.getByRole('button', { name: '検索', exact: true }).click();
    await expect(page.locator('.msg.warn')).toContainText('うまくいきませんでした');
    // 画面は落ちておらず、地図指定・道の駅指定への誘導がある
    await expect(page.locator('.msg.warn')).toContainText('地図で選ぶ');
    await expect(page.getByTestId('plan-submit')).toBeVisible();
  });
});

test.describe('ルート提案から旅行中まで', () => {
  async function planFromStation(page: Page) {
    await page.goto('/');
    await goToAutoPlanner(page);
    await page.getByRole('button', { name: '道の駅から' }).click();
    await page.getByLabel('出発する道の駅').selectOption(STATION_ID);
    await expect(page.getByTestId('origin-label')).toContainText('しちのへ');
    await page.getByTestId('plan-submit').click();
    // 実道路時間の取得（OSRM）を含むため長めに待つ。障害時は概算へ自動フォールバックする
    await expect(page.getByTestId('route-card-max')).toBeVisible({ timeout: 40000 });
  }

  test('条件入力→コース提案→時間内・注意表示→詳細表示 @smoke', async ({ page }) => {
    await planFromStation(page);
    // カード: 大きな見出し・理由・実道路/概算バッジ
    const card = page.getByTestId('route-card-max');
    await expect(card).toContainText('4時間で');
    await expect(card).toContainText('駅回れます');
    await expect(card.getByTestId('road-badge')).toContainText(/実道路時間|概算時間/);
    await card.click();
    const detail = page.getByTestId('route-detail');
    await expect(detail).toBeVisible();
    // 実道路/概算に応じた注意が必ず表示される
    await expect(detail.getByTestId('road-note')).toContainText(/Googleマップ/);
    await expect(detail.getByTestId('route-margin')).toContainText('安全余裕');
    await expect(detail.getByTestId('route-total')).toContainText('設定 4時間 以内');
    await expect(detail.getByTestId('route-timeline')).toContainText('を出発');
    await expect(detail.getByTestId('route-timeline')).toContainText('へ帰着');
    await expect(detail.getByTestId('route-timeline')).toContainText('1. 道の駅'); // 訪問順の番号
    // Googleマップ全体確認: 注意→URL（経由順・avoidなしのデフォルト）
    await page.getByTestId('gmaps-open').click();
    const confirmBox = page.getByTestId('gmaps-confirm');
    await expect(confirmBox).toContainText('Googleマップ');
    const link = confirmBox.locator('a').first();
    await expect(link).toHaveAttribute('href', /google\.com\/maps\/dir\/\?api=1&origin=/);
  });

  test('地図の「コースを作る」ボタンから設定画面へ入れる @smoke', async ({ page }) => {
    await page.goto('/');
    await closeLegend(page);
    await expect(page.getByTestId('make-course-btn')).toBeVisible();
    await page.getByTestId('make-course-btn').click();
    await expect(page.getByTestId('route-pane')).toBeVisible();
    await page.getByTestId('course-mode-auto').click();
    await expect(page.getByTestId('plan-submit')).toBeVisible();
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

  test('シナリオA: 旅行中の1駅ナビ・到着=赤・スタンプ=紫・スキップ不変・帰路表示', async ({ page, context }) => {
    await planFromStation(page);
    await page.getByTestId('route-card-max').click();
    await page.getByTestId('trip-start').click();
    await expect(page.getByTestId('trip-view')).toBeVisible();
    // ルートに含まれただけでは訪問済みにならない
    await expect(page.getByTestId('stats-visited')).toContainText('0／182駅');
    await expect(page.getByTestId('trip-progress')).toContainText('0／');
    await expect(page.getByTestId('trip-remaining-time')).toBeVisible();
    // 安全案内
    await expect(page.getByTestId('trip-view')).toContainText('安全な場所に停車して操作してください');

    // 「Googleマップで次の駅へ」→ 中間画面なしでナビURLを直接開く（状態は変わらない）
    const currentName = (await page.getByTestId('trip-current').textContent()) ?? '';
    const popupPromise = context.waitForEvent('page', { timeout: 8000 }).catch(() => null);
    await page.getByTestId('trip-nav').click();
    const popup = await popupPromise;
    expect(popup).not.toBeNull();
    await popup!.waitForURL(/google\.com\/maps\/dir/, { timeout: 15000 }).catch(() => {});
    const navUrl = decodeURIComponent(popup!.url());
    expect(navUrl).toContain('google.com/maps/dir');
    expect(navUrl).toContain('dir_action=navigate');
    expect(navUrl).toContain(currentName.replace('道の駅 ', '')); // 次の駅名がdestinationに入っている
    await popup!.close();
    await expect(page.getByTestId('stats-visited')).toContainText('0／182駅');

    // 到着した → visited(赤) + 次の駅へ
    await page.getByTestId('trip-arrived').click();
    await expect(page.getByTestId('stats-visited')).toContainText('1／182駅');
    await expect(page.getByTestId('trip-progress')).toContainText('1／');

    // 2駅目: スタンプ取得 → stamped(紫)
    if (await page.getByTestId('trip-stamp').isVisible().catch(() => false)) {
      await page.getByTestId('trip-stamp').click();
      await expect(page.getByTestId('stats-visited')).toContainText('2／182駅');
      await expect(page.getByTestId('stats-stamped')).toContainText('1');
    }

    // 残りはスキップ（状態は変えない）→ 最後に帰路が表示される
    for (let i = 0; i < 8; i++) {
      if (await page.getByTestId('trip-return').isVisible().catch(() => false)) break;
      const skip = page.getByTestId('trip-skip');
      if (await skip.isVisible().catch(() => false)) {
        await skip.click();
        await page.waitForTimeout(200);
      } else break;
    }
    await expect(page.getByTestId('trip-return')).toBeVisible();
    await expect(page.getByTestId('trip-nav-home')).toBeVisible(); // 出発地点へ戻るナビ
    await expect(page.getByTestId('stats-visited')).toContainText('2／182駅'); // スキップで状態不変

    // 中断→再開: 進行状況が保持される
    await page.getByTestId('trip-suspend').click();
    await page.reload();
    await page.getByTestId('tab-route').click();
    await expect(page.getByTestId('trip-return')).toBeVisible();

    // 終了 → 記録確認 → 反映
    await page.getByTestId('trip-finish-btn').click();
    await expect(page.getByTestId('trip-finish')).toBeVisible();
    await page.getByTestId('trip-apply').click();
    await expect(page.getByTestId('route-pane')).toBeVisible();
    await expect(page.getByTestId('stats-visited')).toContainText('2／182駅');
  });

  test('シナリオB: 行きたい優先でwishlist駅が優先される', async ({ page }) => {
    // みさわ・おがわら湖を「行きたい」にしておく
    await page.addInitScript(() => {
      const now = new Date().toISOString();
      const rec = { state: 'wishlist', visitedAt: null, wishlistAt: now, stampAt: null, updatedAt: now };
      localStorage.setItem(
        'tohoku-me:visits:v2',
        JSON.stringify({ 'mne-18920': rec, 'mne-18924': rec }),
      );
    });
    await page.goto('/');
    await goToAutoPlanner(page);
    await page.getByRole('button', { name: '道の駅から' }).click();
    await page.getByLabel('出発する道の駅').selectOption(STATION_ID);
    await page.getByRole('button', { name: '6時間' }).click();
    await page.getByTestId('priority-wishlist').click();
    await page.getByTestId('plan-submit').click();
    const firstCard = page.locator('[data-testid^="route-card-"]').first();
    await expect(firstCard).toBeVisible({ timeout: 30000 });
    // 最上位コースが行きたい駅を含む
    await expect(firstCard).toContainText('★行きたい');
    await firstCard.click();
    const timeline = page.getByTestId('route-timeline');
    await expect(timeline).toContainText(/みさわ|おがわら湖/);
  });
});

test.describe('営業時間の表示（時刻固定・Asia/Tokyo基準）', () => {
  const DAY = new Date('2026-09-04T01:00:00Z'); // JST 金曜 10:00（しちのへ 9:00〜18:00 → 営業中）
  const EVE = new Date('2026-09-04T08:30:00Z'); // JST 17:30 → まもなく終了 あと30分
  const NIGHT = new Date('2026-09-04T14:00:00Z'); // JST 23:00 → 営業時間外

  async function gotoStationAt(page: Page, time: Date, id = STATION_ID) {
    await page.clock.install({ time });
    await page.goto(`/#station=${id}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
  }

  test('営業中: 緑ドット+「営業中 18:00まで」+今日の営業時間 @smoke', async ({ page }) => {
    await gotoStationAt(page, DAY);
    await expect(page.getByTestId('hours-status')).toContainText('営業中 18:00まで');
    await expect(page.getByTestId('hours-today')).toContainText('9:00〜18:00');
    await expect(page.locator(`[data-sid="${STATION_ID}"] .hrs-dot.hrs-open`)).toBeVisible();
  });

  test('まもなく終了: 黄ドット(!)+残り分数', async ({ page }) => {
    await gotoStationAt(page, EVE);
    await expect(page.getByTestId('hours-status')).toContainText('まもなく終了 あと30分');
    const dot = page.locator(`[data-sid="${STATION_ID}"] .hrs-dot.hrs-closing`);
    await expect(dot).toBeVisible();
    await expect(dot).toHaveText('!');
  });

  test('営業時間外: 濃グレードット(×)+翌営業日の案内', async ({ page }) => {
    await gotoStationAt(page, NIGHT);
    await expect(page.getByTestId('hours-status')).toContainText('営業時間外');
    await expect(page.getByTestId('hours-status')).toContainText('明日9:00から');
    const dot = page.locator(`[data-sid="${STATION_ID}"] .hrs-dot.hrs-closed`);
    await expect(dot).toBeVisible();
    await expect(dot).toHaveText('×');
  });

  test('要確認の駅では推測値を表示しない（?ドット）', async ({ page }) => {
    // mne-22686 いわき・ら・ら・ミュウ: ポータルに営業時間の記載なし → 要確認
    await gotoStationAt(page, DAY, 'mne-22686');
    await expect(page.getByTestId('hours-status')).toContainText('要確認');
    await expect(page.getByTestId('hours-status')).not.toContainText(/\d{1,2}:\d{2}/); // 時刻を出さない
    await expect(page.getByTestId('hours-today')).toContainText('公式情報');
    const dot = page.locator('[data-sid="mne-22686"] .hrs-dot.hrs-unknown');
    await expect(dot).toBeVisible();
    await expect(dot).toHaveText('?');
  });

  test('訪問状態の色と営業ドットは独立（訪問済み赤でも営業ドットは残る）', async ({ page }) => {
    await gotoStationAt(page, DAY);
    await page.getByTestId('sheet-x').click();
    await closeLegend(page);
    const marker = page.locator(`[data-sid="${STATION_ID}"]`);
    await marker.click(); // → 詳細シートを開く
    await page.getByTestId('btn-visited').click(); // → 訪問済み(赤)
    const visited = page.locator(`.rs-marker.visited[data-sid="${STATION_ID}"]`);
    await expect(visited).toBeVisible({ timeout: 10000 });
    // 本体は赤(#d83a34)のまま、左下の営業ドットは緑(hrs-open)で別表示
    expect(await visited.innerHTML()).toContain('#d83a34');
    await expect(visited.locator('.hrs-dot.hrs-open')).toBeVisible();
    // ツールチップにも駅名+営業状態
    await marker.hover();
    await expect(page.locator('.leaflet-tooltip.rs-tooltip')).toContainText('営業中');
  });

  test('詳細の「営業時間の詳細を見る」で出典・原文・24時間情報を表示', async ({ page }) => {
    await gotoStationAt(page, DAY);
    await page.getByTestId('hours-detail-toggle').click();
    const detail = page.getByTestId('hours-detail');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('通常営業時間');
    await expect(detail).toContainText('駐車場24時間');
    await expect(detail).toContainText('全国「道の駅」連絡会');
    await expect(detail).toContainText('最終確認 2026-09-02');
    await expect(page.getByTestId('hours-block')).toContainText('通常営業時間に基づく目安');
  });

  test('コース結果に営業見込みサマリーと各駅の到着時バッジが出る', async ({ page }) => {
    await page.clock.install({ time: DAY });
    await page.goto('/');
    await closeLegend(page);
    await goToAutoPlanner(page);
    await expect(page.getByTestId('prefer-open-hours')).toContainText('ON'); // 初期値ON
    await page.getByRole('button', { name: '道の駅から' }).click();
    await page.getByLabel('出発する道の駅').selectOption(STATION_ID);
    await page.getByTestId('plan-submit').click();
    const card = page.getByTestId('route-card-max');
    await expect(card).toBeVisible({ timeout: 40000 });
    await expect(card.getByTestId('hours-summary')).toContainText('営業中に到着見込み');
    await card.click();
    await expect(page.getByTestId('route-timeline').locator('.badge').first()).toBeVisible();
    await expect(page.getByTestId('road-note')).toContainText('通常営業時間に基づく目安');
  });
});

test.describe('スマホUI', () => {
  test('下部ナビ（地図/コース/保存）と主要ボタンが44px以上 @smoke', async ({ page }) => {
    await page.goto('/');
    await closeLegend(page);
    await expect(page.getByTestId('tab-route')).toContainText('コース');
    await expect(page.getByTestId('tab-records')).toContainText('保存');
    for (const id of ['tab-map', 'tab-route', 'tab-records', 'make-course-btn', 'locate-btn', 'fullscreen-btn']) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, id).not.toBeNull();
      expect(box!.height, id).toBeGreaterThanOrEqual(44);
    }
    // スマホ縦画面では達成状況が1行に圧縮される
    const vw = await page.evaluate(() => window.innerWidth);
    if (vw <= 700) {
      const h = await page.evaluate(
        () => document.querySelector('.stats-header')!.getBoundingClientRect().height,
      );
      expect(h).toBeLessThanOrEqual(46);
    }
    // 横スクロールなし
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('スマホでは絞り込みが初期折りたたみで、選択内容の1行サマリーが出る', async ({ page }) => {
    await page.goto('/');
    await closeLegend(page);
    // 初期は閉じており、サマリー1行表示（例: 絞り込み：東北全体・すべて）
    await expect(page.getByTestId('chip-tohoku')).toBeHidden();
    await expect(page.getByTestId('filters-toggle')).toContainText('絞り込み：東北全体・すべて');
    // 展開→操作→たたむ
    await page.getByTestId('filters-toggle').click();
    await expect(page.getByTestId('chip-tohoku')).toBeVisible();
    await page.getByTestId('chip-宮城県').click();
    await page.getByTestId('filter-visited').click();
    await page.getByTestId('filters-toggle').click();
    await expect(page.getByTestId('chip-tohoku')).toBeHidden();
    await expect(page.getByTestId('filters-toggle')).toContainText('絞り込み：宮城県・訪問済み');
  });

  test('ホーム画面追加の案内: 初回表示→閉じたら再表示しない→保存タブから再表示 @smoke', async ({ page }, testInfo) => {
    await page.goto('/');
    const banner = page.getByTestId('a2hs-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('ホーム画面に追加');
    // iOSとAndroidで案内を出し分け
    if (testInfo.project.name === 'iphone' || testInfo.project.name === 'tablet') {
      await expect(banner).toContainText('共有ボタン');
    } else {
      await expect(banner).toContainText('インストール');
    }
    await page.getByTestId('a2hs-close').click();
    await expect(banner).toBeHidden();
    await page.reload();
    await expect(page.getByTestId('a2hs-banner')).toBeHidden(); // 再表示しない
    // 保存タブから再表示できる
    await page.getByTestId('tab-records').click();
    await page.getByTestId('show-a2hs').click();
    await expect(page.getByTestId('a2hs-banner')).toBeVisible();
  });
});

test.describe('地図全画面モード', () => {
  const DAY = new Date('2026-09-04T01:00:00Z'); // JST 金曜10:00（営業バッジを安定させる）

  test('⛶全画面: ボタン表示→UI非表示→地図90%以上→中心維持→解除で復帰 @smoke', async ({ page }) => {
    await page.clock.install({ time: DAY });
    await page.goto('/');
    await closeLegend(page);
    const fsBtn = page.getByTestId('fullscreen-btn');
    await expect(fsBtn).toBeVisible();
    const btnBox = await fsBtn.boundingBox();
    expect(btnBox!.height).toBeGreaterThanOrEqual(44);
    expect(btnBox!.width).toBeGreaterThanOrEqual(44);

    type MS = { lat: number; lng: number; zoom: number };
    const before = (await page.evaluate(() =>
      (window as unknown as { __getMapState: () => unknown }).__getMapState(),
    )) as MS;

    await fsBtn.click();
    // ヘッダー・達成状況・絞り込み・下部ナビが消える
    await expect(page.getByTestId('stats-toggle')).toBeHidden();
    await expect(page.getByTestId('filters-toggle')).toBeHidden();
    await expect(page.getByTestId('tab-map')).toBeHidden();
    // 解除ボタンが常に見える
    const exitBtn = page.getByTestId('fullscreen-exit');
    await expect(exitBtn).toBeVisible();
    expect((await exitBtn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // 地図が画面高の90%以上
    await page.waitForTimeout(300);
    const ratio = await page.evaluate(() => {
      const r = document.querySelector('[data-testid="map-root"]')!.getBoundingClientRect();
      return r.height / window.innerHeight;
    });
    expect(ratio).toBeGreaterThanOrEqual(0.9);
    // 中心座標・ズームが維持される
    const after = (await page.evaluate(() =>
      (window as unknown as { __getMapState: () => unknown }).__getMapState(),
    )) as MS;
    expect(after.zoom).toBe(before.zoom);
    // 1px未満の丸めは許容（広域ズームでは0.005°程度になる）
    expect(Math.abs(after.lat - before.lat)).toBeLessThan(0.02);
    expect(Math.abs(after.lng - before.lng)).toBeLessThan(0.02);
    // タイルが描画されている（灰色のみでない）
    await expect(page.locator('.leaflet-tile-loaded').first()).toBeVisible({ timeout: 15000 });
    // 横スクロールなし
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // コース作成はコンパクトピルで残る
    await expect(page.getByTestId('make-course-btn')).toBeVisible();
    // 現在地・凡例も残る
    await expect(page.getByTestId('locate-btn')).toBeVisible();
    await expect(page.getByTestId('legend-toggle')).toBeVisible();

    // 解除 → 全UIが元に戻る
    await exitBtn.click();
    await expect(page.getByTestId('stats-toggle')).toBeVisible();
    await expect(page.getByTestId('tab-map')).toBeVisible();
    const after2 = (await page.evaluate(() =>
      (window as unknown as { __getMapState: () => unknown }).__getMapState(),
    )) as MS;
    expect(after2.zoom).toBe(before.zoom);
  });

  test('全画面中もマーカー操作・営業バッジ・状態変更・シートが使える', async ({ page }) => {
    await page.clock.install({ time: DAY });
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await page.getByTestId('sheet-x').click();
    await closeLegend(page);
    await page.getByTestId('fullscreen-btn').click();
    await expect(page.getByTestId('fullscreen-exit')).toBeVisible();
    const marker = page.locator(`[data-sid="${STATION_ID}"]`);
    await expect(marker).toBeVisible();
    await expect(marker.locator('.hrs-dot.hrs-open')).toBeVisible(); // 営業バッジ
    // タップで詳細シートが開くだけ（色はまだ変わらない）
    await marker.click();
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    // シート内ボタンで状態変更（未訪問→訪問済み・赤）
    await page.getByTestId('btn-visited').click();
    await expect(page.locator(`.rs-marker.visited[data-sid="${STATION_ID}"]`)).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('tap-toast-msg')).toContainText('訪問済みに変更しました');
    // シートは既に開いたまま。閉じるボタンで閉じられる
    await page.getByTestId('sheet-x').click();
    await expect(page.getByTestId('station-sheet')).toBeHidden();
    // 全画面のままであること
    await expect(page.getByTestId('fullscreen-exit')).toBeVisible();
    // コース作成ピルからコース画面へ移動できる（全画面は解除される）
    const toastClose = page.getByTestId('tap-toast-close');
    if (await toastClose.isVisible().catch(() => false)) await toastClose.click();
    await expect(page.getByTestId('make-course-btn')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('make-course-btn').click();
    await page.getByTestId('course-mode-auto').click();
    await expect(page.getByTestId('plan-submit')).toBeVisible();
  });

  test('Escで解除（シート表示中はまずシートを閉じる）', async ({ page }) => {
    await page.clock.install({ time: DAY });
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await closeLegend(page);
    await page.getByTestId('fullscreen-btn').click();
    await expect(page.getByTestId('fullscreen-exit')).toBeVisible();
    // 1回目のEsc: シートだけ閉じる
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('station-sheet')).toBeHidden();
    await expect(page.getByTestId('fullscreen-exit')).toBeVisible();
    // 2回目のEsc: 全画面解除
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('stats-toggle')).toBeVisible();
  });

  test('画面回転（横向き）でも全画面地図が操作できる', async ({ page }) => {
    await page.clock.install({ time: DAY });
    await page.goto('/');
    await closeLegend(page);
    await page.getByTestId('fullscreen-btn').click();
    await page.setViewportSize({ width: 844, height: 390 }); // 横向き相当
    await page.waitForTimeout(400);
    const ratio = await page.evaluate(() => {
      const r = document.querySelector('[data-testid="map-root"]')!.getBoundingClientRect();
      return r.height / window.innerHeight;
    });
    expect(ratio).toBeGreaterThanOrEqual(0.9);
    await expect(page.locator('.leaflet-tile-loaded').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('fullscreen-exit')).toBeVisible();
    await page.getByTestId('fullscreen-exit').click();
    await expect(page.getByTestId('tab-map')).toBeVisible();
  });
});

test.describe('シナリオC: ルーティング障害時の概算フォールバック', () => {
  test.use({ serviceWorkers: 'block' });

  test('OSRM不通でも概算で提案でき、注意表示とナビは使える', async ({ page }) => {
    await page.route('**router.project-osrm.org/**', (route) => route.abort());
    await page.goto('/');
    await goToAutoPlanner(page);
    await page.getByRole('button', { name: '道の駅から' }).click();
    await page.getByLabel('出発する道の駅').selectOption(STATION_ID);
    await page.getByTestId('plan-submit').click();
    const card = page.getByTestId('route-card-max');
    await expect(card).toBeVisible({ timeout: 30000 });
    // 概算バッジ + 注意文言
    await expect(card.getByTestId('road-badge')).toContainText('概算時間を使用');
    await card.click();
    await expect(page.getByTestId('road-note')).toContainText('所要時間は目安です');
    await expect(page.getByTestId('road-note')).toContainText('Googleマップで確認');
    // アプリは落ちておらず、旅行開始→ナビボタンも使える
    await page.getByTestId('trip-start').click();
    await expect(page.getByTestId('trip-view')).toBeVisible();
    await expect(page.getByTestId('trip-nav')).toBeVisible();
  });

  test('候補0件時の表示（状態変更は再読み込みなしでルート候補へ反映される）', async ({ page }) => {
    // 全駅訪問済み(v2)にして未訪問のみで検索。ルート計算は保存値を都度読むため
    // ページ再読み込みなしで反映されることも同時に検証する
    await page.goto('/');
    const ids = await page.evaluate(() => (window as unknown as { __stationIds?: string[] }).__stationIds);
    await page.evaluate(
      ([key, idList]) => {
        const now = new Date().toISOString();
        const map: Record<string, unknown> = {};
        for (const id of idList as string[]) {
          map[id] = { state: 'visited', visitedAt: now, wishlistAt: null, stampAt: null, updatedAt: now };
        }
        localStorage.setItem(key as string, JSON.stringify(map));
      },
      ['tohoku-me:visits:v2', ids] as const,
    );
    // 再読み込みしない
    await goToAutoPlanner(page);
    await page.getByRole('button', { name: '道の駅から' }).click();
    await page.getByLabel('出発する道の駅').selectOption(STATION_ID);
    await page.getByTestId('plan-submit').click();
    await expect(page.getByTestId('route-empty')).toBeVisible();
    await expect(page.getByTestId('route-empty')).toContainText('見つかりませんでした');
  });
});

test.describe('全駅表示・駅名ラベル・地図の表示設定', () => {
  test('初期状態では東北全域が182件の個別マーカーで表示され、まとめ表示（クラスタ）は出ない @smoke', async ({
    page,
  }) => {
    await page.goto('/');
    await closeLegend(page);
    await expect(page.locator('.rs-marker').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.rs-hit')).toHaveCount(182);
    await expect(page.locator('.cluster-pill')).toHaveCount(0);
  });

  test('「まとめて表示」に切り替えるとクラスタ表示になり、訪問記録は変化しない', async ({ page }) => {
    await page.goto('/');
    await closeLegend(page);
    await setMarkerMode(page, 'cluster');
    await expect(page.locator('.cluster-pill').first()).toBeVisible({ timeout: 15000 });
    // クラスタ化時は大半がピルにまとまる（近隣に他駅がない孤立した駅だけは
    // 単独マーカーのまま出ることがあるため、182件全部ではないことだけ確認する）
    await expect(page.locator('.rs-hit')).not.toHaveCount(182);
    await expect(page.getByTestId('stats-visited')).toContainText('0／182駅');
    // 「全駅表示」へ戻すと元通りになる
    await setMarkerMode(page, 'all');
    await expect(page.locator('.rs-hit')).toHaveCount(182);
    await expect(page.locator('.cluster-pill')).toHaveCount(0);
  });

  test('表示設定は再読み込み後も維持される', async ({ page }) => {
    await page.goto('/');
    await closeLegend(page);
    await setMarkerMode(page, 'cluster');
    await setLabelMode(page, 'always');
    await page.reload();
    await closeLegend(page);
    await expect(page.locator('.cluster-pill').first()).toBeVisible({ timeout: 15000 });
    const saved = await page.evaluate(() => localStorage.getItem('tohoku-me:map-settings:v1'));
    expect(saved).toContain('"markerMode":"cluster"');
    expect(saved).toContain('"labelMode":"always"');
  });

  test('駅名ラベル: 広域では非表示、拡大すると表示される（自動モード）', async ({ page }) => {
    await page.goto('/');
    await closeLegend(page);
    await page.evaluate(() => (window as unknown as { __setMapView: (a: number, b: number, c: number) => void }).__setMapView(38.5, 140.5, 6));
    await page.waitForTimeout(300);
    const label = page.locator(`.rs-hit:has([data-sid="${STATION_ID}"]) .rs-label`);
    await expect(label).toBeHidden();
    // 拡大すると表示される
    await page.evaluate(
      ([lat, lng]) => (window as unknown as { __setMapView: (a: number, b: number, c: number) => void }).__setMapView(lat as number, lng as number, 13),
      [40.63, 141.13],
    );
    await page.waitForTimeout(300);
    await expect(label).toBeVisible({ timeout: 10000 });
    await expect(label).toContainText(STATION_NAME);
  });

  test('「常に表示」「非表示」設定がズームによらず反映される', async ({ page }) => {
    await page.goto('/');
    await closeLegend(page);
    await page.evaluate(() => (window as unknown as { __setMapView: (a: number, b: number, c: number) => void }).__setMapView(38.5, 140.5, 6));
    const label = page.locator(`.rs-hit:has([data-sid="${STATION_ID}"]) .rs-label`);
    await setLabelMode(page, 'always');
    await expect(label).toBeVisible({ timeout: 10000 });
    await setLabelMode(page, 'off');
    await expect(label).toBeHidden();
  });

  test('選択中の駅は設定・ズームに関わらずラベルが表示される', async ({ page }) => {
    // 「非表示」設定を先に保存してから駅を選択（selectedIdはシートを開いている間だけ
    // 有効なため、シートを閉じずに検証する）
    await page.goto('/');
    await closeLegend(page);
    await setLabelMode(page, 'off');
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    const label = page.locator(`.rs-hit.sel .rs-label`);
    await expect(label).toBeVisible({ timeout: 10000 });
    await expect(label).toContainText(STATION_NAME);
  });

  test('タップ可能領域は見た目のサイズによらず約44×44pxを維持する', async ({ page }) => {
    await page.goto('/');
    await closeLegend(page);
    await page.evaluate(() => (window as unknown as { __setMapView: (a: number, b: number, c: number) => void }).__setMapView(38.5, 140.5, 6));
    await page.waitForTimeout(300);
    const hit = page.locator(`.rs-hit:has([data-sid="${STATION_ID}"])`).first();
    const box = await stableBox(page, hit);
    expect(box.width).toBeGreaterThanOrEqual(40);
    expect(box.height).toBeGreaterThanOrEqual(40);
  });
});

test.describe('記録のバックアップ・復元', () => {
  test('バックアップを書き出すと、現在の記録を含むJSONファイルがダウンロードされる @smoke', async ({ page }) => {
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await page.getByTestId('sheet-x').click(); // シートが駅を覆う画面幅があるため先に閉じる
    await closeLegend(page);
    await page.locator(`[data-sid="${STATION_ID}"]`).click(); // 詳細シートを開く
    await page.getByTestId('btn-visited').click(); // 訪問済みにする
    await page.getByTestId('sheet-x').click();
    await page.getByTestId('tab-records').click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('backup-export').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^michinoeki-backup-\d{8}-\d{4}\.json$/);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream!.on('data', (c) => chunks.push(c as Buffer));
      stream!.on('end', () => resolve());
      stream!.on('error', reject);
    });
    const data = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    expect(data.schemaVersion).toBe(2); // 2: 「地図から選ぶ」の選択下書き(manualDraft)を追加
    expect(data.visits[STATION_ID].state).toBe('visited');
    expect(Array.isArray(data.routes)).toBe(true);
    expect(data.settings.map.markerMode).toBe('all');
  });

  test('バックアップの復元（上書き）: 記録がバックアップの内容に置き換わる', async ({ page }) => {
    await page.goto('/');
    await closeLegend(page);
    // 現在の記録: 別の駅を「行きたい」にしておく（上書きで消えることを確認するため）
    await page.evaluate(() => {
      const now = new Date().toISOString();
      localStorage.setItem(
        'tohoku-me:visits:v2',
        JSON.stringify({
          'mne-99999-dummy': { state: 'wishlist', visitedAt: null, wishlistAt: now, stampAt: null, updatedAt: now },
        }),
      );
    });
    await page.reload();
    await closeLegend(page);
    const backupJson = JSON.stringify({
      schemaVersion: 1,
      appVersion: '1.0.0',
      exportedAt: new Date().toISOString(),
      visits: {
        [STATION_ID]: {
          state: 'stamped',
          visitedAt: new Date().toISOString(),
          wishlistAt: null,
          stampAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
      routes: [],
      trip: null,
      settings: { map: { markerMode: 'all', labelMode: 'auto' } },
    });
    const filePath = join(tmpdir(), `backup-overwrite-${Date.now()}.json`);
    writeFileSync(filePath, backupJson, 'utf-8');
    await page.getByTestId('tab-records').click();
    await page.getByTestId('backup-file-input').setInputFiles(filePath);
    await expect(page.getByTestId('restore-dialog')).toBeVisible();
    await page.getByTestId('restore-overwrite').click();
    await expect(page.getByTestId('backup-restored')).toContainText('上書き復元');
    // ダミーの駅は消え、バックアップの駅がスタンプ済みになっている
    const saved = await page.evaluate(() => localStorage.getItem('tohoku-me:visits:v2'));
    expect(saved).not.toContain('mne-99999-dummy');
    expect(saved).toContain(`"${STATION_ID}"`);
    await expect(page.getByTestId('stats-visited')).toContainText('1／182駅');
  });

  test('バックアップの復元（統合）: 既存の記録を残しつつバックアップ側を反映する', async ({ page }) => {
    await page.goto('/');
    await closeLegend(page);
    await page.evaluate(() => {
      const now = new Date().toISOString();
      localStorage.setItem(
        'tohoku-me:visits:v2',
        JSON.stringify({
          'mne-99999-dummy': { state: 'wishlist', visitedAt: null, wishlistAt: now, stampAt: null, updatedAt: now },
        }),
      );
    });
    await page.reload();
    await closeLegend(page);
    const backupJson = JSON.stringify({
      schemaVersion: 1,
      appVersion: '1.0.0',
      exportedAt: new Date().toISOString(),
      visits: {
        [STATION_ID]: {
          state: 'visited',
          visitedAt: new Date().toISOString(),
          wishlistAt: null,
          stampAt: null,
          updatedAt: new Date().toISOString(),
        },
      },
      routes: [],
      trip: null,
      settings: { map: { markerMode: 'all', labelMode: 'auto' } },
    });
    const filePath = join(tmpdir(), `backup-merge-${Date.now()}.json`);
    writeFileSync(filePath, backupJson, 'utf-8');
    await page.getByTestId('tab-records').click();
    await page.getByTestId('backup-file-input').setInputFiles(filePath);
    await expect(page.getByTestId('restore-dialog')).toBeVisible();
    await page.getByTestId('restore-merge').click();
    await expect(page.getByTestId('backup-restored')).toContainText('統合復元');
    // 既存のダミー駅は残り、バックアップの駅も追加されている
    const saved = await page.evaluate(() => localStorage.getItem('tohoku-me:visits:v2'));
    expect(saved).toContain('mne-99999-dummy');
    expect(saved).toContain(`"${STATION_ID}"`);
    await expect(page.getByTestId('stats-visited')).toContainText('1／182駅');
  });

  test('壊れたバックアップファイルはエラー表示となり、既存の記録は変更されない', async ({ page }) => {
    await page.goto(`/#station=${STATION_ID}`);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await page.getByTestId('sheet-x').click(); // シートが駅を覆う画面幅があるため先に閉じる
    await closeLegend(page);
    await page.locator(`[data-sid="${STATION_ID}"]`).click(); // 詳細シートを開く
    await page.getByTestId('btn-visited').click(); // 訪問済みにする
    await page.getByTestId('sheet-x').click();
    const filePath = join(tmpdir(), `backup-broken-${Date.now()}.json`);
    writeFileSync(filePath, '{this is not valid json', 'utf-8');
    await page.getByTestId('tab-records').click();
    await page.getByTestId('backup-file-input').setInputFiles(filePath);
    await expect(page.getByTestId('backup-error')).toBeVisible();
    await expect(page.getByTestId('restore-dialog')).toHaveCount(0);
    const saved = await page.evaluate(() => localStorage.getItem('tohoku-me:visits:v2'));
    expect(saved).toContain(`"${STATION_ID}"`);
  });
});
