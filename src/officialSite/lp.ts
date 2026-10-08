/**
 * Xプロフィール（Webサイト欄）から誘導する、画像中心の縦長・販売LP（公式サイトの /lp/ 配下・静的HTML生成の純関数）。
 *
 * - 既存の公式トップ（/）と販売ページ（/monitor/）は上書きしない。出力は `lp/index.html` だけ。
 * - 10枚の画像は Owner 提供の `道ナビLP1〜10`（順番どおり）。画像に焼き込まれたボタンの上には、実際に動くリンクを重ねる。
 * - 料金の文言は monitorSite/pricing.ts から生成する（画像1の「月額250円」の丸は、実際の料金に合う HTML の丸で覆う）。
 * - 購入ボタンは MONITOR_CONFIG.live の月額・年間 Payment Link だけ。**料金・継続課金・解約の説明を、購入ボタンより前に出す。**
 *   画面上部の「今すぐ始める」は購入ボタンではなく、その説明（#start）へ移動するリンク。
 * - 受付中でなければ（evaluateSalesGate）購入ボタンを一切出さない。
 * - 外部リソース・Cookie・解析ツールなし。JavaScript は流入元の付与とスティッキーCTAの出し分けだけ。
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

/** 画像の元サイズ（px）。ボタンの座標はこのサイズ基準 */
const IMG_W = 941;
const IMG_H = 1672;

interface LpPage {
  n: number;
  /** 画像の代替テキスト（画像に書いてある内容の要約） */
  alt: string;
  /** 画像に焼き込まれたボタン（あれば）。重ねる実リンクの位置 */
  btn?: { x0: number; y0: number; x1: number; y1: number; label: string };
  /** 画像の高さ（px）。省略時は IMG_H。10枚目は焼き込みボタンを切り落としているので短い */
  h?: number;
}

/** 検出したボタンの位置（ピンク/緑の塗りの外接矩形）に余白を足した範囲 */
export const LP_PAGES: LpPage[] = [
  { n: 1, alt: '道の駅ナビ 全国版。次の道の駅、どこ行こう？ 全国1,237施設を収録。飲食店・観光スポット・宿泊施設・ルート作成に対応。', btn: { x0: 67, y0: 1463, x1: 873, y1: 1622, label: '今すぐ始める（料金とお申し込みへ移動）' } },
  { n: 2, alt: 'こんなお悩みありませんか？ 次はどの道の駅？ 回る順番は？ 周辺のお店や宿は？ スタンプの管理は？ 道の駅ナビならまるっと解決。', btn: { x0: 74, y0: 1468, x1: 866, y1: 1630, label: '次のページへ：道の駅ナビの詳しい機能' } },
  { n: 3, alt: '全国の道の駅を地図から探せる。地図・かんたん検索・行きたいを保存・エリア別に探せる。', btn: { x0: 79, y0: 1491, x1: 860, y1: 1641, label: '次のページへ：さらに便利な機能' } },
  { n: 4, alt: 'スタンプラリーもこれひとつで管理。未訪問・訪問済み・行きたい・スタンプ取得済みを地図のアイコンの色で見分けられる。', btn: { x0: 76, y0: 1467, x1: 864, y1: 1626, label: '次のページへ：さらに便利な機能' } },
  { n: 5, alt: '行きたい道の駅が見つかったらすぐにルート作成。道の駅を選ぶ、ルートを作成、ナビアプリで開く、旅を楽しむの4ステップ。', btn: { x0: 73, y0: 1467, x1: 867, y1: 1629, label: '次のページへ：もっと便利な機能' } },
  { n: 6, alt: '道の駅のまわりには楽しみがいっぱい。食べる・観光・温泉・買い物・宿泊の周辺スポットをまとめて見つけられる。', btn: { x0: 76, y0: 1468, x1: 867, y1: 1625, label: '次のページへ：周辺スポット画面' } },
  { n: 7, alt: '行きたい道の駅をつなげてドライブ旅行。行きたい道の駅を選んで追加、自動でルートを作成、ナビアプリと連携して出発。', btn: { x0: 76, y0: 1470, x1: 862, y1: 1626, label: '次のページへ：設定や使い方' } },
  { n: 8, alt: '自分だけのお気に入りリスト。行きたい道の駅を登録し、リストでまとめて確認し、地図でも一目でわかる。', btn: { x0: 77, y0: 1464, x1: 864, y1: 1623, label: '次のページへ：さらに便利な機能' } },
  { n: 9, alt: '最適なルートで効率よくまわれる。行きたい道の駅を選び、自動でルートを作成し、ナビで目的地まで移動。', btn: { x0: 67, y0: 1465, x1: 873, y1: 1625, label: '次のページへ：ルート作成の使い方' } },
  { n: 10, alt: '周辺スポットもまとめてチェック。道の駅を選び、周辺スポットを表示し、気になるスポットを確認してルートに組み込める。', h: 1500 },
];

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const withSlash = (s: string): string => (s.endsWith('/') ? s : `${s}/`);
const pct = (v: number, total: number): string => `${((v / total) * 100).toFixed(3)}%`;

