/**
 * 「道の駅ナビ 先行モニター」販売サイトの静的HTML生成（純関数）。
 *
 * - 出力はJavaScriptなし・外部リソース読み込みなしの静的HTML（Cookie/解析ツールなし）。
 * - 販売の開始可否は evaluateSalesGate だけが決める。Ownerの確認が必要な事業者情報や
 *   Live の購入URLが揃わない間は「受付準備中」表示になり、申込ボタンは出さない。
 *   Test mode のURL・ダミー事業者情報は 'test' モード（公開しないQA用ビルド）でしか使われない。
 * - 販売サイトはアプリ本体（SPA）とは別の /monitor/ 配下に置く。GitHub Pagesでは本当の認証は
 *   作れないため、アクセス制御があるかのような表現は一切しない。
 */
import { MONITOR_CONFIG, TEST_OWNER_DUMMY, type MonitorConfig, type OwnerLegalInfo, type StripeUrls } from './config';

export type SiteMode = 'live' | 'test';

export interface SalesGate {
  /** 購入ボタン・Live URLまで含めて受付中か */
  open: boolean;
  /** 事業者情報（特商法・規約・プライバシー用）が確認済みか。Live URLの有無とは独立 */
  ownerReady: boolean;
  /** 未充足の必須項目（表示用の名前。値は含まない） */
  missing: string[];
}

export interface ResolvedSite {
  mode: SiteMode;
  gate: SalesGate;
  owner: OwnerLegalInfo;
  urls: StripeUrls;
}

const LIVE_PAYMENT_LINK_RE = /^https:\/\/buy\.stripe\.com\/(?!test_)[A-Za-z0-9]+$/;
const LIVE_PORTAL_RE = /^https:\/\/billing\.stripe\.com\/p\/login\/(?!test_)[A-Za-z0-9]+$/;
const TEST_PAYMENT_LINK_RE = /^https:\/\/buy\.stripe\.com\/test_[A-Za-z0-9]+$/;
const TEST_PORTAL_RE = /^https:\/\/billing\.stripe\.com\/p\/login\/test_[A-Za-z0-9]+$/;
const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const filled = (v: string | null | undefined): v is string => typeof v === 'string' && v.trim() !== '';

export function resolveSite(cfg: MonitorConfig, mode: SiteMode): ResolvedSite {
  const owner = mode === 'test' ? TEST_OWNER_DUMMY : cfg.owner;
  const urls = mode === 'test' ? cfg.test : cfg.live;
  const ownerMissing: string[] = [];
  if (!filled(owner.sellerName)) ownerMissing.push('販売事業者名');
  if (owner.addressDisclosure === null) ownerMissing.push('所在地の開示方法');
  else if (owner.addressDisclosure === 'published' && !filled(owner.address)) ownerMissing.push('所在地');
  if (owner.phoneDisclosure === null) ownerMissing.push('電話番号の開示方法');
  else if (owner.phoneDisclosure === 'published' && !filled(owner.phone)) ownerMissing.push('電話番号');
  if (!filled(owner.supportEmail) || !EMAIL_RE.test(owner.supportEmail)) ownerMissing.push('お問い合わせメール');
  if (owner.monitorPriceTaxInclusive === null) ownerMissing.push('税込・税別の別');
  if (!filled(owner.refundPolicy)) ownerMissing.push('返金・キャンセル条件');
  if (!filled(owner.effectiveDate) || !DATE_RE.test(owner.effectiveDate)) ownerMissing.push('制定日');
  const urlMissing: string[] = [];
  const linkRe = mode === 'test' ? TEST_PAYMENT_LINK_RE : LIVE_PAYMENT_LINK_RE;
  const portalRe = mode === 'test' ? TEST_PORTAL_RE : LIVE_PORTAL_RE;
  if (!filled(urls.paymentLink) || !linkRe.test(urls.paymentLink)) urlMissing.push(mode === 'test' ? 'Test Payment Link' : 'Live Payment Link');
  if (!filled(urls.portalLoginUrl) || !portalRe.test(urls.portalLoginUrl)) urlMissing.push(mode === 'test' ? 'Test Customer Portal' : 'Live Customer Portal');
  const missing = [...ownerMissing, ...urlMissing];
  return { mode, gate: { open: missing.length === 0, ownerReady: ownerMissing.length === 0, missing }, owner, urls };
}

