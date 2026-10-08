/**
 * Xプロフィール（Webサイト欄）から誘導する、明るい縦長・販売LP（公式サイトの /lp/ 配下・静的HTML生成の純関数）。
 *
 * Product Truth（商品説明と現行アプリの一致）の方針:
 *  - アプリの画面は、本物のアプリ画面（public/official/img の実画面）だけを使う。生成画像の「アプリ画面」は使わない。
 *    （生成画像には、実在しない「クチコミ」タブ・「買い物」カテゴリ・アプリ内ナビ画面・4つの下部タブ等が描かれていたため）
 *  - Owner提供の画像は、画面の絵を含まない部分だけを使う: ヒーロー上部（見出し・ロゴ・施設数）、お悩みの画像（lp-02）、写真の帯（lp-b1〜b3）。
 *  - 説明文は、コード（src/）と実画面で確かめた機能だけ。確かめられない文言（ボタン名など）は引用しない。
 *  - 料金の文言は monitorSite/pricing.ts から生成する。3か月目から500円への切替は「実購入での動作は未実証」なので、
 *    ページ内では「確認済み」と書かない（料金の約束として、条件を決済前に明示するだけ）。
 *
 * 構成:
 *  - 既存の公式トップ（/）と販売ページ（/monitor/）は上書きしない。出力は `lp/index.html` だけ。
 *  - 10の区画（#p1〜#p10）＋料金とお申し込み（#start）。各区画の「次へ」は実際に動くリンク。
 *  - 購入ボタンは MONITOR_CONFIG.live の月額・年間 Payment Link だけ。**料金・継続課金・解約の説明を、購入ボタンより前に出す。**
 *    上部の「今すぐ始める」は購入ボタンではなく、その説明（#start）へ移動するリンク。
 *  - 受付中でなければ購入ボタンを一切出さない。外部リソース・Cookie・解析ツールなし。
 */
import { MONITOR_CONFIG, type MonitorConfig } from '../monitorSite/config';
import { pricingText } from '../monitorSite/pricing';
import { CHECKOUT_ATTRIBUTION_JS, resolveSite, taxSentence } from '../monitorSite/render';
import { OFFICIAL_CONFIG, type OfficialConfig } from './config';

export interface LpRenderOptions {
  /** 公式サイトの配信base（公式ドメイン直下=`/`、プレビュー=`/tohoku-michinoeki-map/official/`）。LP は `${base}lp/` に出る */
  base: string;
  /** アプリ本体・共通アセット（icons/og-image）のbase。公式ドメイン直下=`/`、プレビュー=`/tohoku-michinoeki-map/` */
  assetBase: string;
  /** 公式ドメインで稼働しているか（canonical の出し分けだけに使う。LP は常に noindex） */
  live: boolean;
}

/** 区画の並び（#p1〜#p10）。`next` は「次へ」の行き先と、読み上げ用の名前 */
export const LP_SECTIONS = [
  { n: 1, id: 'p1', title: 'ヒーロー', next: { href: '#start', label: '今すぐ始める' } },
  { n: 2, id: 'p2', title: 'お悩み', next: { href: '#p3', label: '次へ：全国の道の駅を地図で探す' } },
  { n: 3, id: 'p3', title: '地図で探す', next: { href: '#p4', label: '次へ：訪問・スタンプの管理' } },
  { n: 4, id: 'p4', title: '訪問・スタンプの管理', next: { href: '#p5', label: '次へ：コースを作る' } },
  { n: 5, id: 'p5', title: 'コースを作る', next: { href: '#p6', label: '次へ：周辺スポット' } },
  { n: 6, id: 'p6', title: '周辺スポット', next: { href: '#p7', label: '次へ：コースの確認・保存・変更' } },
  { n: 7, id: 'p7', title: 'コースの確認・保存・変更', next: { href: '#p8', label: '次へ：タップで記録' } },
  { n: 8, id: 'p8', title: 'タップで記録', next: { href: '#p9', label: '次へ：出発とGoogleマップ' } },
  { n: 9, id: 'p9', title: '出発とGoogleマップ', next: { href: '#p10', label: '次へ：安心して使うために' } },
  { n: 10, id: 'p10', title: '安心して使うために', next: { href: '#start', label: '料金とお申し込みへ' } },
] as const;