const CSS = `
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
body{margin:0;background:#e9efe6;color:#1f2a1f;font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic",Meiryo,sans-serif;font-size:17px;line-height:1.75;overflow-wrap:anywhere}
body.has-sticky{padding-bottom:84px}
a{color:#1b5e20}
img{display:block;max-width:100%;height:auto}
.wrap{max-width:480px;margin:0 auto;background:#f7f8f5;box-shadow:0 0 0 1px #d3dcd0}
.banner{padding:8px 14px;font-size:.85rem;text-align:center;font-weight:700;background:#c62828;color:#fff}
.pg{position:relative;container-type:inline-size;line-height:0}
.pg img{width:100%;height:auto;background:#dfe9dc}
.hit{position:absolute;display:block;border-radius:999px;-webkit-tap-highlight-color:rgba(255,255,255,.25)}
.hit:focus-visible{outline:4px solid #1b5e20;outline-offset:2px;box-shadow:0 0 0 7px #fff}
.badge{position:absolute;left:57%;top:51%;width:36.6%;aspect-ratio:1;border-radius:50%;background:#e8294f;border:1.6cqw solid #fff;box-shadow:0 0 0 .6cqw #f3a9b8;color:#fff;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.15;font-weight:900;font-size:3.1cqw}
.badge b{display:block;font-size:11cqw;line-height:1.05;letter-spacing:-.02em}
.badge b small{font-size:5cqw;font-weight:900}
.badge .arrow{font-size:3.1cqw;margin-top:.6cqw;opacity:.95}
.badge .reg{font-size:4.6cqw;margin-top:.4cqw}
.badge .reg small{font-size:3cqw}
.start{padding:30px 18px 34px;background:#fff;border-top:1px solid #dfe6dc;line-height:1.75}
.start h2{margin:.1em 0 .3em;font-size:1.55rem;line-height:1.4;color:#1b5e20;text-align:center;text-wrap:balance}
.start .lead{text-align:center;color:#3a4a3a;margin:.2em 0 1em}
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
.btn:focus-visible{outline:4px solid #1b5e20;outline-offset:2px}
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
@media(min-width:640px){body{font-size:18px}.sticky-cta{display:none}body.has-sticky{padding-bottom:0}.wrap{margin:24px auto;border-radius:18px;overflow:hidden}}
`;

const BLANK_GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

/** 全員に既定の流入元（lp1）を付ける。utm_* があれば、そのあとに CHECKOUT_ATTRIBUTION_JS が上書きする */
const DEFAULT_REF_JS =
  "(function(){try{var as=document.querySelectorAll('a[data-checkout]');for(var i=0;i<as.length;i++){var u=new URL(as[i].href);if(!u.searchParams.get('client_reference_id')){u.searchParams.set('client_reference_id','lp1');as[i].href=u.toString()}}}catch(e){}})();";
/**
 * (1) スティッキーCTAは、1枚目（「今すぐ始める」がある）と、料金・お申し込みの見出しが見えている間は出さない。
 * (2) 2枚目以降の画像は、ページの読み込み完了後に、画面の手前 800px に入ったものから読む。
 */
