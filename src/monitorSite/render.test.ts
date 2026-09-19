import { describe, expect, it } from 'vitest';
import { STATIONS } from '../data';
import { MONITOR_CONFIG, TEST_OWNER_DUMMY, type MonitorConfig } from './config';
import { CHECKOUT_ATTRIBUTION_JS, evaluateSalesGate, jpDate, renderMonitorSite, resolveSite, taxSentence } from './render';

const BASE = '/tohoku-michinoeki-map/';

/** リポジトリに実在する画像（public/monitor/img）。Node型に依存せず、Viteのglobで列挙する */
const PUBLIC_IMAGES = Object.keys(import.meta.glob('../../public/monitor/img/*.jpg')).map((k) => k.replace('../../public/', ''));
const imageExists = (rel: string) => PUBLIC_IMAGES.includes(rel);
const PAGES = ['index', 'terms', 'privacy', 'tokushoho', 'contact', 'thanks'] as const;

/** Ownerが本番で作成済みのPayment Link（config.tsの値と一致していること＝リンクミスの検出） */
const OWNER_PAYMENT_LINK = 'https://buy.stripe.com/bJe5kE3eheQO8XYaa07Zu00';

/** 解約ポータルURLまで揃った「受付中」を検証するための架空の値（実在しない） */
const OPEN_CFG: MonitorConfig = {
  ...MONITOR_CONFIG,
  owner: {
    sellerName: '架空 太郎',
    addressDisclosure: 'on_request',
    address: null,
    phoneDisclosure: 'on_request',
    phone: null,
    supportEmail: 'support@example.invalid',
    monitorPriceTaxInclusive: true,
    refundPolicy: '決済後の返金は行いません。',
    effectiveDate: '2026-10-01',
    responseTimeNote: null,
  },
  live: {
    paymentLink: 'https://buy.stripe.com/liveFakeLink123',
    portalLoginUrl: 'https://billing.stripe.com/p/login/liveFakePortal456',
  },
};

/** 事業者情報は確認済みだが、Payment Linkが無い設定（受付準備中） */
const CLOSED_CFG: MonitorConfig = { ...MONITOR_CONFIG, live: { paymentLink: null, portalLoginUrl: null } };

/** 事業者情報が未確認（全項目null）の設定: 捏造せず「受付開始時に掲載します」を出すことを検証する */
const UNCONFIRMED_CFG: MonitorConfig = {
  ...MONITOR_CONFIG,
  owner: {
    sellerName: null, addressDisclosure: null, address: null, phoneDisclosure: null, phone: null,
    supportEmail: null, monitorPriceTaxInclusive: null, refundPolicy: null, effectiveDate: null, responseTimeNote: null,
  },
};

const html = (files: Record<string, string>, page: (typeof PAGES)[number]) =>
  files[page === 'index' ? 'monitor/index.html' : `monitor/${page}/index.html`];