/** 本物のアプリ画面（public/official/img）。寸法は実ファイルと一致させる（テストで確かめる） */
export const APP_SHOTS = {
  national: { f: 'map-national.webp', w: 600, h: 1298 },
  states: { f: 'map-states.webp', w: 600, h: 1298 },
  legend: { f: 'legend.webp', w: 464, h: 865 },
  stats: { f: 'stats.webp', w: 600, h: 492 },
  sheet: { f: 'sheet-actions.webp', w: 600, h: 1298 },
  wantDone: { f: 'want-done.webp', w: 600, h: 1298 },
  select: { f: 'route-select.webp', w: 600, h: 1298 },
  detail: { f: 'route-detail.webp', w: 600, h: 1298 },
  poi: { f: 'poi-pins.webp', w: 600, h: 494 },
  actions: { f: 'route-actions.webp', w: 600, h: 1298 },
  trip: { f: 'trip.webp', w: 600, h: 1298 },
} as const;
type ShotKey = keyof typeof APP_SHOTS;

/** Owner提供の画像から作った素材（画面の絵を含まない部分だけ）。lp/ 配下。-480 は小さい版 */
export const LP_ART = {
  hero: { f: 'lp-01', w: 941, h: 540 },
  pains: { f: 'lp-02', w: 941, h: 1672 },
  b1: { f: 'lp-b1', w: 941, h: 175 },
  b2: { f: 'lp-b2', w: 941, h: 220 },
  b3: { f: 'lp-b3', w: 941, h: 155 },
} as const;
type ArtKey = keyof typeof LP_ART;

/** 「お悩み」の画像（lp-02）の焼き込みボタンの位置（px）。この上に実リンクを重ねる */
const PAINS_BTN = { x0: 74, y0: 1468, x1: 866, y1: 1630 };

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const withSlash = (s: string): string => (s.endsWith('/') ? s : `${s}/`);
const pct = (v: number, total: number): string => `${((v / total) * 100).toFixed(3)}%`;

const BLANK_GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

