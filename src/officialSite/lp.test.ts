import { describe, expect, it } from 'vitest';
import { STATIONS } from '../data';
import { MONITOR_CONFIG, type MonitorConfig } from '../monitorSite/config';
import { OFFICIAL_CONFIG } from './config';
import { LP_PAGES, renderXProfileLp, type LpRenderOptions } from './lp';
import { renderOfficialSite } from './render';

const MONTHLY_LINK = 'https://buy.stripe.com/bJe00kbKNgYW6PQ95W7Zu09';
const ANNUAL_LINK = 'https://buy.stripe.com/9B6fZi5mp9wu7TU4PG7Zu08';
/** 旧・月額250円固定のPayment Link。新規販売には使わない */
const LEGACY_250_LINK = 'https://buy.stripe.com/bJe5kE3eheQO8XYaa07Zu00';
const PREVIEW: LpRenderOptions = { base: '/tohoku-michinoeki-map/official/', assetBase: '/tohoku-michinoeki-map/', live: false };
const DOMAIN: LpRenderOptions = { base: '/', assetBase: '/', live: true };

const lp = (o = DOMAIN, cfg: MonitorConfig = MONITOR_CONFIG) => renderXProfileLp(o, cfg, OFFICIAL_CONFIG)['lp/index.html'];
/** script・style を除いた HTML（属性名が JS や CSS の中に出ていても数えない） */
const markup = (h: string) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '');
const text = (h: string) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript>[\s\S]*?<\/noscript>/g, '').replace(/<[^>]+>/g, '');

/** 画像は public/official/lp に実在すること（Viteのglob） */
const FILES = Object.keys(import.meta.glob('../../public/official/lp/*.webp')).map((k) => k.replace('../../public/official/lp/', ''));