export function evaluateSalesGate(cfg: MonitorConfig, mode: SiteMode): SalesGate {
  return resolveSite(cfg, mode).gate;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const yen = (n: number): string => `${n}円`;

/** 'YYYY-MM-DD' → 'YYYY年M月D日'（形式が不正なら空文字） */
export function jpDate(d: string | null): string {
  const m = typeof d === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(d) : null;
  return m ? `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日` : '';
}

/** 先行モニター価格の税の扱い（Owner確認済みの構造化された値から生成。自由記述にしない） */
export function taxSentence(cfg: MonitorConfig, owner: OwnerLegalInfo): string | null {
  if (owner.monitorPriceTaxInclusive === null) return null;
  return owner.monitorPriceTaxInclusive
    ? `先行モニター価格（月額${yen(cfg.monitorPriceYen)}）は税込です。`
    : `先行モニター価格（月額${yen(cfg.monitorPriceYen)}）は税別です（別途、消費税がかかります）。`;
}

const CSS = `
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#f7f8f5;color:#1f2a1f;font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic",Meiryo,sans-serif;font-size:16px;line-height:1.8;overflow-wrap:anywhere}
a{color:#1b5e20}
.site-header{background:#fff;border-bottom:1px solid #dfe6dc}
.brand{display:flex;align-items:center;gap:10px;max-width:760px;margin:0 auto;padding:10px 16px;text-decoration:none;color:#1b5e20;font-weight:700}
.brand img{border-radius:8px}
main{max-width:760px;margin:0 auto;padding:16px 16px 40px}
h1{font-size:1.65rem;line-height:1.4;margin:.4em 0 .5em}
h2{font-size:1.25rem;line-height:1.45;margin:2em 0 .6em;padding-left:10px;border-left:5px solid #2e7d32}
h3{font-size:1.05rem;margin:1.4em 0 .3em}
p{margin:.6em 0}
ul,ol{padding-left:1.4em;margin:.6em 0}
li{margin:.25em 0}
.eyebrow{display:inline-block;background:#e8f5e9;color:#1b5e20;border-radius:999px;padding:2px 12px;font-size:.85rem;font-weight:700}
.hero{background:#fff;border:1px solid #dfe6dc;border-radius:16px;padding:20px 16px;margin-top:8px}
.price{display:grid;grid-template-columns:1fr;gap:10px;margin:16px 0}
.price .box{border:2px solid #2e7d32;border-radius:12px;padding:12px 14px;background:#f1f8f1}
.price .box.plan{border-color:#c5d3c2;background:#fafbf9}
.price .lbl{font-size:.85rem;color:#4a5a4a}
.price .amt{font-size:1.7rem;font-weight:800;line-height:1.3}
.price .amt small{font-size:.9rem;font-weight:600}
.btn{display:block;text-align:center;background:#2e7d32;color:#fff;text-decoration:none;font-weight:800;font-size:1.05rem;border-radius:12px;padding:14px 12px;min-height:48px}
.btn.sub{background:#fff;color:#1b5e20;border:2px solid #2e7d32}
.note,.notice{border-radius:10px;padding:10px 14px;margin:14px 0;font-size:.95rem}
.notice{background:#fff8e1;border:1px solid #f0d98a}
.note{background:#fff;border:1px solid #dfe6dc}
.banner{padding:8px 16px;font-size:.9rem;text-align:center;font-weight:700}
.banner.test{background:#c62828;color:#fff}
.banner.closed{background:#fff8e1;color:#5d4a00;border-bottom:1px solid #f0d98a}
.cards{display:grid;grid-template-columns:1fr;gap:10px;margin:.8em 0;padding:0;list-style:none}
.cards li{background:#fff;border:1px solid #dfe6dc;border-radius:12px;padding:12px 14px;margin:0}
.cards b{display:block;color:#1b5e20}
.steps{counter-reset:s;list-style:none;padding:0}
.steps li{counter-increment:s;background:#fff;border:1px solid #dfe6dc;border-radius:12px;padding:10px 14px 10px 46px;position:relative;margin:8px 0}
.steps li::before{content:counter(s);position:absolute;left:12px;top:10px;width:24px;height:24px;border-radius:50%;background:#2e7d32;color:#fff;text-align:center;font-weight:700;line-height:24px;font-size:.9rem}
dl.tbl{margin:0;border:1px solid #dfe6dc;border-radius:12px;background:#fff;overflow:hidden}
dl.tbl dt{background:#f1f8f1;font-weight:700;padding:8px 14px;border-top:1px solid #dfe6dc}
dl.tbl dt:first-child{border-top:0}
dl.tbl dd{margin:0;padding:8px 14px}
details{background:#fff;border:1px solid #dfe6dc;border-radius:12px;padding:8px 14px;margin:8px 0}
summary{font-weight:700;cursor:pointer}
footer{border-top:1px solid #dfe6dc;background:#fff;padding:16px}
footer nav{max-width:760px;margin:0 auto;display:flex;flex-wrap:wrap;gap:6px 18px;font-size:.9rem}
footer small{display:block;max-width:760px;margin:8px auto 0;color:#5a6a5a}
@media(min-width:640px){.price{grid-template-columns:1fr 1fr}.cards{grid-template-columns:1fr 1fr}.btn{display:inline-block;padding:14px 28px}}
`;

interface PageInput {
  site: ResolvedSite;
  cfg: MonitorConfig;
  base: string;
  path: string; // 'monitor/…/'
  title: string;
  description: string;
  body: string;
}

function page(p: PageInput): string {
  const { site, cfg, base } = p;
  const canonical = new URL(p.path, cfg.appUrl).toString();
  const noindex = !site.gate.open || site.mode === 'test';
  const nav = (path: string, label: string) => `<a href="${base}monitor/${path}">${label}</a>`;
  const banner =
    site.mode === 'test'
      ? '<div class="banner test">TEST BUILD（Stripe Test mode・ダミー事業者情報）— 公開・販売には使用しないでください</div>'
      : !site.gate.open
        ? `<div class="banner closed">${site.gate.ownerReady ? 'お申込みの受付を準備中です（受付開始までお待ちください）' : '現在、先行モニターの受付準備中です（受付開始前のため、掲載内容は準備中の項目を含みます）'}</div>`
        : '';
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.description)}">
${noindex ? '<meta name="robots" content="noindex,nofollow">' : ''}
<meta name="theme-color" content="#2e7d32">
<link rel="icon" href="${base}icons/icon-48.png">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(p.description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(new URL('og-image.png', cfg.appUrl).toString())}">
<style>${CSS}</style>
</head>
<body>
<header class="site-header"><a class="brand" href="${base}monitor/"><img src="${base}icons/icon-48.png" alt="" width="32" height="32"><span>${esc(cfg.productName)}</span></a></header>
${banner}
<main>
${p.body}
</main>
<footer>
<nav aria-label="運営情報">${nav('', '先行モニター募集')}${nav('terms/', '利用規約')}${nav('privacy/', 'プライバシーポリシー')}${nav('tokushoho/', '特定商取引法に基づく表記')}${nav('contact/', 'お問い合わせ・改善要望')}</nav>
<small>${esc(cfg.appName)} 先行モニター</small>
</footer>
</body>
</html>
`;
}

/** 受付準備中／受付中で出し分ける、事業者固有の値（未確認の値は決して捏造しない） */
function ownerValue(site: ResolvedSite, value: string | null, fallback = '受付開始時に掲載します'): string {
  return site.gate.ownerReady && filled(value) ? esc(value) : fallback;
}

function disclosure(site: ResolvedSite, mode: OwnerLegalInfo['addressDisclosure'], value: string | null): string {
  if (!site.gate.ownerReady) return '受付開始時に掲載します';
  if (mode === 'published' && filled(value)) return esc(value);
  return '請求があった場合、遅滞なく開示します。「お問い合わせ」のメールアドレスまでご連絡ください。';
}

function mailto(email: string, subject: string, bodyText: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
}

// ── LP ────────────────────────────────────────────────────────────────

function renderLanding(site: ResolvedSite, cfg: MonitorConfig, base: string): string {
  const taxTag = !site.gate.ownerReady || site.owner.monitorPriceTaxInclusive === null ? '' : site.owner.monitorPriceTaxInclusive ? '（税込）' : '（税別）';
  const cta = site.gate.open
    ? `<a class="btn" href="${esc(site.urls.paymentLink ?? '')}" rel="noopener">月額${yen(cfg.monitorPriceYen)}で先行モニターに参加する</a>