const CSS = `
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
body{margin:0;background:#f4f9ee;color:#1f2a3a;font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic",Meiryo,sans-serif;font-size:17px;line-height:1.75;overflow-wrap:anywhere}
body.has-sticky{padding-bottom:84px}
a{color:#1b5e20}
img{display:block;max-width:100%;height:auto}
.wrap{max-width:480px;margin:0 auto;background:#f4f9ee;box-shadow:0 0 0 1px #cfdccf}
.banner{padding:8px 14px;font-size:.85rem;text-align:center;font-weight:700;background:#c62828;color:#fff}
.art{position:relative;line-height:0}
.art img{width:100%;height:auto;background:#cfe6f7}
.hit{position:absolute;display:block;border-radius:999px;-webkit-tap-highlight-color:rgba(255,255,255,.25)}
.hit:focus-visible,.next:focus-visible,.btn:focus-visible{outline:4px solid #1b5e20;outline-offset:2px;box-shadow:0 0 0 7px #fff}
.sec{padding:30px 18px 28px;text-align:center;position:relative}
.s-sky{background:linear-gradient(180deg,#bfe2fb 0%,#e6f3fb 55%,#f4f9ee 100%)}
.s-mint{background:linear-gradient(180deg,#e3f4e0 0%,#f4f9ee 100%)}
.s-sun{background:linear-gradient(180deg,#fff4cf 0%,#f4f9ee 100%)}
.s-hero{padding-top:18px;background:linear-gradient(180deg,#cfe9fb 0%,#e6f3fb 40%,#e3f4e0 100%)}
.kick{display:inline-block;font-size:.85rem;font-weight:800;color:#1565c0;background:#fff;border-radius:999px;padding:1px 14px;box-shadow:0 1px 0 #bcd3e6}
.hd{margin:.35em 0 .3em;font-size:1.65rem;line-height:1.4;font-weight:900;color:#12306b;text-wrap:balance;word-break:auto-phrase}
.hd .em{color:#e8294f}
.hd .mk{background:linear-gradient(transparent 62%,#ffe75a 62%)}
.lead{margin:.3em 0 .8em;font-size:1rem;color:#33455a;text-wrap:balance;word-break:auto-phrase}
.ph{margin:14px auto 4px;width:min(64vw,250px);background:#14211a;border-radius:30px;padding:8px;box-shadow:0 10px 24px rgba(20,33,26,.28)}
.ph img{border-radius:23px;width:100%;height:auto;background:#eef2ec}
.ph.wide{width:min(86vw,400px)}
.phs{display:flex;justify-content:center;gap:12px;margin:14px 0 4px}
.phs .ph{margin:0;width:calc(50% - 6px);max-width:218px;padding:6px;border-radius:24px}
.phs .ph img{border-radius:18px}
.cap{margin:6px 0 0;font-size:.82rem;color:#4a5b6a}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:16px 0 4px;padding:0;list-style:none}
.cards li{background:#fff;border-radius:16px;padding:10px 8px;box-shadow:0 2px 0 #c9d9c6;border-top:6px solid var(--c);margin:0;line-height:1.5}
.cards b{display:block;font-size:1.02rem;color:var(--c)}
.cards span{font-size:.84rem;color:#33455a}
.chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;list-style:none;padding:0;margin:12px 0 0}
.chips li{background:#fff;color:#12306b;border:2px solid #9ec5ea;border-radius:999px;padding:3px 14px;font-weight:800;font-size:.92rem;margin:0}
.steps{list-style:none;counter-reset:s;padding:0;margin:14px 0 0;text-align:left;display:grid;gap:10px}
.steps li{counter-increment:s;background:#fff;border-radius:16px;padding:11px 12px 11px 54px;position:relative;margin:0;box-shadow:0 2px 0 #c9d9c6;font-size:.95rem;line-height:1.6}
.steps li::before{content:counter(s);position:absolute;left:12px;top:10px;width:30px;height:30px;border-radius:50%;background:#e8294f;color:#fff;text-align:center;font-weight:900;line-height:30px}
.steps.plain li{padding-left:14px}
.steps.plain li::before{display:none}
.steps b{color:#12306b}
.note{margin:12px 0 0;font-size:.82rem;color:#4a5b6a;text-align:left;background:rgba(255,255,255,.75);border-radius:12px;padding:8px 12px;line-height:1.6}
.photo{margin:16px -18px 0;line-height:0}
.photo img{width:100%;height:auto;background:#cfe6f7}
.next{display:flex;align-items:center;justify-content:center;gap:10px;margin:18px auto 0;max-width:420px;min-height:60px;padding:12px 18px;border-radius:999px;background:#e8294f;color:#fff;text-decoration:none;font-weight:900;font-size:1.02rem;line-height:1.35;box-shadow:0 4px 0 #b11d3b;border:3px solid #fff}
.next i{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:#fff;color:#e8294f;font-style:normal;font-size:1.3rem;line-height:1;flex:0 0 auto}
.next.go{background:#2e7d32;box-shadow:0 4px 0 #1b5e20;font-size:1.3rem}
.next.go i{color:#2e7d32}
.next small{display:block;font-size:.72rem;font-weight:700;opacity:.95}
.heroRow{display:flex;align-items:center;justify-content:center;gap:12px;margin:8px 0 0}
.heroRow .ph{margin:0;width:50%;max-width:210px}
.badge{flex:0 0 auto;width:min(38vw,168px);aspect-ratio:1;border-radius:50%;background:#e8294f;border:5px solid #fff;box-shadow:0 0 0 2px #f3a9b8,0 6px 14px rgba(0,0,0,.18);color:#fff;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.2;font-weight:900;font-size:.78rem}
.badge b{display:block;font-size:2rem;line-height:1.05;letter-spacing:-.02em}
.badge b small{font-size:.9rem;font-weight:900}
.badge .arrow{font-size:.7rem;margin-top:2px;opacity:.95}
.badge .reg{font-size:1rem;margin-top:1px}
.badge .reg small{font-size:.66rem}
.start{padding:30px 18px 34px;background:#fff;border-top:1px solid #dfe6dc;line-height:1.75}
.start h2{margin:.1em 0 .3em;font-size:1.55rem;line-height:1.4;color:#1b5e20;text-align:center;text-wrap:balance}
.start .lead2{text-align:center;color:#3a4a3a;margin:.2em 0 1em}
.plan{border:2px solid #2e7d32;border-radius:16px;padding:14px 14px 10px;margin:12px 0;background:#f4faf3}
.plan h3{margin:0 0 .2em;font-size:1.05rem;color:#1b5e20}
.plan .price{font-size:1.05rem;font-weight:800;margin:.1em 0}
.plan .price b{font-size:1.9rem;font-weight:900;color:#1b5e20;white-space:nowrap}
.plan .price small{font-size:.9rem}
.plan p{margin:.3em 0;font-size:.93rem;color:#33433a}
.check{background:#fff8e1;border:1px solid #f0d98a;border-radius:14px;padding:12px 14px;margin:16px 0}
.check h3{margin:0 0 .3em;font-size:1rem}
.check ul{margin:0;padding-left:1.2em}
.check li{margin:.25em 0;font-size:.93rem}
.btn{display:block;text-wrap:balance;text-align:center;background:#2e7d32;color:#fff;text-decoration:none;font-weight:800;font-size:1.1rem;border-radius:14px;padding:15px 12px;min-height:56px;box-shadow:0 3px 0 #1b5e20;margin:10px 0 4px}
.btn.ghost{background:#fff;color:#1b5e20;border:2px solid #2e7d32;box-shadow:none}
.mini{font-size:.84rem;color:#4a5a4a;margin:.5em 0 0}
.after{background:#e8f5e9;border-radius:14px;padding:12px 14px;margin:16px 0 0;font-size:.93rem}
.after ol{margin:.3em 0 0;padding-left:1.3em}
.faq details{background:#fff;border:1px solid #dfe6dc;border-radius:12px;padding:8px 14px;margin:8px 0}
.faq summary{font-weight:700;cursor:pointer}
.faq p{font-size:.93rem;margin:.4em 0}
.imgnote{font-size:.8rem;color:#5a6a5a;margin:16px 0 0}
footer{padding:20px 16px 26px;background:#f7f8f5;font-size:.88rem;text-align:center;line-height:1.7;border-top:1px solid #dfe6dc}
footer nav{display:flex;flex-wrap:wrap;gap:6px 16px;justify-content:center;margin-bottom:8px}
footer small{color:#5a6a5a;display:block}
.sticky-cta{position:fixed;left:0;right:0;bottom:0;z-index:20;background:rgba(255,255,255,.97);border-top:1px solid #dfe6dc;padding:8px 12px calc(8px + env(safe-area-inset-bottom));box-shadow:0 -2px 10px rgba(0,0,0,.08);transition:transform .2s ease,visibility 0s}
.sticky-cta .btn{margin:0 auto;max-width:456px;min-height:52px;padding:12px}
body.cta-in-view .sticky-cta,body.hero-in-view .sticky-cta{transform:translateY(110%);visibility:hidden;transition:transform .2s ease,visibility 0s .2s}
@media(min-width:640px){body{font-size:18px;background:#dcebf7}.sticky-cta{display:none}body.has-sticky{padding-bottom:0}.wrap{margin:24px auto;border-radius:18px;overflow:hidden}}
`;

