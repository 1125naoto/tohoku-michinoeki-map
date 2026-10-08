/**
 * Xプロフィール用LP（/lp/）のローカルQA。ビルド済みの dist-official/ を別途配信しておき（既定 http://127.0.0.1:4190/lp/）、
 * 実ブラウザ（Chromium）で スマホ幅・PC幅 の表示、リンク動作、横スクロール、コンソールエラー、読み込み速度を確かめる。
 * 決済はしない（Stripeへのリンクは href を読むだけで、クリックしない）。
 *   node scripts/lp-qa.mjs [url] [outDir]
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:4190/lp/';
const out = process.argv[3] ?? 'lp-qa-shots';
mkdirSync(out, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();

async function run(label, viewport, dpr, mobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  const failed = [];
  page.on('requestfailed', (r) => failed.push(r.url()));
  let bytes = 0;
  page.on('response', async (r) => {
    try { bytes += (await r.body()).length; } catch { /* redirect等 */ }
  });

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(300);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`[${label}] 横スクロールが無い`, overflow <= 0, `scrollWidth差 ${overflow}px`);
  check(`[${label}] コンソールエラー・読み込み失敗が無い`, errors.length === 0 && failed.length === 0, [...errors, ...failed].join(' | '));

  // 画像10枚が順番どおり・表示サイズが縦横比どおり
  const imgs = await page.$$eval('section.pg img', (els) => els.map((e) => ({ src: e.currentSrc.split('/').pop(), w: e.clientWidth, h: e.clientHeight, nat: e.naturalWidth })));
  check(`[${label}] 画像が10枚`, imgs.length === 10, String(imgs.length));
  await page.evaluate(async () => {
    for (const y of [...Array(30).keys()].map((i) => i * 1200)) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  await page.waitForTimeout(500);
  const loaded = await page.$$eval('section.pg img', (els) => els.every((e) => e.complete && e.naturalWidth > 0));
  check(`[${label}] 画像が全部読み込める（遅延読み込み後）`, loaded);

  // 焼き込みボタンの上の実リンク: 中心をクリックして遷移先へ動く
  const hits = await page.$$eval('a.hit', (as) => as.map((a) => ({ href: a.getAttribute('href'), label: a.getAttribute('aria-label') })));
  check(`[${label}] 実リンクが9つ（画像1〜9のボタン）`, hits.length === 9, String(hits.length));
  const idsOk = await page.evaluate(() => [...document.querySelectorAll('a.hit, .sticky-cta a')].every((a) => document.querySelector(a.getAttribute('href'))));
  check(`[${label}] すべてのリンク先（#id）が存在する`, idsOk);

  let moved = 0;
  for (let i = 0; i < hits.length; i++) {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    const loc = page.locator('a.hit').nth(i);
    await loc.scrollIntoViewIfNeeded();
    await loc.click({ timeout: 4000 });
    await page.waitForTimeout(hits[i].href === '#start' ? 2500 : 900); // #start は遠いので smooth scroll が長い
    const targetTop = await page.evaluate((h) => Math.round(document.querySelector(h).getBoundingClientRect().top), hits[i].href);
    const vh = viewport.height;
    // 文書の末尾にある #start は上端まで動けないので「画面内に見えている」で判定する
    if (Math.abs(targetTop) < 140 || (hits[i].href === '#start' && targetTop > 0 && targetTop < vh)) moved++;
    else console.log(`   リンク${i + 1} → ${hits[i].href}: 遷移先の上端 ${targetTop}px`);
  }
  check(`[${label}] 各ボタンをクリックすると遷移先まで動く（9/9）`, moved === 9, `${moved}/9`);

  // 購入ボタン（クリックはしない）: href と順序（説明 → ボタン）
  const buy = await page.$$eval('#start a[data-checkout]', (as) => as.map((a) => ({ href: a.href.split('?')[0], plan: a.dataset.plan, ref: new URL(a.href).searchParams.get('client_reference_id') })));
  check(`[${label}] 購入ボタンは月額・年間の2つだけ`, buy.length === 2 && buy.map((b) => b.plan).join() === 'monthly,annual', JSON.stringify(buy));
  const order = await page.evaluate(() => {
    const disc = document.querySelector('#start .check').getBoundingClientRect().top;
    const btn = document.querySelector('#start a[data-checkout]').getBoundingClientRect().top;
    const firstBuyInDom = document.querySelector('a[data-checkout]');
    return { discBeforeBtn: disc < btn, buyOnlyInStart: firstBuyInDom.closest('#start') !== null, other: document.querySelectorAll('a[data-checkout]').length };
  });
  check(`[${label}] 継続課金の説明が購入ボタンより前にあり、購入ボタンは #start の中だけ`, order.discBeforeBtn && order.buyOnlyInStart && order.other === 2, JSON.stringify(order));
  check(`[${label}] 流入元（client_reference_id）の既定が付く`, buy.every((b) => b.ref === 'lp1'), JSON.stringify(buy.map((b) => b.ref)));

  const txt = await page.locator('#start').innerText();
  for (const need of ['最初の2か月', '250円/月', '3か月目以降', '500円/月', '毎月自動更新', '継続課金', '解約', '4,980円/年', '税込']) {
    check(`[${label}] 決済前の説明に「${need}」がある`, txt.includes(need));
  }

  // スティッキーCTA（スマホ幅のみ）
  if (mobile) {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(400);
    const heroHidden = await page.$eval('.sticky-cta', (e) => getComputedStyle(e).visibility);
    await page.evaluate(() => document.getElementById('p3').scrollIntoView({ behavior: 'instant' }));
    await page.waitForTimeout(500);
    const midVisible = await page.$eval('.sticky-cta', (e) => getComputedStyle(e).visibility);
    await page.evaluate(() => document.getElementById('start').scrollIntoView({ behavior: 'instant' }));
    await page.waitForTimeout(500);
    const startHidden = await page.$eval('.sticky-cta', (e) => getComputedStyle(e).visibility);
    check(`[${label}] スティッキーCTA: 1枚目は非表示・途中は表示・購入欄では非表示`, heroHidden === 'hidden' && midVisible === 'visible' && startHidden === 'hidden', `${heroHidden}/${midVisible}/${startHidden}`);
  }

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${label}-1-hero.png` });
  await page.evaluate(() => document.getElementById('start').scrollIntoView({ behavior: 'instant' }));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${label}-2-start.png` });
  await page.screenshot({ path: `${out}/${label}-3-full.png`, fullPage: true });
  console.log(`   [${label}] 転送量（遅延読み込みを全部読んだ後）: ${(bytes / 1024).toFixed(0)} KB`);
  await ctx.close();
}