<p class="note">お支払いはStripeの決済ページで行います。お申込み前に<a href="${base}monitor/terms/">利用規約</a>・<a href="${base}monitor/tokushoho/">特定商取引法に基づく表記</a>をご確認ください。毎月自動更新で、解約はいつでも手続きできます。</p>`
    : `<div class="notice">現在、先行モニターの受付準備中です。受付を開始するまで、しばらくお待ちください。</div>`;
  const cancelLink =
    site.gate.open && site.urls.portalLoginUrl
      ? `<a href="${esc(site.urls.portalLoginUrl)}" rel="noopener">解約・お支払い管理ページ（Stripe）</a>`
      : '解約・お支払い管理ページ（受付開始時に掲載します）';
  return `
<section class="hero">
<span class="eyebrow">先行モニター募集｜まず${cfg.targetMonitors}名</span>
<h1>全国の道の駅を、記録して、ルートにして、めぐる。</h1>
<p>「${esc(cfg.appName)}」は、全国の道の駅を地図で探し、訪問やスタンプの記録を残しながら、行きたい駅をつないでドライブルートを作れるアプリです。先行モニターとして使っていただき、改善のご意見をお寄せください。</p>
<div class="price">
<div class="box"><div class="lbl">先行モニター価格</div><div class="amt">月額${yen(cfg.monitorPriceYen)}<small>${taxTag}</small></div></div>
<div class="box plan"><div class="lbl">正式版</div><div class="amt">月額${yen(cfg.plannedFullPriceYen)}<small>を予定</small></div></div>
</div>
${cta}
</section>

