import { expect, test, type Page } from '@playwright/test';

/**
 * 新リリース・モニター販売サイト（/monitor/）のE2E。本番ビルド('live')の状態を検証する:
 * Ownerが作成したStripe Payment LinkとCustomer Portalが設定され、LPの購入CTAが受付中になっている。
 * （受付準備中・解約ポータル設定あり・testモードの見た目は、単体テストで網羅している）
 *
 * @smoke を付けたテストは、iPhone・Android・タブレット・デスクトップの全プロジェクトで実行される。
 */

// 料金・購入リンクは Stripe Live の実設定（2026-10-10 読み取りで確認: 商品 prod_VHqkd8f4kNSm2y）と照合する。
// config.ts から読み込まず、ここに独立して書く（設定を間違えたらテストが気づくように）。
//   月額: plink_1ULl7H…（price_1ULl7F… 250円/月、3回目のお支払いから price_1ULkA5… 500円/月）
//   年額: plink_1ULkBF…（price_1ULkA7… 4,980円/年）  いずれも税込（tax_behavior=inclusive）
const MONTHLY_LINK = 'https://buy.stripe.com/bJe00kbKNgYW6PQ95W7Zu09';
const ANNUAL_LINK = 'https://buy.stripe.com/9B6fZi5mp9wu7TU4PG7Zu08';
const LINK_BY_PLAN: Record<string, string> = { monthly: MONTHLY_LINK, annual: ANNUAL_LINK };
// 旧・月額250円固定の購入リンク（plink_1UHH4S…、Stripe Live で無効化済み）。購入リンクとして二度と出してはいけない
const OLD_FIXED_250_LINK = 'https://buy.stripe.com/bJe5kE3eheQO8XYaa07Zu00';
const PORTAL_URL = 'https://billing.stripe.com/p/login/bJe5kE3eheQO8XYaa07Zu00';
const MONTHLY_CTA = '月額プランで始める（最初の2か月 250円/月）';
const ANNUAL_CTA = '年間プランで始める（4,980円/年）';

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

  test('LP: セクション・料金（月額: 最初の2か月250円→3か月目以降500円／年間4,980円・税込）・FAQ・最終CTAが揃い、二重価格表示がない', async ({ page }) => {
    await page.goto('/monitor/');
    await expect(page.locator('.hero .lead')).toContainText('全国1,237施設を収録');
    await expect(page.locator('h2')).toHaveText([
      'こんな経験ありませんか？',
      'これ1つで、道の駅めぐり',
      '全国1,237施設を収録',
      'ドライブがもっと楽しく',
      '料金',
      '料金について',
      'よくある質問',
      '次のドライブを、もっと楽しく。',
    ]);
    // 料金表（「料金」と最後のまとめの2か所）: 月額プラン2段・年間プラン1段だけ
    const tables = page.locator('.plans');
    await expect(tables).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
      const monthly = tables.nth(i).locator('.plan-card').nth(0);
      const annual = tables.nth(i).locator('.plan-card').nth(1);
      await expect(monthly.locator('.plan-name')).toHaveText('月額プラン');
      await expect(monthly.locator('.plan-row')).toHaveCount(2);
      await expect(monthly.locator('.plan-row').nth(0).locator('.when')).toHaveText('最初の2か月');
      await expect(monthly.locator('.plan-row').nth(0).locator('.amt')).toHaveText('250円/月（税込）');
      await expect(monthly.locator('.plan-row').nth(1).locator('.when')).toHaveText('3か月目以降');
      await expect(monthly.locator('.plan-row').nth(1).locator('.amt')).toHaveText('500円/月（税込）');
      await expect(annual.locator('.plan-name')).toHaveText('年間プラン');
      await expect(annual.locator('.plan-row .amt')).toHaveText('4,980円/年（税込）');
    }
    const main = page.locator('main');
    // 切り替えの説明: 3回目のお支払いから自動で500円、再申込み不要
    await expect(main).toContainText('最初の2か月（2回目のお支払いまで）が250円/月、3か月目以降（3回目のお支払いから）は自動で500円/月になります。切り替えのための再度のお申込みは不要です。');
    // 年間プランの比較は、基準（500円/月×12か月=6,000円）と月額プランの初年度合計（5,500円）を併記
    await expect(main).toContainText('500円/月で12か月分（6,000円）と比べて1,020円お得です');
    await expect(main).toContainText('月額プランの初年度のお支払い合計は5,500円（250円×2か月＋500円×10か月）');
    // 廃止した表示（旧・250円固定のモニター価格の二重価格表示）が残っていない
    await expect(main.locator('s')).toHaveCount(0);
    await expect(main).not.toContainText('OFF');
    await expect(main).not.toContainText('正式版の予定価格');
    await expect(main).not.toContainText('新リリース・モニター価格');
    await expect(page.locator('details')).toHaveCount(10);
  });

  test('購入CTA: 月額・年間それぞれ正しいStripe Payment Linkへ向き、タップしやすい大きさで、押せる', async ({ page }) => {
    await page.goto('/monitor/');
    const ctas = page.locator('a[data-checkout]');
    expect(await ctas.count()).toBeGreaterThanOrEqual(3);
    const n = await ctas.count();
    const plans: string[] = [];
    for (let i = 0; i < n; i++) {
      const a = ctas.nth(i);
      const plan = (await a.getAttribute('data-plan')) ?? '';
      plans.push(plan);
      expect(['monthly', 'annual']).toContain(plan);
      await expect(a).toHaveAttribute('href', LINK_BY_PLAN[plan]);
      await expect(a).toHaveText(plan === 'monthly' ? MONTHLY_CTA : ANNUAL_CTA);
      await expect(a).toHaveAttribute('rel', /noopener/);
    }
    // 月額（ヒーロー・料金表2か所・スティッキー）と年間（料金表2か所）の両方が買える
    expect(plans.filter((p) => p === 'monthly').length).toBeGreaterThanOrEqual(3);
    expect(plans.filter((p) => p === 'annual').length).toBeGreaterThanOrEqual(2);
    // ページ内の、Stripeへ向くリンクは、購入用の2つのPayment Linkと、解約用のCustomer Portalだけ
    const stripeHrefs = await page
      .locator('a[href*="stripe.com"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
    for (const h of stripeHrefs) expect([MONTHLY_LINK, ANNUAL_LINK, PORTAL_URL]).toContain(h);
    // 無効化済みの旧・250円固定の購入リンクは、どこにも出ない
    expect(await page.content()).not.toContain(OLD_FIXED_250_LINK.replace('https://', ''));
    // 購入用リンクは、購入CTAだけ（解約導線が購入用リンクにならない）
    expect(stripeHrefs.filter((h) => h === MONTHLY_LINK || h === ANNUAL_LINK).length).toBe(n);
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
    await expect(page).toHaveURL(MONTHLY_LINK);
    expect(requested).toBe(MONTHLY_LINK);
  });

  test('年間プランのCTAをタップすると、年間プランのPayment Linkへ遷移しようとする', async ({ page }) => {
    await page.goto('/monitor/');
    let requested = '';
    await page.route('https://buy.stripe.com/**', (route) => {
      requested = route.request().url();
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>stripe-stub</title>' });
    });
    await page.locator('a[data-checkout][data-plan="annual"]').first().click();
    await expect(page).toHaveURL(ANNUAL_LINK);
    expect(requested).toBe(ANNUAL_LINK);
  });

  test('流入元の判別: utm が client_reference_id としてStripeへ引き継がれ、遷移先URLは壊れない', async ({ page }) => {
    await page.goto('/monitor/?utm_source=x&utm_medium=social&utm_campaign=launch1');
    const links = await page
      .locator('a[data-checkout]')
      .evaluateAll((els) => els.map((e) => ({ href: (e as HTMLAnchorElement).href, plan: e.getAttribute('data-plan') ?? '' })));
    expect(links.length).toBeGreaterThanOrEqual(3);
    for (const { href, plan } of links) {
      const u = new URL(href);
      expect(u.origin + u.pathname).toBe(LINK_BY_PLAN[plan]);
      expect(u.searchParams.get('client_reference_id')).toBe('x_social_launch1');
    }
    // UTMが無いときは、リンクを一切変えない
    await page.goto('/monitor/');
    const plain = await page
      .locator('a[data-checkout]')
      .evaluateAll((els) => els.map((e) => ({ href: (e as HTMLAnchorElement).href, plan: e.getAttribute('data-plan') ?? '' })));
    for (const { href, plan } of plain) expect(href).toBe(LINK_BY_PLAN[plan]);
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
      await expect(sticky.locator('a')).toHaveAttribute('href', MONTHLY_LINK);
      await expect(sticky.locator('a')).toHaveText(MONTHLY_CTA);
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
    await expect(page).toHaveTitle(/道の駅ナビ 全国版.*1,237施設を収録.*最初の2か月 250円\/月/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /全国1,237施設を収録/);
    // 説明文には、月額の切り替わりと年間プランまで書く（250円だけを見せない）
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      /月額プラン：最初の2か月 250円\/月、3か月目以降 500円\/月（税込）。年間プラン：4,980円\/年（税込）。/,
    );
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
    await expect(page.locator('main')).toContainText('「道の駅ナビ 全国版」をお申し込みいただき、ありがとうございます');
    await expect(page.locator('main')).not.toContainText('新リリース・モニター');
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
    // 販売価格は Stripe Live の実設定と同じ（月額: 最初の2か月250円→3か月目以降500円、年間4,980円）
    expect(t).toContain('月額プラン：最初の2か月 250円/月、3か月目以降 500円/月（3か月目以降の料金へは自動で切り替わります）。年間プラン：4,980円/年。');
    expect(t).toContain('表示価格（月額プラン・年間プラン）は税込です。');
    expect(t).not.toContain('新リリース・モニター価格');
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
    expect(sw).toMatch(/denylist:\s*\[\s*\/\\\/monitor\(\\\/\|\$\)\//);
    // 公式HP（/official/）も同様に、precache・SPAフォールバックの対象外
    expect(sw).not.toContain('official/');
    expect(sw).toMatch(/denylist:\s*\[[^\]]*\/\\\/official\(\\\/\|\$\)\//);
  });
});
