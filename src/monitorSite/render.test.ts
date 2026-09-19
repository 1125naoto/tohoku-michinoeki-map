import { describe, expect, it } from 'vitest';
import { MONITOR_CONFIG, TEST_OWNER_DUMMY, type MonitorConfig } from './config';
import { evaluateSalesGate, jpDate, renderMonitorSite, resolveSite, taxSentence } from './render';

const BASE = '/tohoku-michinoeki-map/';
const PAGES = ['index', 'terms', 'privacy', 'tokushoho', 'contact', 'thanks'] as const;

/** 事業者情報・Live URLが揃った「受付中」を検証するための架空の値（実在しない） */
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
const text = (h: string) => h.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('販売ゲート（evaluateSalesGate）', () => {
  it('リポジトリの実設定: 事業者情報は確認済み、Live URLが無い間は「受付準備中」（申込不可）', () => {
    const gate = evaluateSalesGate(MONITOR_CONFIG, 'live');
    expect(gate.ownerReady).toBe(true);
    expect(gate.open).toBe(false);
    expect(gate.missing).toEqual(['Live Payment Link', 'Live Customer Portal']);
  });

  it('事業者情報が未確認なら、ownerReadyもopenもfalse（捏造しない）', () => {
    const gate = evaluateSalesGate(UNCONFIRMED_CFG, 'live');
    expect(gate.ownerReady).toBe(false);
    expect(gate.open).toBe(false);
    expect(gate.missing).toEqual(expect.arrayContaining(['販売事業者名', 'お問い合わせメール', '返金・キャンセル条件', '税込・税別の別', 'Live Payment Link']));
  });

  it('リポジトリの実設定: 秘密値を含まず、住所・電話は請求開示方式で保持せず、Live URLは未設定', () => {
    const o = MONITOR_CONFIG.owner;
    expect(o.addressDisclosure).toBe('on_request');
    expect(o.phoneDisclosure).toBe('on_request');
    expect(o.address).toBeNull();
    expect(o.phone).toBeNull();
    expect(MONITOR_CONFIG.live.paymentLink).toBeNull();
    expect(MONITOR_CONFIG.live.portalLoginUrl).toBeNull();
    expect(JSON.stringify(MONITOR_CONFIG)).not.toMatch(/sk_(live|test)_|rk_(live|test)_|whsec_|pk_(live|test)_/);
  });

  it('必須項目・Live URLがすべて揃うと受付中になる', () => {
    expect(evaluateSalesGate(OPEN_CFG, 'live')).toEqual({ open: true, ownerReady: true, missing: [] });
  });

  it('Test modeのURLはLiveとして受け付けない（本番への混入防止）', () => {
    const cfg: MonitorConfig = { ...OPEN_CFG, live: { paymentLink: MONITOR_CONFIG.test.paymentLink, portalLoginUrl: MONITOR_CONFIG.test.portalLoginUrl } };
    const gate = evaluateSalesGate(cfg, 'live');
    expect(gate.open).toBe(false);
    expect(gate.missing).toEqual(expect.arrayContaining(['Live Payment Link', 'Live Customer Portal']));
  });

  it('Stripe以外・http・パス違いのURL、不正なメール・日付は受け付けない', () => {
    const bad = (patch: Partial<MonitorConfig['owner']>, live: Partial<MonitorConfig['live']> = {}) =>
      evaluateSalesGate({ ...OPEN_CFG, owner: { ...OPEN_CFG.owner, ...patch }, live: { ...OPEN_CFG.live, ...live } }, 'live').open;
    expect(bad({}, { paymentLink: 'https://evil.example/buy' })).toBe(false);
    expect(bad({}, { paymentLink: 'http://buy.stripe.com/abc' })).toBe(false);
    expect(bad({}, { portalLoginUrl: 'https://billing.stripe.com/p/session/abc' })).toBe(false);
    expect(bad({ supportEmail: 'not-an-email' })).toBe(false);
    expect(bad({ effectiveDate: '2026/10/01' })).toBe(false);
  });

  it('所在地・電話を「掲載」にする場合は、その値が必須', () => {
    const r = resolveSite({ ...OPEN_CFG, owner: { ...OPEN_CFG.owner, addressDisclosure: 'published', address: null } }, 'live');
    expect(r.gate.missing).toContain('所在地');
    const r2 = resolveSite({ ...OPEN_CFG, owner: { ...OPEN_CFG.owner, phoneDisclosure: 'published', phone: ' ' } }, 'live');
    expect(r2.gate.missing).toContain('電話番号');
  });

  it('testモードは Test URL＋ダミー事業者で受付中になる', () => {
    expect(evaluateSalesGate(MONITOR_CONFIG, 'test')).toEqual({ open: true, ownerReady: true, missing: [] });
  });
});

