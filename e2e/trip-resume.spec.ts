import { expect, test, type Page } from '@playwright/test';
import { AREA_SELECTION_KEY, AREA_SESSION_KEY } from './helpers';

/**
 * Owner iPhone実機で再現した白画面の回帰確認。
 *
 * 旅行中の画面から戻る操作・他アプリからの復帰を行っても、アプリの描画が消えず
 * （Reactのrootが空にならず）、旅行中の状態が保たれ、そのまま操作を続けられること。
 *
 * 原因だったService Worker更新の適用タイミングそのものは lib/swUpdate.ts の
 * 単体テストで直接検証している。ここでは利用者から見た結果（白くならない）を担保する。
 * 地図タップは使わず、旅行中の状態を直接用意して復帰の挙動だけを見る。
 */

const ST_A = 'mne-19038'; // 季の里天栄（福島県）
const ST_B = 'mne-19029'; // たまかわ（福島県）
const ROUTE_ID = 'e2e-trip-route';

/** 旅行中（TripState）の状態を端末に用意した状態で開く */
async function seedTrip(page: Page, preVisits: Record<string, 'stamped' | 'visited'> = {}) {
  await page.addInitScript(
    ([areaKey, sessionKey, routesKey, tripKey, stA, stB, routeId, visitsKey, pre]) => {
      try {
        localStorage.setItem(areaKey as string, JSON.stringify({ prefectures: ['福島県'] }));
        sessionStorage.setItem(sessionKey as string, '1');
        const depart = '2026-05-10T00:00:00.000Z';
        const stop = (id: string, h: number) => ({
          stationId: id,
          arriveAt: `2026-05-10T0${h}:00:00.000Z`,
          departAt: `2026-05-10T0${h}:30:00.000Z`,
          stayMin: 30,
          stopType: 'station',
        });
        const leg = { fromId: null, toId: null, distanceKm: 12, driveMin: 20, unreachable: false };
        localStorage.setItem(
          routesKey as string,
          JSON.stringify([
            {
              id: routeId,
              name: 'E2E旅行中コース',
              createdAt: depart,
              done: false,
              route: {
                key: 'manual',
                title: 'E2E旅行中コース',
                reason: '',
                stops: [stop(stA as string, 1), stop(stB as string, 2)],
                legs: [leg, leg, leg],
                totalMin: 120,
                driveMin: 60,
                stayTotalMin: 60,
                marginMin: 10,
                totalKm: 24,
                newCount: 2,
                wantCount: 0,
                returnAt: '2026-05-10T04:00:00.000Z',
                roadData: 'approx',
                hoursSummary: { open: 2, closing: 0, closed: 0, unknown: 0 },
                params: {
                  origin: { lat: 37.2436603, lng: 140.2447857, label: '出発地点' },
                  departAt: depart,
                  budgetMin: 240,
                  stayMin: 30,
                  returnToStart: true,
                  roadPref: 'highway_ok',
                  priority: 'unvisited',
                  prefs: [],
                },
              },
            },
          ]),
        );
        localStorage.setItem(
          tripKey as string,
          JSON.stringify({ savedRouteId: routeId, startedAt: depart, progress: {} }),
        );
        const preMap = pre as Record<string, string>;
        if (Object.keys(preMap).length > 0 && localStorage.getItem(visitsKey as string) == null) {
          const at = '2026-01-01T00:00:00.000Z';
          const v: Record<string, unknown> = {};
          for (const [id, state] of Object.entries(preMap)) {
            v[id] = {
              state,
              visitedAt: at,
              wishlistAt: null,
              stampAt: state === 'stamped' ? at : null,
              updatedAt: at,
            };
          }
          localStorage.setItem(visitsKey as string, JSON.stringify(v));
        }
      } catch {
        /* noop */
      }
    },
    [
      AREA_SELECTION_KEY,
      AREA_SESSION_KEY,
      'tohoku-me:routes:v1',
      'tohoku-me:trip:v1',
      ST_A,
      ST_B,
      ROUTE_ID,
      'tohoku-me:visits:v2',
      preVisits,
    ] as const,
  );
}

async function openTripView(page: Page) {
  await page.goto('/');
  const banner = page.getByTestId('a2hs-banner');
  if (await banner.isVisible().catch(() => false)) await page.getByTestId('a2hs-close').click();
  await page.getByTestId('tab-route').click();
  await expect(page.getByTestId('trip-view')).toBeVisible({ timeout: 20000 });
}

