import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLOCK_SKEW_MS,
  MAX_TTL_MS,
  activeTimedGrantHashes,
  composeActiveHashes,
  judgeTimedGrant,
  pruneExpiredTimedHashes,
  summarizeTimedGrants,
} from '../../scripts/timedGrants.mjs';
import { checkEntitlement, sha256Hex } from './accessCredential';

const NOW = Date.parse('2026-10-11T10:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const STRIPE_HASH = '1'.repeat(64); // 実際の購入者のハッシュに見立てた値
const NAMI_HASH = '2'.repeat(64); // ナミちゃんの招待コードのハッシュに見立てた値

function grant(over: Record<string, unknown> = {}) {
  return { label: 'verify', sha256: HASH_A, issuedAt: iso(NOW - 60_000), expiresAt: iso(NOW + 30 * 60_000), ...over };
}

describe('judgeTimedGrant（期限つきの一時アクセスの判定）', () => {
  it('期限内の正しい形式は有効', () => {
    expect(judgeTimedGrant(grant(), NOW)).toEqual({ valid: true, reason: 'ok' });
  });

  it('期限切れ（ちょうど期限の瞬間を含む）は無効', () => {
    expect(judgeTimedGrant(grant({ expiresAt: iso(NOW) }), NOW).reason).toBe('expired');
    expect(judgeTimedGrant(grant({ expiresAt: iso(NOW - 1) }), NOW).valid).toBe(false);
  });

  it('期限なし・発行時刻なし・日付として読めないものは無効（恒久アクセスは作れない）', () => {
    expect(judgeTimedGrant(grant({ expiresAt: undefined }), NOW).reason).toBe('no_expiry');
    expect(judgeTimedGrant(grant({ issuedAt: undefined }), NOW).reason).toBe('no_expiry');
    expect(judgeTimedGrant(grant({ expiresAt: 'never' }), NOW).reason).toBe('no_expiry');
    expect(judgeTimedGrant(grant({ expiresAt: null }), NOW).reason).toBe('no_expiry');
  });

  it('有効期間が24時間を超えるものは無効（期限を遠い未来にして恒久化できない）', () => {
    const issued = NOW - 1000;
    expect(judgeTimedGrant(grant({ issuedAt: iso(issued), expiresAt: iso(issued + MAX_TTL_MS) }), NOW).valid).toBe(true);
    expect(judgeTimedGrant(grant({ issuedAt: iso(issued), expiresAt: iso(issued + MAX_TTL_MS + 1) }), NOW).reason).toBe(
      'ttl_too_long',
    );
    expect(judgeTimedGrant(grant({ expiresAt: '2999-01-01T00:00:00Z' }), NOW).valid).toBe(false);
  });

  it('期限が発行より前・同時のものは無効', () => {
    expect(judgeTimedGrant(grant({ issuedAt: iso(NOW), expiresAt: iso(NOW) }), NOW).reason).toBe('bad_window');
    expect(judgeTimedGrant(grant({ issuedAt: iso(NOW + 1000), expiresAt: iso(NOW) }), NOW).reason).toBe('bad_window');
  });

  it('発行時刻が未来すぎるもの（台帳の誤り・改ざん）は無効。時計のずれ程度は許容', () => {
    const farFuture = grant({ issuedAt: iso(NOW + CLOCK_SKEW_MS + 60_000), expiresAt: iso(NOW + 3_600_000) });
    expect(judgeTimedGrant(farFuture, NOW).reason).toBe('issued_in_future');
    const slight = grant({ issuedAt: iso(NOW + 60_000), expiresAt: iso(NOW + 3_600_000) });
    expect(judgeTimedGrant(slight, NOW).valid).toBe(true);
  });

  it('sha256 が64桁の16進でないもの（平文を書き込んだ場合を含む）は無効', () => {
    expect(judgeTimedGrant(grant({ sha256: 'verify-plain-text-code' }), NOW).reason).toBe('bad_hash');
    expect(judgeTimedGrant(grant({ sha256: 'A'.repeat(64) }), NOW).reason).toBe('bad_hash');
    expect(judgeTimedGrant(grant({ sha256: 'a'.repeat(63) }), NOW).reason).toBe('bad_hash');
    expect(judgeTimedGrant(grant({ sha256: undefined }), NOW).reason).toBe('bad_hash');
  });

  it('オブジェクトでないものは無効', () => {
    expect(judgeTimedGrant(null, NOW).valid).toBe(false);
    expect(judgeTimedGrant('x', NOW).valid).toBe(false);
  });
});

describe('activeTimedGrantHashes / summarizeTimedGrants', () => {
  it('有効なものだけのハッシュを返し、台帳が配列でなくても落ちない（空）', () => {
    const grants = [grant(), grant({ sha256: HASH_B, expiresAt: iso(NOW - 1) })];
    expect(activeTimedGrantHashes(grants, NOW)).toEqual([HASH_A]);
    expect(activeTimedGrantHashes({}, NOW)).toEqual([]);
    expect(activeTimedGrantHashes(null, NOW)).toEqual([]);
  });

  it('要約は件数と理由だけで、ハッシュを含まない', () => {
    const grants = [grant(), grant({ sha256: HASH_B, expiresAt: iso(NOW - 1) }), grant({ expiresAt: undefined })];
    const s = summarizeTimedGrants(grants, NOW);
    expect(s).toEqual({ active: 1, rejected: { expired: 1, no_expiry: 1 } });
    expect(JSON.stringify(s)).not.toContain(HASH_A);
  });
});

describe('composeActiveHashes（同期: 既存購入者・NAMIの保護）', () => {
  it('Stripeの購入者・NAMIのハッシュは、一時アクセスの有無・期限にかかわらず常に残る', () => {
    const base = { stripeHashes: [STRIPE_HASH], manualHashes: [NAMI_HASH] };
    const existing = [STRIPE_HASH, NAMI_HASH].sort();
    expect(composeActiveHashes({ ...base, timedGrants: [], now: NOW })).toEqual(existing);
    // 台帳が無い（既存の同期と同じ結果）
    expect(composeActiveHashes({ ...base, now: NOW })).toEqual(existing);
    // 台帳が壊れていても既存のハッシュは残る
    expect(composeActiveHashes({ ...base, timedGrants: 'broken', now: NOW })).toEqual(existing);
    // 期限内 → 追加、期限後 → 外れる。その間も既存のハッシュは変わらない
    const grants = [grant()];
    expect(composeActiveHashes({ ...base, timedGrants: grants, now: NOW })).toEqual([HASH_A, ...existing].sort());
    expect(composeActiveHashes({ ...base, timedGrants: grants, now: NOW + 31 * 60_000 })).toEqual(existing);
  });

  it('同期のたびに（1分ごとに再生成しても）期限内は消えない', () => {
    const grants = [grant()];
    for (let minute = 0; minute < 25; minute++) {
      const list = composeActiveHashes({
        stripeHashes: [STRIPE_HASH],
        manualHashes: [],
        timedGrants: grants,
        now: NOW + minute * 60_000,
      });
      expect(list).toContain(HASH_A);
    }
  });

  it('重複は1つにまとめ、昇順で安定する', () => {
    const list = composeActiveHashes({
      stripeHashes: [HASH_B, HASH_A],
      manualHashes: [HASH_A],
      timedGrants: [grant()],
      now: NOW,
    });
    expect(list).toEqual([HASH_A, HASH_B]);
  });
});

describe('pruneExpiredTimedHashes（Stripe取得失敗時: 除去のみ）', () => {
  it('期限切れの一時アクセスだけを外し、他のハッシュ（購入者・NAMI）には触れない', () => {
    const prev = [HASH_A, STRIPE_HASH, NAMI_HASH, HASH_B];
    const grants = [grant({ expiresAt: iso(NOW - 1) }), grant({ sha256: HASH_B })];
    expect(pruneExpiredTimedHashes(prev, grants, NOW)).toEqual([STRIPE_HASH, NAMI_HASH, HASH_B]);
  });

  it('何も追加しない（台帳に有効なものがあっても、一覧に無いものは足さない）', () => {
    expect(pruneExpiredTimedHashes([STRIPE_HASH], [grant()], NOW)).toEqual([STRIPE_HASH]);
  });

  it('台帳が壊れていても一覧は変わらない', () => {
    expect(pruneExpiredTimedHashes([STRIPE_HASH, HASH_A], 'broken', NOW)).toEqual([STRIPE_HASH, HASH_A]);
  });
});

describe('認証の通しテスト（同期の出力 → ゲートの照合）', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn() as never;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  const serve = (list: string[]) =>
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => list });

  it('期限内は granted、期限後は denied。購入者の資格情報は常に granted、別のコードは denied', async () => {
    const code = 'verify-test-only-not-a-real-code';
    const customer = 'cs_live_a_real_customer_session';
    const grants = [
      { label: 'verify', sha256: await sha256Hex(code), issuedAt: iso(NOW - 1000), expiresAt: iso(NOW + 600_000) },
    ];
    const stripeHashes = [await sha256Hex(customer)];

    serve(composeActiveHashes({ stripeHashes, timedGrants: grants, now: NOW }));
    await expect(checkEntitlement(code, '/base/')).resolves.toBe('granted');
    await expect(checkEntitlement(customer, '/base/')).resolves.toBe('granted');
    await expect(checkEntitlement('verify-another-code', '/base/')).resolves.toBe('denied');

    serve(composeActiveHashes({ stripeHashes, timedGrants: grants, now: NOW + 601_000 }));
    await expect(checkEntitlement(code, '/base/')).resolves.toBe('denied');
    await expect(checkEntitlement(customer, '/base/')).resolves.toBe('granted');
  });
});
