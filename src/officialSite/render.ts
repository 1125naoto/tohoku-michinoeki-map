/**
 * 「道の駅ナビ 全国版」公式ホームページ＋販売LP（縦長・画像中心のスマホ向け1ページ）の静的HTML生成（純関数）。
 *
 * - 画像はすべて本物のアプリ画面（Productionを実機相当の幅で撮影→切り出し・縮小のみ）。AI生成の画面は使わない。
 * - 購入ボタンは既存のStripe Payment Link（MONITOR_CONFIG.live.paymentLink）だけを使う。新しい商品・価格・リンクは作らない。
 * - 販売可否は monitorSite の evaluateSalesGate（受付中でなければ購入ボタンを一切出さない）。
 * - LINEのCTAは config.lineUrl が実在形式で設定されている場合だけ出す（未設定=ページに一切出ない）。
 * - `live=false`（ドメイン稼働前のプレビュー）は noindex・canonicalはプレビュー自身・robots.txt/sitemap.xmlは出さない。
 *   `live=true`（公式ドメインで稼働）で canonical/OGP/JSON-LD/robots/sitemap を公式URLで出力する。
 * - 外部リソース・Cookie・解析ツールなし。JavaScriptは流入元の付与とスティッキーCTAの出し分けだけ。
 */
import { MONITOR_CONFIG, type MonitorConfig } from '../monitorSite/config';
import { CHECKOUT_ATTRIBUTION_JS, evaluateSalesGate, resolveSite, taxSentence } from '../monitorSite/render';
import { OFFICIAL_CONFIG, isValidLineUrl, type OfficialConfig } from './config';