describe('受付準備中（本番ビルドの現状）', () => {
  const files = renderMonitorSite(MONITOR_CONFIG, { mode: 'live', base: BASE });

  it('全ページが生成され、状態は closed', () => {
    for (const p of PAGES) expect(html(files, p)).toContain('<!doctype html>');
    expect(JSON.parse(files['monitor/status.json'])).toMatchObject({ mode: 'live', salesOpen: false });
  });

  it('LPは受付準備中で、購入ボタン・Stripe・アプリ本体へのリンクが一切ない', () => {
    const lp = html(files, 'index');
    expect(lp).toContain('受付準備中');
    expect(lp).not.toContain('class="btn"');
    expect(lp).not.toContain('stripe.com');
    expect(lp).not.toContain(`href="${MONITOR_CONFIG.appUrl}"`);
    expect(lp).toContain('name="robots" content="noindex,nofollow"');
  });

  it('Test URL・ダミー事業者・TEST BUILD表示が本番ビルドに出ない', () => {
    const all = allHtml(files) + files['monitor/status.json'];
    expect(all).not.toMatch(/buy\.stripe\.com|billing\.stripe\.com|test_|ダミー|TEST BUILD|example\.invalid/);
  });

  it('事業者情報は確認済みなので特商法・規約に反映され、解約ページ（Live未作成）だけ「受付開始時に掲載します」', () => {
    const t = text(html(files, 'tokushoho'));
    expect(t).toContain('請求があった場合、遅滞なく開示します');
    expect(t).toContain('2026年9月19日');
    expect(t).toContain('先行モニター価格（月額250円）は税込です。');
    expect(t).toContain('受付開始時に掲載します'); // 解約ページ（Live Portal）はまだ無い
    expect(html(files, 'tokushoho')).not.toContain('billing.stripe.com');
    expect(text(html(files, 'index'))).toMatch(/月額250円\s*（税込）/);
  });

  it('お問い合わせ・改善要望のmailtoは事業者情報の確認後から使える（購入導線とは独立）', () => {
    expect(html(files, 'contact')).toContain('href="mailto:');
    expect(html(files, 'thanks')).not.toContain('href="mailto:'); // ご案内ページは受付開始まで案内のみ
  });
});

describe('事業者情報が未確認の場合（捏造しない）', () => {
  const files = renderMonitorSite(UNCONFIRMED_CFG, { mode: 'live', base: BASE });
  it('未確認の事業者情報は「受付開始時に掲載します」と出し、メール・氏名・価格の税表記を出さない', () => {
    const t = text(html(files, 'tokushoho'));
    expect(t).toContain('受付開始時に掲載します');
    expect(t).not.toMatch(/@/);
    expect(text(html(files, 'index'))).not.toContain('（税込）');
    expect(html(files, 'contact')).not.toContain('href="mailto:');
  });
});