test.describe('旅行中からの復帰（白画面の回帰）@webkit', () => {
  test.use({ serviceWorkers: 'block' });

  test('旅行中に画面を離れて戻ってもアプリが白くならず、旅行を続けられる @webkit', async ({ page }) => {
    await seedTrip(page);
    await openTripView(page);
    await expect(page.getByTestId('trip-current')).toBeVisible();
    const currentName = await page.getByTestId('trip-current').textContent();

    // 1. 旅行中は「操作中」として扱われ、この間に自動再読み込みをさせない
    expect(await page.evaluate(() => (window as unknown as { __michinoekiBusy?: boolean }).__michinoekiBusy)).toBe(
      true,
    );

    // 2. 戻る操作・他アプリへの切り替え相当（hidden → pagehide → 復帰）
    await page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pagehide'));
    });
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      window.dispatchEvent(new Event('focus'));
    });
    await page.waitForTimeout(800);

    // 3. Reactのrootが空になっていない（＝白画面ではない）
    expect(await page.evaluate(() => document.getElementById('root')?.childElementCount ?? 0)).toBeGreaterThan(0);
    await expect(page.getByTestId('error-screen')).toHaveCount(0);

    // 4. 旅行中の状態が保持されている
    await expect(page.getByTestId('trip-view')).toBeVisible();
    await expect(page.getByTestId('trip-current')).toHaveText(currentName ?? '');

    // 5. そのまま操作を続けられる（到着→次の駅へ）
    await expect(page.getByTestId('trip-nav')).toBeVisible();
    await page.getByTestId('trip-arrived').click();
    await expect(page.getByTestId('trip-arrived')).toContainText('到着済み');
    await page.getByTestId('trip-next').click();
    await expect(page.getByTestId('trip-progress')).toContainText('1／');
  });

  test('旅行中に再読み込みしても白画面にならず、旅行中の状態から再開できる @webkit', async ({ page }) => {
    await seedTrip(page);
    await openTripView(page);
    await expect(page.getByTestId('trip-current')).toBeVisible();

    await page.reload();
    await page.getByTestId('tab-route').click();

    expect(await page.evaluate(() => document.getElementById('root')?.childElementCount ?? 0)).toBeGreaterThan(0);
    await expect(page.getByTestId('error-screen')).toHaveCount(0);
    await expect(page.getByTestId('trip-view')).toBeVisible();
    await expect(page.getByTestId('trip-nav')).toBeVisible();
    // 訪問記録は復帰だけでは変化しない
    await expect(page.getByTestId('stats-visited')).toContainText('0／1237駅');
  });

  test('スタンプ取得ボタン: 取得で深緑＋「スタンプ取得済み」になり、次の駅へは誤記録せず、再読み込み後も維持 @webkit', async ({
    page,
  }) => {
    await seedTrip(page);
    await openTripView(page);
    const stamp = page.getByTestId('trip-stamp');

    // 1. 未取得の駅では未取得表示
    await expect(stamp).toHaveText('印 スタンプ取得');
    await expect(stamp).not.toHaveClass(/trip-stamp-done/);
    const firstName = await page.getByTestId('trip-current').textContent();

    // 2. タップ → 対象駅にスタンプ記録 → ボタンが深緑＋「スタンプ取得済み」
    await stamp.click();
    await expect(page.getByTestId('stats-stamped')).toContainText('1');
    await expect(stamp).toHaveText('印 スタンプ取得済み');
    await expect(stamp).toHaveClass(/trip-stamp-done/);
    await expect(stamp).toHaveAttribute('aria-pressed', 'true');
    const bg = await stamp.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe('rgb(31, 107, 74)'); // 訪問済みマーカーと同じ深緑 #1f6b4a
    // 同じ駅のまま（スタンプを押しても勝手に次へ進まない）
    await expect(page.getByTestId('trip-current')).toHaveText(firstName ?? '');

    // 5. 再読み込みしても取得済み表示を維持
    await page.reload();
    await page.getByTestId('tab-route').click();
    await expect(page.getByTestId('trip-stamp')).toHaveText('印 スタンプ取得済み');

    // 3. 次の駅へ → 次駅は未取得表示のまま（スタンプが誤記録されていない）
    await page.getByTestId('trip-next').click();
    await expect(page.getByTestId('trip-current')).not.toHaveText(firstName ?? '');
    await expect(page.getByTestId('trip-stamp')).toHaveText('印 スタンプ取得');
    await expect(page.getByTestId('stats-stamped')).toContainText('1');
  });

  test('スタンプ取得ボタン: 既に取得済みの駅へ再訪すると最初から取得済み表示 @webkit', async ({ page }) => {
    // 4. 1駅目（季の里天栄）を以前にスタンプ取得済みの状態で旅行を開始する
    await seedTrip(page, { [ST_A]: 'stamped' });
    await openTripView(page);
    await expect(page.getByTestId('trip-stamp')).toHaveText('印 スタンプ取得済み');
    await expect(page.getByTestId('trip-stamp')).toHaveClass(/trip-stamp-done/);
    // 「到着した」を押してもスタンプ記録を降格させない（P1-02）
    await page.getByTestId('trip-arrived').click();
    await expect(page.getByTestId('trip-stamp')).toHaveText('印 スタンプ取得済み');
    await expect(page.getByTestId('stats-stamped')).toContainText('1');
  });
});

