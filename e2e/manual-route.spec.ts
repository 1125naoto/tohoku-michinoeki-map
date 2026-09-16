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
 * 「地図から選ぶ」ルート作成のE2Eシナリオ（仕様§B〜§X）。
 * OSRM公開デモへの負荷を抑えるため、実道路時間の検証テスト1本を除き
 * router.project-osrm.org への通信は中断し、概算フォールバックで決定的に検証する
 * （app.spec.ts のシナリオCと同じ手法）。
 */

const DAY = new Date('2026-09-04T01:00:00Z'); // JST 金曜 10:00（営業中の駅が多い時間帯）
const NIGHT = new Date('2026-09-04T15:00:00Z'); // JST 金曜 24:00（ほぼ全駅が営業時間外）

// 郡山市近郊の開業済み駅（座標は src/data/stations.json より）
const ST_A = 'mne-19038'; // 季の里天栄
const ST_B = 'mne-19029'; // たまかわ
const ST_C = 'mne-19033'; // ひらた
const ST_D = 'mne-19041'; // さくらの郷
const ST_E = 'mne-19026'; // ふくしま東和
const COORDS: Record<string, [number, number]> = {
  [ST_A]: [37.2436603, 140.2447857],
  [ST_B]: [37.2228324, 140.4181372],
  [ST_C]: [37.2505454, 140.5600321],
  [ST_D]: [37.53478, 140.5902479],
  [ST_E]: [37.5699562, 140.5773494],
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
  await expect(page.getByTestId('course-mode-manual')).toBeVisible();
  await page.getByTestId('course-mode-manual').click();
  await expect(page.getByTestId('map-root')).toBeVisible();
  await expect(page.getByTestId('route-select-banner')).toBeVisible();
  await expect(page.getByTestId('route-select-bar')).toBeVisible();
}

/**
 * 対象駅を画面中央へ寄せてからタップする。下部の選択バー・上部案内・凡例等の
 * 固定UIは画面端に配置されているため、中央にセンタリングすれば重ならず確実に押せる…
 * はずだったが、desktopビューポート（横長）では地図領域自体の高さが小さく（実測217px程度）、
 * 幾何中心が下部固定バー(.route-select-bar)の帯へ入ってしまうケースがあることが実測で
 * 判明した（Astra再監査Final Gate: document.elementFromPointで実測・再現済み。iPhoneの
 * 縦長ビューポートでは地図領域が十分縦に長く発生しなかった）。中心を求め直すのではなく、
 * 実測したバーの領域を避けるぶんだけE2E専用フック(__panMapBy、実ユーザー機能ではない)で
 * 上へずらしてからクリックする（アプリの挙動そのものは変更しない）。
 */
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
    await avoidSelectBarOverlap(page, id);
    await waitForCenteredMarkerSettled(page, id);
  }
  await page.locator(`[data-sid="${id}"]`).click();
}

/**
 * 対象マーカーが下部固定バー(.route-select-bar)の領域と重なっている場合、
 * 重ならなくなるまでE2E専用フック(__panMapBy)で地図を上へずらす。
 */
async function avoidSelectBarOverlap(page: Page, id: string) {
  const hasPan = await page.evaluate(() => typeof (window as unknown as { __panMapBy?: unknown }).__panMapBy === 'function');
  if (!hasPan) return;
  for (let i = 0; i < 5; i++) {
    const markerBox = await page.locator(`[data-sid="${id}"]`).boundingBox();
    const barBox = await page.getByTestId('route-select-bar').boundingBox().catch(() => null);
    if (!markerBox || !barBox) return;
    const markerCenterY = markerBox.y + markerBox.height / 2;
    const overlap = markerCenterY + markerBox.height / 2 + 8 - barBox.y; // マーカー下端+余白がバー上端を超えている量
    if (overlap <= 0) return; // 既に重なっていない
    await page.evaluate((dy) => (window as unknown as { __panMapBy: (dx: number, dy: number) => void }).__panMapBy(0, dy), overlap);
    await page.waitForTimeout(150);
  }
}

/**
 * __setMapView後、対象駅マーカー自身の現在位置の中心ピクセルに、実際にそのマーカーが
 * （差し替え途中の別要素ではなく）存在する状態になるまで待つ。map-root自体の中心座標に
 * 依存すると、ビューポート幅（desktop/iPhone等）によるレイアウト差でマーカーの実際の
 * 位置とズレることがあったため、マーカー自身の座標を都度読み直す方式にした。
 */
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