const PAGE_JS =
  "(function(){try{var d=document,b=d.body,v={};function upd(){b.classList.toggle('hero-in-view',!!(v.p1||v.hs))}" +
  "if(window.IntersectionObserver){var o=new window.IntersectionObserver(function(es){es.forEach(function(e){v[e.target.id==='p1'?'p1':'hs']=e.isIntersecting&&(e.target.id!=='p1'||e.intersectionRatio>0.5)});upd()},{threshold:[0,.5,1]});" +
  "var a=d.getElementById('p1'),c=d.getElementById('h-start');if(a)o.observe(a);if(c)o.observe(c)}" +
  "}catch(e){}" +
  "function ld(i){var s=i.getAttribute('data-src');if(!s)return;i.setAttribute('srcset',i.getAttribute('data-srcset'));i.src=s;i.removeAttribute('data-src');i.removeAttribute('data-srcset')}" +
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
  const canonical = opts.live ? `${withSlash(off.siteOrigin)}lp/` : new URL(lpBase, cfg.appUrl).toString();
  const title = `${cfg.productName}｜次の道の駅、どこ行こう？`;
  const description = `全国${cfg.stationCount.toLocaleString('en-US')}施設を収録。道の駅を地図で探し、行きたい道の駅を保存して、ルートを作れるアプリ。${pt.monthlySummary}。`;
  const ogImage = opts.live ? `${withSlash(off.siteOrigin)}og-image.png` : new URL('og-image.png', cfg.appUrl).toString();
  const legal = (path: string, label: string) => `<a href="${cfg.appUrl}monitor/${path}">${label}</a>`;

  const pages = LP_PAGES.map((p, i) => {
    const h = p.h ?? IMG_H;
    const f = `lp-${String(p.n).padStart(2, '0')}`;
    const w480 = 480;
    const first = i === 0;
    const srcset = `${lpBase}${f}-480.webp ${w480}w, ${lpBase}${f}.webp ${IMG_W}w`;
    const sizes = '(min-width:640px) 480px, 100vw';
    // 1枚目は最優先で読む。2枚目以降は、1枚目の読み込みが終わってから画面に近づいたものだけ読む（回線を奪い合わないため）。
    // JavaScript が使えないときは <noscript> の通常の画像が出る。
    const imgTag = first
      ? `<img src="${lpBase}${f}.webp" srcset="${srcset}" sizes="${sizes}" width="${IMG_W}" height="${h}" alt="${esc(p.alt)}" fetchpriority="high" decoding="async">`
      : `<img src="${BLANK_GIF}" data-srcset="${srcset}" data-src="${lpBase}${f}.webp" sizes="${sizes}" width="${IMG_W}" height="${h}" alt="${esc(p.alt)}" decoding="async"><noscript><img src="${lpBase}${f}.webp" srcset="${srcset}" sizes="${sizes}" width="${IMG_W}" height="${h}" alt="${esc(p.alt)}" loading="lazy" decoding="async"></noscript>`;
    let overlay = '';
    if (p.btn) {
      const target = p.n === 1 ? '#start' : `#p${p.n + 1}`;
      const b = p.btn;
      overlay += `<a class="hit" href="${target}" aria-label="${esc(p.btn.label)}" style="left:${pct(b.x0, IMG_W)};top:${pct(b.y0, h)};width:${pct(b.x1 - b.x0, IMG_W)};height:${pct(b.y1 - b.y0, h)}"></a>`;
    }
    if (p.n === 1) {
      // 画像1に焼き込まれた「月額250円（税込）」は、3か月目以降の料金を含まないため、実際の料金の丸で覆う
      overlay += `<div class="badge" role="note" aria-label="${esc(pt.monthlySummary)}"><span>${esc(pt.introPeriod)}</span><b>${esc(pt.introPerMonth.replace('円/月', ''))}<small>円/月</small></b><span class="arrow">▼ ${esc(pt.regularPeriod)}</span><span class="reg">${esc(pt.regularPerMonth.replace('円/月', ''))}<small>円/月${esc(tax.replace('（', '(').replace('）', ')'))}</small></span></div>`;
    }
    return `<section class="pg" id="p${p.n}" aria-label="${p.n} / ${LP_PAGES.length}">${imgTag}${overlay}</section>`;
  }).join('\n');

  const buy = (href: string, plan: string, text: string, ghost = false) =>
    open ? `<a class="btn${ghost ? ' ghost' : ''}" data-checkout data-plan="${plan}" data-cta="lp-start" href="${esc(href)}" rel="noopener">${text}</a>` : '';

  const startPanel = `<section class="start" id="start" aria-labelledby="h-start">
<h2 id="h-start">料金とお申し込み</h2>
<p class="lead">お申し込み前に、料金と継続課金（自動更新）の内容をご確認ください。</p>
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
<ol><li>決済が完了すると、「お申し込みありがとうございます」のページに移動します。</li><li>そのページの「道の駅ナビを開く」から、すぐに使い始められます。</li></ol>
</div>
<div class="faq">
<details><summary>3か月目から、申し込み直しが必要ですか？</summary><p>不要です。${esc(pt.monthlyTransition)}</p></details>
<details><summary>スマホで使えますか？</summary><p>スマホのブラウザで使えます。ホーム画面に追加すると、アプリのように起動できます。</p></details>
<details><summary>口コミや評価は見られますか？</summary><p>アプリ内には表示していません。道の駅や周辺スポットの口コミ・評価は、Googleマップで確認できます。</p></details>
</div>
<p class="imgnote">※ 上の画像は、機能を紹介するためのイメージです。実際のアプリの画面・項目・表示内容とは異なる場合があります。</p>
</section>`;

  const footer = `<footer>
<nav aria-label="運営情報">${legal('', '料金・お申込み')}${legal('terms/', '利用規約')}${legal('privacy/', 'プライバシーポリシー')}${legal('tokushoho/', '特定商取引法に基づく表記')}${legal('contact/', 'お問い合わせ・改善要望')}${open && portalUrl ? `<a href="${esc(portalUrl)}" rel="noopener">契約内容の確認・解約</a>` : ''}</nav>
<small>${esc(cfg.productName)}（道ナビ）</small>
</footer>`;

  const sticky = open
    ? `<div class="sticky-cta"><a class="btn" data-cta="lp-sticky" href="#start">今すぐ始める（料金・お申し込みへ）</a></div>\n`
    : '';
  const banner = opts.live ? '' : '<div class="banner">公開前の確認用プレビューです（検索エンジンには表示されません）</div>\n';

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
<link rel="preload" as="image" href="${lpBase}lp-01-480.webp" imagesrcset="${lpBase}lp-01-480.webp 480w, ${lpBase}lp-01.webp ${IMG_W}w" imagesizes="(min-width:640px) 480px, 100vw" fetchpriority="high">
<style>${CSS}</style>
</head>
<body${open ? ' class="has-sticky"' : ''}>
<div class="wrap">
${banner}<main>
${pages}
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