<h2>${esc(cfg.appName)}とは</h2>
<p>全国47都道府県の道の駅を地図上で探し、「訪問済み」「行きたい」「スタンプ取得済み」を記録できる、スマートフォン向けのウェブアプリです。アカウント登録は不要で、記録はお使いの端末に保存されます。ホーム画面に追加すれば、アプリのように使えます。</p>

<h2>こんな方に</h2>
<ul>
<li>道の駅めぐりや道の駅スタンプラリーを楽しんでいる方</li>
<li>ドライブ旅行が好きな方</li>
<li>次に行く道の駅や、めぐる順番を考えるのが楽しみな（または大変な）方</li>
</ul>

<h2>主な機能</h2>
<ul class="cards">
<li><b>全国の道の駅を探す</b>全国47都道府県・1,200か所を超える道の駅を、地図と一覧から探せます。</li>
<li><b>訪問・スタンプを記録</b>「未訪問」「訪問済み」「行きたい」「スタンプ取得済み」を道の駅ごとに記録し、県別の達成状況も確認できます。</li>
<li><b>行きたい駅からルートを作成</b>行きたい道の駅を選んで、めぐるルートを作れます。</li>
<li><b>おおよその所要時間</b>ルートの走行時間の目安を確認できます（実際の所要時間は道路状況などで変わります）。</li>
<li><b>Googleマップのナビへ</b>作成したルートをGoogleマップに引き継いで、ナビゲーションに使えます。</li>
<li><b>周辺の飲食・観光・温泉・宿泊</b>道の駅の周辺にある飲食店・観光スポット・温泉や休憩・宿泊施設を探せます（OpenStreetMapのデータに基づく表示で、すべての店舗を網羅するものではありません）。</li>
</ul>

<h2>先行モニターについて</h2>
<ul>
<li>全国版の${esc(cfg.appName)}をご利用いただけます</li>
<li>先行モニターとして参加していただけます</li>
<li>改善要望・フィードバックをお送りいただけます</li>
<li>今後の改善・アップデートに、ご意見を反映する機会があります</li>
</ul>
<div class="note">
<b>ご確認いただきたいこと</b>
<ul>
<li>現時点で、アプリ本体はログイン不要のウェブアプリとして公開されており、先行モニター専用の機能制限は設けていません。先行モニターは、アプリをお使いいただき、改善のご意見を届けていただく参加型のプログラムです。</li>
<li>いただいたご要望を必ず実装するお約束はできません。</li>
<li>正式版の月額${yen(cfg.plannedFullPriceYen)}は予定であり、正式版の内容・価格は今後変わる可能性があります。</li>
<li>営業時間・施設情報・ルートの所要時間は目安です。現地の案内や道路状況を優先してください。</li>
</ul>
</div>

<h2>お申込みから利用開始まで</h2>
<ol class="steps">
<li>「月額${yen(cfg.monitorPriceYen)}で先行モニターに参加する」から、Stripeの決済ページでお支払い情報を入力します。</li>
<li>お支払い完了後、ご案内ページが表示されます。</li>
<li>運営者がお支払いを確認し、ご登録のメールアドレス宛に利用開始のご案内をお送りします（運営者が手作業で対応するため、お時間をいただくことがあります）。</li>
<li>${esc(cfg.appName)}をご利用いただき、改善のご意見をお送りください。</li>
<li>解約は、いつでも手続きできます。</li>
</ol>