describe('暫定方針（返金・解約・税・制定日）', () => {
  const files = renderMonitorSite(MONITOR_CONFIG, { mode: 'live', base: BASE });
  const terms = text(html(files, 'terms'));
  const toku = text(html(files, 'tokushoho'));

  it('返金: 決済済み期間は原則返金なし。ただし法令上必要な対応・重複請求・運営者側の決済事故は除外しない', () => {
    for (const t of [terms, toku]) {
      expect(t).toContain('原則として返金いたしません');
      expect(t).toContain('法令上必要な場合');
      expect(t).toContain('重複してご請求した場合');
      expect(t).toContain('決済上の事故');
    }
  });

  it('解約: いつでも解約でき、次回以降の請求は発生しない', () => {
    for (const t of [terms, toku]) {
      expect(t).toContain('いつでも');
      expect(t).toContain('次回以降の請求は発生しません');
    }
  });

  it('お宝ファインダー固有の条件（14日間の返金保証・アカウント・LINE等）を持ち込まない', () => {
    const all = allHtml(files);
    for (const banned of ['14日', '満足度', '返金保証', 'AIを活用した商品リサーチ', 'LINE公式']) expect(all, banned).not.toContain(banned);
  });

  it('制定日は「2026年9月19日」と表示される', () => {
    expect(terms).toContain('制定日: 2026年9月19日');
    expect(text(html(files, 'privacy'))).toContain('制定日: 2026年9月19日');
  });
});

describe('ヘルパー', () => {
  it('jpDate / taxSentence', () => {
    expect(jpDate('2026-09-19')).toBe('2026年9月19日');
    expect(jpDate('2026/09/19')).toBe('');
    expect(jpDate(null)).toBe('');
    expect(taxSentence(MONITOR_CONFIG, { ...MONITOR_CONFIG.owner, monitorPriceTaxInclusive: true })).toBe('先行モニター価格（月額250円）は税込です。');
    expect(taxSentence(MONITOR_CONFIG, { ...MONITOR_CONFIG.owner, monitorPriceTaxInclusive: false })).toContain('税別');
    expect(taxSentence(MONITOR_CONFIG, { ...MONITOR_CONFIG.owner, monitorPriceTaxInclusive: null })).toBeNull();
  });
});

