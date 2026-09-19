import { expect, test, type Page } from '@playwright/test';

/**
 * 公式ホームページ＋販売LP（プレビュー: /official/）のE2E。ビルド済みdistを配信して検証する。
 * 公式ドメイン稼働用の出力（canonical/robots/sitemap）は単体テスト（src/officialSite/render.test.ts）で網羅。
 */
const PAYMENT_LINK = 'https://buy.stripe.com/bJe5kE3eheQO8XYaa07Zu00';
const PATH = '/official/';

async function noHorizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
}

async function scrollThrough(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 80));
    }
    window.scrollTo(0, 0);
  });
}

test.describe('公式HP＋販売LP（プレビュー） @smoke', () => {
  test('表示・横スクロールなし・全画像が読み込まれる・コンソールエラーなし・アプリ本体に吸われない', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
    });
    const res = await page.goto(PATH);
    expect(res?.status()).toBe(200);
    await expect(page.locator('#root')).toHaveCount(0);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toContainText('次の道の駅、どこ行こう？');
    await scrollThrough(page);
    await page.waitForFunction(() => [...document.images].every((i) => i.complete), undefined, { timeout: 15000 });
    expect(await noHorizontalOverflow(page)).toBe(true);
    const broken = await page.evaluate(() => [...document.images].filter((i) => !(i.complete && i.naturalWidth > 0)).map((i) => i.src));
    expect(broken).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('10のパネルが順に並び、はみ出す要素がない', async ({ page }) => {
    await page.goto(PATH);
    await scrollThrough(page);
    const ids = await page.locator('section.panel h1, section.panel h2').evaluateAll((els) => els.map((e) => e.id));
    expect(ids).toEqual(['h-top', 'h-pain', 'h-map', 'h-stamp', 'h-tap', 'h-poi', 'h-route', 'h-own', 'h-go', 'h-cta', 'h-faq']);
    const wide = await page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      return [...document.querySelectorAll('body *')]
        .filter((e) => e.getBoundingClientRect().right > w + 1 && getComputedStyle(e).position !== 'fixed')
        .map((e) => `${e.tagName}.${(e as HTMLElement).className}`);
    });
    expect(wide).toEqual([]);
  });

  test('購入CTAが3か所以上・すべて既存のStripe Payment Linkで、押せる大きさ', async ({ page }) => {
    await page.goto(PATH);
    const links = page.locator('a[data-checkout]');
    expect(await links.count()).toBeGreaterThanOrEqual(3);
    const hrefs = await links.evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).href));
    for (const h of hrefs) expect(h).toBe(PAYMENT_LINK);
    // インラインCTA（スティッキー以外）の高さは44px以上
    const heights = await page.locator('a[data-checkout]:not(.sticky-cta *)').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
    await expect(page.locator('a[data-checkout]').first()).toHaveText('月額250円で始める');
  });

  test('utm_* と ?s= が Stripe の client_reference_id に引き継がれる（Payment Link本体は不変）', async ({ page }) => {
    await page.goto(`${PATH}?utm_source=tiktok&utm_medium=video&utm_campaign=launch1`);
    let href = await page.locator('a[data-checkout]').first().getAttribute('href');
    expect(href).toBe(`${PAYMENT_LINK}?client_reference_id=tiktok_video_launch1`);
    await page.goto(`${PATH}?s=l`);
    href = await page.locator('a[data-checkout]').first().getAttribute('href');
    expect(href).toBe(`${PAYMENT_LINK}?client_reference_id=line_lp`);
    await page.goto(PATH);
    href = await page.locator('a[data-checkout]').first().getAttribute('href');
    expect(href).toBe(PAYMENT_LINK);
  });

  test('LINE CTAは、友だち追加URLが確定するまで出ない（仮URLなし）', async ({ page }) => {
    await page.goto(PATH);
    await expect(page.locator('a[data-line]')).toHaveCount(0);
    expect(await page.content()).not.toMatch(/lin\.ee|line\.me/);
  });

  test('プレビューは noindex・canonicalはプレビュー自身、OGP/Twitterカードがある', async ({ page }) => {
    await page.goto(PATH);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow');
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toMatch(/\/official\/$/);
    expect(canonical).not.toContain('michinavi.jp');
    await expect(page.locator('meta[property="og:title"]')).toHaveCount(1);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
    await expect(page.locator('meta[name="description"]')).toHaveCount(1);
  });

  test('画像の総転送量が軽い（1.5MB未満）・レイアウトシフトが小さい', async ({ page }) => {
    let bytes = 0;
    page.on('response', async (r) => {
      if (r.url().includes('/official/img/')) {
        const len = Number(r.headers()['content-length'] ?? 0);
        bytes += len;
      }
    });
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((l) => {
        for (const e of l.getEntries() as unknown as Array<{ hadRecentInput: boolean; value: number }>) if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto(PATH);
    await scrollThrough(page);
    await page.waitForTimeout(800);
    expect(bytes).toBeLessThan(1_500_000);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls).toBeLessThan(0.1);
  });

  test('最初の画面から購入CTAに触れる（スティッキー or インライン）。インラインCTAが見えている間はスティッキーが引っ込む', async ({ page }) => {
    await page.goto(PATH);
    if ((page.viewportSize()?.width ?? 0) < 640) {
      await expect(page.locator('.sticky-cta a')).toBeVisible();
      await page.locator('#start a[data-checkout]').scrollIntoViewIfNeeded();
      await expect(page.locator('.sticky-cta')).toBeHidden();
    } else {
      await expect(page.locator('.sticky-cta')).toBeHidden();
    }
    await expect(page.locator('#start a[data-checkout]')).toBeVisible();
  });

  test('規約・特商法・プライバシー・お問い合わせ・解約ページへのリンクがある', async ({ page }) => {
    await page.goto(PATH);
    const hrefs = await page.locator('footer a').evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).href));
    for (const p of ['/monitor/terms/', '/monitor/privacy/', '/monitor/tokushoho/', '/monitor/contact/']) expect(hrefs.some((h) => h.endsWith(p))).toBe(true);
    expect(hrefs).toContain('https://billing.stripe.com/p/login/bJe5kE3eheQO8XYaa07Zu00');
  });
});