describe('Xプロフィール用LP: 画像と順番', () => {
  it('10枚を順番どおりに使い、それぞれの画像ファイル（通常・480w）が実在する', () => {
    expect(LP_PAGES.map((p) => p.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const h = lp();
    let last = -1;
    for (const p of LP_PAGES) {
      const f = `lp-${String(p.n).padStart(2, '0')}`;
      expect(FILES).toContain(`${f}.webp`);
      expect(FILES).toContain(`${f}-480.webp`);
      const at = h.indexOf(`id="p${p.n}"`);
      expect(at).toBeGreaterThan(last);
      last = at;
    }
  });

  it('1枚目だけを最優先で読み、2枚目以降は遅延読み込み（noscriptの代替つき）', () => {
    const h = lp();
    expect(h.match(/fetchpriority="high"/g)?.length).toBe(2); // 画像1 と preload
    expect(h.match(/data-src=/g)?.length).toBe(9);
    expect(h.match(/<noscript>/g)?.length).toBe(9);
  });

  it('画像には代替テキストがあり、幅・高さを持つ（レイアウトずれを防ぐ）', () => {
    const imgs = [...lp().matchAll(/<img [^>]*>/g)].map((m) => m[0]);
    expect(imgs.length).toBeGreaterThanOrEqual(10);
    for (const i of imgs) {
      expect(i).toMatch(/alt="[^"]+"/);
      expect(i).toMatch(/width="941"/);
      expect(i).toMatch(/height="\d+"/);
    }
  });
});

describe('Xプロフィール用LP: 画像に焼き込まれたボタンは実際に動く', () => {
  it('画像1〜9のボタンの上に実リンクがあり、リンク先の #id が存在する', () => {
    const h = lp();
    const hits = [...h.matchAll(/<a class="hit" href="(#[^"]+)" aria-label="([^"]+)"/g)];
    expect(hits).toHaveLength(9);
    for (const [, href, label] of hits) {
      expect(h).toContain(`id="${href.slice(1)}"`);
      expect(label.length).toBeGreaterThan(3); // 画像だけでなく読み上げ可能な名前がある
    }
  });

  it('「今すぐ始める」（画像1）は購入欄（#start）へ、画像2〜9の「次のページへ」は次の画像へ移る', () => {
    const h = lp();
    expect(h).toMatch(/<a class="hit" href="#start" aria-label="今すぐ始める/);
    for (let n = 2; n <= 9; n++) expect(h).toContain(`href="#p${n + 1}" aria-label="次のページへ`);
  });

  it('画像10は焼き込みボタンを切り落としてあり、行き先の無いボタンが残らない', () => {
    expect(LP_PAGES.find((p) => p.n === 10)?.btn).toBeUndefined();
    expect(LP_PAGES.find((p) => p.n === 10)?.h).toBe(1500);
  });
});

describe('Xプロフィール用LP: 料金と継続課金は決済前に明示する', () => {
  it('画像1の価格の丸は、最初の2か月と3か月目以降の両方を示す（「月額250円」だけを出さない）', () => {
    const badge = lp().match(/<div class="badge"[\s\S]*?<\/div>/)?.[0] ?? '';
    const t = text(badge);
    expect(t).toContain('最初の2か月');
    expect(t).toContain('250');
    expect(t).toContain('3か月目以降');
    expect(t).toContain('500');
    expect(t).toContain('税込');
  });

  it('料金・継続課金・解約の説明が購入ボタンより前にある。購入ボタンは #start の中の月額・年間の2つだけ', () => {
    const h = lp();
    const start = h.indexOf('id="start"');
    const firstBuy = h.indexOf('<a class="btn" data-checkout');
    const check = h.indexOf('class="check"');
    expect(start).toBeGreaterThan(h.indexOf('id="p10"'));
    expect(check).toBeGreaterThan(start);
    expect(firstBuy).toBeGreaterThan(check);
    expect(markup(h).match(/data-checkout/g)?.length).toBe(2);
    expect(h).toContain(`href="${MONTHLY_LINK}"`);
    expect(h).toContain(`href="${ANNUAL_LINK}"`);
  });

  it('必須の説明（自動更新・継続課金・解約・税込・年間・返金・Stripe決済画面の表示名）がある', () => {
    const t = text(lp().slice(lp().indexOf('id="start"')));
    for (const w of ['最初の2か月', '250円/月', '3か月目以降', '500円/月', '毎月自動更新', '継続課金', 'いつでも解約', '4,980円/年', '税込', '原則として返金しません', 'お宝ファインダー', 'お申し込みのあとの流れ', '道の駅ナビを開く']) {
      expect(t).toContain(w);
    }
  });

  it('旧・月額250円固定のPayment Linkは使わない', () => {
    expect(lp()).not.toContain(LEGACY_250_LINK);
    expect(lp()).not.toContain('bJe5kE3eheQO8XYaa07Zu00" rel="noopener">月額');
  });

  it('上部の「今すぐ始める」（スティッキー含む）は決済リンクではなく、説明（#start）への移動', () => {
    const h = lp();
    const sticky = h.match(/<div class="sticky-cta">[\s\S]*?<\/div>/)?.[0] ?? '';
    expect(sticky).toContain('href="#start"');
    expect(sticky).not.toContain('buy.stripe.com');
    expect(sticky).not.toContain('data-checkout');
  });

  it('画像が機能紹介のイメージであること・口コミはアプリ内に無いことを明記する', () => {
    const t = text(lp());
    expect(t).toContain('機能を紹介するためのイメージ');
    expect(t).toContain('口コミ・評価は、Googleマップで確認できます');
  });

  it('収録施設数・料金の数字は config（アプリのデータ件数と一致をテスト済み）から出ている', () => {
    // 画像1・3に「全国1,237施設」が焼き込まれている。アプリのデータ件数が変わったら、画像の作り直しが必要
    expect(STATIONS.length).toBe(1237);
    expect(MONITOR_CONFIG.stationCount).toBe(1237);
    expect(lp()).toContain('全国1,237施設');
    const cfg: MonitorConfig = { ...MONITOR_CONFIG, pricing: { monthly: { introPriceYen: 300, introMonths: 3, regularPriceYen: 600 }, annual: { priceYen: 5980 } } };
    const t = text(lp(DOMAIN, cfg));
    expect(t).toContain('最初の3か月');
    expect(t).toContain('300円/月');
    expect(t).toContain('600円/月');
    expect(t).toContain('5,980円/年');
    expect(t).not.toContain('4,980円/年');
  });
});

describe('Xプロフィール用LP: 受付中でなければ購入ボタンを出さない', () => {
  it('Ownerの販売開始承認が無いと、購入ボタン・Stripeリンク・スティッキーが一切出ない', () => {
    const h = lp(DOMAIN, { ...MONITOR_CONFIG, salesLaunchApproved: false });
    const m = markup(h);
    expect(h).not.toContain('buy.stripe.com');
    expect(h).not.toContain('billing.stripe.com');
    expect(m).not.toContain('data-checkout');
    expect(m).not.toContain('class="sticky-cta"');
    expect(text(h)).toContain('受付準備中');
  });

  it('Payment Linkの形式が不正（テスト用URLなど）でも出さない', () => {
    const h = lp(DOMAIN, { ...MONITOR_CONFIG, live: { ...MONITOR_CONFIG.live, monthlyPaymentLink: 'https://buy.stripe.com/test_abc' } });
    expect(h).not.toContain('buy.stripe.com');
  });
});

describe('Xプロフィール用LP: 公開の扱い', () => {
  it('常に noindex（検索に出さない）。canonical は自分自身', () => {
    expect(lp()).toContain('<meta name="robots" content="noindex,follow">');
    expect(lp()).toContain('<link rel="canonical" href="https://michinoekinavi.jp/lp/">');
    expect(lp(PREVIEW)).toContain('canonical" href="https://1125naoto.github.io/tohoku-michinoeki-map/official/lp/"');
    expect(lp(PREVIEW)).toContain('公開前の確認用プレビューです');
  });

  it('既存の公式トップ（index.html）を上書きしない。追加されるのは lp/index.html だけ', () => {
    const files = renderOfficialSite({ base: '/', assetBase: '/', standalone: true, live: true });
    expect(Object.keys(files).sort()).toEqual(['404.html', 'index.html', 'lp/index.html', 'robots.txt', 'sitemap.xml']);
    expect(files['sitemap.xml']).not.toContain('/lp/');
    const before = renderOfficialSite({ base: '/', assetBase: '/', standalone: true, live: true })['index.html'];
    expect(files['index.html']).toBe(before);
    expect(files['index.html']).not.toContain('lp-01.webp');
  });

  it('画像・アイコンのパスは配信baseに従う（プレビューと公式ドメインの両方）', () => {
    expect(lp(DOMAIN)).toContain('src="/lp/lp-01.webp"');
    expect(lp(DOMAIN)).toContain('href="/icons/icon-48.png"');
    expect(lp(PREVIEW)).toContain('src="/tohoku-michinoeki-map/official/lp/lp-01.webp"');
    expect(lp(PREVIEW)).toContain('href="/tohoku-michinoeki-map/icons/icon-48.png"');
  });

  it('外部の解析・Cookie・外部スクリプトを使わない', () => {
    const h = lp();
    expect(h).not.toMatch(/<script[^>]+src=/);
    expect(h).not.toMatch(/google-analytics|googletagmanager|gtag\(|document\.cookie|fbq\(/);
  });

  it('秘密情報（Stripeの秘密鍵など）を含まない', () => {
    expect(lp()).not.toMatch(/\b(sk|rk|whsec)_(live|test)_[A-Za-z0-9]+/);
  });
});