<h2>よくある質問</h2>
<details><summary>お支払い方法は？</summary><p>Stripeの決済ページに表示されるお支払い方法をご利用いただけます。</p></details>
<details><summary>解約するには？</summary><p>${cancelLink}から手続きできます。解約は現在の請求期間の終了時に有効となり、次回以降の請求は発生しません。</p></details>
<details><summary>領収書は出ますか？</summary><p>お支払い履歴・領収書は、上記の解約・お支払い管理ページ（Stripe）から確認できます。</p></details>
<details><summary>記録したデータはどこに保存されますか？</summary><p>お使いの端末内に保存され、他の端末とは同期されません。ブラウザのデータを削除すると記録が消える場合があります。</p></details>
<details><summary>どんな端末で使えますか？</summary><p>スマートフォンやパソコンの最新のブラウザでご利用いただけます。</p></details>
<details><summary>個人情報の扱いは？</summary><p><a href="${base}monitor/privacy/">プライバシーポリシー</a>をご覧ください。</p></details>
`;
}

// ── 利用規約 ────────────────────────────────────────────────────────

function renderTerms(site: ResolvedSite, cfg: MonitorConfig, base: string): string {
  const taxText = site.gate.ownerReady ? taxSentence(cfg, site.owner) : null;
  const tax = taxText ? `<p>${esc(taxText)}</p>` : '<p>税の表示は受付開始時に掲載します。</p>';
  const refund = site.gate.ownerReady && filled(site.owner.refundPolicy) ? `<p>${esc(site.owner.refundPolicy)}</p>` : '<p>返金・キャンセル条件は受付開始時に掲載します。</p>';
  const cancel =
    site.gate.open && site.urls.portalLoginUrl
      ? `<a href="${esc(site.urls.portalLoginUrl)}" rel="noopener">Stripeの解約・お支払い管理ページ</a>`
      : 'Stripeの解約・お支払い管理ページ（受付開始時に掲載します）';
  return `
<h1>利用規約</h1>
<p>この規約は、${esc(cfg.productName)}（以下「本サービス」）の利用条件を定めるものです。お申込みをもって、本規約に同意したものとみなします。</p>

<h2>第1条（本サービスの内容）</h2>
<ol>
<li>本サービスは、次の内容で構成されます。（1）全国版「${esc(cfg.appName)}」（ウェブアプリ）の利用　（2）先行モニターとしての参加　（3）改善要望・フィードバックの送信　（4）今後の改善・アップデートに対して意見を反映する機会</li>
<li>アプリ本体は、この規約の制定時点で、ログイン不要のウェブアプリとして公開されています。本サービスの利用にアカウント登録は必要なく、先行モニター専用の機能制限も設けていません。</li>
<li>運営者は、送信された改善要望を実装する義務を負いません。要望の採否や時期は、運営者が判断します。</li>
</ol>

<h2>第2条（料金・お支払い）</h2>
<ol>
<li>先行モニター価格は、月額${yen(cfg.monitorPriceYen)}です。</li>
<li>正式版の価格として月額${yen(cfg.plannedFullPriceYen)}を予定していますが、これは予定であり、正式版の内容・価格は変更される場合があります。</li>
<li>料金は毎月自動更新で、お申込み日を基準に、Stripeを通じてクレジットカード等で請求されます。お支払い情報はStripeが取り扱い、運営者はカード番号を保有しません。</li>
<li>料金を変更する場合は、変更の前にお知らせします。</li>
</ol>
${tax}

<h2>第3条（解約）</h2>
<ol>
<li>先行モニターは、${cancel}から、いつでも解約できます。</li>
<li>解約は現在の請求期間の終了時に有効となり、次回以降の請求は発生しません。</li>
</ol>

<h2>第4条（返金）</h2>
${refund}

<h2>第5条（禁止事項）</h2>
<ul>
<li>法令または公序良俗に反する行為</li>
<li>運営者や、地図・検索・ルート計算などの外部サービスに過度な負荷をかける行為</li>
<li>その他、運営者が不適切と判断する行為</li>
</ul>

<h2>第6条（免責）</h2>
<ol>
<li>地図・施設情報・営業時間・周辺スポット・ルート・所要時間は目安であり、正確性・完全性・最新性を保証しません。現地の案内・交通規制・道路状況を優先してください。</li>
<li>運転中は画面を操作しないでください。</li>
<li>本サービスは外部サービス（地図・検索・ルート計算など）に依存しており、その障害や仕様変更により、一部の機能が使えなくなる場合があります。</li>
<li>記録データはお使いの端末内に保存されます。端末やブラウザのデータ削除などにより、記録が失われる場合があります。</li>
<li>運営者は、法令上許される範囲で、本サービスの利用により生じた損害について責任を負いません。</li>
</ol>

<h2>第7条（サービスの変更・終了）</h2>
<p>運営者は、先行モニターの募集や本サービスの内容を、お知らせのうえで変更または終了することがあります。</p>

<h2>第8条（データの出典）</h2>
<p>地図・周辺スポットのデータには、© OpenStreetMap contributors（ODbL）などを利用しています。</p>

<h2>第9条（個人情報）</h2>
<p>個人情報の取扱いは、<a href="${base}monitor/privacy/">プライバシーポリシー</a>に従います。</p>

<h2>第10条（準拠法）</h2>
<p>本規約は日本法に準拠します。</p>

<p class="note">制定日: ${ownerValue(site, jpDate(site.owner.effectiveDate))}</p>
`;
}

// ── プライバシーポリシー ─────────────────────────────────────────────

function renderPrivacy(site: ResolvedSite, cfg: MonitorConfig, base: string): string {
  const contact = site.gate.ownerReady && filled(site.owner.supportEmail) ? esc(site.owner.supportEmail) : '受付開始時に掲載します';
  return `
