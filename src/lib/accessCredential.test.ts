import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureActivationParam, checkEntitlement, finishActivation, sha256Hex } from './accessCredential';

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

describe('?activate= の取り込みとホーム画面追加用の受け渡し', () => {
  let href: string;
  let standalone: boolean;
  let store: Map<string, string>;
  let manifestLink: { rel: string; href: string };

  beforeEach(() => {
    store = new Map();
    standalone = false;
    manifestLink = { rel: 'manifest', href: '/base/manifest.webmanifest' };
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
    vi.stubGlobal('document', { querySelector: () => manifestLink });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Safariのタブ: 保存し、?activate= はURLに残し、LINEの指定だけ消す', () => {
    href = 'https://x.example/base/?activate=code123&openExternalBrowser=1';
    const c = captureActivationParam();
    expect(c).toEqual({ credential: 'code123', fromUrl: true });
    expect(store.get('michinoeki_access_credential')).toBe('code123');
    expect(href).toBe('https://x.example/base/?activate=code123');
  });

  it('Safariのタブで有効と確認できたら、manifestをstart_url無しの受け渡し用へ差し替える', () => {
    href = 'https://x.example/base/?activate=code123';
    finishActivation(captureActivationParam(), 'granted', '/base/');
    expect(manifestLink.href).toBe('/base/manifest-handoff.webmanifest');
  });

  it('拒否された招待コードはURLから消し、manifestは変えない', () => {
    href = 'https://x.example/base/?activate=forged';
    finishActivation(captureActivationParam(), 'denied', '/base/');
    expect(href).toBe('https://x.example/base/');
    expect(manifestLink.href).toBe('/base/manifest.webmanifest');
  });

  it('ホーム画面版（standalone）: 自分のlocalStorageへ保存し、URLから消す。manifestは変えない', () => {
    standalone = true;
    href = 'https://x.example/base/?activate=code123';
    const c = captureActivationParam();
    finishActivation(c, 'granted', '/base/');
    expect(store.get('michinoeki_access_credential')).toBe('code123');
    expect(href).toBe('https://x.example/base/');
    expect(manifestLink.href).toBe('/base/manifest.webmanifest');
  });

  it('?activate= なし（一般ユーザー・有料契約者）: 保存済みの資格情報を使い、manifestは変えない', () => {
    store.set('michinoeki_access_credential', 'cs_live_paid');
    href = 'https://x.example/base/';
    const c = captureActivationParam();
    expect(c).toEqual({ credential: 'cs_live_paid', fromUrl: false });
    finishActivation(c, 'granted', '/base/');
    expect(manifestLink.href).toBe('/base/manifest.webmanifest');
  });
});
