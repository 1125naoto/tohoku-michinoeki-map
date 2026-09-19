import { expect, test, type Page } from '@playwright/test';

/**
 * 先行モニター販売サイト（/monitor/）のE2E。本番ビルド('live')の状態を検証する:
 * Ownerの確認が済むまでは「受付準備中」で、購入ボタンが出ない。
 * （受付中の見た目・CTA・解約導線などは、単体テストとMONITOR_MODE=testビルドで検証）
 */

const PAGES = [
  { path: 'monitor/', h1: '全国の道の駅を、記録して、ルートにして、めぐる。' },
  { path: 'monitor/terms/', h1: '利用規約' },
  { path: 'monitor/privacy/', h1: 'プライバシーポリシー' },
  { path: 'monitor/tokushoho/', h1: '特定商取引法に基づく表記' },
  { path: 'monitor/contact/', h1: 'お問い合わせ・改善要望' },
  { path: 'monitor/thanks/', h1: '先行モニターのご案内' },
];

async function noHorizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
}

test.describe('先行モニター販売サイト @smoke', () => {
  for (const p of PAGES) {
    test(`${p.path} が表示され、アプリ本体ではなく、横スクロールが出ない`, async ({ page }) => {
      const res = await page.goto(`/${p.path}`);
      expect(res?.status()).toBe(200);
      await expect(page.locator('h1').first()).toHaveText(p.h1);
      // SPA（アプリ本体）に吸われていない
      await expect(page.locator('#root')).toHaveCount(0);
      expect(await noHorizontalOverflow(page)).toBe(true);
      // 受付準備中の間は検索エンジンへ出さない
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow');
    });
  }

  test('受付準備中: LPに購入ボタン・Stripe・アプリ本体へのリンクがない', async ({ page }) => {
    await page.goto('/monitor/');
    await expect(page.locator('.notice')).toContainText('現在、先行モニターの受付準備中です');
    await expect(page.locator('a.btn')).toHaveCount(0);
    const hrefs = await page.locator('a[href]').evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
    expect(hrefs.filter((h) => /stripe\.com/.test(h))).toEqual([]);
    // 価格の表示: 先行モニター250円 / 正式版500円は「予定」
    await expect(page.getByText('月額250円').first()).toBeVisible();
    await expect(page.getByText('月額500円').first()).toBeVisible();
    await expect(page.getByText('を予定').first()).toBeVisible();
  });

  test('フッターから 規約・プライバシー・特商法・お問い合わせ へ移動でき、戻れる', async ({ page }) => {
    await page.goto('/monitor/');
    for (const [name, h1] of [
      ['利用規約', '利用規約'],
      ['プライバシーポリシー', 'プライバシーポリシー'],
      ['特定商取引法に基づく表記', '特定商取引法に基づく表記'],
      ['お問い合わせ・改善要望', 'お問い合わせ・改善要望'],
    ]) {
      await page.locator('footer nav').getByRole('link', { name }).click();
      await expect(page.locator('h1').first()).toHaveText(h1);
      await page.goBack();
      await expect(page.locator('h1').first()).toHaveText(PAGES[0].h1);
    }
  });

  test('リンク切れがない: 全ページのサイト内リンクが200で、アプリ本体（SPA）にならない', async ({ page, request }) => {
    const targets = new Set<string>();
    for (const p of PAGES) {
      await page.goto(`/${p.path}`);
      const hrefs = await page.locator('a[href]').evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
      for (const h of hrefs) if (h.startsWith('/monitor/')) targets.add(h);
    }
    expect(targets.size).toBeGreaterThanOrEqual(5);
    for (const t of targets) {
      const r = await request.get(t);
      expect(r.status(), t).toBe(200);
      expect(await r.text(), t).not.toContain('id="root"');
    }
  });

  test('特商法・規約: 確認済みの事業者情報と暫定方針（返金・解約・税込・制定日）が表示される', async ({ page }) => {
    await page.goto('/monitor/tokushoho/');
    const t = await page.locator('main').innerText();
    expect(t).toContain('請求があった場合、遅滞なく開示します');
    expect(t).toContain('先行モニター価格（月額250円）は税込です。');
    expect(t).toContain('原則として返金いたしません');
    expect(t).toContain('次回以降の請求は発生しません');
    expect(t).toContain('2026年9月19日');
    expect(t).not.toContain('（テスト用ダミー');
    await page.goto('/monitor/');
    await expect(page.locator('.price .box').first()).toContainText('月額250円（税込）');
  });

  test('アプリ本体（/）は従来どおり表示される（販売サイト追加で壊れていない）', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#root')).toHaveCount(1);
    await expect(page).toHaveTitle(/道の駅ナビ/);
  });

  test('Service Workerが /monitor/ をprecache・SPAフォールバックしない（古いHTMLや吸い込みの防止）', async ({ request }) => {
    const sw = await (await request.get('/sw.js')).text();
    expect(sw).not.toContain('monitor/');
    expect(sw).toMatch(/denylist:\s*\[\s*\/\\\/monitor\(\\\/\|\$\)\/\s*\]/);
  });
});
