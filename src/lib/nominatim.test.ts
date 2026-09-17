import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeFacilityQuery, searchPlacesByName } from './nominatim';

/** fetchを差し替え、呼び出し時刻と同時実行数を記録する */
function mockFetch(delayMs = 30) {
  const startedAt: number[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fn = vi.fn(async () => {
    startedAt.push(Date.now());
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, delayMs));
    inFlight -= 1;
    return {
      ok: true,
      json: async () => [],
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return {
    fn,
    startedAt,
    get maxInFlight() {
      return maxInFlight;
    },
  };
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('P1-05回帰: 公開Nominatimへの要求を直列化する', () => {
  it('表記正規化で2語になっても同時に発射しない（1本ずつ・最低間隔を空ける）', async () => {
    const m = mockFetch();
    // 「郡山インター」は正規化すると「郡山IC」になり、内部で2回問い合わせる
    await searchPlacesByName('郡山インター');
    expect(m.fn).toHaveBeenCalledTimes(2);
    expect(m.maxInFlight).toBe(1);
    expect(m.startedAt[1] - m.startedAt[0]).toBeGreaterThanOrEqual(1400);
  }, 20000);

  it('同時に呼んでも重ならない', async () => {
    const m = mockFetch();
    await Promise.all([searchPlacesByName('秋田駅'), searchPlacesByName('青森駅')]);
    expect(m.maxInFlight).toBe(1);
  }, 20000);

  it('同じ検索語はキャッシュから返し、公開サービスへ再送しない', async () => {
    const m = mockFetch();
    await searchPlacesByName('盛岡駅');
    const calls = m.fn.mock.calls.length;
    await searchPlacesByName('盛岡駅');
    expect(m.fn.mock.calls.length).toBe(calls);
  }, 20000);

  it('空文字では問い合わせない', async () => {
    const m = mockFetch();
    await searchPlacesByName('   ');
    expect(m.fn).not.toHaveBeenCalled();
  });
});

describe('道路施設の表記ゆれ正規化', () => {
  it('IC/JCT/PA/SA表記へ寄せる', () => {
    expect(normalizeFacilityQuery('郡山インターチェンジ')).toBe('郡山IC');
    expect(normalizeFacilityQuery('郡山インター')).toBe('郡山IC');
    expect(normalizeFacilityQuery('インターネットカフェ')).toBe('インターネットカフェ');
  });
});
