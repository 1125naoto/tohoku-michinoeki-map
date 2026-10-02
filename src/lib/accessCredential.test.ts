import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PAYMENT_CONFIRMATION_WINDOW_MS,
  captureActivationParam,
  checkEntitlement,
  finishActivation,
  isAwaitingPaymentConfirmation,
  sha256Hex,
} from './accessCredential';

describe('sha256Hex', () => {
  it('既知のSHA-256値と一致する', async () => {
    // echo -n "" | sha256sum
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('入力が違えば別のハッシュになる', async () => {
    expect(await sha256Hex('a')).not.toBe(await sha256Hex('b'));
  });
});

describe('checkEntitlement (fail-closed)', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn() as never;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('自分の資格情報のハッシュが一覧に含まれていればgranted', async () => {
    const credential = 'cs_test_realsecret';
    const hash = await sha256Hex(credential);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => [hash, 'someone-elses-hash'],
    });
    await expect(checkEntitlement(credential, '/base/')).resolves.toBe('granted');
  });

  it('一覧に含まれていなければdenied（解約後・未購入者はここに落ちる）', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ['someone-elses-hash'],
    });
    await expect(checkEntitlement('cs_test_notmine', '/base/')).resolves.toBe('denied');
  });

  it('HTTPエラー時はunavailable（fail-closed。無条件で許可しない）', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, json: async () => [] });
    await expect(checkEntitlement('x', '/base/')).resolves.toBe('unavailable');
  });

  it('通信自体が失敗した場合もunavailable', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));
    await expect(checkEntitlement('x', '/base/')).resolves.toBe('unavailable');
  });

  it('不正な形式（配列でない・文字列以外を含む）もunavailable', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ oops: true }) });
    await expect(checkEntitlement('x', '/base/')).resolves.toBe('unavailable');
  });
});

describe('?activate= の取り込み', () => {
  let href: string;
  let standalone: boolean;
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    standalone = false;
    vi.stubGlobal('location', {
      get href() {
        return href;
      },
    });
    vi.stubGlobal('history', { replaceState: (_s: unknown, _t: string, u: string) => (href = u) });
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
    vi.stubGlobal('window', { matchMedia: () => ({ matches: standalone }) });
    vi.stubGlobal('navigator', {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Safariのタブ: 保存し、?activate= はURLに残し、LINEの指定だけ消す', () => {
    href = 'https://x.example/base/?activate=code123&openExternalBrowser=1';
    expect(captureActivationParam()).toEqual({ credential: 'code123', fromUrl: true });
    expect(store.get('michinoeki_access_credential')).toBe('code123');
    expect(href).toBe('https://x.example/base/?activate=code123');
  });

  it('ホーム画面版（standalone）: 自分のlocalStorageへ保存し、URLから消す', () => {
    standalone = true;
    href = 'https://x.example/base/?activate=code123';
    captureActivationParam();
    expect(store.get('michinoeki_access_credential')).toBe('code123');
    expect(href).toBe('https://x.example/base/');
  });

  it('拒否された招待コードはURLから消す', () => {
    href = 'https://x.example/base/?activate=forged';
    finishActivation(captureActivationParam(), 'denied');
    expect(href).toBe('https://x.example/base/');
  });

  it('?activate= なし（一般ユーザー・有料契約者）: 保存済みの資格情報を使い、URLは変えない', () => {
    store.set('michinoeki_access_credential', 'cs_live_paid');
    href = 'https://x.example/base/';
    const c = captureActivationParam();
    expect(c).toEqual({ credential: 'cs_live_paid', fromUrl: false });
    finishActivation(c, 'granted');
    expect(href).toBe('https://x.example/base/');
  });
});

describe('決済直後の「確認中」（購入者一覧への反映待ち）', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const NOW = 1_800_000_000_000;

  it('Thanksページで30分以内に保存されたCheckout Session ID（cs_）だけが確認中になる', () => {
    store.set('michinoeki_access_credential_at', String(NOW - 60_000));
    expect(isAwaitingPaymentConfirmation('cs_live_abc', NOW)).toBe(true);
    expect(isAwaitingPaymentConfirmation('invite_code', NOW)).toBe(false); // 招待コードは対象外
  });

  it('30分を過ぎた・時刻が無い・未来の時刻は確認中にしない（いつまでも待たせない／課金画面に戻す）', () => {
    store.set('michinoeki_access_credential_at', String(NOW - PAYMENT_CONFIRMATION_WINDOW_MS));
    expect(isAwaitingPaymentConfirmation('cs_live_abc', NOW)).toBe(false);
    store.delete('michinoeki_access_credential_at');
    expect(isAwaitingPaymentConfirmation('cs_live_abc', NOW)).toBe(false);
    store.set('michinoeki_access_credential_at', String(NOW + 60_000));
    expect(isAwaitingPaymentConfirmation('cs_live_abc', NOW)).toBe(false);
  });
});

describe('購入者一覧の取得はCDNキャッシュを避ける', () => {
  it('毎回クエリ付きのURLで取得する（GitHub PagesのCDNは10分キャッシュするため）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal('fetch', fetchMock);
    await checkEntitlement('x', '/base/');
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^\/base\/access-control\/active\.json\?t=\d+$/);
    vi.unstubAllGlobals();
  });
});