<h1>プライバシーポリシー</h1>
<p>${esc(cfg.productName)}（以下「本サービス」）における個人情報等の取扱いを定めます。</p>

<h2>1. 事業者</h2>
<p>販売事業者: ${ownerValue(site, site.owner.sellerName)}（詳細は<a href="${base}monitor/tokushoho/">特定商取引法に基づく表記</a>）</p>

<h2>2. 取得する情報と利用目的</h2>
<h3>お申込み・お支払い</h3>
<p>お申込み時にStripeの決済ページでご入力いただくメールアドレス、お支払い情報、契約の状態などは、Stripeが取得・処理します。運営者は、お支払いの確認、利用開始のご案内、解約・お支払い管理、お問い合わせへの対応のために、Stripeの管理画面でメールアドレスや契約の状態を確認します。運営者はカード番号を保有しません。</p>
<h3>お問い合わせ・改善要望</h3>
<p>メールでお送りいただいたメールアドレスと内容を、ご返信と改善の検討のために利用します。</p>

<h2>3. アプリ内のデータ（訪問記録・保存ルートなど）</h2>
<p>「訪問済み」「行きたい」「スタンプ取得済み」などの記録や保存したルート・設定は、お使いの端末（ブラウザのlocalStorage）にのみ保存され、運営者のサーバーへは送信されません。</p>

<h2>4. アクセス解析・Cookie</h2>
<p>この販売サイトとアプリ本体は、Cookieやアクセス解析ツールを使用していません。なお、これらのページはGitHub Pagesで配信されており、配信にあたってGitHubがアクセスログ（IPアドレス等）を取得する場合があります。Stripeの決済ページ・解約ページでは、Stripeが独自にCookie等を使用する場合があります。</p>

<h2>5. 外部サービスへの送信</h2>
<p>アプリの機能を使う際に、お使いのブラウザから次の外部サービスへ、機能に必要な情報が送信されます。</p>
<ul>
<li>地図の表示: OpenStreetMapのタイルサーバー（表示する地図の範囲）</li>
<li>周辺スポットの検索: Overpass APIおよびそのミラーサーバー（検索の中心座標）</li>
<li>ルート・所要時間の計算: OSRM公開サーバー（経由地の座標）</li>
<li>地名・住所の検索: OpenStreetMap Nominatim、国土地理院の住所検索API（入力した検索語）</li>
<li>Googleマップ／Google検索への遷移: リンクを開いたときに、Googleのサービスへ移動します（Googleのポリシーが適用されます）</li>
</ul>
<p>現在地を使う機能は、端末の許可を求めたうえで、取得した座標を上記の検索に使用します。</p>

<h2>6. 第三者への提供・委託</h2>
<p>法令に基づく場合を除き、個人情報を第三者へ提供しません。お支払いの処理はStripeに委託しています。</p>

<h2>7. 開示・訂正・削除のご請求</h2>
<p>ご自身の情報の開示・訂正・削除をご希望の場合は、次の窓口へご連絡ください。<br>お問い合わせ先: ${contact}</p>

<h2>8. 改定</h2>
<p>本ポリシーを改定する場合は、このページでお知らせします。</p>
<p class="note">制定日: ${ownerValue(site, jpDate(site.owner.effectiveDate))}</p>
`;
}

// ── 特定商取引法に基づく表記 ─────────────────────────────────────────

function renderTokushoho(site: ResolvedSite, cfg: MonitorConfig, base: string): string {
  const ownerReady = site.gate.ownerReady;
  const portalLive = site.gate.open && site.urls.portalLoginUrl;
  const cancel =
    portalLive
      ? `<a href="${esc(site.urls.portalLoginUrl ?? '')}" rel="noopener">Stripeの解約・お支払い管理ページ</a>から、いつでも解約できます。解約は現在の請求期間の終了時に有効となり、次回以降の請求は発生しません。`
      : 'お申込み後、Stripeの解約・お支払い管理ページから、いつでも解約できます（解約ページのURLは受付開始時に掲載します）。解約は現在の請求期間の終了時に有効となり、次回以降の請求は発生しません。';
  const email = ownerReady && filled(site.owner.supportEmail) ? esc(site.owner.supportEmail) : '受付開始時に掲載します';
  const timing = ownerReady && filled(site.owner.responseTimeNote)
    ? `お支払い確認後、運営者からご登録のメールアドレス宛に利用開始のご案内をお送りします（運営者の手作業による対応です）。${esc(site.owner.responseTimeNote)}`
    : 'お支払い確認後、運営者からご登録のメールアドレス宛に利用開始のご案内をお送りします（運営者の手作業による対応です）。';
  return `
