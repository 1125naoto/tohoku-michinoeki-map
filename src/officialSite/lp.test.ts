import { describe, expect, it } from 'vitest';
import { STATIONS } from '../data';
import { CATEGORY_LABEL } from '../lib/poi';
import { MONITOR_CONFIG, type MonitorConfig } from '../monitorSite/config';
import { OFFICIAL_CONFIG } from './config';
import { APP_SHOTS, LP_ART, LP_SECTIONS, renderXProfileLp, type LpRenderOptions } from './lp';
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
const text = (h: string) => markup(h).replace(/<noscript>[\s\S]*?<\/noscript>/g, '').replace(/<[^>]+>/g, '');
/** 購入欄（#start）より前の本文 */
const body = (h: string) => text(h.slice(0, h.indexOf('id="start"')));
/** アプリのソース（Viteの ?raw）。引用した文言がアプリに実在するかを確かめるために読む */
const RAW = import.meta.glob(['../App.tsx', '../components/*.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const src = (rel: string): string => {
  const t = RAW[`../${rel}`];
  if (typeof t !== 'string') throw new Error(`ソースが読めない: ${rel}`);
  return t;
};

const LP_FILES = Object.keys(import.meta.glob('../../public/official/lp/*.webp')).map((k) => k.replace('../../public/official/lp/', ''));
const APP_FILES = Object.keys(import.meta.glob('../../public/official/img/*.webp')).map((k) => k.replace('../../public/official/img/', ''));

describe('LP: 構成（10区画・順番・実リンク）', () => {
  it('区画 #p1〜#p10 が順番に並び、すべての「次へ」の行き先（#id）が存在する', () => {
    const h = lp();
    let last = -1;
    for (const s of LP_SECTIONS) {
      const at = h.indexOf(`id="${s.id}"`);
      expect(at, s.id).toBeGreaterThan(last);
      last = at;
    }
    expect(h.indexOf('id="start"')).toBeGreaterThan(last);
    const targets = [...markup(h).matchAll(/<a class="(?:next(?: go)?|hit)" href="(#[^"]+)"/g)].map((m) => m[1]);
    expect(targets).toHaveLength(10); // p1・p2・p3〜p9（7）・p10
    for (const t of targets) expect(h).toContain(`id="${t.slice(1)}"`);
  });

  it('「次へ」の名前は、行き先の内容と一致する（ボタンの説明と遷移先が食い違わない）', () => {
    const bySection = new Map<string, (typeof LP_SECTIONS)[number]>(LP_SECTIONS.map((s) => [s.id, s]));
    const KEY: Record<string, string> = { p3: '地図', p4: 'スタンプ', p5: 'コース', p6: '周辺', p7: 'コース', p8: '記録', p9: 'Googleマップ', p10: '安心' };
    for (const s of LP_SECTIONS.slice(1, 9)) {
      const to = bySection.get(s.next.href.slice(1))!;
      expect(s.next.label).toContain('次へ：');
      expect(s.next.label, `${s.id}→${to.id}`).toContain(KEY[to.id]);
      expect(to.title, `${to.id}`).toContain(KEY[to.id].replace('記録', '記録'));
    }
    expect(LP_SECTIONS[0].next.href).toBe('#start');
    expect(LP_SECTIONS[9].next.href).toBe('#start');
  });

  it('お悩みの画像（lp-02）の焼き込みボタンの上に実リンクがあり、次の区画へ移る', () => {
    expect(markup(lp())).toMatch(/<a class="hit" href="#p3" aria-label="次へ：全国の道の駅を地図で探す"/);
  });

  it('使う画像ファイル（本物のアプリ画面・Owner素材）がすべて実在し、使わないファイルは置かない', () => {
    for (const s of Object.values(APP_SHOTS)) expect(APP_FILES).toContain(s.f);
    const used = new Set<string>();
    for (const a of Object.values(LP_ART)) {
      expect(LP_FILES).toContain(`${a.f}.webp`);
      expect(LP_FILES).toContain(`${a.f}-480.webp`);
      used.add(`${a.f}.webp`);
      used.add(`${a.f}-480.webp`);
    }
    expect(LP_FILES.filter((f) => !used.has(f))).toEqual([]);
  });

  it('画像には代替テキスト・幅・高さがあり、先頭の画像だけを最優先で読む（2枚目以降は遅延＋noscript代替）', () => {
    const m = markup(lp());
    const imgs = [...m.replace(/<noscript>[\s\S]*?<\/noscript>/g, '').matchAll(/<img [^>]*>/g)].map((x) => x[0]);
    expect(imgs.length).toBeGreaterThanOrEqual(15);
    for (const i of imgs) {
      expect(i).toMatch(/alt="[^"]+"/);
      expect(i).toMatch(/width="\d+"/);
      expect(i).toMatch(/height="\d+"/);
    }
    expect(m.match(/fetchpriority="high"/g)?.length).toBe(2); // 先頭画像 と preload
    expect(m.match(/<noscript>/g)?.length).toBe(imgs.length - 1);
  });
});

describe('LP: Product Truth（商品説明と現行アプリの一致）', () => {
  it('アプリ画面はすべて本物の画面（public/official/img）。生成画像の画面（lp-03〜10）は使わない', () => {
    const h = lp();
    for (const n of ['03', '04', '05', '06', '07', '08', '09', '10']) expect(h).not.toContain(`lp-${n}`);
    const shots = new Set([...markup(h).matchAll(/data-src="[^"]*\/img\/([a-z-]+\.webp)"/g)].map((m) => m[1]));
    expect(shots.size).toBe(Object.keys(APP_SHOTS).length);
    for (const s of shots) expect(APP_FILES).toContain(s);
  });

  it('実在しない機能の表現を出さない（クチコミタブ・買い物・アプリ内ナビ・4つの下部タブ・「最適」）', () => {
    const t = text(lp());
    for (const w of ['クチコミ', '買い物', '地元産直市場', '地図で探す', '一覧で探す', 'エリアで探す', 'お気に入りリスト', 'ターンバイターン', '最適なルート', '最適な順番', '東北の美しい']) {
      expect(t, w).not.toContain(w);
    }
    // 「口コミ」は「アプリ内には表示しない／Googleマップで」と説明する文脈だけ
    for (const m of t.matchAll(/口コミ/g)) {
      expect(t.slice(Math.max(0, m.index - 40), m.index + 40)).toMatch(/表示していません|表示しません|Googleマップ|アプリ内には/);
    }
    expect(t).toContain('アプリの中にナビ画面はありません');
  });

  it('周辺スポットのカテゴリ名は、アプリの定義（CATEGORY_LABEL）と一致する', () => {
    const labels = Object.values(CATEGORY_LABEL);
    expect(labels).toEqual(['食べる', '観光', '温泉・休憩', '宿泊']);
    for (const l of labels) expect(markup(lp())).toContain(`<li>${l}</li>`);
    expect(text(lp())).toContain('「食べる」「観光」「温泉・休憩」「宿泊」');
  });

  it('引用しているボタン名・文言は、アプリのソースに実在する', () => {
    const station = src('components/StationSheet.tsx');
    const results = src('components/RouteResults.tsx');
    const trip = src('components/TripView.tsx');
    const bar = src('components/RouteSelectBar.tsx');
    const map = src('components/MapView.tsx');
    const poiSheet = src('components/PoiDetailSheet.tsx');
    for (const l of ['訪問済みにする', '行きたいにする', 'スタンプ取得済みにする']) expect(station).toContain(l);
    for (const l of ['このコースで出発', 'Googleマップで全体を確認', '地図で順番を見る', 'このコースを保存']) expect(results).toContain(l);
    expect(trip).toContain('Googleマップで次の');
    expect(trip).toContain('到着した');
    expect(bar).toContain('この駅でコース作成');
    expect(map).toContain('回りたい道の駅を選んでください');
    expect(poiSheet).toContain('評価・口コミはこのアプリには表示していません');
    const t = body(lp());
    for (const l of ['この駅でコース作成', '訪問済みにする', '行きたいにする', 'スタンプ取得済みにする', 'Googleマップで次の駅へ', '到着した']) expect(t).toContain(l);
  });

  it('本文中の「」の引用は、確認済みの語だけ（新しい引用を足すときは、ソースで確かめてここに足す）', () => {
    const VERIFIED = new Set([
      '食べる', '観光', '温泉・休憩', '宿泊', 'この駅でコース作成', '訪問済みにする', '行きたいにする', 'スタンプ取得済みにする',
      'Googleマップで次の駅へ', '到着した', 'スタンプ取得済み',
    ]);
    const quoted = [...body(lp()).matchAll(/「([^」]+)」/g)].map((m) => m[1]);
    expect(quoted.length).toBeGreaterThan(5);
    for (const q of quoted) expect(VERIFIED.has(q), `「${q}」`).toBe(true);
  });

  it('収録施設数はアプリのデータ件数と一致する（ヒーロー画像の見出しに焼き込み済み）', () => {
    expect(STATIONS.length).toBe(1237);
    expect(MONITOR_CONFIG.stationCount).toBe(STATIONS.length);
    expect(lp()).toContain('全国1,237施設');
  });

  it('下部タブの構成を書かない（実際は地図・コース・保存の3つで、画像の4タブとは違う）', () => {
    expect(src('App.tsx')).toMatch(/type Tab = 'map' \| 'route' \| 'records'/);
    expect(body(lp())).not.toContain('タブ');
  });
});

describe('LP: Pricing Truth（料金は決済前に明示し、未実証のことは確認済みと書かない）', () => {
  it('ヒーローの価格の丸は、最初の2か月と3か月目以降の両方を示す（「月額250円」だけを出さない）', () => {
    const badge = markup(lp()).match(/<div class="badge"[\s\S]*?<\/div>/)?.[0] ?? '';
    const t = badge.replace(/<[^>]+>/g, ' ');
    for (const w of ['最初の2か月', '250', '3か月目以降', '500', '税込']) expect(t).toContain(w);
  });

  it('料金・継続課金・解約の説明が購入ボタンより前にある。購入ボタンは #start の中の月額・年間の2つだけ', () => {
    const h = lp();
    const start = h.indexOf('id="start"');
    const check = h.indexOf('class="check"');
    const firstBuy = h.indexOf('<a class="btn" data-checkout');
    expect(check).toBeGreaterThan(start);
    expect(firstBuy).toBeGreaterThan(check);
    expect(markup(h).match(/data-checkout/g)?.length).toBe(2);
    expect(h).toContain(`href="${MONTHLY_LINK}"`);
    expect(h).toContain(`href="${ANNUAL_LINK}"`);
    expect(h).not.toContain(LEGACY_250_LINK);
    expect(h.match(/buy\.stripe\.com/g)?.length).toBe(2);
  });

  it('必須の説明（自動更新・継続課金・解約・税込・年間・返金・Stripe決済画面の表示名・申込後の流れ）がある', () => {
    const t = text(lp());
    const s = t.slice(t.indexOf('料金とお申し込み'));
    for (const w of ['最初の2か月', '250円/月', '3か月目以降', '500円/月', '毎月自動更新', '継続課金', 'いつでも解約', '4,980円/年', '税込', '原則として返金しません', 'お宝ファインダー', 'お申し込みのあとの流れ', '道の駅ナビを開く']) expect(s).toContain(w);
  });

  it('3か月目からの切替は「確認済み」「保証」と書かない（実購入での動作は未実証）。料金の約束として条件を示すだけ', () => {
    const t = text(lp());
    expect(t).not.toMatch(/確認済み|保証|必ず500|自動で切り替わることを確認/);
    expect(t).toContain('自動で500円/月になります');
  });

  it('料金の数字は config から出る（変えると全部変わる）', () => {
    const cfg: MonitorConfig = { ...MONITOR_CONFIG, pricing: { monthly: { introPriceYen: 300, introMonths: 3, regularPriceYen: 600 }, annual: { priceYen: 5980 } } };
    const t = text(lp(DOMAIN, cfg));
    for (const w of ['最初の3か月', '300円/月', '600円/月', '5,980円/年']) expect(t).toContain(w);
    expect(t).not.toContain('4,980円/年');
  });

  it('上部の「今すぐ始める」（スティッキー含む）は決済リンクではなく、説明（#start）への移動', () => {
    const h = lp();
    const sticky = markup(h).match(/<div class="sticky-cta">[\s\S]*?<\/div>/)?.[0] ?? '';
    expect(sticky).toContain('href="#start"');
    expect(sticky).not.toContain('buy.stripe.com');
    expect(sticky).not.toContain('data-checkout');
    expect(markup(h)).toMatch(/<a class="next go" href="#start"/);
  });

  it('画像の説明（アプリ画面は実画面・上部の写真はイメージ）と、口コミの案内を明記する', () => {
    const t = text(lp());
    expect(t).toContain('アプリの画面は、実際の画面です');
    expect(t).toContain('写真・イラストは紹介用のイメージ');
    expect(t).toContain('口コミ・評価は、Googleマップで確認できます');
  });
});

describe('LP: 受付中でなければ購入ボタンを出さない', () => {
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

describe('LP: 公開の扱い', () => {
  it('常に noindex。canonical は自分自身', () => {
    expect(lp()).toContain('<meta name="robots" content="noindex,follow">');
    expect(lp()).toContain('<link rel="canonical" href="https://michinoekinavi.jp/lp/">');
    expect(lp(PREVIEW)).toContain('canonical" href="https://1125naoto.github.io/tohoku-michinoeki-map/official/lp/"');
    expect(lp(PREVIEW)).toContain('公開前の確認用プレビューです');
  });

  it('既存の公式トップ（index.html）を上書きしない。追加されるのは lp/index.html だけ', () => {
    const files = renderOfficialSite({ base: '/', assetBase: '/', standalone: true, live: true });
    expect(Object.keys(files).sort()).toEqual(['404.html', 'index.html', 'lp/index.html', 'robots.txt', 'sitemap.xml']);
    expect(files['sitemap.xml']).not.toContain('/lp/');
    expect(files['index.html']).not.toContain('lp-01.webp');
  });

  it('画像・アイコンのパスは配信baseに従う（プレビューと公式ドメインの両方）', () => {
    expect(lp(DOMAIN)).toContain('src="/lp/lp-01.webp"');
    expect(lp(DOMAIN)).toContain('data-src="/img/map-national.webp"');
    expect(lp(DOMAIN)).toContain('href="/icons/icon-48.png"');
    expect(lp(PREVIEW)).toContain('src="/tohoku-michinoeki-map/official/lp/lp-01.webp"');
    expect(lp(PREVIEW)).toContain('data-src="/tohoku-michinoeki-map/official/img/map-national.webp"');
    expect(lp(PREVIEW)).toContain('href="/tohoku-michinoeki-map/icons/icon-48.png"');
  });

  it('外部の解析・Cookie・外部スクリプトを使わない。秘密情報を含まない', () => {
    const h = lp();
    expect(h).not.toMatch(/<script[^>]+src=/);
    expect(h).not.toMatch(/google-analytics|googletagmanager|gtag\(|document\.cookie|fbq\(/);
    expect(h).not.toMatch(/\b(sk|rk|whsec)_(live|test)_[A-Za-z0-9]+/);
  });
});