const allHtml = (files: Record<string, string>) => PAGES.map((p) => html(files, p)).join('\n');
const text = (h: string) => h.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const h2s = (h: string) => [...h.matchAll(/<h2>([\s\S]*?)<\/h2>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());

// ─────────────────────────────────────────────────────────────────────────────
describe('販売ゲート（evaluateSalesGate）', () => {
  it('リポジトリの実設定: 事業者情報は確認済みで、Ownerが作成したLive Payment Linkにより受付中になる', () => {
    const g = evaluateSalesGate(MONITOR_CONFIG, 'live');
    expect(g).toEqual({ open: true, ownerReady: true, missing: [] });
  });

  it('リポジトリの実設定: Payment Linkは、Ownerが指定したURLと1文字も違わない', () => {
    expect(MONITOR_CONFIG.live.paymentLink).toBe(OWNER_PAYMENT_LINK);
  });

  it('リポジトリの実設定: 秘密値を含まず、住所・電話は請求開示方式で保持しない', () => {
    const o = MONITOR_CONFIG.owner;
    expect(o.addressDisclosure).toBe('on_request');
    expect(o.phoneDisclosure).toBe('on_request');
    expect(o.address).toBeNull();
    expect(o.phone).toBeNull();
    expect(JSON.stringify(MONITOR_CONFIG)).not.toMatch(/sk_(live|test)_|rk_(live|test)_|whsec_|pk_(live|test)_/);
  });

  it('Payment Linkが無ければ、事業者情報が確認済みでも受付準備中（購入ボタンを出さない）', () => {
    const g = evaluateSalesGate(CLOSED_CFG, 'live');
    expect(g.ownerReady).toBe(true);
    expect(g.open).toBe(false);
    expect(g.missing).toEqual(['Live Payment Link']);
  });

  it('事業者情報が未確認なら、ownerReadyもopenもfalse（捏造しない）', () => {
    const g = evaluateSalesGate(UNCONFIRMED_CFG, 'live');
    expect(g.open).toBe(false);
    expect(g.ownerReady).toBe(false);
    expect(g.missing).toEqual(
      expect.arrayContaining(['販売事業者名', '所在地の開示方法', '電話番号の開示方法', 'お問い合わせメール', '税込・税別の別', '返金・キャンセル条件', '制定日']),
    );
  });

  it('解約ポータルURLは任意: 未設定でも受付中。設定するなら正しい形式であること', () => {
    expect(MONITOR_CONFIG.live.portalLoginUrl).toBeNull();
    expect(evaluateSalesGate(MONITOR_CONFIG, 'live').open).toBe(true);
    expect(evaluateSalesGate(OPEN_CFG, 'live').open).toBe(true);
    const bad: MonitorConfig = { ...OPEN_CFG, live: { paymentLink: OPEN_CFG.live.paymentLink, portalLoginUrl: 'https://example.com/portal' } };
    const g = evaluateSalesGate(bad, 'live');
    expect(g.open).toBe(false);
    expect(g.missing.join()).toContain('Customer Portal');
  });

  it('Test modeのURLはLiveとして受け付けない（本番への混入防止）', () => {
    const cfg: MonitorConfig = { ...OPEN_CFG, live: { paymentLink: MONITOR_CONFIG.test.paymentLink, portalLoginUrl: MONITOR_CONFIG.test.portalLoginUrl } };
    const g = evaluateSalesGate(cfg, 'live');
    expect(g.open).toBe(false);
    expect(g.missing).toEqual(expect.arrayContaining(['Live Payment Link']));
    expect(g.missing.join()).toContain('Customer Portal');
  });

  it('Stripe以外・http・パス違いのURL、不正なメール・日付は受け付けない', () => {
    const withLink = (paymentLink: string): MonitorConfig => ({ ...OPEN_CFG, live: { paymentLink, portalLoginUrl: null } });
    for (const bad of ['https://example.com/x', 'http://buy.stripe.com/abc', 'https://buy.stripe.com/abc/def', 'https://buy.stripe.com.evil.com/abc', 'https://buy.stripe.com/']) {
      expect(evaluateSalesGate(withLink(bad), 'live').open, bad).toBe(false);
    }
    expect(evaluateSalesGate({ ...OPEN_CFG, owner: { ...OPEN_CFG.owner, supportEmail: 'not-an-email' } }, 'live').missing).toContain('お問い合わせメール');
    expect(evaluateSalesGate({ ...OPEN_CFG, owner: { ...OPEN_CFG.owner, effectiveDate: '2026/10/01' } }, 'live').missing).toContain('制定日');
  });

  it('所在地・電話を「掲載」にする場合は、その値が必須', () => {
    const cfg: MonitorConfig = { ...OPEN_CFG, owner: { ...OPEN_CFG.owner, addressDisclosure: 'published', address: null, phoneDisclosure: 'published', phone: ' ' } };
    expect(evaluateSalesGate(cfg, 'live').missing).toEqual(expect.arrayContaining(['所在地', '電話番号']));
  });

  it('testモードは Test URL＋ダミー事業者で受付中になる', () => {
    expect(evaluateSalesGate(MONITOR_CONFIG, 'test')).toEqual({ open: true, ownerReady: true, missing: [] });
    expect(resolveSite(MONITOR_CONFIG, 'test').owner).toBe(TEST_OWNER_DUMMY);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('LP（リポジトリの実設定・受付中）', () => {
  const files = renderMonitorSite(MONITOR_CONFIG, { mode: 'live', base: BASE });
  const lp = html(files, 'index');
  const plain = text(lp);

  it('全ページが生成され、状態は open（Payment Linkだけ設定・解約ポータルURLは未設定）', () => {
    for (const p of PAGES) expect(html(files, p), p).toBeTruthy();
    expect(JSON.parse(files['monitor/status.json'])).toMatchObject({ mode: 'live', salesOpen: true, ownerInfoReady: true, missing: [] });
  });

  it('HERO: メインコピー・「全国1,237施設を収録」・商品名・補足・CTA', () => {
    const hero = lp.slice(lp.indexOf('class="hero"'), lp.indexOf('</section>'));
    expect(text(hero.slice(hero.indexOf('<h1>'), hero.indexOf('</h1>'))).replace(/\s/g, '')).toBe('道の駅巡りを、もっと楽しく！');
    expect(hero).toContain('<span class="nb">道の駅巡りを、</span><span class="nb">もっと楽しく！</span>'); // 文節ごとに折り返す
    expect(hero).toContain('全国1,237施設を収録');
    expect(hero).toContain('「道の駅ナビ 全国版」');
    expect(hero).toContain('探す・記録する・巡る。道の駅ドライブをこれひとつで。');
    expect(hero).toContain('>月額250円で始める</a>');
  });

  it('「全国1,237施設を収録」はアプリの収録データ件数と一致する（「登録道の駅」とは書かない）', () => {
    expect(MONITOR_CONFIG.stationCount).toBe(STATIONS.length);
    expect(STATIONS.length).toBe(1237);
    expect(plain).not.toContain('登録道の駅');
    expect(plain).not.toContain('1,237の');
    expect(plain).toContain('47都道府県');
  });

  it('9つのセクションが、指定された順序で並ぶ', () => {
    expect(h2s(lp)).toEqual([
      'こんな経験ありませんか？',
      'これ1つで、道の駅めぐり',
      '全国1,237施設を収録',
      'ドライブがもっと楽しく',
      '料金',
      '新リリース・モニターについて',
      'よくある質問',
      '次のドライブを、もっと楽しく。',
    ]);
  });

  it('これ1つで: 6つの機能（地図・訪問・スタンプ・行きたい・ルート・周辺スポット）', () => {
    for (const f of ['地図で探す', '訪問を記録', 'スタンプを記録', '行きたい場所を管理', 'ルートを作る', '周辺スポットを探す']) expect(plain, f).toContain(f);
  });

  it('こんな経験ありませんか？: 5つの例', () => {
    for (const q of ['次はどの道の駅へ行こう？', '行った場所が分からなくなった', 'スタンプの記録をまとめたい', 'ドライブコースを考えるのが大変', '道の駅周辺の観光やグルメも楽しみたい']) expect(plain, q).toContain(q);
  });

  it('周辺スポットはProductionの実際のカテゴリだけ（買い物など、未提供の項目を断定しない）', () => {
    for (const c of ['食べる', '観光', '温泉・休憩', '宿泊']) expect(plain, c).toContain(c);
    for (const banned of ['買い物', 'ショッピング', 'ご当地グルメ', '口コミ']) expect(plain, banned).not.toContain(banned);
    expect(plain).toContain('すべての店舗・施設を網羅するものではありません');
  });

  it('料金: 正式版の予定価格を取り消し線、モニター価格月額250円（税込）と50% OFFを目立たせる', () => {
    const box = lp.slice(lp.indexOf('class="pricebox"'), lp.indexOf('<h2>新リリース・モニターについて</h2>'));
    expect(box).toContain('<s>月額500円（税込）</s>');
    expect(box).toContain('正式版の予定価格');
    expect(box).toContain('新リリース・モニター価格');
    expect(box).toContain('月額250円<small>（税込）</small>');
    expect(box).toContain('50% OFF');
    expect(box).toContain('data-checkout');
  });

  it('500円は必ず「予定」と一緒に出る（将来の価格を確定価格のように見せない）', () => {
    for (const sentence of plain.split(/[。！]/).filter((s) => s.includes('500円'))) expect(sentence, sentence).toContain('予定');
  });

  it('モニターは有料であり、無料モニターと誤認させない。フィードバックの依頼に触れる', () => {
    const sec = plain.slice(plain.indexOf('新リリース・モニターについて'), plain.indexOf('よくある質問'));
    expect(sec).toContain('有料のモニター募集');
    expect(sec).toContain('無料ではありません');
    expect(sec).toContain('フィードバック');
    expect(sec).toContain('料金を変更する場合は、事前にお知らせします');
    expect(plain).not.toContain('無料モニター');
  });

  it('料金の自動変更（一定期間後に500円へ）を約束・示唆しない', () => {
    expect(plain).not.toMatch(/(か月|ヶ月|カ月|年|期間|日)(後|経過|以降)[^。]{0,20}500円/);
    expect(plain).not.toMatch(/自動的に(月額)?500円/);
  });

  it('FAQ: 料金・解約・スマホ・iPhone/Android・インストール（PWA）・保存・支払い・個人情報', () => {
    const faq = lp.slice(lp.indexOf('<h2>よくある質問</h2>'), lp.indexOf('class="final"'));
    for (const q of ['月額料金はいくらですか？', '解約できますか？', 'スマートフォンで使えますか？', 'iPhone / Androidで使えますか？', 'アプリのインストールは必要ですか？', '記録したデータはどこに保存されますか？', 'お支払い方法は？', '個人情報の扱いは？']) {
      expect(faq, q).toContain(`<summary>${q}</summary>`);
    }
    expect(text(faq)).toContain('新リリース・モニター価格として、月額250円（税込）です。');
    expect(text(faq)).toContain('App StoreやGoogle Playからのインストールは不要');
    expect(text(faq)).toContain('ホーム画面に追加');
  });

  it('FINAL CTA: 指定コピーとCTA', () => {
    const fin = lp.slice(lp.indexOf('class="final"'));
    expect(fin).toContain('次のドライブを、もっと楽しく。');
    expect(fin).toContain('「道の駅ナビ 全国版」');
    expect(text(fin)).toContain('新リリース・モニター価格 月額250円（税込）');
    expect(fin).toContain('data-checkout');
  });

  it('実画面のスクリーンショット（3枚）は、リポジトリに実在し、代替テキストと寸法を持つ', () => {
    const imgs = [...lp.matchAll(/<img src="([^"]+)" width="(\d+)" height="(\d+)"[^>]*alt="([^"]+)"/g)].filter((m) => m[1].includes('/monitor/img/'));
    expect(imgs.length).toBe(3);
    for (const m of imgs) {
      const rel = m[1].replace(BASE, '');
      expect(imageExists(rel), rel).toBe(true);
      expect(Number(m[2])).toBeGreaterThan(0);
      expect(Number(m[3])).toBeGreaterThan(0);
      expect(m[4].length).toBeGreaterThan(5);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('購入CTA（Stripe Payment Linkへの接続）', () => {
  const files = renderMonitorSite(MONITOR_CONFIG, { mode: 'live', base: BASE });
  const lp = html(files, 'index');
  const ctas = [...lp.matchAll(/<a class="btn cta[^"]*" data-checkout href="([^"]+)" rel="([^"]+)">([^<]+)<\/a>/g)];

  it('すべての購入CTAは、Ownerが作成したPayment Linkと完全に一致するURLへ向き、文言は「月額250円で始める」', () => {
    expect(ctas.length).toBeGreaterThanOrEqual(4); // HERO・料金・FINAL・スティッキー
    for (const m of ctas) {
      expect(m[1]).toBe(OWNER_PAYMENT_LINK);
      expect(m[2]).toContain('noopener');
      expect(m[3]).toBe('月額250円で始める');
    }
  });

  it('LP内のStripe向けリンクは、Payment Link以外に存在しない（別URL・Test URLの混入なし）', () => {
    const stripe = [...lp.matchAll(/href="(https:\/\/[^"]*stripe\.com[^"]*)"/g)].map((m) => m[1]);
    expect(stripe.length).toBe(ctas.length);
    for (const u of stripe) expect(u).toBe(OWNER_PAYMENT_LINK);
    expect(lp).not.toContain('test_');
  });

  it('モバイル用のスティッキーCTAがあり、フッターに隠れないよう余白が確保される', () => {
    expect(lp).toContain('class="sticky-cta"');
    expect(lp).toContain('<body class="has-sticky">');
    expect(lp).toContain('.sticky-cta{position:fixed');
    expect(lp).toContain('body.has-sticky{padding-bottom:88px}');
  });

  it('タップしやすい大きさ（CTAは高さ56px以上）', () => {
    expect(lp).toContain('.btn.cta{font-size:1.2rem;padding:16px 14px;min-height:56px');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('流入元の判別（UTM → Stripe client_reference_id）', () => {
  const run = (search: string, href = OWNER_PAYMENT_LINK) => {
    const anchors = [{ href }, { href }];
    const fn = new Function('location', 'document', `${CHECKOUT_ATTRIBUTION_JS}`);
    fn({ search }, { querySelectorAll: () => anchors }); // window なし（IntersectionObserver非対応環境）でも流入元の付与は動く
    return anchors.map((a) => new URL(a.href));
  };

  it('utm_source / utm_campaign を、client_reference_id に付与する（Stripeへの遷移先URL自体は変えない）', () => {
    for (const u of run('?utm_source=x&utm_medium=social&utm_campaign=launch1')) {
      expect(u.origin + u.pathname).toBe(OWNER_PAYMENT_LINK);
      expect(u.searchParams.get('client_reference_id')).toBe('x_social_launch1');
    }
  });

  it('UTMが無ければ何も変えない', () => {
    for (const u of run('')) expect(u.toString()).toBe(OWNER_PAYMENT_LINK);
    for (const u of run('?foo=bar')) expect(u.toString()).toBe(OWNER_PAYMENT_LINK);
  });

  it('Stripeが受け付ける文字（英数字・-・_）だけにし、長さを制限する', () => {
    const u = run('?utm_source=' + encodeURIComponent('TikTok 春/2026!') + '&utm_campaign=' + 'a'.repeat(300))[0];
    const ref = u.searchParams.get('client_reference_id') ?? '';
    expect(ref).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(ref.length).toBeLessThanOrEqual(190);
    expect(ref.startsWith('TikTok---2026-_')).toBe(true); // 空白・全角・記号は1文字ずつ「-」に置換
  });

  it('リンクに既にあるクエリを壊さない', () => {
    const u = run('?utm_source=youtube', `${OWNER_PAYMENT_LINK}?prefilled_promo_code=X`)[0];
    expect(u.searchParams.get('prefilled_promo_code')).toBe('X');
    expect(u.searchParams.get('client_reference_id')).toBe('youtube');
  });

  it('不正な入力でも例外を出さず、ページを壊さない', () => {
    expect(() => run('?utm_source=%E0%A4%A')).not.toThrow();
  });

  it('ページ内のCTAが画面に見えている間だけ、スティッキーCTAを引っ込める（スティッキー自身は監視しない）', () => {
    const inline = { closest: (sel: string) => (sel === '.sticky-cta' ? null : null) };
    const sticky = { closest: (sel: string) => (sel === '.sticky-cta' ? {} : null) };
    let cb: (es: { target: unknown; isIntersecting: boolean }[]) => void = () => undefined;
    const observed: unknown[] = [];
    class FakeIO {
      constructor(fn: typeof cb) { cb = fn; }
      observe(t: unknown) { observed.push(t); }
    }
    const cls = new Set<string>();
    const doc = {
      body: { classList: { toggle: (c: string, on: boolean) => (on ? cls.add(c) : cls.delete(c)) } },
      querySelectorAll: () => [inline, sticky],
    };
    new Function('location', 'document', 'window', CHECKOUT_ATTRIBUTION_JS)({ search: '' }, doc, { IntersectionObserver: FakeIO });
    expect(observed).toEqual([inline]); // スティッキーは監視しない
    cb([{ target: inline, isIntersecting: false }]);
    expect(cls.has('cta-in-view')).toBe(false); // 見えていない → スティッキーを出す
    cb([{ target: inline, isIntersecting: true }]);
    expect(cls.has('cta-in-view')).toBe(true); // 見えている → スティッキーを引っ込める
    cb([{ target: inline, isIntersecting: false }]);
    expect(cls.has('cta-in-view')).toBe(false);
  });

  it('スクリプトは、CTAのある受付中のLPにだけ入り、他のページ・受付準備中のページには入らない', () => {
    const open = renderMonitorSite(MONITOR_CONFIG, { mode: 'live', base: BASE });
    expect(html(open, 'index')).toContain(`<script>${CHECKOUT_ATTRIBUTION_JS}</script>`);
    for (const p of ['terms', 'privacy', 'tokushoho', 'contact', 'thanks'] as const) expect(html(open, p), p).not.toContain('<script');
    expect(html(renderMonitorSite(CLOSED_CFG, { mode: 'live', base: BASE }), 'index')).not.toContain('<script');
  });

  it('プライバシーポリシーに、流入元の参照コードをStripeへ渡すことを明記している', () => {
    const open = renderMonitorSite(MONITOR_CONFIG, { mode: 'live', base: BASE });
    expect(text(html(open, 'privacy'))).toContain('参照コードとして付ける場合があります');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('受付準備中（Payment Linkが無い場合）', () => {
  const files = renderMonitorSite(CLOSED_CFG, { mode: 'live', base: BASE });

  it('状態は closed。LPに購入ボタン・Stripe・スティッキー・アプリ本体へのリンクが一切ない（デッドCTAを出さない）', () => {
    expect(JSON.parse(files['monitor/status.json'])).toMatchObject({ mode: 'live', salesOpen: false, ownerInfoReady: true });
    const lp = html(files, 'index');
    expect(lp).toContain('受付準備中');
    expect(lp).not.toMatch(/buy\.stripe\.com|billing\.stripe\.com/);
    expect(lp).not.toContain('data-checkout');
    expect(lp).not.toContain('class="sticky-cta"');
    expect(lp).not.toContain(`href="${CLOSED_CFG.appUrl}"`);
    expect(lp).toContain('name="robots" content="noindex,nofollow"');
  });

  it('Test URL・ダミー事業者・TEST BUILD表示が本番ビルドに出ない', () => {
    const all = allHtml(files);
    expect(all).not.toMatch(/buy\.stripe\.com\/test_|billing\.stripe\.com\/p\/login\/test_/);
    expect(all).not.toContain('テスト用ダミー');
    expect(all).not.toContain('TEST BUILD');
  });

  it('お支払い完了後のご案内ページも、受付準備中である旨だけを出す', () => {
    const t = text(html(files, 'thanks'));
    expect(t).toContain('現在は受付準備中です');
    expect(t).not.toContain('を開く');
  });
});

describe('事業者情報が未確認の場合（捏造しない）', () => {
  it('未確認の事業者情報は「受付開始時に掲載します」と出し、メール・氏名・価格の税表記を出さない', () => {
    const files = renderMonitorSite(UNCONFIRMED_CFG, { mode: 'live', base: BASE });
    const all = allHtml(files);
    expect(all).toContain('受付開始時に掲載します');
    expect(all).not.toContain('otakarafinder');
    expect(all).not.toContain('奥山');
    expect(all).not.toContain('は税込です');
    expect(html(files, 'contact')).not.toContain('href="mailto:');
    expect(html(files, 'index')).not.toContain('data-checkout'); // 事業者情報が揃うまで購入ボタンは出ない
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('暫定方針（返金・解約・税・制定日）と、事業者情報の反映', () => {
  const files = renderMonitorSite(MONITOR_CONFIG, { mode: 'live', base: BASE });

  it('返金: 決済済み期間は原則返金なし。ただし法令上必要な対応・重複請求・運営者側の決済事故は除外しない', () => {
    const t = text(html(files, 'tokushoho')) + text(html(files, 'terms'));
    expect(t).toContain('原則として返金いたしません');
    expect(t).toContain('法令上必要な場合');
    expect(t).toContain('重複してご請求した場合');
    expect(t).toContain('決済上の事故');
  });

  it('解約: いつでも解約でき、次回以降の請求は発生しない', () => {
    for (const p of ['index', 'terms', 'tokushoho', 'thanks'] as const) {
      expect(text(html(files, p)), p).toContain('次回以降の請求は発生しません');
    }
    expect(text(html(files, 'terms'))).toContain('いつでも解約できます');
  });

  it('解約ポータルURLが未設定の間は、存在しない解約ページを案内せず、お問い合わせメールでの解約を案内する', () => {
    for (const p of ['index', 'terms', 'tokushoho'] as const) {
      const t = text(html(files, p));
      expect(t, p).toContain('へのご連絡により、いつでも解約できます');
      expect(t, p).not.toContain('解約・お支払い管理ページ（Stripe）');
      expect(t, p).not.toContain('受付開始時に掲載します');
    }
    expect(html(files, 'thanks')).not.toContain('billing.stripe.com');
    expect(text(html(files, 'thanks'))).toContain('へご連絡ください');
  });

  it('解約ポータルURLを設定すると、LP・規約・特商法・ご案内ページの解約導線がそのURLになる', () => {
    const open = renderMonitorSite(OPEN_CFG, { mode: 'live', base: BASE });
    for (const p of ['index', 'terms', 'tokushoho', 'thanks'] as const) {
      expect(html(open, p), p).toContain('href="https://billing.stripe.com/p/login/liveFakePortal456"');
    }
  });

  it('制定日は「2026年9月19日」と表示される', () => {
    for (const p of ['terms', 'privacy', 'tokushoho'] as const) expect(text(html(files, p)), p).toContain('2026年9月19日');
  });

  it('商品名・料金の表記が、規約・特商法でも「道の駅ナビ 全国版」「新リリース・モニター価格」に統一されている', () => {
    const tok = text(html(files, 'tokushoho'));
    expect(tok).toContain('道の駅ナビ 全国版');
    expect(tok).toContain('新リリース・モニター価格 月額250円');
    expect(tok).toContain('新リリース・モニター価格（月額250円）は税込です。');
    expect(text(html(files, 'terms'))).toContain('新リリース・モニター価格は、月額250円です。');
    expect(allHtml(files)).not.toContain('先行モニター');
  });

  it('サービス提供時期: 手作業の利用案内メールを約束せず、お支払い完了後すぐに使える旨を記載する', () => {
    const tok = text(html(files, 'tokushoho'));
    expect(tok).toContain('お支払い完了後、すぐにご利用いただけます');
    expect(allHtml(files)).not.toContain('手作業');
  });

  it('お宝ファインダー固有の条件（14日間の返金保証・アカウント・LINE等）を持ち込まない', () => {
    const all = text(allHtml(files));
    for (const banned of ['14日間', 'LINE', 'お宝ファインダー', 'ログインしてください', 'アカウントを作成']) expect(all, banned).not.toContain(banned);
  });

  it('お問い合わせ・改善要望のmailtoは事業者情報の確認後から使える', () => {
    expect(html(files, 'contact')).toContain('href="mailto:');
  });
});

describe('ヘルパー', () => {
  it('jpDate / taxSentence', () => {
    expect(jpDate('2026-09-19')).toBe('2026年9月19日');
    expect(jpDate('bad')).toBe('');
    expect(jpDate(null)).toBe('');
    expect(taxSentence(MONITOR_CONFIG, MONITOR_CONFIG.owner)).toBe('新リリース・モニター価格（月額250円）は税込です。');
    expect(taxSentence(MONITOR_CONFIG, { ...MONITOR_CONFIG.owner, monitorPriceTaxInclusive: false })).toContain('税別');
    expect(taxSentence(MONITOR_CONFIG, { ...MONITOR_CONFIG.owner, monitorPriceTaxInclusive: null })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('お支払い完了後のご案内ページ（/monitor/thanks/）', () => {
  const files = renderMonitorSite(MONITOR_CONFIG, { mode: 'live', base: BASE });
  const th = html(files, 'thanks');
  const t = text(th);

  it('お礼・商品名・250円モニターへの参加・アプリを開く・使い方・問い合わせ・解約', () => {
    expect(th).toContain('<h1><span class="nb">お申し込み</span><span class="nb">ありがとうございます</span></h1>');
    expect(t).toContain('道の駅ナビ 全国版');
    expect(t).toContain('月額250円の新リリース・モニターに、ご参加いただきありがとうございます');
    expect(th).toContain(`href="${MONITOR_CONFIG.appUrl}" rel="noopener">道の駅ナビを開く</a>`);
    expect(t).toContain('かんたんな使い方');
    expect(th).toContain('href="mailto:');
    expect(t).toContain('解約は、いつでも手続きできます');
    expect(t).toContain('解約・お支払い情報の変更をご希望の場合');
  });

  it('決済していない人でも技術的にアクセスできるページであることを隠さず、購入済みの証明のように見せない', () => {
    expect(t).not.toMatch(/決済(した|済み)(人|方)だけ|購入者限定|会員限定/);
    expect(th).toContain('name="robots" content="noindex,nofollow"'); // 検索エンジンに出さない
  });

  it('手作業のメール対応を約束しない（アプリは、このページからすぐ開ける）', () => {
    expect(t).not.toContain('ご案内をお送りします');
    expect(t).not.toContain('運営者がお支払いを確認');
  });
});

describe('アプリ本体への導線', () => {
  it('アプリ本体のURLは、お支払い後のご案内ページにのみ載せる（販売LPには載せない）', () => {
    const files = renderMonitorSite(OPEN_CFG, { mode: 'live', base: BASE });
    const exact = `href="${OPEN_CFG.appUrl}"`;
    expect(html(files, 'thanks')).toContain(exact);
    for (const p of ['index', 'terms', 'privacy', 'tokushoho', 'contact'] as const) expect(html(files, p)).not.toContain(exact);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('事業者の入力値はHTMLエスケープされる', () => {
  it('特殊文字を含む名前・メールでも、タグとして解釈されない', () => {
    const cfg: MonitorConfig = { ...OPEN_CFG, owner: { ...OPEN_CFG.owner, sellerName: '<script>alert(1)</script>&"\'' } };
    const all = allHtml(renderMonitorSite(cfg, { mode: 'live', base: BASE }));
    expect(all).not.toContain('<script>alert(1)</script>');
    expect(all).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('testモード（公開しないQA用ビルド）と、公開前プレビュー', () => {
  it('TEST BUILD表示・noindex・Test Payment Link・ダミー事業者', () => {
    const files = renderMonitorSite(MONITOR_CONFIG, { mode: 'test', base: BASE });
    const lp = html(files, 'index');
    expect(lp).toContain('TEST BUILD');
    expect(lp).toContain('name="robots" content="noindex,nofollow"');
    expect(lp).toContain(`href="${MONITOR_CONFIG.test.paymentLink}"`);
    expect(lp).not.toContain(OWNER_PAYMENT_LINK);
    expect(text(html(files, 'tokushoho'))).toContain('テスト用ダミー');
  });

  it('QA配信（base が -qa/）は、検索エンジンに出さず、プレビューである旨を表示する', () => {
    const files = renderMonitorSite(MONITOR_CONFIG, { mode: 'live', base: '/tohoku-michinoeki-map-qa/' });
    const lp = html(files, 'index');
    expect(lp).toContain('name="robots" content="noindex,nofollow"');
    expect(lp).toContain('公開前の確認用プレビュー');
  });

  it('本番配信は、LP・規約・特商法・プライバシー・問い合わせを検索エンジンに出してよい（ご案内ページだけnoindex）', () => {
    const files = renderMonitorSite(MONITOR_CONFIG, { mode: 'live', base: BASE });
    for (const p of ['index', 'terms', 'privacy', 'tokushoho', 'contact'] as const) expect(html(files, p), p).not.toContain('name="robots"');
    expect(html(files, 'thanks')).toContain('name="robots" content="noindex,nofollow"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe.each([
  ['受付中（実設定）', MONITOR_CONFIG],
  ['受付中（解約ポータル設定あり）', OPEN_CFG],
  ['受付準備中', CLOSED_CFG],
] as const)('表現・リンクの安全性: %s', (_name, cfg) => {
  const files = renderMonitorSite(cfg, { mode: 'live', base: BASE });
  const all = allHtml(files);
  const plain = text(all);

  it('Ownerが決めていない条件・未提供機能・偽のアクセス制御を主張しない', () => {
    const allowed = plain.replace(/必ず実装するお約束はできません/g, '').replace(/無料ではありません/g, '');
    for (const banned of ['永久', '必ず', '無料で', '買い物', '完全なアクセス制御', '会員限定', '限定公開', 'モニター限定機能', '保証します', '先着', '限定10']) {
      expect(allowed, banned).not.toContain(banned);
    }
  });

  it('アプリは現在ログイン不要で公開されている事実を、LP・規約・特商法で隠さない', () => {
    for (const p of ['index', 'terms', 'tokushoho'] as const) {
      expect(text(html(files, p)), p).toContain('ログイン不要');
      expect(text(html(files, p)), p).toMatch(/機能制限(は|も)設けていません/);
    }
  });

  it('外部リソースを読み込まない（外部CSS・外部スクリプト・外部画像なし。Cookie/解析なし）', () => {
    expect(all).not.toMatch(/<script[^>]+src=/);
    expect(all).not.toMatch(/<link[^>]+rel="stylesheet"/);
    expect(all).not.toMatch(/<img[^>]+src="https?:/);
    // 唯一許されるインラインスクリプト（流入元の付与）以外のスクリプトは無く、それはCookie・保存・外部送信をしない
    const scripts = [...all.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    for (const sc of scripts) expect(sc).toBe(CHECKOUT_ATTRIBUTION_JS);
    expect(all.match(/<script/g)?.length ?? 0).toBe(scripts.length);
    expect(CHECKOUT_ATTRIBUTION_JS).not.toMatch(/cookie|localStorage|sessionStorage|fetch|XMLHttpRequest|sendBeacon|gtag|fbq/i);
  });

  it('リンクは Stripe・アプリ・mailto・サイト内のみで、サイト内リンク・画像はすべて生成済みページ／実在ファイルに解決する', () => {
    const hrefs = [...all.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    const internal = new Set(Object.keys(files).map((f) => `${BASE}${f.replace(/index\.html$/, '')}`));
    for (const h of hrefs) {
      if (h.startsWith('mailto:') || h.startsWith('https://buy.stripe.com/') || h.startsWith('https://billing.stripe.com/')) continue;
      if (h === cfg.appUrl || h.startsWith(cfg.appUrl)) continue; // アプリ・canonical
      if (h.startsWith(`${BASE}icons/`)) continue;
      expect(internal.has(h), h).toBe(true);
    }
    for (const m of all.matchAll(/<img src="([^"]+)"/g)) {
      if (m[1].startsWith(`${BASE}icons/`)) continue;
      expect(imageExists(m[1].replace(BASE, '')), m[1]).toBe(true);
    }
  });

  it('モバイル向けviewportを持ち、全ページにフッター導線（規約・プライバシー・特商法・問い合わせ）がある', () => {
    for (const p of PAGES) {
      const h = html(files, p);
      expect(h).toContain('name="viewport" content="width=device-width, initial-scale=1"');
      for (const path of ['terms/', 'privacy/', 'tokushoho/', 'contact/']) expect(h).toContain(`href="${BASE}monitor/${path}"`);
    }
  });

  it('SNS共有用のOGP・Twitterカード・title・descriptionがある（og:imageは絶対URL）', () => {
    const lp = html(files, 'index');
    expect(lp).toMatch(/<title>[^<]*道の駅ナビ 全国版[^<]*<\/title>/);
    for (const m of ['name="description"', 'property="og:title"', 'property="og:description"', 'property="og:url"', 'property="og:image"', 'name="twitter:card" content="summary_large_image"', 'name="twitter:image"']) {
      expect(lp, m).toContain(m);
    }
    expect(lp).toMatch(/property="og:image" content="https:\/\/[^"]+og-image\.png"/);
    expect(lp).toContain('全国1,237施設を収録');
  });
});