<h1>特定商取引法に基づく表記</h1>
<dl class="tbl">
<dt>販売事業者</dt><dd>${ownerValue(site, site.owner.sellerName)}</dd>
<dt>運営統括責任者</dt><dd>${ownerValue(site, site.owner.sellerName)}</dd>
<dt>所在地</dt><dd>${disclosure(site, site.owner.addressDisclosure, site.owner.address)}</dd>
<dt>電話番号</dt><dd>${disclosure(site, site.owner.phoneDisclosure, site.owner.phone)}</dd>
<dt>メールアドレス</dt><dd>${email}</dd>
<dt>サービス名</dt><dd>${esc(cfg.productName)}</dd>
<dt>サービスの内容</dt><dd>全国版「${esc(cfg.appName)}」（ウェブアプリ）の利用、先行モニターとしての参加、改善要望・フィードバックの送信、今後の改善・アップデートに意見を反映する機会。アプリ本体は現時点でログイン不要のウェブアプリとして公開されており、先行モニター専用の機能制限は設けていません。</dd>
<dt>販売価格</dt><dd>先行モニター価格 月額${yen(cfg.monitorPriceYen)}。正式版は月額${yen(cfg.plannedFullPriceYen)}を予定しています（予定であり、変更される場合があります）。${site.gate.ownerReady && taxSentence(cfg, site.owner) ? esc(taxSentence(cfg, site.owner) ?? '') : '税の表示は受付開始時に掲載します。'}</dd>
<dt>販売価格以外の必要料金</dt><dd>インターネット接続にかかる通信料等は、お客様のご負担となります。</dd>
<dt>お支払い方法</dt><dd>Stripeの決済ページに表示されるお支払い方法（クレジットカード等）。</dd>
<dt>お支払い時期</dt><dd>お申込み時に初回のお支払いが発生し、以降は毎月、お申込み日を基準に自動更新されます。</dd>
<dt>サービス提供時期</dt><dd>${timing}</dd>
<dt>解約</dt><dd>${cancel}</dd>
<dt>返金・キャンセル</dt><dd>${ownerValue(site, site.owner.refundPolicy, '受付開始時に掲載します')}</dd>
<dt>動作環境</dt><dd>スマートフォンやパソコンの最新のブラウザ。インターネット接続が必要です。</dd>
<dt>その他</dt><dd>営業時間・施設情報・ルートの所要時間は目安であり、正確性を保証するものではありません。詳しくは<a href="${base}monitor/terms/">利用規約</a>をご確認ください。</dd>
</dl>
<p class="note">制定日: ${ownerValue(site, jpDate(site.owner.effectiveDate))}</p>
`;
}

// ── お問い合わせ・改善要望 ───────────────────────────────────────────

function renderContact(site: ResolvedSite, cfg: MonitorConfig): string {
  if (!site.gate.ownerReady || !filled(site.owner.supportEmail)) {
    return `
<h1>お問い合わせ・改善要望</h1>
<div class="notice">お問い合わせ窓口は、先行モニターの受付開始時に掲載します。</div>
`;
  }
  const email = site.owner.supportEmail;
  const template = '■ご要望・不具合の内容:\n\n\n■使っていた画面・操作:\n\n\n■お使いの端末・ブラウザ:\n';
  return `
<h1>お問い合わせ・改善要望</h1>
<p>先行モニターの改善要望・不具合のご報告、ご契約やお支払いに関するお問い合わせは、メールでお送りください。</p>
<p><a class="btn" href="${esc(mailto(email, `【${cfg.productName}】改善要望`, template))}">改善要望をメールで送る</a></p>
<p><a class="btn sub" href="${esc(mailto(email, `【${cfg.productName}】不具合のご報告`, template))}">不具合をメールで報告する</a></p>
<p><a class="btn sub" href="${esc(mailto(email, `【${cfg.productName}】お問い合わせ`, ''))}">その他のお問い合わせ</a></p>
<p class="note">ボタンが使えない場合は、次のメールアドレスへ直接お送りください。<br><b>${esc(email)}</b><br>お送りいただいたご要望を必ず実装するお約束はできませんが、改善の検討に活用します。${site.owner.responseTimeNote ? `<br>${esc(site.owner.responseTimeNote)}` : ''}</p>
`;
}

// ── お支払い完了後のご案内 ───────────────────────────────────────────

function renderThanks(site: ResolvedSite, cfg: MonitorConfig, base: string): string {
  if (!site.gate.open) {
    return `