/**
 * Production v1.1.0 実機不具合の回帰確認: Googleマップ等への外部遷移と復帰（白画面／戻れない問題）。
 *
 * 根本原因: iOSのホーム画面追加PWA（standalone表示）ではwindow.open()が信頼できず、
 * 成功時でもnullを返し得る（iOS/iPadOSの既知の制約）。旧実装はwindow.open()がnullを
 * 返した場合に「ポップアップブロック」とみなし、フォールバックとしてlocation.assign(url)で
 * アプリ自身のルート画面を外部URLへ丸ごと遷移させていた。standalone表示ではこのフォール
 * バックがポップアップブロック以外でも発動しやすく、アプリの状態（React root・旅行中の
 * 進行状況）を巻き込んで壊し、復帰時に白画面や状態消失として現れ得る。「戻る」導線が
 * 無いというOwnerの報告も、この経路ではアプリ自身が外部URLへ置き換わってしまうために
 * 生じていた可能性がある。
 *
 * 修正: 旅行中ナビ（trip-nav/trip-nav-home）・周辺スポット詳細のナビ（poi-detail-nav等、
 * 本ファイルの下のブロック参照）・タップトーストの公式HPリンクを、window.open()を一切
 * 使わないネイティブ<a target="_blank" rel="noopener noreferrer">へ統一した
 * （駅詳細シートの「Googleマップで開く」・完成ルートの分割ナビ等、既存の正常系と同じ方式）。
 * これによりJSのフォールバックによるアプリ自身の遷移は構造的に起こり得なくなる。
 *
 * 注意（過大評価の防止）: ここで使うPlaywrightのiphone(Chromium)・webkit-iphone(WebKit)は、
 * いずれもiOSのホーム画面追加PWA（standalone表示）そのものを再現するものではない。
 * ここで検証できるのは「アプリ自身のページが外部URLへ遷移しないこと」「復帰後に白画面や
 * 状態消失が起きないこと」という、修正によって除去したコード上の危険経路そのものである。
 * standalone表示特有のwindow.open()の挙動は実機（Owner iPhone・ホーム画面追加状態）でのみ
 * 最終確認できる。
 */
test.describe('Googleマップ等への外部遷移と復帰（白画面・戻れない問題の回帰） @webkit', () => {
  test.use({ serviceWorkers: 'block' });

  test('trip-nav: ネイティブアンカーで開き、アプリ自身は遷移せず、復帰後も白画面にならず旅行状態を保つ @webkit', async ({
    page,
    context,
  }) => {
    await seedTrip(page);
    await openTripView(page);
    await expect(page.getByTestId('trip-current')).toBeVisible();
    const currentName = await page.getByTestId('trip-current').textContent();
    const progressBefore = await page.getByTestId('trip-progress').textContent();
    const originUrl = page.url();

    // 1. window.open()ではなく、ネイティブ<a target="_blank" rel="noopener noreferrer">であること
    const navLink = page.getByTestId('trip-nav');
    await expect(navLink).toHaveJSProperty('tagName', 'A');
    expect(await navLink.getAttribute('target')).toBe('_blank');
    expect(await navLink.getAttribute('rel')).toContain('noopener');
    expect(await navLink.getAttribute('href')).toContain('google.com/maps/dir');

    // 2. クリックすると新しいタブでGoogleマップが開く
    const popupPromise = context.waitForEvent('page', { timeout: 8000 }).catch(() => null);
    await navLink.click();
    const popup = await popupPromise;
    expect(popup).not.toBeNull();

    // 3. 最重要: アプリ自身のページは一切遷移していない
    //    （旧実装はwindow.open()失敗時にlocation.assign()でアプリ自身を外部URLへ
    //    丸ごと遷移させていた。この経路が無くなったことを直接確認する）
    expect(page.url()).toBe(originUrl);
    await popup?.close();

    // 4. アプリ自身の状態はそのまま（rootは空にならず、旅行の進行状況も変わらない）
    expect(await page.evaluate(() => document.getElementById('root')?.childElementCount ?? 0)).toBeGreaterThan(0);
    await expect(page.getByTestId('error-screen')).toHaveCount(0);
    await expect(page.getByTestId('trip-view')).toBeVisible();
    await expect(page.getByTestId('trip-current')).toHaveText(currentName ?? '');
    await expect(page.getByTestId('trip-progress')).toHaveText(progressBefore ?? '');

    // 5. 外部アプリ切り替え相当の復帰後も白画面にならず、そのまま操作を続けられる
    await page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pagehide'));
    });
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      window.dispatchEvent(new Event('focus'));
    });
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => document.getElementById('root')?.childElementCount ?? 0)).toBeGreaterThan(0);
    await expect(page.getByTestId('trip-view')).toBeVisible();
    await expect(page.getByTestId('trip-nav')).toBeVisible();
    await page.getByTestId('trip-arrived').click();
    await expect(page.getByTestId('trip-arrived')).toContainText('到着済み');
  });
});