async function pickOriginStation(page: Page, id: string) {
  await page.getByRole('button', { name: '道の駅から', exact: true }).click();
  await page.getByLabel('出発する道の駅').selectOption(id);
  await expect(page.getByTestId('origin-label')).toBeVisible();
}

/** OSRM待ち・順番調整/営業時間確認の中間画面・一覧カードを自動で進めてroute-detailまで到達する */
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

test.describe('地図から選ぶルート作成', () => {
  // page.route()でのOSRM中断をService Workerの fetch ハンドラに横取りされないよう無効化
  // （app.spec.ts のシナリオCと同じ理由）
  test.use({ serviceWorkers: 'block' });

  test('OSRM実道路検証: 選択した駅だけで実道路時間のコースが作成される @smoke', async ({ page }) => {
    await page.clock.install({ time: DAY });
    await page.goto('/');
    await closeBanners(page);
    await enterManualSelect(page);

    await tapStation(page, ST_A);
    await tapStation(page, ST_B);
    await expect(page.getByTestId('route-select-count')).toContainText('2駅選択中');
    await expect(page.getByTestId('stats-visited')).toContainText('0／1237駅');

    await page.getByTestId('route-select-create').click();
    await pickOriginStation(page, ST_A);
    await page.getByTestId('manual-submit').click();
    await advanceToRouteDetail(page, 30000);

    await expect(page.getByTestId('route-detail')).toBeVisible();
    await expect(page.getByTestId('road-badge')).toContainText('実道路時間を使用');
    const ids = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="route-timeline"] li:has(.badge) b')).map((e) => e.textContent),
    );
    expect(ids.join(' ')).toContain('季の里天栄');
  });

  test('シナリオ1: 基本選択 - 追加→番号→一覧→解除→振り直し→再追加→作成', async ({ page }) => {
    await page.route('**router.project-osrm.org/**', (route) => route.abort());
    await page.clock.install({ time: DAY });
    await page.goto('/');
    await closeBanners(page);
    await enterManualSelect(page);

    await tapStation(page, ST_A);
    await tapStation(page, ST_B);
    await tapStation(page, ST_C);
    await expect(page.getByTestId('route-select-count')).toContainText('3駅選択中');
    await expect(page.locator(`[data-sid="${ST_A}"] .rs-route-num`)).toHaveText('1');
    await expect(page.locator(`[data-sid="${ST_B}"] .rs-route-num`)).toHaveText('2');
    await expect(page.locator(`[data-sid="${ST_C}"] .rs-route-num`)).toHaveText('3');
    // 訪問記録は変わっていない
    await expect(page.getByTestId('stats-visited')).toContainText('0／1237駅');

    await page.getByTestId('route-select-show-list').click();
    await expect(page.getByTestId('route-select-row')).toHaveCount(3);

    // 1駅解除 → 残りの番号が自動的に振り直される
    await page.getByTestId('route-select-remove').first().click();
    await expect(page.getByTestId('route-select-row')).toHaveCount(2);
    await page.getByTestId('route-select-sheet-close').click();
    await expect(page.locator(`[data-sid="${ST_B}"] .rs-route-num`)).toHaveText('1');
    await expect(page.locator(`[data-sid="${ST_C}"] .rs-route-num`)).toHaveText('2');

    // 再追加
    await tapStation(page, ST_A);
    await expect(page.getByTestId('route-select-count')).toContainText('3駅選択中');

    await page.getByTestId('route-select-create').click();
    await pickOriginStation(page, ST_B);
    await page.getByTestId('manual-submit').click();
    await advanceToRouteDetail(page);
    await expect(page.getByTestId('route-detail')).toBeVisible();
    await expect(page.getByTestId('road-badge')).toContainText('概算時間を使用');
  });

  test('1駅だけでは作成できない（2駅以上の案内）', async ({ page }) => {
    await page.route('**router.project-osrm.org/**', (route) => route.abort());
    await page.clock.install({ time: DAY });
    await page.goto('/');
    await closeBanners(page);
    await enterManualSelect(page);
    await tapStation(page, ST_A);
    await expect(page.getByTestId('route-select-min-hint')).toContainText('2駅以上選んでください');
    await expect(page.getByTestId('route-select-create')).toBeDisabled();
  });

  test('シナリオ2: 順番の最適化 - 選んだ順/自動調整で同じ駅集合、行き先は変わらない', async ({ page }) => {
    test.setTimeout(120000); // 2回のルート作成を含むため既定の60秒より余裕を持たせる
    await page.route('**router.project-osrm.org/**', (route) => route.abort());
    await page.clock.install({ time: DAY });
    await page.goto('/');
    await closeBanners(page);
    await enterManualSelect(page);
    // 意図的に不利な順（ジグザグ）で選択
    await tapStation(page, ST_D);
    await tapStation(page, ST_A);
    await tapStation(page, ST_E);
    await tapStation(page, ST_B);

    await page.getByTestId('route-select-create').click();
    await pickOriginStation(page, ST_D);

    // このシナリオは順番の検証が目的のため、時間制限は外しておく（4駅が離れており既定4時間では収まらない）
    await page.getByTestId('budget-unlimited').click();

    // 選んだ順のまま作成
    await page.getByTestId('order-mode-selected').click();
    await page.getByTestId('manual-submit').click();
    await advanceToRouteDetail(page);
    await expect(page.getByTestId('route-detail')).toContainText('選んだ順番のまま作成しました');
    const namesSelected = await page.locator('[data-testid="route-timeline"] li:has(.badge) b').allTextContents();
    expect(namesSelected.length).toBe(4);

    // 戻って自動調整で作り直す
    await page.getByTestId('route-detail-back').click();
    await page.getByTestId('route-back').click();
    await page.getByTestId('budget-unlimited').click();
    await page.getByTestId('order-mode-optimized').click();
    await page.getByTestId('manual-submit').click();
    await advanceToRouteDetail(page);
    // 自動調整で順番が変わった場合は理由文に出る（変わらなかった場合は選んだ順と同じ理由になる）
    const reasonText = await page.getByTestId('route-detail').innerText();
    expect(reasonText).toMatch(/順番を調整しました|選んだ順番のまま作成しました/);
    const namesOptimized = await page.locator('[data-testid="route-timeline"] li:has(.badge) b').allTextContents();
    // 同じ4駅が含まれる（未選択駅が紛れ込んでいない）。表示は「N. 道の駅 名前」のため
    // 番号を取り除いてから比較する（番号つきのまま比べると常に1,2,3,4順になり集合比較にならない）
    const stripOrderPrefix = (s: string) => s.replace(/^\d+\.\s*道の駅\s*/, '');
    expect(namesOptimized.length).toBe(4);
    expect([...namesOptimized].map(stripOrderPrefix).sort()).toEqual(
      [...namesSelected].map(stripOrderPrefix).sort(),
    );
  });

  test('シナリオ3: 時間超過 - 除外候補を提示し、確認後だけ除外する', async ({ page }) => {
    // 30秒の超過待ちポーリング＋advanceToRouteDetailの60秒ポーリングを内包するため、既定の60秒では不足しうる
    test.setTimeout(120_000);
    await page.route('**router.project-osrm.org/**', (route) => route.abort());
    await page.clock.install({ time: DAY });
    await page.goto('/');
    await closeBanners(page);
    await enterManualSelect(page);
    await tapStation(page, ST_A);
    await tapStation(page, ST_B);
    await tapStation(page, ST_C);
    await tapStation(page, ST_D);
    await tapStation(page, ST_E);

    await page.getByTestId('route-select-create').click();
    await pickOriginStation(page, ST_A);
    await page.getByTestId('budget-limited').click();
    // 明らかに収まらない短時間を指定
    await page.getByLabel('お出かけ時間を分で入力').fill('60');
    await page.getByTestId('manual-submit').click();

    // 順番調整の確認画面が挟まることがある（実OSRM応答待ちを含むためポーリングで待つ）
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && !(await page.getByTestId('over-budget').isVisible().catch(() => false))) {
      const order = page.getByTestId('order-review-keep');
      if (await order.isVisible().catch(() => false)) {
        await order.click();
        continue;
      }
      await page.waitForTimeout(300);
    }
    await expect(page.getByTestId('over-budget')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('over-budget')).toContainText('選択した5件をすべて回ると約');
    await expect(page.getByTestId('over-budget')).toContainText('超えます');

    // 駅が勝手に削除されていない（選択バー等の状態には触れないが、除外候補UIが出るのみ）
    await page.getByTestId('over-budget-fit').click();
    await expect(page.getByTestId('over-budget-fit-result')).toBeVisible();
    const excludedText = await page.getByTestId('over-budget-fit-result').innerText();
    expect(excludedText.length).toBeGreaterThan(0);

    // ユーザー確認後にだけ除外を確定する
    const confirmBtn = page.getByTestId('over-budget-fit-confirm');
    if (await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click();
      await advanceToRouteDetail(page);
      await expect(page.getByTestId('route-detail')).toBeVisible();
    } else {
      // 除外なしで収まる場合は「除外しなくても時間内」の表示のみ
      await expect(page.getByTestId('over-budget-fit-result')).toContainText('除外しなくても時間内に収まります');
    }
  });

  test('シナリオ3b: 「時間を超えてこのまま作成」で全駅のまま作成する', async ({ page }) => {
    // シナリオ3と同様、複数のポーリング待ちを内包するため既定の60秒では不足しうる
    test.setTimeout(120_000);
    await page.route('**router.project-osrm.org/**', (route) => route.abort());
    await page.clock.install({ time: DAY });
    await page.goto('/');
    await closeBanners(page);
    await enterManualSelect(page);
    await tapStation(page, ST_A);
    await tapStation(page, ST_B);
    await tapStation(page, ST_C);

    await page.getByTestId('route-select-create').click();
    await pickOriginStation(page, ST_A);
    await page.getByLabel('お出かけ時間を分で入力').fill('60');
    await page.getByTestId('manual-submit').click();
    {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline && !(await page.getByTestId('over-budget').isVisible().catch(() => false))) {
        const order = page.getByTestId('order-review-keep');
        if (await order.isVisible().catch(() => false)) {
          await order.click();
          continue;
        }
        await page.waitForTimeout(300);
      }
    }
    await expect(page.getByTestId('over-budget')).toBeVisible({ timeout: 5000 });
    await page.getByTestId('over-budget-force').click();
    await advanceToRouteDetail(page);
    const names = await page.locator('[data-testid="route-timeline"] li:has(.badge) b').allTextContents();
    expect(names.length).toBe(3); // 3駅とも含まれる（黙って削除されない）
  });

  test('シナリオ4: 営業時間警告 - 深夜出発では警告が出るが勝手に除外しない', async ({ page }) => {
    await page.route('**router.project-osrm.org/**', (route) => route.abort());
    await page.clock.install({ time: NIGHT });
    await page.goto('/');
    await closeBanners(page);
    await enterManualSelect(page);
    await tapStation(page, ST_A);
    await tapStation(page, ST_B);

    await page.getByTestId('route-select-create').click();
    await pickOriginStation(page, ST_A);
    await page.getByTestId('manual-submit').click();

    {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline && !(await page.getByTestId('hours-review').isVisible().catch(() => false))) {
        const order = page.getByTestId('order-review-keep');
        if (await order.isVisible().catch(() => false)) {
          await order.click();
          continue;
        }
        await page.waitForTimeout(300);
      }
    }
    await expect(page.getByTestId('hours-review')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('hours-review-row').first()).toContainText('営業時間外となる可能性があります');
    await expect(page.getByTestId('hours-review-official').first()).toBeVisible();
    // 「このまま含める」を押しても記録には触れない
    await page.getByTestId('hours-review-keep').first().click();
    await expect(page.getByTestId('hours-review-keep').first()).toContainText('確認済み');
    await page.getByTestId('hours-review-continue').click();
    await advanceToRouteDetail(page, 15000);
    // 勝手に除外されていない（2駅とも含まれる）
    const names = await page.locator('[data-testid="route-timeline"] li:has(.badge) b').allTextContents();
    expect(names.length).toBe(2);
  });

  test('シナリオ5: 旅行中 - このコースで出発→ナビ→到着/スタンプ→終了で記録される', async ({ page }) => {
    await page.route('**router.project-osrm.org/**', (route) => route.abort());
    await page.clock.install({ time: DAY });
    await page.goto('/');
    await closeBanners(page);
    await enterManualSelect(page);
    await tapStation(page, ST_A);
    await tapStation(page, ST_B);
    await page.getByTestId('route-select-create').click();
    await pickOriginStation(page, ST_A);
    await page.getByTestId('manual-submit').click();
    await advanceToRouteDetail(page);

    await page.getByTestId('trip-start').click();
    await expect(page.getByTestId('trip-view')).toBeVisible();
    await expect(page.getByTestId('trip-nav')).toBeVisible();
    await page.getByTestId('trip-arrived').click();
    await page.getByTestId('trip-stamp').click();
    const finishBtn = page.getByTestId('trip-finish-btn').first();
    await finishBtn.click();
    await expect(page.getByTestId('trip-finish')).toBeVisible();
    await page.getByTestId('trip-apply').click();
    await expect(page.getByTestId('stats-visited')).not.toContainText('0／1237駅');
  });

  test('シナリオ6: モード競合 - 通常タップ→詳細シート、選択モード中はタップで選択追加（シートは開かない）、終了後は詳細シートに復帰', async ({
    page,
  }) => {
    await page.route('**router.project-osrm.org/**', (route) => route.abort());
    await page.clock.install({ time: DAY });
    await page.goto('/');
    await closeBanners(page);

    // 通常モード: タップで詳細シートが開き、シート内ボタンで状態変更する
    await tapStation(page, ST_A);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await page.getByTestId('btn-visited').click();
    await expect(page.locator(`.rs-marker.visited[data-sid="${ST_A}"]`)).toBeVisible({ timeout: 10000 });
    await page.getByTestId('sheet-x').click();

    // 選択モードへ
    await page.getByTestId('tab-route').click();
    await page.getByTestId('course-mode-manual').click();
    await expect(page.getByTestId('route-select-bar')).toBeVisible();

    // 同じ駅をタップ→詳細シートは開かず選択に追加されるだけで、色・訪問記録は変わらない
    await tapStation(page, ST_A);
    await expect(page.getByTestId('route-select-count')).toContainText('1駅選択中');
    await expect(page.getByTestId('station-sheet')).toHaveCount(0);
    await expect(page.locator(`.rs-marker.visited[data-sid="${ST_A}"]`)).toBeVisible(); // 赤のまま
    await expect(page.getByTestId('stats-visited')).toContainText('1／1237駅'); // タップ前と同じ（増えない）

    // 選択モード終了
    await page.getByTestId('route-select-exit').click();
    await expect(page.getByTestId('route-select-bar')).toHaveCount(0);

    // 通常モードへ復帰: 同じ駅をタップすると詳細シートが開く（状態は変えない）。シート内ボタンで変更できる
    await tapStation(page, ST_A);
    await expect(page.getByTestId('station-sheet')).toBeVisible();
    await page.getByTestId('btn-want').click();
    await expect(page.locator(`.rs-marker.want[data-sid="${ST_A}"]`)).toBeVisible({ timeout: 10000 });
  });

  test('シナリオ7a: 選択中の再読み込みで下書きを再開できる', async ({ page }) => {
    await page.route('**router.project-osrm.org/**', (route) => route.abort());
    await page.clock.install({ time: DAY });
    await page.goto('/');
    await closeBanners(page);
    await enterManualSelect(page);
    await tapStation(page, ST_A);
    await tapStation(page, ST_B);
    await tapStation(page, ST_C);
    await expect(page.getByTestId('route-select-count')).toContainText('3駅選択中');

    await page.reload();
    await expect(page.getByRole('dialog', { name: '前回の続きがあります' })).toBeVisible({ timeout: 10000 });
    await page.getByTestId('confirm-ok').click();
    // 出発地点未設定だったため、選択内容を保ったまま出発地点の入力画面へ直接戻る
    await expect(page.getByTestId('manual-selection-summary')).toContainText('選んだ3件');
  });

  test('シナリオ7b: バックアップの書き出し・復元に選択下書きが含まれる', async ({ page }) => {
    await page.route('**router.project-osrm.org/**', (route) => route.abort());
    await page.clock.install({ time: DAY });
    await page.goto('/');
    await closeBanners(page);
    await enterManualSelect(page);
    await tapStation(page, ST_A);
    await tapStation(page, ST_B);
    await expect(page.getByTestId('route-select-count')).toContainText('2駅選択中');

    await page.getByTestId('tab-records').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('backup-export').click()]);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      stream!.on('data', (c) => chunks.push(c as Buffer));
      stream!.on('end', () => resolve());
      stream!.on('error', reject);
    });
    const data = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    expect(data.schemaVersion).toBe(2);
    expect(data.manualDraft.selectedIds).toEqual([ST_A, ST_B]);

    // 既存訪問記録は正しく残ったまま（このテストでは未変更=空のはず）
    expect(data.visits).toEqual({});
  });
});