describe('受付中（Ownerの確認値とLive URLが揃った場合）', () => {
  const files = renderMonitorSite(OPEN_CFG, { mode: 'live', base: BASE });

  it('LPに月額250円のCTAがあり、Live Payment Linkへ向く', () => {
    const lp = html(files, 'index');
    expect(lp).toContain('月額250円で先行モニターに参加する');
    expect(lp).toContain('href="https://buy.stripe.com/liveFakeLink123"');
    expect(lp).not.toContain('noindex');
    expect(JSON.parse(files['monitor/status.json'])).toMatchObject({ salesOpen: true, missing: [] });
  });

  it('特商法・規約・プライバシーにOwner確認値が入り、所在地・電話は請求開示の文言になる', () => {
    const t = text(html(files, 'tokushoho'));
    expect(t).toContain('架空 太郎');
    expect(t).toContain('support@example.invalid');
    expect(t).toContain('決済後の返金は行いません。');
    expect(t).toContain('請求があった場合、遅滞なく開示します');
    expect(text(html(files, 'terms'))).toContain('先行モニター価格（月額250円）は税込です。');
    expect(text(html(files, 'privacy'))).toContain('support@example.invalid');
  });

  it('解約導線（Stripe Customer Portal）が、LP・規約・特商法・ご案内ページにある', () => {
    for (const p of ['index', 'terms', 'tokushoho', 'thanks'] as const) {
      expect(html(files, p)).toContain('href="https://billing.stripe.com/p/login/liveFakePortal456"');
    }
  });

  it('お支払い完了後のご案内ページ: お礼・利用開始（アプリ）・改善要望・解約', () => {
    const th = html(files, 'thanks');
    expect(th).toContain('先行モニターへのご参加ありがとうございます');
    expect(th).toContain(`href="${MONITOR_CONFIG.appUrl}"`);
    expect(th).toContain('mailto:support@example.invalid?subject=');
    expect(text(th)).toContain('運営者の手作業による対応');
  });

  it('お問い合わせページに改善要望・不具合・その他のmailtoがある', () => {
    const c = html(files, 'contact');
    expect(c.match(/href="mailto:support@example\.invalid\?subject=/g)?.length).toBe(3);
    const subjects = [...c.matchAll(/href="mailto:[^?"]+\?subject=([^&"]+)/g)].map((m) => decodeURIComponent(m[1]));
    expect(subjects.join('|')).toMatch(/改善要望.*不具合.*お問い合わせ/);
  });

  it('事業者の入力値はHTMLエスケープされる', () => {
    const evil = renderMonitorSite(
      { ...OPEN_CFG, owner: { ...OPEN_CFG.owner, sellerName: '<script>alert(1)</script>' } },
      { mode: 'live', base: BASE },
    );
    expect(allHtml(evil)).not.toContain('<script');
    expect(html(evil, 'tokushoho')).toContain('&lt;script&gt;');
  });
});

describe('testモード（公開しないQA用ビルド）', () => {
  const files = renderMonitorSite(MONITOR_CONFIG, { mode: 'test', base: BASE });
  it('TEST BUILD表示・noindex・Test Payment Link・ダミー事業者', () => {
    const lp = html(files, 'index');
    expect(lp).toContain('TEST BUILD');
    expect(lp).toContain('noindex');
    expect(lp).toContain(`href="${MONITOR_CONFIG.test.paymentLink}"`);
    expect(text(html(files, 'tokushoho'))).toContain(TEST_OWNER_DUMMY.sellerName as string);
    expect(JSON.parse(files['monitor/status.json'])).toMatchObject({ mode: 'test', salesOpen: true });
  });
});

describe.each([
  ['受付準備中', MONITOR_CONFIG, 'live'],
  ['受付中', OPEN_CFG, 'live'],
  ['test', MONITOR_CONFIG, 'test'],
] as const)('表現・リンクの安全性（%s）', (_name, cfg, mode) => {
  const files = renderMonitorSite(cfg, { mode, base: BASE });
  const all = allHtml(files);
  const plain = text(all);

  it('Ownerが決めていない条件・未提供機能・偽のアクセス制御を主張しない', () => {
    const withoutAllowed = plain.replace('必ず実装するお約束はできません', '').replace('必ず実装するお約束はできませんが', '');
    for (const banned of ['永久', '必ず', '無料で', '買い物', '完全なアクセス制御', '会員限定', '限定公開', 'モニター限定機能', '保証します']) {
      expect(withoutAllowed, banned).not.toContain(banned);
    }
  });

  it('価格: 250円（先行モニター価格）と500円（予定）を区別し、500円は必ず「予定」と一緒に出る', () => {
    expect(plain).toContain('月額250円');
    expect(plain).toContain('先行モニター価格');
    expect(plain).toContain('月額500円');
    for (const sentence of plain.split('。').filter((s) => s.includes('500円'))) {
      expect(sentence, sentence).toContain('予定');
    }
  });

  it('アプリは現在ログイン不要で公開されている事実を、LP・規約・特商法で隠さない', () => {
    for (const p of ['index', 'terms', 'tokushoho'] as const) {
      expect(text(html(files, p)), p).toContain('ログイン不要');
      expect(text(html(files, p)), p).toMatch(/機能制限(は|も)設けていません/);
    }
  });

  it('外部リソース・スクリプトを読み込まない（Cookie/解析なし）', () => {
    expect(all).not.toMatch(/<script|<iframe|<link[^>]+rel="stylesheet"|<img[^>]+src="https?:/);
  });

  it('リンクは Stripe・アプリ・mailto・サイト内のみで、サイト内リンクはすべて生成済みページに解決する', () => {
    const hrefs = [...all.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    const internal = new Set(Object.keys(files).map((f) => `${BASE}${f.replace(/index\.html$/, '')}`));
    for (const h of hrefs) {
      if (h.startsWith('mailto:') || h.startsWith('https://buy.stripe.com/') || h.startsWith('https://billing.stripe.com/')) continue;
      if (h === cfg.appUrl) continue;
      if (h.startsWith(cfg.appUrl)) continue; // canonical
      if (h.startsWith(`${BASE}icons/`)) continue;
      expect(internal.has(h), h).toBe(true);
    }
  });

  it('モバイル向けviewportを持ち、全ページにフッター導線（規約・プライバシー・特商法・問い合わせ）がある', () => {
    for (const p of PAGES) {
      const h = html(files, p);
      expect(h).toContain('name="viewport" content="width=device-width, initial-scale=1"');
      for (const path of ['terms/', 'privacy/', 'tokushoho/', 'contact/']) expect(h).toContain(`href="${BASE}monitor/${path}"`);
    }
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