/** 全員に既定の流入元（lp1）を付ける。utm_* があれば、そのあとに CHECKOUT_ATTRIBUTION_JS が上書きする */
const DEFAULT_REF_JS =
  "(function(){try{var as=document.querySelectorAll('a[data-checkout]');for(var i=0;i<as.length;i++){var u=new URL(as[i].href);if(!u.searchParams.get('client_reference_id')){u.searchParams.set('client_reference_id','lp1');as[i].href=u.toString()}}}catch(e){}})();";
/**
 * (1) スティッキーCTAは、1枚目の区画（「今すぐ始める」がある）と、料金・お申し込みの見出しが見えている間は出さない。
 * (2) 画像は、ページの読み込み完了後に、画面の手前 800px に入ったものから読む（先頭の画像と回線を奪い合わないため）。
 */
const PAGE_JS =
  "(function(){try{var d=document,b=d.body,v={};function upd(){b.classList.toggle('hero-in-view',!!(v.p1||v.hs))}" +
  "if(window.IntersectionObserver){var o=new window.IntersectionObserver(function(es){es.forEach(function(e){v[e.target.id==='p1'?'p1':'hs']=e.isIntersecting&&(e.target.id!=='p1'||e.intersectionRatio>0.3)});upd()},{threshold:[0,.3,1]});" +
  "var a=d.getElementById('p1'),c=d.getElementById('h-start');if(a)o.observe(a);if(c)o.observe(c)}" +
  "}catch(e){}" +
  "function ld(i){var s=i.getAttribute('data-src');if(!s)return;var ss=i.getAttribute('data-srcset');if(ss)i.setAttribute('srcset',ss);i.src=s;i.removeAttribute('data-src');i.removeAttribute('data-srcset')}" +
  "function go(){var im=[].slice.call(d.querySelectorAll('img[data-src]'));if(!window.IntersectionObserver){im.forEach(ld);return}" +
  "var l=new window.IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){l.unobserve(e.target);ld(e.target)}})},{rootMargin:'800px 0px'});im.forEach(function(i){l.observe(i)})}" +
  "if(d.readyState==='complete'){go()}else{window.addEventListener('load',go)}" +
  "})();";