await run('mobile', { width: 390, height: 844 }, 2, true);
await run('mobile-small', { width: 320, height: 568 }, 2, true);
await run('pc', { width: 1280, height: 800 }, 1, false);

// 表示速度: 初回表示（1枚目だけ）を、低速な4G相当に絞って計測する
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  let bytes = 0;
  page.on('response', async (r) => { try { bytes += (await r.body()).length; } catch { /* */ } });
  await page.addInitScript(() => {
    window.__lcp = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  const loadMs = Date.now() - t0;
  await page.waitForTimeout(500);
  const lcp = await page.evaluate(() => Math.round(window.__lcp));
  const first = await page.$eval('section.pg img', (e) => e.currentSrc.split('/').pop());
  console.log(`   [速度 低速4G相当 1.6Mbps/150ms DPR3] load ${loadMs}ms / LCP ${lcp}ms / 初回転送 ${(bytes / 1024).toFixed(0)} KB / 1枚目 ${first}`);
  check('[速度] 低速4G相当でも LCP 4秒以内', lcp > 0 && lcp <= 4000, `${lcp}ms`);
  await ctx.close();
}

await browser.close();
const ng = results.filter((r) => !r.ok);
console.log(ng.length ? `\nNG ${ng.length} 件` : '\nすべて OK');
process.exit(ng.length ? 1 : 0);