export interface OfficialRenderOptions {
  /** 配信パスのbase（公式ドメイン直下=`/`、GitHub Pagesプレビュー=`/tohoku-michinoeki-map/official/`）。前後に '/' */
  base: string;
  /** アプリ本体・共通アセット（icons等）のbase。プレビューでは `/tohoku-michinoeki-map/`、単独ビルドでは `/` */
  assetBase: string;
  /** 単独（公式ドメイン直下）ビルドか。robots.txt/sitemap.xml/404.html はこのときだけ出す */
  standalone: boolean;
  /** cfg.live を上書き（ビルド時の OFFICIAL_LIVE=1）。省略時は official.live */
  live?: boolean;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** 文節ごとに折り返す（日本語の語の途中で改行しない）。`|` が文節の区切り。文字列は静的でエスケープ不要なものだけ */
const ph = (t: string): string => t.split('|').map((x) => `<span class="nb">${x}</span>`).join('');
const yen = (n: number): string => `${n}円`;
const fmt = (n: number): string => n.toLocaleString('en-US');
const withSlash = (s: string): string => (s.endsWith('/') ? s : `${s}/`);

const CSS = `
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#e9efe6;color:#1f2a1f;font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic",Meiryo,sans-serif;font-size:17px;line-height:1.75;overflow-wrap:anywhere}
body.has-sticky{padding-bottom:84px}
a{color:#1b5e20}
img{display:block;max-width:100%;height:auto}
.wrap{max-width:480px;margin:0 auto;background:#f7f8f5;box-shadow:0 0 0 1px #d3dcd0}
.banner{padding:8px 14px;font-size:.85rem;text-align:center;font-weight:700;background:#c62828;color:#fff}
.panel{padding:34px 20px 36px;border-bottom:1px solid #dfe6dc;text-align:center}
.panel.alt{background:#fff}
.panel.hero{background:linear-gradient(180deg,#e3f2e1 0%,#f7f8f5 100%);padding-top:22px}
.panel.dark{background:#1f3d22;color:#fff}
.panel.dark h2,.panel.dark .num{color:#fff}
.num{display:inline-block;font-size:.8rem;font-weight:800;letter-spacing:.08em;color:#2e7d32;background:#e8f5e9;border-radius:999px;padding:1px 12px}
.panel.dark .num{background:rgba(255,255,255,.16)}
h1,h2{margin:.35em 0 .3em;line-height:1.4;text-wrap:balance;word-break:auto-phrase}
h1{font-size:1.9rem;font-weight:900;color:#1b5e20}
h2{font-size:1.5rem;font-weight:900}
h3{font-size:1.05rem;margin:0 0 .2em;color:#1b5e20}
p{margin:.55em 0}
.brandline{display:flex;align-items:center;justify-content:center;gap:10px;font-weight:800;color:#1b5e20;margin-bottom:6px}
.brandline img{border-radius:9px}
.nb{display:inline-block}
.sub{font-size:1.02rem;color:#3a4a3a;text-wrap:balance;word-break:auto-phrase}
.badges{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;list-style:none;padding:0;margin:14px 0}
.badges li{background:#fff;border:2px solid #2e7d32;border-radius:999px;padding:4px 14px;font-weight:800;color:#1b5e20;font-size:.95rem;margin:0}
.badges li.mon{background:#2e7d32;color:#fff}
.phone{margin:18px auto 6px;width:min(66vw,264px);background:#14211a;border-radius:34px;padding:9px;box-shadow:0 10px 26px rgba(20,33,26,.28)}
.phone img{border-radius:26px;width:100%;height:auto;background:#eef2ec}
.phones{display:flex;justify-content:center;align-items:center;gap:12px;margin:18px 0 6px}
.phones .phone{margin:0;width:calc(50% - 6px);max-width:224px;padding:6px;border-radius:26px}
.phones .phone img{border-radius:20px}
.panel.dark .phone{background:#0c1510}
.cap{font-size:.86rem;color:#4a5a4a;margin:6px 0 0}
.panel.dark .cap{color:#c8dcc6}
.pains{list-style:none;padding:0;margin:16px 0 0;display:grid;gap:10px;text-align:left}
.pains li{background:#fff;border:1px solid #dfe6dc;border-left:6px solid #e57373;border-radius:12px;padding:12px 14px;font-weight:700;margin:0}
.after{margin-top:18px;font-weight:800;color:#1b5e20;font-size:1.15rem;text-wrap:balance}
.states{list-style:none;padding:0;margin:14px 0 0;display:grid;grid-template-columns:1fr 1fr;gap:8px}
.states li{background:#fff;border:1px solid #dfe6dc;border-radius:12px;padding:8px 6px;font-weight:800;font-size:.95rem;margin:0}
.chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;list-style:none;padding:0;margin:14px 0 0}
.chips li{background:#e8f5e9;color:#1b5e20;border-radius:999px;padding:5px 16px;font-weight:800;margin:0}
.steps{list-style:none;counter-reset:s;padding:0;margin:14px 0 0;text-align:left;display:grid;gap:8px}
.steps li{counter-increment:s;background:#e8f5e9;border-radius:12px;padding:10px 12px 10px 46px;position:relative;margin:0}
.steps li::before{content:counter(s);position:absolute;left:12px;top:10px;width:24px;height:24px;border-radius:50%;background:#2e7d32;color:#fff;text-align:center;font-weight:800;line-height:24px;font-size:.9rem}
.btn{display:block;text-wrap:balance;text-align:center;background:#2e7d32;color:#fff;text-decoration:none;font-weight:800;font-size:1.15rem;border-radius:14px;padding:15px 12px;min-height:56px;box-shadow:0 3px 0 #1b5e20;margin:16px 0 6px}
.btn.line{background:#06c755;box-shadow:0 3px 0 #04913f}
.btn.ghost{background:#fff;color:#1b5e20;border:2px solid #2e7d32;box-shadow:none}
.panel.dark .btn{background:#fff;color:#1b5e20;box-shadow:0 3px 0 #9fc79f}
.mini{font-size:.86rem;color:#4a5a4a;margin:.5em 0 0}
.panel.dark .mini{color:#c8dcc6}
.panel.dark .mini a{color:#fff}
.pricebox{background:#fff;color:#1f2a1f;border-radius:16px;padding:16px 12px;margin:16px 0 4px}
.pricebox .plan{display:inline-block;background:#2e7d32;color:#fff;border-radius:999px;padding:1px 14px;font-weight:800;font-size:.9rem}
.pricebox .now{font-size:2.5rem;font-weight:900;line-height:1.25;color:#1b5e20;margin:.15em 0}
.pricebox .now small{font-size:1rem;font-weight:800}
.pricebox .formal{font-size:.95rem;color:#3a4a3a;margin:.2em 0 0}
.faq{text-align:left;margin-top:14px}
details{background:#fff;border:1px solid #dfe6dc;border-radius:12px;padding:8px 14px;margin:8px 0}
summary{font-weight:700;cursor:pointer}
details p{font-size:.95rem}
.note{font-size:.84rem;color:#4a5a4a;text-align:left;margin-top:14px}
footer{padding:20px 16px 26px;background:#fff;font-size:.88rem;text-align:center}
footer nav{display:flex;flex-wrap:wrap;gap:6px 16px;justify-content:center;margin-bottom:8px}
footer small{color:#5a6a5a;display:block}
.sticky-cta{position:fixed;left:0;right:0;bottom:0;z-index:20;background:rgba(255,255,255,.97);border-top:1px solid #dfe6dc;padding:8px 12px calc(8px + env(safe-area-inset-bottom));box-shadow:0 -2px 10px rgba(0,0,0,.08);transition:transform .2s ease,visibility 0s}
.sticky-cta .btn{margin:0 auto;max-width:456px;min-height:52px;padding:12px}
body.cta-in-view .sticky-cta{transform:translateY(110%);visibility:hidden;transition:transform .2s ease,visibility 0s .2s}
@media(min-width:640px){body{font-size:18px}.sticky-cta{display:none}body.has-sticky{padding-bottom:0}.wrap{margin:24px auto;border-radius:18px;overflow:hidden}}
`;

const IMG = {
  icon: { f: 'app-icon.webp', w: 144, h: 144 },
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
type ImgKey = keyof typeof IMG;

interface Ctx {
  cfg: MonitorConfig;
  off: OfficialConfig;
  base: string;
  assetBase: string;
  open: boolean;
  payUrl: string;
  portalUrl: string;
  line: string | null;
  live: boolean;
  canonical: string;
  taxNote: string | null;
}

const img = (c: Ctx, k: ImgKey, alt: string, lazy = true): string => {
  const i = IMG[k];
  return `<img src="${c.base}img/${i.f}" width="${i.w}" height="${i.h}" alt="${esc(alt)}"${lazy ? ' loading="lazy" decoding="async"' : ' fetchpriority="high"'}>`;
};
const phone = (c: Ctx, k: ImgKey, alt: string, lazy = true): string => `<div class="phone">${img(c, k, alt, lazy)}</div>`;

/** 購入CTA（Payment Link）。受付中でなければ出さない。`data-checkout` は流入元の付与に使う */
const cta = (c: Ctx, where: string): string =>
  c.open ? `<a class="btn" data-checkout data-cta="${where}" href="${esc(c.payUrl)}" rel="noopener">月額${yen(c.cfg.monitorPriceYen)}で始める</a>` : '';

/** LINE CTA。友だち追加URLが確定するまでは何も出さない（架空のURLは公開しない） */
const lineCta = (c: Ctx, where: string): string =>
  c.line ? `<a class="btn line" data-line data-cta="${where}" href="${esc(c.line)}" rel="noopener">LINEで最新情報を受け取る</a>` : '';

function panels(c: Ctx): string[] {
  const n = fmt(c.cfg.stationCount);
  const price = yen(c.cfg.monitorPriceYen);
  const formal = yen(c.cfg.plannedFullPriceYen);
  const tax = c.taxNote ? '（税込）' : '';
  const p: string[] = [];

  // 01 ファーストビュー
  p.push(`<section class="panel hero" id="top" aria-labelledby="h-top">
<div class="brandline"><img src="${c.base}img/${IMG.icon.f}" width="40" height="40" alt=""><span>${esc(c.cfg.productName)}</span></div>
<h1 id="h-top">${ph('次の道の駅、|どこ行こう？')}</h1>
<p class="sub">${ph(`${esc(c.cfg.productName)}は、|探す・記録する・巡る、|道の駅ドライブが|これひとつでできる|スマホのアプリです。`)}</p>
<ul class="badges"><li>全国${n}施設を収録</li><li class="mon"><span class="nb">新リリース・モニター</span> <span class="nb">月額${price}${tax}</span></li></ul>
${phone(c, 'national', '全国の道の駅が地図に並ぶ「道の駅ナビ 全国版」の実際の画面', false)}
<p class="cap">${ph('実際のアプリ画面|（全国表示）')}</p>
${cta(c, 'hero')}
${lineCta(c, 'hero')}
<p class="mini">${c.open ? '毎月自動更新・いつでも解約できます' : '現在、新リリース・モニターのお申込みは準備中です'}</p>
</section>`);

  // 02 お悩み
  p.push(`<section class="panel alt" aria-labelledby="h-pain">
<span class="num">02</span>
<h2 id="h-pain">${ph('道の駅めぐり、|こんなことは|ありませんか？')}</h2>
<ul class="pains">
<li>${ph('どこに行ったか、|わからなくなる')}</li>
<li>${ph('行ってみたい道の駅が、|メモや写真に|バラバラ')}</li>
<li>${ph('次はどこへ行くか、|なかなか決められない')}</li>
<li>${ph('何駅かまわるコースを、|考えるのが|たいへん')}</li>
</ul>
<p class="after">${ph('ぜんぶ、|ひとつのアプリに|まとめられます。')}</p>
</section>`);

  // 03 地図で探す
  p.push(`<section class="panel" aria-labelledby="h-map">
<span class="num">03</span>
<h2 id="h-map">${ph('全国の道の駅を、|地図で探せる')}</h2>
<p class="sub">${ph(`北海道から沖縄まで、|全国${n}施設を収録。|地図を動かして、|気になる道の駅を|見つけられます。`)}</p>
<div class="phones">${phone(c, 'national', '全国の道の駅が並ぶ地図の実際の画面')}${phone(c, 'states', 'ひとつの地域に拡大した地図の実際の画面')}</div>
<p class="cap">${ph('全国表示から、地域ごとの拡大まで|（実際のアプリ画面）')}</p>
<ul class="chips"><li>地図から探す</li><li>道の駅名で検索</li><li>都道府県で絞り込み</li></ul>
</section>`);

  // 04 訪問・スタンプ管理
  p.push(`<section class="panel alt" aria-labelledby="h-stamp">
<span class="num">04</span>
<h2 id="h-stamp">${ph('訪問・スタンプを、|地図で管理')}</h2>
<p class="sub">${ph('道の駅の状態は、|地図のマークの色や印で|見分けられます。')}</p>
<ul class="states"><li>未訪問</li><li>訪問済み</li><li>行きたい</li><li>スタンプ取得済み</li></ul>
<div class="phones">${phone(c, 'legend', '訪問状態を色と印で見分ける凡例の実際の画面')}${phone(c, 'stats', '都道府県ごとの訪問数と達成率の実際の画面')}</div>
<p class="cap">${ph('凡例と、都道府県ごとの達成状況|（実際のアプリ画面）')}</p>
</section>`);

  // 05 タップで選ぶ
  p.push(`<section class="panel" aria-labelledby="h-tap">
<span class="num">05</span>
<h2 id="h-tap">${ph('気になる道の駅を、|タップで選ぶ')}</h2>
<p class="sub">${ph('地図のマークをタップすると、|詳細が開きます。|「訪問済みにする」|「行きたいにする」|「スタンプ取得済みにする」を、|ボタンひとつで|記録できます。')}</p>
<div class="phones">${phone(c, 'sheet', '道の駅をタップして開く詳細と記録ボタンの実際の画面')}${phone(c, 'wantDone', '「行きたい」に記録した直後の実際の画面')}</div>
<p class="cap">${ph('タップして、記録するまで|（実際のアプリ画面）')}</p>
${cta(c, 'mid')}
</section>`);

  // 06 周辺スポット
  p.push(`<section class="panel alt" aria-labelledby="h-poi">
<span class="num">06</span>
<h2 id="h-poi">${ph('道の駅の周辺も、|まとめて探せる')}</h2>
<p class="sub">${ph('道の駅のまわりにある|「食べる」「観光」|「温泉・休憩」「宿泊」の|候補を、|地図と一覧で|確認できます。')}</p>
<div class="phone" style="width:min(88vw,400px)">${img(c, 'poi', '道の駅の周辺の食べる・観光・温泉のスポットが地図に表示された実際の画面')}</div>
<p class="cap">${ph('周辺スポットの表示|（実際のアプリ画面）')}</p>
<ul class="chips"><li>食べる</li><li>観光</li><li>温泉・休憩</li><li>宿泊</li></ul>
<p class="mini">${ph('掲載する施設情報は、|変更や誤りがある場合があります。|お出かけ前に公式情報で|ご確認ください。')}</p>
</section>`);

  // 07 ルート
  p.push(`<section class="panel" aria-labelledby="h-route">
<span class="num">07</span>
<h2 id="h-route">${ph('選んだ道の駅で、|ドライブコースを作る')}</h2>
<p class="sub">${ph('行きたい道の駅を|地図でいくつか選んで|「この駅でコースを作る」。|出発地や希望を選ぶと、|移動時間や滞在時間を|ふくめた行程の目安が|表示されます。')}</p>
<div class="phones">${phone(c, 'select', '地図で3つの道の駅を選んだ状態の実際の画面')}${phone(c, 'detail', '所要時間と行程の内訳が表示されたコースの実際の画面')}</div>
<p class="cap">${ph('駅を選ぶ → 行程の目安を確認|（実際のアプリ画面）')}</p>
<p class="mini">${ph('所要時間は目安です。|実際の道路状況は|反映されません。')}</p>
</section>`);

  // 08 自分だけの道の駅めぐり
  p.push(`<section class="panel alt" aria-labelledby="h-own">
<span class="num">08</span>
<h2 id="h-own">${ph('自分だけの|道の駅めぐりに')}</h2>
<p class="sub">${ph('できたコースは保存でき、|立ち寄り先・順番・|時間・道路の希望は、|あとから変えられます。|地図で順番を|見ることもできます。')}</p>
${phone(c, 'actions', '「このコースを保存」「立ち寄り先や順番を変更する」などのボタンが並ぶ実際の画面')}
<p class="cap">${ph('保存・変更のボタン|（実際のアプリ画面）')}</p>
</section>`);

  // 09 移動時間・Googleナビ
  p.push(`<section class="panel" aria-labelledby="h-go">
<span class="num">09</span>
<h2 id="h-go">${ph('出発したら、|次の駅へ|Googleマップでナビ')}</h2>
<p class="sub">${ph('「このコースで出発」を押すと、|いまの目的地（次の道の駅）と、|到着予定の目安が|表示されます。|案内は「Googleマップで次の駅へ」から、|いつものGoogleマップのナビで。')}</p>
${phone(c, 'trip', '出発後に次の道の駅とGoogleマップへのボタンが表示された実際の画面')}
<p class="cap">${ph('出発後の画面|（実際のアプリ画面）')}</p>
<ol class="steps"><li>「到着した」で、次の道の駅へ進める</li><li>着いたら「スタンプ取得済み」も記録できる</li></ol>
</section>`);

  // 10 最後のCTA
  p.push(`<section class="panel dark" id="start" aria-labelledby="h-cta">
<span class="num">10</span>
<h2 id="h-cta">${ph('道の駅巡りを、|もっと簡単に。|もっと楽しく。')}</h2>
<div class="pricebox">
<span class="plan">${esc(c.cfg.planName.replace('価格', ''))}</span>
<p class="now">月額${price}<small>${tax}</small></p>
<p class="formal">正式版の予定価格 月額${formal}（税込）</p>
</div>
${cta(c, 'final')}
${lineCta(c, 'final')}
<p class="mini">毎月自動更新・いつでも解約できます。お申込み前に<a href="${c.cfg.appUrl}monitor/terms/">利用規約</a>・<a href="${c.cfg.appUrl}monitor/tokushoho/">特定商取引法に基づく表記</a>をご確認ください。</p>
</section>`);

  return p;
}

function faq(c: Ctx): string {
  const items: Array<[string, string]> = [
    ['いくつの道の駅が入っていますか？', `全国${fmt(c.cfg.stationCount)}施設を収録しています。`],
    ['料金はいくらですか？', `新リリース・モニターは月額${yen(c.cfg.monitorPriceYen)}（税込）です。正式版の予定価格は月額${yen(c.cfg.plannedFullPriceYen)}（税込）です。`],
    ['解約はできますか？', `いつでも解約できます。解約後は次回以降の請求は発生しません。`],
    ['お支払い画面に「お宝ファインダー」と表示されるのはなぜですか？', `運営者が、お支払いの受付に使うStripeのアカウントを、別のサービス「お宝ファインダー」と共通で使っているためです。この販売の事業者は<a href="${c.cfg.appUrl}monitor/tokushoho/">特定商取引法に基づく表記</a>のとおりです。`],
    ['スマホで使えますか？', `スマホのブラウザで使えます。ホーム画面に追加すると、アプリのように起動できます。`],
    ['営業時間や施設情報は正確ですか？', `営業時間・施設情報・ルートの所要時間は目安です。お出かけ前に、各施設の公式情報をご確認ください。`],
  ];
  return `<section class="panel alt" aria-labelledby="h-faq">
<h2 id="h-faq">よくあるご質問</h2>
<div class="faq">${items.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${a}</p></details>`).join('\n')}</div>
</section>`;
}

/** 公開HTMLへ出す構造化データ（画面に書いてある内容と一致するものだけ） */
function jsonLd(c: Ctx): string {
  const site = c.canonical;
  const data = [
    { '@context': 'https://schema.org', '@type': 'WebSite', name: c.cfg.productName, alternateName: ['道ナビ', '道の駅ナビ'], url: site, inLanguage: 'ja' },
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: c.cfg.productName,
      applicationCategory: 'TravelApplication',
      operatingSystem: 'Web（スマートフォンのブラウザ）',
      url: site,
      inLanguage: 'ja',
      description: `全国${fmt(c.cfg.stationCount)}施設を収録。道の駅を地図で探し、訪問やスタンプを記録し、周辺スポットを見ながらドライブコースを作れるアプリ。`,
      offers: { '@type': 'Offer', price: String(c.cfg.monitorPriceYen), priceCurrency: 'JPY', url: c.payUrl, availability: 'https://schema.org/InStock', description: '新リリース・モニター価格（月額・税込）' },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        ['いくつの道の駅が入っていますか？', `全国${fmt(c.cfg.stationCount)}施設を収録しています。`],
        ['料金はいくらですか？', `新リリース・モニターは月額${yen(c.cfg.monitorPriceYen)}（税込）です。正式版の予定価格は月額${yen(c.cfg.plannedFullPriceYen)}（税込）です。`],
        ['解約はできますか？', 'いつでも解約できます。解約後は次回以降の請求は発生しません。'],
      ].map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
    },
  ];
  // '<' を \u003c にして </script> 断ち切りを防ぐ
  return data.map((d) => `<script type="application/ld+json">${JSON.stringify(d).replace(/</g, '\\u003c')}</script>`).join('\n');
}

export const OFFICIAL_TITLE = (cfg: MonitorConfig): string => `${cfg.productName}｜全国${fmt(cfg.stationCount)}施設の道の駅を地図で探す・スタンプ記録・ルート作成`;
export const OFFICIAL_DESCRIPTION = (cfg: MonitorConfig): string =>
  `全国${fmt(cfg.stationCount)}施設を収録した「${cfg.productName}」（道ナビ）。道の駅を地図で探し、訪問・スタンプを記録し、周辺スポットを見ながらドライブコースを作れます。新リリース・モニターは月額${yen(cfg.monitorPriceYen)}（税込）。`;

export function renderOfficialSite(
  opts: OfficialRenderOptions,
  cfg: MonitorConfig = MONITOR_CONFIG,
  off: OfficialConfig = OFFICIAL_CONFIG,
): Record<string, string> {
  const base = withSlash(opts.base);
  const assetBase = withSlash(opts.assetBase);
  const live = opts.live ?? off.live;
  const site = resolveSite(cfg, 'live');
  const gate = evaluateSalesGate(cfg, 'live');
  const origin = withSlash(off.siteOrigin);
  // live=公式ドメインの正式URL。プレビューは自分自身（公式ドメインの未稼働URLを名乗らない）
  const canonical = live ? origin : new URL(base, cfg.appUrl).toString();
  const ctx: Ctx = {
    cfg,
    off,
    base,
    assetBase,
    open: gate.open,
    payUrl: site.urls.paymentLink ?? '',
    portalUrl: site.urls.portalLoginUrl ?? '',
    line: isValidLineUrl(off.lineUrl) ? off.lineUrl : null,
    live,
    canonical,
    taxNote: taxSentence(cfg, site.owner),
  };
  const title = OFFICIAL_TITLE(cfg);
  const description = OFFICIAL_DESCRIPTION(cfg);
  const ogImageUrl = live ? `${origin}og-image.png` : new URL('og-image.png', cfg.appUrl).toString();
  const noindex = !live || !gate.open;
  const hasSticky = ctx.open;
  const bodyPanels = panels(ctx).join('\n');
  const legal = (path: string, label: string) => `<a href="${cfg.appUrl}monitor/${path}">${label}</a>`;
  const footer = `<footer>
<nav aria-label="運営情報">${legal('', '新リリース・モニター募集')}${legal('terms/', '利用規約')}${legal('privacy/', 'プライバシーポリシー')}${legal('tokushoho/', '特定商取引法に基づく表記')}${legal('contact/', 'お問い合わせ・改善要望')}${ctx.open && ctx.portalUrl ? `<a href="${esc(ctx.portalUrl)}" rel="noopener">契約内容の確認・解約</a>` : ''}</nav>
<small>${esc(cfg.productName)}（道ナビ）｜画面は、記録の例を入れた実際のアプリ画面です。</small>
</footer>`;
  const stickyCta = hasSticky
    ? `<div class="sticky-cta"><a class="btn" data-checkout data-cta="sticky" href="${esc(ctx.payUrl)}" rel="noopener">月額${yen(cfg.monitorPriceYen)}で始める</a></div>\n`
    : '';
  const banner = live ? '' : '<div class="banner">公開前の確認用プレビューです（検索エンジンには表示されません）</div>\n';
  const sourceJs = `(function(){try{var m={${Object.entries(off.sources).map(([k, v]) => `${k}:'${v}'`).join(',')}},s=new URLSearchParams(location.search).get('s');if(s&&m[s]&&!new URLSearchParams(location.search).get('utm_source')){var as=document.querySelectorAll('a[data-checkout]'),ref=m[s]+'_lp';for(var i=0;i<as.length;i++){var u=new URL(as[i].href);u.searchParams.set('client_reference_id',ref);as[i].href=u.toString()}}}catch(e){}})();`;
  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="${noindex ? 'noindex,nofollow' : 'index,follow,max-image-preview:large'}">
<meta name="theme-color" content="#2e7d32">
${live && off.googleSiteVerification ? `<meta name="google-site-verification" content="${esc(off.googleSiteVerification)}">\n` : ''}<link rel="icon" href="${assetBase}icons/icon-48.png">
<link rel="apple-touch-icon" href="${assetBase}icons/icon-192.png">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(cfg.productName)}">
<meta property="og:locale" content="ja_JP">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(ogImageUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(ogImageUrl)}">
${live && gate.open ? jsonLd(ctx) + '\n' : ''}<style>${CSS}</style>
</head>
<body${hasSticky ? ' class="has-sticky"' : ''}>
<div class="wrap">
${banner}<main>
${bodyPanels}
${faq(ctx)}
</main>
${footer}
</div>
${stickyCta}${ctx.open ? `<script>${CHECKOUT_ATTRIBUTION_JS}${sourceJs}</script>
` : ''}</body>
</html>
`;

  const files: Record<string, string> = { 'index.html': html };
  if (opts.standalone) {
    files['404.html'] = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>ページが見つかりません｜${esc(cfg.productName)}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic",Meiryo,sans-serif;background:#f7f8f5;color:#1f2a1f;margin:0;padding:48px 20px;text-align:center;line-height:1.8}a{color:#1b5e20;font-weight:700}</style></head>
<body><h1>ページが見つかりません</h1><p>お探しのページは移動または削除された可能性があります。</p><p><a href="${base}">${esc(cfg.productName)} のトップへ</a></p></body></html>
`;
    files['robots.txt'] = live
      ? `User-agent: *\nAllow: /\n\nSitemap: ${origin}sitemap.xml\n`
      : `User-agent: *\nDisallow: /\n`;
    if (live) {
      files['sitemap.xml'] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${origin}</loc></url>\n</urlset>\n`;
    }
  }
  return files;
}