export function renderXProfileLp(
  opts: LpRenderOptions,
  cfg: MonitorConfig = MONITOR_CONFIG,
  off: OfficialConfig = OFFICIAL_CONFIG,
): Record<string, string> {
  const base = withSlash(opts.base);
  const lpBase = `${base}lp/`;
  const site = resolveSite(cfg, 'live');
  const open = site.gate.open;
  const pt = pricingText(cfg.pricing, site.gate.ownerReady ? site.owner.priceTaxInclusive : null);
  const tax = pt.tax;
  const taxNote = taxSentence(cfg, site.owner);
  const payUrl = site.urls.monthlyPaymentLink ?? '';
  const annualUrl = site.urls.annualPaymentLink ?? '';
  const portalUrl = site.urls.portalLoginUrl ?? '';
  const n = cfg.stationCount.toLocaleString('en-US');
  const canonical = opts.live ? `${withSlash(off.siteOrigin)}lp/` : new URL(lpBase, cfg.appUrl).toString();
  const title = `${cfg.productName}｜次の道の駅、どこ行こう？`;
  const description = `全国${n}施設を収録。道の駅を地図で探し、訪問を記録し、行きたい道の駅を選んでコースを作れるアプリ。${pt.monthlySummary}。`;
  const ogImage = opts.live ? `${withSlash(off.siteOrigin)}og-image.png` : new URL('og-image.png', cfg.appUrl).toString();
  const legal = (path: string, label: string) => `<a href="${cfg.appUrl}monitor/${path}">${label}</a>`;

  // ── 画像 ──
  const art = (k: ArtKey, alt: string, eager = false): string => {
    const a = LP_ART[k];
    const src = `${lpBase}${a.f}.webp`;
    const set = `${lpBase}${a.f}-480.webp 480w, ${src} ${a.w}w`;
    const sizes = '(min-width:640px) 480px, 100vw';
    return eager
      ? `<img src="${src}" srcset="${set}" sizes="${sizes}" width="${a.w}" height="${a.h}" alt="${esc(alt)}" fetchpriority="high" decoding="async">`
      : `<img src="${BLANK_GIF}" data-srcset="${set}" data-src="${src}" sizes="${sizes}" width="${a.w}" height="${a.h}" style="aspect-ratio:${a.w}/${a.h}" alt="${esc(alt)}" decoding="async"><noscript><img src="${src}" srcset="${set}" sizes="${sizes}" width="${a.w}" height="${a.h}" alt="${esc(alt)}" loading="lazy" decoding="async"></noscript>`;
  };
  const shot = (k: ShotKey, alt: string): string => {
    const s = APP_SHOTS[k];
    const src = `${base}img/${s.f}`;
    return `<img src="${BLANK_GIF}" data-src="${src}" width="${s.w}" height="${s.h}" style="aspect-ratio:${s.w}/${s.h}" alt="${esc(alt)}" decoding="async"><noscript><img src="${src}" width="${s.w}" height="${s.h}" alt="${esc(alt)}" loading="lazy" decoding="async"></noscript>`;
  };
  const ph = (k: ShotKey, alt: string, cls = '') => `<figure class="ph${cls ? ` ${cls}` : ''}">${shot(k, alt)}</figure>`;
  const phs = (...items: Array<[ShotKey, string]>) => `<div class="phs">${items.map(([k, a]) => `<figure class="ph">${shot(k, a)}</figure>`).join('')}</div>`;
  const photo = (k: ArtKey, alt: string) => `<div class="photo">${art(k, alt)}</div>`;
  const chips = (...c: string[]) => `<ul class="chips">${c.map((x) => `<li>${x}</li>`).join('')}</ul>`;
  const next = (i: number): string => {
    const s = LP_SECTIONS[i];
    return `<a class="next${i === 0 ? ' go' : ''}" href="${s.next.href}"><span>${esc(s.next.label)}${i === 0 ? '<small>料金・継続課金の内容を確認してお申し込みできます</small>' : ''}</span><i aria-hidden="true">›</i></a>`;
  };
  const head = (id: string, kick: string, html: string) => `<span class="kick">${esc(kick)}</span><h2 class="hd" id="h-${id}">${html}</h2>`;
  const sec = (i: number, cls: string, body: string) => {
    const s = LP_SECTIONS[i];
    return `<section class="sec ${cls}" id="${s.id}" aria-labelledby="h-${s.id}">\n${body}\n${next(i)}\n</section>`;
  };

  const p: string[] = [];

  // 1 ヒーロー（Owner画像の上部＝見出し・ロゴ・施設数。画面の絵は本物のアプリ画面に置き換え）
  p.push(`<section class="art" aria-label="道の駅ナビ 全国版">${art('hero', `道の駅ナビ 全国版。次の道の駅、どこ行こう？ 全国${n}施設を収録。`, true)}</section>
<section class="sec s-hero" id="p1" aria-labelledby="h-p1">
<h2 class="hd" id="h-p1" style="font-size:1.35rem">探す・記録する・巡る。<br><span class="em">道の駅ドライブ</span>が、これひとつで。</h2>
<div class="heroRow">${ph('national', `全国の道の駅が地図に並ぶ「${cfg.productName}」の実際の画面`)}<div class="badge" role="note" aria-label="${esc(pt.monthlySummary)}"><span>${esc(pt.introPeriod)}</span><b>${esc(pt.introPerMonth.replace('円/月', ''))}<small>円/月</small></b><span class="arrow">▼ ${esc(pt.regularPeriod)}</span><span class="reg">${esc(pt.regularPerMonth.replace('円/月', ''))}<small>円/月${esc(tax.replace('（', '(').replace('）', ')'))}</small></span></div></div>
<p class="cap">実際のアプリ画面（全国表示）</p>
<ul class="cards">
<li style="--c:#e8294f"><b>食べる</b><span>道の駅の周辺の候補を<br>地図で確認</span></li>
<li style="--c:#2e9a3e"><b>観光</b><span>立ち寄りスポットも<br>周辺で探せる</span></li>
<li style="--c:#f08a1c"><b>温泉・休憩</b><span>ひと息つける場所も<br>候補に</span></li>
<li style="--c:#1e6fd9"><b>宿泊</b><span>近くの宿も<br>周辺で探せる</span></li>
</ul>
${next(0)}
</section>`);

  // 2 お悩み（Owner画像そのまま。焼き込みボタンの上に実リンク）
  p.push(`<section class="art" id="p2" aria-label="2 / 10">${art('pains', 'こんなお悩みありませんか？ 次はどの道の駅？ 回る順番は？ 周辺のお店や宿は？ スタンプの管理は？ 計画を立てるのが面倒。')}<a class="hit" href="${LP_SECTIONS[1].next.href}" aria-label="${esc(LP_SECTIONS[1].next.label)}" style="left:${pct(PAINS_BTN.x0, LP_ART.pains.w)};top:${pct(PAINS_BTN.y0, LP_ART.pains.h)};width:${pct(PAINS_BTN.x1 - PAINS_BTN.x0, LP_ART.pains.w)};height:${pct(PAINS_BTN.y1 - PAINS_BTN.y0, LP_ART.pains.h)}"></a></section>`);

  // 3 地図で探す
  p.push(sec(2, 's-sky', `${head('p3', '探す', '全国の道の駅を<br><span class="mk">地図から探せる</span>')}
<p class="lead">北海道から沖縄まで、全国${n}施設を収録。地図を動かして、気になる道の駅を見つけられます。</p>
${phs(['national', '全国の道の駅が地図に並ぶ実際の画面'], ['states', 'ひとつの県に拡大した地図の実際の画面'])}
<p class="cap">全国表示から、県ごとの拡大まで（実際のアプリ画面）</p>
${chips('地域・県を変更', '絞り込み', '全画面表示', '使い方・凡例')}`));

  // 4 訪問・スタンプの管理
  p.push(sec(3, 's-mint', `${head('p4', '記録する', 'スタンプラリーも<br><span class="mk">これひとつで管理</span>')}
<p class="lead">道の駅の状態は、地図のマークの色や印で見分けられます。都道府県ごとの達成状況も見られます。</p>
${phs(['legend', '訪問状態（未訪問・訪問済み・行きたい・スタンプ取得済み）を見分ける凡例の実際の画面'], ['stats', '都道府県ごとの訪問数と達成率の実際の画面'])}
<p class="cap">マークの凡例と、都道府県ごとの達成状況（実際のアプリ画面）</p>
${chips('未訪問', '訪問済み', '行きたい', 'スタンプ取得済み')}`));

  // 5 コースを作る
  p.push(sec(4, 's-sky', `${head('p5', '巡る', '行きたい道の駅を選んで<br><span class="em">コースを作る</span>')}
<ol class="steps">
<li><b>地図で、回りたい道の駅を選ぶ。</b>選んだ駅の数が表示され、「この駅でコース作成」へ進めます。</li>
<li><b>コースを作ると、行程の目安が出ます。</b>移動時間・滞在時間・走行距離のほか、営業中に着ける見込みの駅数も確認できます。</li>
</ol>
${phs(['select', '地図で道の駅を選んでいる実際の画面。3駅選択中'], ['detail', '「2時間35分で3駅回れます」など、行程の目安が表示された実際の画面'])}
<p class="cap">駅を選ぶ → 行程の目安を確認（実際のアプリ画面）</p>
<p class="note">所要時間・営業の見込みは目安です。実際の経路・渋滞・通行止めはGoogleマップで、営業時間は各施設の公式情報でご確認ください。</p>
${photo('b1', '海沿いの道をドライブする二人')}`));

  // 6 周辺スポット
  p.push(sec(5, 's-mint', `${head('p6', '寄り道する', '道の駅の周辺も<br><span class="mk">まとめて探せる</span>')}
<p class="lead">道の駅のまわりにある「食べる」「観光」「温泉・休憩」「宿泊」の候補を、地図と一覧で確認できます。</p>
${ph('poi', '道の駅の周辺の食べる・観光・温泉のスポットが地図に表示された実際の画面', 'wide')}
<p class="cap">周辺スポットの表示（実際のアプリ画面）</p>
${chips('食べる', '観光', '温泉・休憩', '宿泊')}
<p class="note">掲載する施設情報には、変更や誤りがある場合があります。お出かけ前に公式情報でご確認ください。</p>`));

  // 7 コースの確認・保存・変更
  p.push(sec(6, 's-sun', `${head('p7', '決める', 'できたコースを<br><span class="mk">確認・保存・変更</span>')}
<p class="lead">作ったコースは、Googleマップで全体を確認したり、地図で順番を見たり、保存したりできます。立ち寄り先・順番・時間・道路の希望は、あとから変えられます。</p>
${ph('actions', '「このコースで出発」「Googleマップで全体を確認」「このコースを保存」などのボタンが並ぶ実際の画面')}
<p class="cap">コース作成後のボタン（実際のアプリ画面）</p>`));

  // 8 タップで記録
  p.push(sec(7, 's-mint', `${head('p8', '記録する', 'タップで開いて<br><span class="mk">ボタンひとつで記録</span>')}
<p class="lead">地図のマークをタップすると詳細が開きます。「訪問済みにする」「行きたいにする」「スタンプ取得済みにする」を、ボタンひとつで記録できます。</p>
${phs(['sheet', '道の駅をタップして開く詳細と、記録のボタンの実際の画面'], ['wantDone', '「行きたい」に記録した直後の実際の画面'])}
<p class="cap">タップして、記録するまで（実際のアプリ画面）</p>`));

  // 9 出発とGoogleマップ
  p.push(sec(8, 's-sky', `${head('p9', '出発する', '出発したら、次の駅へ<br><span class="em">Googleマップ</span>でナビ')}
<p class="lead">出発すると、次の道の駅と到着予定の目安が表示されます。道案内は、いつものGoogleマップで行います。</p>
${ph('trip', '出発後に、次の道の駅とGoogleマップで案内を開くボタンが表示された実際の画面')}
<p class="cap">出発後の画面（実際のアプリ画面）</p>
<ol class="steps"><li><b>「Googleマップで次の駅へ」</b>で、次の道の駅の案内をGoogleマップで開く。</li><li><b>着いたら「到着した」</b>。「スタンプ取得済み」も記録できて、次の駅へ進めます。</li></ol>
<p class="note">アプリの中にナビ画面はありません。案内（ルート・渋滞・音声）はGoogleマップの機能です。</p>
${photo('b2', '道を指さしてドライブする二人')}`));

  // 10 安心して使うために
  p.push(sec(9, 's-mint', `${head('p10', '安心', 'お出かけ前に、<br><span class="mk">ここだけ確認</span>')}
<ul class="steps plain">
<li><b>口コミ・評価は、Googleマップで。</b>アプリの中には口コミ・評価を表示していません。周辺スポットの詳細から、Googleマップで見られます。</li>
<li><b>時間・営業は目安です。</b>所要時間・営業の見込みは目安です。臨時休業や季節の変更は、各施設の公式情報でご確認ください。</li>
<li><b>スマホのブラウザで使えます。</b>ホーム画面に追加すると、アプリのように起動できます。記録はお使いの端末の中に保存されます。</li>
</ul>
${photo('b3', '景色のよい場所で道を指さす二人')}`));

  const buy = (href: string, plan: string, text: string, ghost = false) =>
    open ? `<a class="btn${ghost ? ' ghost' : ''}" data-checkout data-plan="${plan}" data-cta="lp-start" href="${esc(href)}" rel="noopener">${text}</a>` : '';

  const startPanel = `<section class="start" id="start" aria-labelledby="h-start">
<h2 id="h-start">料金とお申し込み</h2>
<p class="lead2">お申し込み前に、料金と継続課金（自動更新）の内容をご確認ください。</p>
<div class="plan">
<h3>月額プラン（毎月自動更新）</h3>
<p class="price">${esc(pt.introPeriod)}　<b>${esc(pt.introPerMonth.replace('円/月', ''))}</b><small>円/月${esc(tax)}</small></p>
<p class="price">${esc(pt.regularPeriod)}　<b>${esc(pt.regularPerMonth.replace('円/月', ''))}</b><small>円/月${esc(tax)}</small></p>
<p>${esc(pt.monthlyTransition)}</p>
</div>
<div class="plan">
<h3>年間プラン（1年ごとに自動更新）</h3>
<p class="price"><b>${esc(pt.annualPerYear.replace('円/年', ''))}</b><small>円/年${esc(tax)}</small></p>
<p>${esc(pt.annualComparison)}</p>
</div>
<div class="check">
<h3>お申し込み前にご確認ください</h3>
<ul>
<li><b>継続課金です。</b>解約しない限り、毎月（年間プランは毎年）自動で更新され、請求されます。</li>
<li>いつでも解約できます。解約後は次回以降の請求は発生しません。${portalUrl && open ? `解約は<a href="${esc(portalUrl)}" rel="noopener">契約内容の確認・解約ページ</a>から、ご自身で手続きできます。` : ''}</li>
<li>お支払い済みの期間は、原則として返金しません。詳しくは${legal('tokushoho/', '特定商取引法に基づく表記')}をご確認ください。</li>
<li>お支払いはStripeの決済画面で行います。決済画面には「お宝ファインダー」と表示されます（運営者が決済の受付アカウントを別サービスと共通で使っているためです）。</li>
<li>営業時間・施設情報・ルートの所要時間は目安です。お出かけ前に、各施設の公式情報をご確認ください。</li>
${taxNote ? `<li>${esc(taxNote)}</li>` : ''}
</ul>
</div>
${open ? `${buy(payUrl, 'monthly', `月額プランで申し込む（${esc(pt.introPeriod)} ${esc(pt.introPerMonth)}${esc(tax)}）`)}
${buy(annualUrl, 'annual', `年間プランで申し込む（${esc(pt.annualPerYear)}${esc(tax)}）`, true)}
<p class="mini">ボタンを押すと、Stripeの決済画面へ移動します。お申し込みの前に<a href="${cfg.appUrl}monitor/terms/">利用規約</a>・${legal('tokushoho/', '特定商取引法に基づく表記')}をご確認ください。</p>` : '<p class="check" role="status"><b>ただいまお申し込みの受付準備中です。</b></p>'}
<div class="after">
<b>お申し込みのあとの流れ</b>
<ol><li>決済が完了すると、「お申し込みありがとうございます」のページに移動します。</li><li>そのページの「${esc(cfg.appName)}を開く」から、すぐに使い始められます。</li></ol>
</div>
<div class="faq">
<details><summary>3か月目から、申し込み直しが必要ですか？</summary><p>不要です。${esc(pt.monthlyTransition)}</p></details>
<details><summary>スマホで使えますか？</summary><p>スマホのブラウザで使えます。ホーム画面に追加すると、アプリのように起動できます。</p></details>
<details><summary>口コミや評価は見られますか？</summary><p>アプリ内には表示していません。道の駅や周辺スポットの口コミ・評価は、Googleマップで確認できます。</p></details>
</div>
<p class="imgnote">※ アプリの画面は、実際の画面です（記録の例が入っています）。ページ上部の写真・イラストは紹介用のイメージです。</p>
</section>`;

  const footer = `<footer>
<nav aria-label="運営情報">${legal('', '料金・お申込み')}${legal('terms/', '利用規約')}${legal('privacy/', 'プライバシーポリシー')}${legal('tokushoho/', '特定商取引法に基づく表記')}${legal('contact/', 'お問い合わせ・改善要望')}${open && portalUrl ? `<a href="${esc(portalUrl)}" rel="noopener">契約内容の確認・解約</a>` : ''}</nav>
<small>${esc(cfg.productName)}（道ナビ）</small>
</footer>`;

  const sticky = open
    ? `<div class="sticky-cta"><a class="btn" data-cta="lp-sticky" href="#start">今すぐ始める（料金・お申し込みへ）</a></div>\n`
    : '';
  const banner = opts.live ? '' : '<div class="banner">公開前の確認用プレビューです（検索エンジンには表示されません）</div>\n';
  const hero = LP_ART.hero;

  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="noindex,follow">
<meta name="theme-color" content="#2e7d32">
<link rel="icon" href="${withSlash(opts.assetBase)}icons/icon-48.png">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(cfg.productName)}">
<meta property="og:locale" content="ja_JP">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(ogImage)}">
<link rel="preload" as="image" href="${lpBase}${hero.f}-480.webp" imagesrcset="${lpBase}${hero.f}-480.webp 480w, ${lpBase}${hero.f}.webp ${hero.w}w" imagesizes="(min-width:640px) 480px, 100vw" fetchpriority="high">
<style>${CSS}</style>
</head>
<body${open ? ' class="has-sticky"' : ''}>
<div class="wrap">
${banner}<main>
${p.join('\n')}
${startPanel}
</main>
${footer}
</div>
${sticky}<script>${DEFAULT_REF_JS}${CHECKOUT_ATTRIBUTION_JS}${PAGE_JS}</script>
</body>
</html>
`;
  return { 'lp/index.html': html };
}