<h1>先行モニターのご案内</h1>
<div class="notice">このページは、先行モニターのお申込み完了後にご案内するページです。現在は受付準備中です。</div>
`;
  }
  const email = site.owner.supportEmail ?? '';
  return `
<h1>先行モニターへのご参加ありがとうございます</h1>
<p>${esc(cfg.productName)}に、お申込みいただきありがとうございます。このページは、お支払いが完了した方へのご案内です。</p>

<h2>これからの流れ</h2>
<ol class="steps">
<li>運営者がお支払いを確認し、ご登録のメールアドレス宛に利用開始のご案内をお送りします（運営者の手作業による対応のため、お時間をいただくことがあります）。${site.owner.responseTimeNote ? esc(site.owner.responseTimeNote) : ''}</li>
<li>ご案内が届く前でも、下のボタンから${esc(cfg.appName)}をお使いいただけます。</li>
<li>使ってみて気づいたこと、困ったこと、ほしい機能を、改善要望としてお送りください。</li>
</ol>

<p><a class="btn" href="${esc(cfg.appUrl)}" rel="noopener">${esc(cfg.appName)}を開く</a></p>
<p class="note">${esc(cfg.appName)}は、アカウント登録なしで使えるウェブアプリです。記録はお使いの端末に保存されます。ホーム画面に追加すると、アプリのように使えます。</p>

<h2>改善要望・お問い合わせ</h2>
<p><a class="btn sub" href="${esc(mailto(email, `【${cfg.productName}】改善要望`, '■ご要望の内容:\n\n\n■お使いの端末・ブラウザ:\n'))}">改善要望をメールで送る</a></p>
<p>詳しくは<a href="${base}monitor/contact/">お問い合わせ・改善要望</a>をご覧ください。</p>

<h2>解約・お支払い管理</h2>
<p>解約は、いつでも手続きできます。解約は現在の請求期間の終了時に有効となり、次回以降の請求は発生しません。</p>
<p><a class="btn sub" href="${esc(site.urls.portalLoginUrl ?? '')}" rel="noopener">解約・お支払い管理（Stripe）</a></p>

<p class="note">メールが届かない場合は、迷惑メールフォルダをご確認のうえ、<a href="${base}monitor/contact/">お問い合わせ</a>ください。</p>
`;
}

// ── 出力 ────────────────────────────────────────────────────────────

export interface RenderOptions {
  mode: SiteMode;
  /** Viteのbase（例: '/tohoku-michinoeki-map/'）。必ず前後に '/' を持つ */
  base: string;
}

export function renderMonitorSite(cfg: MonitorConfig = MONITOR_CONFIG, opts: RenderOptions): Record<string, string> {
  const site = resolveSite(cfg, opts.mode);
  const base = opts.base.endsWith('/') ? opts.base : `${opts.base}/`;
  const mk = (path: string, title: string, description: string, body: string) =>
    page({ site, cfg, base, path, title, description, body });
  const files: Record<string, string> = {
    'monitor/index.html': mk(
      'monitor/',
      `${cfg.productName}｜月額${yen(cfg.monitorPriceYen)}で参加できる先行モニター募集`,
      `全国の道の駅を記録して、ルートにして、めぐる「${cfg.appName}」の先行モニター募集（月額${yen(cfg.monitorPriceYen)}・正式版は月額${yen(cfg.plannedFullPriceYen)}を予定）。`,
      renderLanding(site, cfg, base),
    ),
    'monitor/terms/index.html': mk('monitor/terms/', `利用規約｜${cfg.productName}`, `${cfg.productName}の利用規約`, renderTerms(site, cfg, base)),
    'monitor/privacy/index.html': mk('monitor/privacy/', `プライバシーポリシー｜${cfg.productName}`, `${cfg.productName}のプライバシーポリシー`, renderPrivacy(site, cfg, base)),
    'monitor/tokushoho/index.html': mk('monitor/tokushoho/', `特定商取引法に基づく表記｜${cfg.productName}`, `${cfg.productName}の特定商取引法に基づく表記`, renderTokushoho(site, cfg, base)),
    'monitor/contact/index.html': mk('monitor/contact/', `お問い合わせ・改善要望｜${cfg.productName}`, `${cfg.productName}のお問い合わせ・改善要望`, renderContact(site, cfg)),
    'monitor/thanks/index.html': mk('monitor/thanks/', `先行モニターのご案内｜${cfg.productName}`, `${cfg.productName}のお申込み完了後のご案内`, renderThanks(site, cfg, base)),
  };
  // 機械可読の状態（個人情報・URLは含めない）。Owner/検証用。
  files['monitor/status.json'] = JSON.stringify({ mode: site.mode, salesOpen: site.gate.open, ownerInfoReady: site.gate.ownerReady, missing: site.gate.missing }, null, 2);
  return files;
}
