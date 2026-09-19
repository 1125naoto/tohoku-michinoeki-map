import { describe, expect, it } from 'vitest';
import { STATIONS } from '../data';
import { MONITOR_CONFIG, type MonitorConfig } from '../monitorSite/config';
import { OFFICIAL_CONFIG, isValidLineUrl, type OfficialConfig } from './config';
import { OFFICIAL_DESCRIPTION, OFFICIAL_TITLE, renderOfficialSite } from './render';

const PAYMENT_LINK = 'https://buy.stripe.com/bJe5kE3eheQO8XYaa07Zu00';
const PREVIEW = { base: '/tohoku-michinoeki-map/official/', assetBase: '/tohoku-michinoeki-map/', standalone: false } as const;
const DOMAIN = { base: '/', assetBase: '/', standalone: true } as const;

const html = (o: Parameters<typeof renderOfficialSite>[0], cfg: MonitorConfig = MONITOR_CONFIG, off: OfficialConfig = OFFICIAL_CONFIG) =>
  renderOfficialSite(o, cfg, off)['index.html'];

/** 画像は public/official/img に実在すること（Viteのglob） */
const IMAGES = Object.keys(import.meta.glob('../../public/official/img/*.webp')).map((k) => k.replace('../../public/official/img/', ''));

describe('公式サイト: 内容の正しさ', () => {
  it('収録施設数はアプリのデータ件数と一致する', () => {
    expect(OFFICIAL_CONFIG.stationCount).toBe(STATIONS.length);
    expect(MONITOR_CONFIG.stationCount).toBe(STATIONS.length);
  });

  it('必須の文言が入っている（次の道の駅、どこ行こう？／全国1,237施設を収録／月額250円（税込）／正式版の予定価格）', () => {
    const h = html(PREVIEW);
    const text = h.replace(/<[^>]+>/g, '');
    expect(text).toContain('次の道の駅、どこ行こう？');
    expect(h).toContain('全国1,237施設を収録');
    expect(text).toContain('新リリース・モニター 月額250円（税込）');
    expect(h).toContain('正式版の予定価格 月額500円（税込）');
    expect(h.replace(/<[^>]+>/g, '')).toContain('道の駅巡りを、もっと簡単に。もっと楽しく。');
  });

  it('禁止表現・未実装機能の表現を含まない', () => {
    const h = html(PREVIEW);
    for (const w of ['全国1,237の登録道の駅', '通常価格', '永久', '無料', '今なら', 'AIが全自動', '最適ルート', '完全自動', '自動で最適']) {
      expect(h, w).not.toContain(w);
    }
  });

  it('10個のパネル（01〜10）＋FAQ。h1は1つだけ、見出しの階層が正しい', () => {
    const h = html(PREVIEW);
    expect((h.match(/<h1[ >]/g) ?? []).length).toBe(1);
    expect((h.match(/<section class="panel/g) ?? []).length).toBe(11); // 10パネル+FAQ
    for (const n of ['02', '03', '04', '05', '06', '07', '08', '09', '10']) expect(h).toContain(`<span class="num">${n}</span>`);
    expect(h).not.toMatch(/<h3[ >]/);
    expect(h).not.toContain('<img src="null');
  });

  it('周辺スポットは実装済みの4カテゴリだけを書く', () => {
    const h = html(PREVIEW);
    const chips = /<h2 id="h-poi">[\s\S]*?<\/section>/.exec(h)![0];
    for (const c of ['食べる', '観光', '温泉・休憩', '宿泊']) expect(chips).toContain(`<li>${c}</li>`);
    expect(chips).not.toContain('<li>レジャー');
  });

  it('参照する画像はすべて public/official/img に実在し、WebPで軽量（縦横指定あり）', () => {
    const h = html(PREVIEW);
    const srcs = [...h.matchAll(/<img src="[^"]*\/img\/([^"]+)"([^>]*)>/g)];
    expect(srcs.length).toBeGreaterThanOrEqual(10);
    for (const m of srcs) {
      expect(IMAGES, m[1]).toContain(m[1]);
      expect(m[2]).toMatch(/width="\d+" height="\d+"/);
    }
    // 最初の画面の画像だけ即時読み込み、それ以外は遅延読み込み
    const eager = srcs.filter((m) => !m[2].includes('loading="lazy"'));
    expect(eager.length).toBeLessThanOrEqual(3); // ロゴ・アイコン・ファーストビュー画像
  });

  it('画像にはすべて alt がある', () => {
    const h = html(PREVIEW);
    for (const m of h.matchAll(/<img [^>]*>/g)) expect(m[0]).toContain('alt=');
  });
});

describe('公式サイト: 購入CTA（既存のStripe Payment Linkだけ）', () => {
  it('CTAは3つ以上（ヒーロー・中盤・最終＋スティッキー）で、すべて既存のPayment Link', () => {
    const h = html(PREVIEW);
    const links = [...h.matchAll(/<a [^>]*data-checkout[^>]*>/g)].map((m) => /href="([^"]+)"/.exec(m[0])![1]);
    expect(links.length).toBeGreaterThanOrEqual(3);
    for (const l of links) expect(l).toBe(PAYMENT_LINK);
    expect(h).toContain('月額250円で始める');
  });

  it('Stripe以外へ課金する導線・新しいStripeリンクがない', () => {
    const h = html(PREVIEW);
    const stripe = [...h.matchAll(/https:\/\/(?:buy|billing)\.stripe\.com\/[^"'\s<]+/g)].map((m) => m[0]);
    for (const u of stripe) expect([PAYMENT_LINK, 'https://billing.stripe.com/p/login/bJe5kE3eheQO8XYaa07Zu00']).toContain(u);
  });

  it('販売受付中でなければ購入ボタン・スティッキーを出さない（承認スイッチ）', () => {
    const closed = { ...MONITOR_CONFIG, salesLaunchApproved: false };
    const h = html(PREVIEW, closed);
    expect(h).not.toContain('data-checkout');
    expect(h).not.toContain('class="sticky-cta"');
    expect(h).not.toContain('buy.stripe.com');
    expect(h).toContain('noindex');
  });

  it('流入元の付与（utm_* と ?s=）のスクリプトがある。Cookie・外部送信なし', () => {
    const h = html(PREVIEW);
    expect(h).toContain('client_reference_id');
    expect(h).toContain("t:'tiktok'");
    expect(h).toContain("l:'line'");
    expect(h).not.toMatch(/document\.cookie|fetch\(|XMLHttpRequest|sendBeacon|gtag|analytics/);
    expect(h).not.toMatch(/<script[^>]+src=/);
  });

  it('規約・特商法・プライバシー・お問い合わせ・解約ページへ（実在するURL）リンクする', () => {
    const h = html(PREVIEW);
    for (const p of ['terms/', 'privacy/', 'tokushoho/', 'contact/']) expect(h).toContain(`${MONITOR_CONFIG.appUrl}monitor/${p}`);
    expect(h).toContain('https://billing.stripe.com/p/login/bJe5kE3eheQO8XYaa07Zu00');
  });
});

describe('公式サイト: LINE CTA（設定が確定するまで出さない）', () => {
  it('lineUrl 未設定（null）ではLINEのCTA・文言が一切出ない', () => {
    expect(OFFICIAL_CONFIG.lineUrl).toBeNull();
    const h = html(PREVIEW);
    expect(h).not.toContain('data-line');
    expect(h).not.toContain('LINEで');
    expect(h).not.toMatch(/lin\.ee|line\.me/);
  });

  it('形式が不正な（仮の）URLでは出さない', () => {
    for (const bad of ['https://example.com/line', 'http://lin.ee/abc', 'lin.ee/abc', 'https://lin.ee/', '']) {
      expect(isValidLineUrl(bad), bad).toBe(false);
      expect(html(PREVIEW, MONITOR_CONFIG, { ...OFFICIAL_CONFIG, lineUrl: bad })).not.toContain('data-line');
    }
  });

  it('実在形式のURLを設定すると、2か所のCTAにその1つの設定値が反映される', () => {
    const url = 'https://lin.ee/AbCdEf123';
    const h = html(PREVIEW, MONITOR_CONFIG, { ...OFFICIAL_CONFIG, lineUrl: url });
    const hits = [...h.matchAll(/<a [^>]*data-line[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    for (const u of hits) expect(u).toBe(url);
  });
});

describe('公式サイト: SEO（プレビュー／公式ドメイン稼働の切り替え）', () => {
  it('プレビュー: noindex、canonicalはプレビュー自身（未稼働の公式URLを名乗らない）、JSON-LDなし', () => {
    const h = html(PREVIEW);
    expect(h).toContain('<meta name="robots" content="noindex,nofollow">');
    expect(h).toContain(`<link rel="canonical" href="${MONITOR_CONFIG.appUrl}official/">`);
    expect(h).not.toContain('michinavi.jp');
    expect(h).not.toContain('application/ld+json');
    expect(h).not.toContain('google-site-verification');
  });

  it('公式ドメイン稼働時: index可、canonical=公式URL、OGP/Twitter/JSON-LDあり', () => {
    const h = html({ ...DOMAIN, live: true });
    expect(h).toContain('content="index,follow');
    expect(h).not.toContain('noindex');
    expect(h).toContain('<link rel="canonical" href="https://michinavi.jp/">');
    expect(h).toContain('<meta property="og:url" content="https://michinavi.jp/">');
    expect(h).toContain('<meta property="og:image" content="https://michinavi.jp/og-image.png">');
    expect(h).toContain('<meta name="twitter:card" content="summary_large_image">');
    for (const t of ['"@type":"WebSite"', '"@type":"SoftwareApplication"', '"@type":"FAQPage"']) expect(h).toContain(t);
    expect(h).toContain('"price":"250","priceCurrency":"JPY"');
  });

  it('JSON-LDは正しいJSONで、画面の内容（250円・1,237施設）と一致する', () => {
    const h = html({ ...DOMAIN, live: true });
    const blocks = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    expect(blocks.length).toBe(3);
    const app = blocks.find((b) => b['@type'] === 'SoftwareApplication');
    expect(app.offers.price).toBe('250');
    expect(app.description).toContain('1,237');
    expect(app.offers.url).toBe(PAYMENT_LINK);
  });

  it('title / description は道ナビ・道の駅ナビ・スタンプ・地図・ルートを自然に含み、詰め込みすぎない', () => {
    const t = OFFICIAL_TITLE(MONITOR_CONFIG);
    const d = OFFICIAL_DESCRIPTION(MONITOR_CONFIG);
    for (const k of ['道の駅ナビ', '地図', 'スタンプ', 'ルート']) expect(t).toContain(k);
    expect(d).toContain('道ナビ');
    expect(t.length).toBeLessThanOrEqual(70);
    expect(d.length).toBeLessThanOrEqual(140);
    expect((d.match(/道の駅/g) ?? []).length).toBeLessThanOrEqual(4);
  });

  it('Search Console の確認タグは、稼働時かつトークン設定時だけ出す', () => {
    const off = { ...OFFICIAL_CONFIG, googleSiteVerification: 'tok_ABC-123' };
    expect(html({ ...DOMAIN, live: true }, MONITOR_CONFIG, off)).toContain('<meta name="google-site-verification" content="tok_ABC-123">');
    expect(html({ ...DOMAIN, live: false }, MONITOR_CONFIG, off)).not.toContain('google-site-verification');
    expect(html({ ...DOMAIN, live: true })).not.toContain('google-site-verification');
  });

  it('robots.txt / sitemap.xml / 404.html は単独ビルドのみ。稼働前は全拒否・sitemapなし', () => {
    expect(Object.keys(renderOfficialSite(PREVIEW))).toEqual(['index.html']);
    const pre = renderOfficialSite({ ...DOMAIN, live: false });
    expect(pre['robots.txt']).toBe('User-agent: *\nDisallow: /\n');
    expect(pre['sitemap.xml']).toBeUndefined();
    const live = renderOfficialSite({ ...DOMAIN, live: true });
    expect(live['robots.txt']).toBe('User-agent: *\nAllow: /\n\nSitemap: https://michinavi.jp/sitemap.xml\n');
    expect(live['sitemap.xml']).toContain('<loc>https://michinavi.jp/</loc>');
    expect(live['404.html']).toContain('noindex');
  });

  it('未承認・受付準備中は、公式ドメイン稼働でも noindex（未完成を検索に出さない）', () => {
    const h = html({ ...DOMAIN, live: true }, { ...MONITOR_CONFIG, salesLaunchApproved: false });
    expect(h).toContain('noindex');
    expect(h).not.toContain('application/ld+json');
  });
});
