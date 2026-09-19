import { expect, test, type Page } from '@playwright/test';

/**
 * 新リリース・モニター販売サイト（/monitor/）のE2E。本番ビルド('live')の状態を検証する:
 * Ownerが作成したStripe Payment LinkとCustomer Portalが設定され、LPの購入CTAが受付中になっている。
 * （受付準備中・解約ポータル設定あり・testモードの見た目は、単体テストで網羅している）
 *
 * @smoke を付けたテストは、iPhone・Android・タブレット・デスクトップの全プロジェクトで実行される。
 */

const PAYMENT_LINK = 'https://buy.stripe.com/bJe5kE3eheQO8XYaa07Zu00';
const PORTAL_URL = 'https://billing.stripe.com/p/login/bJe5kE3eheQO8XYaa07Zu00';

const PAGES = [
  { path: 'monitor/', h1: '道の駅巡りを、もっと楽しく！' },
  { path: 'monitor/terms/', h1: '利用規約' },
  { path: 'monitor/privacy/', h1: 'プライバシーポリシー' },
  { path: 'monitor/tokushoho/', h1: '特定商取引法に基づく表記' },
  { path: 'monitor/contact/', h1: 'お問い合わせ・改善要望' },
  { path: 'monitor/thanks/', h1: 'お申し込みありがとうございます' },
];

async function noHorizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
}

