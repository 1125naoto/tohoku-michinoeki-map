import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkEntitlement, sha256Hex } from './accessCredential';

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