test.describe('新リリース・モニター販売サイト @smoke', () => {
  for (const p of PAGES) {
    test(`${p.path} が表示され、アプリ本体ではなく、横スクロールが出ず、コンソールエラーが無い`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
      });
      const res = await page.goto(`/${p.path}`);
      expect(res?.status()).toBe(200);
      await expect(page.locator('h1').first()).toHaveText(p.h1);
      // SPA（アプリ本体）に吸われていない
      await expect(page.locator('#root')).toHaveCount(0);
      expect(await noHorizontalOverflow(page)).toBe(true);
      expect(errors).toEqual([]);
    });
  }

  test('検索エンジン: LP・規約類は出してよく、お申込み完了後のご案内ページだけ出さない', async ({ page }) => {
    for (const p of PAGES) {
      await page.goto(`/${p.path}`);
      if (p.path === 'monitor/thanks/') {
        await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow');
      } else {
        await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
      }
    }
  });

  test('LP: 9つのセクション・価格（取り消し線と50% OFF）・モニター説明・FAQ・最終CTAが揃う', async ({ page }) => {
    await page.goto('/monitor/');
    await expect(page.locator('.hero .lead')).toContainText('全国1,237施設を収録');
    await expect(page.locator('h2')).toHaveText([
      'こんな経験ありませんか？',
      'これ1つで、道の駅めぐり',
      '全国1,237施設を収録',
      'ドライブがもっと楽しく',
      '料金',
      '新リリース・モニターについて',
      'よくある質問',
      '次のドライブを、もっと楽しく。',
    ]);
    const box = page.locator('.pricebox');
    await expect(box.locator('s')).toHaveText('月額500円（税込）');
    await expect(box.locator('s')).toHaveCSS('text-decoration-line', 'line-through');
    await expect(box.locator('.now')).toContainText('月額250円');
    await expect(box.locator('.off')).toContainText('50% OFF');
    await expect(page.locator('.pricebox .planname')).toHaveText('新リリース・モニター価格');
    // 有料のモニター募集であり、無料と誤認させない
    await expect(page.locator('main')).toContainText('無料ではありません');
    await expect(page.locator('details')).toHaveCount(8);
  });

  test('購入CTA: すべてStripe Payment Linkへ向き、タップしやすい大きさで、押せる', async ({ page }) => {
    await page.goto('/monitor/');
    const ctas = page.locator('a[data-checkout]');
    expect(await ctas.count()).toBeGreaterThanOrEqual(3);
    const n = await ctas.count();
    for (let i = 0; i < n; i++) {
      const a = ctas.nth(i);
      await expect(a).toHaveAttribute('href', PAYMENT_LINK);
      await expect(a).toHaveText('月額250円で始める');
      await expect(a).toHaveAttribute('rel', /noopener/);
    }
    // ページ内の、Stripeへ向くリンクは、購入用のPayment Linkと、解約用のCustomer Portalだけ
    const stripeHrefs = await page
      .locator('a[href*="stripe.com"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
    for (const h of stripeHrefs) expect([PAYMENT_LINK, PORTAL_URL]).toContain(h);
    // 購入用リンクは、購入CTAだけ（解約導線が購入用リンクにならない）
    expect(stripeHrefs.filter((h) => h === PAYMENT_LINK).length).toBe(n);
    // 押しやすい大きさ（表示されているCTAの高さが48px以上）
    for (let i = 0; i < n; i++) {
      const a = ctas.nth(i);
      if (await a.isVisible()) {
        const box = await a.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(48);
      }
    }
  });

  test('CTAをタップすると、Stripeの決済ページ（Payment Link）へ遷移しようとする', async ({ page }) => {
    await page.goto('/monitor/');
    let requested = '';
    // 実際のStripeには接続しない（決済ページの読み込みを遮断し、遷移先URLだけを検証する）
    await page.route('https://buy.stripe.com/**', (route) => {
      requested = route.request().url();
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>stripe-stub</title>' });
    });
    await page.locator('.hero a[data-checkout]').click();
    await expect(page).toHaveURL(PAYMENT_LINK);
    expect(requested).toBe(PAYMENT_LINK);
  });

  test('流入元の判別: utm が client_reference_id としてStripeへ引き継がれ、遷移先URLは壊れない', async ({ page }) => {
    await page.goto('/monitor/?utm_source=x&utm_medium=social&utm_campaign=launch1');
    const hrefs = await page.locator('a[data-checkout]').evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).href));
    expect(hrefs.length).toBeGreaterThanOrEqual(3);
    for (const h of hrefs) {
      const u = new URL(h);
      expect(u.origin + u.pathname).toBe(PAYMENT_LINK);
      expect(u.searchParams.get('client_reference_id')).toBe('x_social_launch1');
    }
    // UTMが無いときは、リンクを一切変えない
    await page.goto('/monitor/');
    const plain = await page.locator('a[data-checkout]').evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).href));
    for (const h of plain) expect(h).toBe(PAYMENT_LINK);
  });

  test('画面幅に応じたCTA: スマホでは画面下にスティッキーCTAが出て、デスクトップでは出ない。フッターにも隠れない', async ({ page }) => {
    await page.goto('/monitor/');
    const width = page.viewportSize()!.width;
    const sticky = page.locator('.sticky-cta');
    if (width < 640) {
      // ページ内のCTA（ヒーロー）が見えている間は、同じボタンが2つ並ばないよう引っ込んでいる
      await expect(page.locator('body')).toHaveClass(/cta-in-view/);
      await expect(sticky).toBeHidden();
      // 機能紹介など、ページ内にCTAが無い場所まで読み進めると、画面下端にスティッキーCTAが出る
      await page.locator('h2', { hasText: 'これ1つで、道の駅めぐり' }).scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, 300));
      await expect(page.locator('body')).not.toHaveClass(/cta-in-view/);
      await expect(sticky).toBeVisible();
      const box = (await sticky.boundingBox())!;
      const vh = page.viewportSize()!.height;
      expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(vh - 2); // 画面下端に固定
      await expect(sticky.locator('a')).toHaveAttribute('href', PAYMENT_LINK);
      // 最下部までスクロールしても、フッターのリンクがスティッキーCTAに隠れない
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const link = page.locator('footer nav a', { hasText: 'お問い合わせ・改善要望' });
      const lb = (await link.boundingBox())!;
      const sb = (await sticky.boundingBox())!;
      expect(lb.y + lb.height).toBeLessThanOrEqual(sb.y + 1);
    } else {
      await expect(sticky).toBeHidden();
    }
  });

  test('実画面のスクリーンショット3枚が表示され、はみ出さない', async ({ page }) => {
    await page.goto('/monitor/');
    const imgs = page.locator('.shot img');
    await expect(imgs).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      const img = imgs.nth(i);
      await img.scrollIntoViewIfNeeded();
      await expect
        .poll(async () => img.evaluate((e) => (e as HTMLImageElement).complete && (e as HTMLImageElement).naturalWidth), { timeout: 10000 })
        .toBeGreaterThan(0);
      const box = (await img.boundingBox())!;
      expect(box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
    expect(await noHorizontalOverflow(page)).toBe(true);
  });

  test('SNS共有: title・description・OGP・Twitterカードがある', async ({ page }) => {
    await page.goto('/monitor/');
    await expect(page).toHaveTitle(/道の駅ナビ 全国版.*1,237施設を収録.*月額250円/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /全国1,237施設を収録/);
    await expect(page.locator('meta[property="og:title"]')).toHaveCount(1);
    await expect(page.locator('meta[property="og:description"]')).toHaveCount(1);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /^https:\/\/.+og-image\.png$/);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /width=device-width/);
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

  test('お申込み完了後のご案内ページ: アプリを開く導線・使い方・問い合わせ・解約', async ({ page }) => {
    await page.goto('/monitor/thanks/');
    const open = page.getByRole('link', { name: '道の駅ナビを開く' });
    await expect(open).toHaveAttribute('href', 'https://1125naoto.github.io/tohoku-michinoeki-map/');
    await expect(page.locator('main')).toContainText('月額250円の新リリース・モニターに、ご参加いただきありがとうございます');
    await expect(page.locator('main')).toContainText('かんたんな使い方');
    await expect(page.locator('main')).toContainText('解約は、いつでも手続きできます');
    await expect(page.locator('main')).not.toContainText('お問い合わせ（otakarafinder'); // 旧暫定の「メールで解約」表記が無い
    await expect(page.locator('a[href^="mailto:"]').first()).toBeVisible();
    await expect(page.getByRole('link', { name: '契約内容・お支払い方法の確認／解約はこちら' })).toHaveAttribute('href', PORTAL_URL);
  });

  test('特商法・規約: 確認済みの事業者情報と暫定方針（返金・解約・税込・制定日）が表示される', async ({ page }) => {
    await page.goto('/monitor/tokushoho/');
    const t = await page.locator('main').innerText();
    expect(t).toContain('請求があった場合、遅滞なく開示します');
    expect(t).toContain('新リリース・モニター価格（月額250円）は税込です。');
    expect(t).toContain('原則として返金いたしません');
    expect(t).toContain('次回以降の請求は発生しません');
    expect(t).toContain('2026年9月19日');
    expect(t).toContain('道の駅ナビ 全国版');
    expect(t).not.toContain('（テスト用ダミー');
  });

  test('Customer Portal導線: フッター（全ページ）・FAQ・決済後ページの「契約内容・お支払い方法の確認／解約」がPortalへ向く', async ({ page }) => {
    for (const p of PAGES) {
      await page.goto(`/${p.path}`);
      await expect(page.locator('footer nav').getByRole('link', { name: '契約内容の確認・解約' }), p.path).toHaveAttribute('href', PORTAL_URL);
    }
    await page.goto('/monitor/');
    await page.locator('details', { hasText: '解約できますか？' }).locator('summary').click();
    const faqLink = page.locator('details', { hasText: '解約できますか？' }).getByRole('link');
    await expect(faqLink).toHaveAttribute('href', PORTAL_URL);
    await expect(faqLink).toContainText('契約内容・お支払い方法の確認／解約');
    await expect(page.locator('details', { hasText: '解約できますか？' })).toContainText('ご購入時のメールアドレスを入力すると、管理ページへのリンクがメールで届きます。');
    // 「メールで連絡しないと解約できない」旧暫定表記が、どのページにも残っていない
    for (const p of PAGES) {
      await page.goto(`/${p.path}`);
      const t = await page.locator('main').innerText();
      expect(t, p.path).not.toMatch(/へのご連絡により、いつでも解約|メールで解約|解約をご希望の場合/);
    }
  });

  test('Customer Portalのリンクをタップすると、Portalのログインページ（Stripe）へ遷移する', async ({ page }) => {
    await page.goto('/monitor/thanks/');
    let requested = '';
    await page.route('https://billing.stripe.com/**', (route) => {
      requested = route.request().url();
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>portal-stub</title>' });
    });
    await page.getByRole('link', { name: '契約内容・お支払い方法の確認／解約はこちら' }).click();
    await expect(page).toHaveURL(PORTAL_URL);
    expect(requested).toBe(PORTAL_URL);
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
