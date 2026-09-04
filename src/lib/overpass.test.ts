import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_ESCALATE_MAX_M,
  DEFAULT_RADIUS_M,
  MIN_AUTO_RESULTS,
  POI_RESULT_LIMIT,
  clearPoiCache,
  searchNearbyPois,
  searchNearbyPoisAuto,
} from './overpass';

const LAT = 37.4004;
const LNG = 140.3597;

function makeElements(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    type: 'node',
    id: 1000 + i,
    lat: LAT + i * 0.0005,
    lon: LNG + i * 0.0005,
    tags: { amenity: 'cafe', name: `カフェ${i}` },
  }));
}

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemoryStorage();
  clearPoiCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('検索結果の取得', () => {
  it('成功時はPOIを距離順で返す', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ elements: makeElements(3) }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.failed).toBe(false);
    expect(res.pois.length).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (let i = 1; i < res.pois.length; i++) {
      expect(res.pois[i].distanceM).toBeGreaterThanOrEqual(res.pois[i - 1].distanceM);
    }
  });

  it('取得件数はPOI_RESULT_LIMITまでに絞られる', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ elements: makeElements(POI_RESULT_LIMIT + 20) }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.pois.length).toBe(POI_RESULT_LIMIT);
  });

  it('分類できない要素は結果から除外される', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        elements: [
          { type: 'node', id: 1, lat: LAT, lon: LNG, tags: { shop: 'supermarket' } }, // 分類不能
          { type: 'node', id: 2, lat: LAT, lon: LNG, tags: { amenity: 'cafe', name: 'OK' } },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.pois.length).toBe(1);
    expect(res.pois[0].name).toBe('OK');
  });
});

describe('キャッシュ', () => {
  it('同じ条件の再検索はキャッシュから返し、fetchを呼び直さない', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: makeElements(2) }) });
    vi.stubGlobal('fetch', fetchMock);
    await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('30分経過するとキャッシュを使わず再取得する', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: makeElements(1) }) });
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    try {
      await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
      vi.advanceTimersByTime(31 * 60 * 1000);
      await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('検索半径が違えば別キャッシュ扱いになる', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: makeElements(1) }) });
    vi.stubGlobal('fetch', fetchMock);
    await searchNearbyPois(LAT, LNG, 1000);
    await searchNearbyPois(LAT, LNG, 5000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('障害時のふるまい', () => {
  it('通信エラー時は例外を投げず failed:true を返す（アプリを落とさない）', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.failed).toBe(true);
    expect(res.pois).toEqual([]);
  });

  it('一度だけ再試行する（成功すればfailedにならない）', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ elements: makeElements(1) }) });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.failed).toBe(false);
    expect(res.pois.length).toBe(1);
  });

  it('全接続先が失敗した場合はfailed:trueで打ち切る（無限リトライしない）', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('down'));
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    // 接続先の数だけ（無制限ではなく）試行して打ち切る
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res.failed).toBe(true);
  });

  it('HTTPエラーステータスもfailed扱いになる', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 504, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.failed).toBe(true);
  });

  it('1つ目の接続先が429の場合、2つ目の接続先へ切り替えて成功できる', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ elements: makeElements(1) }) });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.failed).toBe(false);
    expect(res.pois.length).toBe(1);
  });

  it('1つ目の接続先が504の場合、2つ目の接続先へ切り替えて成功できる', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 504, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ elements: makeElements(1) }) });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.failed).toBe(false);
  });

  it('1つ目の接続先がタイムアウト（通信エラー）の場合、2つ目の接続先へ切り替えて成功できる', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('The operation was aborted', 'AbortError'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ elements: makeElements(1) }) });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.failed).toBe(false);
  });

  it('全接続先が失敗した場合はfailed:trueになる（同一接続先への無制限リトライはしない）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    // 接続先の数だけ（無制限ではなく）試行して打ち切る
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res.failed).toBe(true);
    expect(res.pois).toEqual([]);
  });

  it('0件（検索は成功したが該当なし）と通信失敗は区別される', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.failed).toBe(false);
    expect(res.pois).toEqual([]);
  });

  it('接続先の優先順は private.coffee → maps.mail.ru(VK Maps) → overpass-api.de（旧kumi.systemsは含まれない）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls).toEqual([
      'https://overpass.private.coffee/api/interpreter',
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
      'https://overpass-api.de/api/interpreter',
    ]);
    expect(urls.some((u) => u.includes('kumi.systems'))).toBe(false);
  });

  it('呼び出し側のsignalで中断した場合は例外を投げる（結果を上書きしない）', async () => {
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, opts: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          const s = opts?.signal;
          if (s?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }
          s?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const ctrl = new AbortController();
    const promise = searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M, ctrl.signal);
    ctrl.abort();
    await expect(promise).rejects.toBeTruthy();
  });
});

describe('前回成功結果の劣化フォールバック（全接続先失敗時）', () => {
  it('過去に成功していれば、全接続先失敗時でも前回の結果をfromCache:trueで返す', async () => {
    const okMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: makeElements(2) }) });
    vi.stubGlobal('fetch', okMock);
    const first = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(first.fromCache).toBe(false);

    // 30分キャッシュを飛び越して「新鮮なキャッシュではない」状態を作る
    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(31 * 60 * 1000);
      const failMock = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
      vi.stubGlobal('fetch', failMock);
      const second = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
      expect(second.failed).toBe(false);
      expect(second.fromCache).toBe(true);
      expect(second.pois.length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('過去に一度も成功していなければ、全接続先失敗時は素直にfailed:trueになる', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.failed).toBe(true);
    expect(res.fromCache).toBe(false);
  });

  it('30分以内の新鮮なキャッシュはfromCache:trueで返る', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: makeElements(1) }) });
    vi.stubGlobal('fetch', fetchMock);
    await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    const second = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(second.fromCache).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('診断ログ（attemptLog）', () => {
  it('成功時は成功した接続先のログ(outcome:ok, status, elementCount)を含む', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ elements: makeElements(2) }) });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.attemptLog).toHaveLength(2);
    expect(res.attemptLog[0]).toMatchObject({ outcome: 'http_error', status: 429, radiusM: DEFAULT_RADIUS_M });
    expect(res.attemptLog[1]).toMatchObject({ outcome: 'ok', status: 200, elementCount: 2 });
  });

  it('タイムアウトはoutcome:timeoutとして記録される', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.attemptLog.every((a) => a.outcome === 'timeout')).toBe(true);
  });

  it('キャッシュヒット時はattemptLogが空配列になる（新規通信していないため）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: makeElements(1) }) });
    vi.stubGlobal('fetch', fetchMock);
    await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    const second = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(second.fromCache).toBe(true);
    expect(second.attemptLog).toEqual([]);
  });

  it('searchNearbyPoisAutoは範囲拡張をまたいでattemptLogを累積する', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ elements: makeElements(1) }) }) // 3km: 少ない
      .mockResolvedValueOnce({ ok: true, json: async () => ({ elements: makeElements(5) }) }); // 5km: 十分
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPoisAuto(LAT, LNG, 3000);
    expect(res.attemptLog).toHaveLength(2);
    expect(res.attemptLog[0].radiusM).toBe(3000);
    expect(res.attemptLog[1].radiusM).toBe(5000);
  });
});

describe('検索範囲の自動拡張（searchNearbyPoisAuto）', () => {
  it('最初の範囲で十分な件数があれば範囲を広げない', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ elements: makeElements(MIN_AUTO_RESULTS) }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPoisAuto(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.radiusUsed).toBe(DEFAULT_RADIUS_M);
    expect(res.pois.length).toBe(MIN_AUTO_RESULTS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('結果が少ない場合は次の検索範囲まで自動的に広げる', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ elements: makeElements(1) }) }) // 3km: 少ない
      .mockResolvedValueOnce({ ok: true, json: async () => ({ elements: makeElements(5) }) }); // 5km: 十分
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPoisAuto(LAT, LNG, 3000);
    expect(res.failed).toBe(false);
    expect(res.radiusUsed).toBe(5000);
    expect(res.pois.length).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('AUTO_ESCALATE_MAX_Mまで広げても少ない場合はそこで打ち切る（失敗扱いにはしない）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: makeElements(1) }) });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPoisAuto(LAT, LNG, 3000);
    expect(res.failed).toBe(false);
    expect(res.radiusUsed).toBe(AUTO_ESCALATE_MAX_M);
    // 3km → 5km → 10km の3段階で打ち切り（15kmへは自動では進まない）
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('通信が失敗した場合は範囲を広げずに失敗を返す（無意味な再試行をしない）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPoisAuto(LAT, LNG, 3000);
    expect(res.failed).toBe(true);
    expect(res.radiusUsed).toBe(3000);
    // 1段階分の3接続先フェイルオーバーのみ（範囲を変えて再試行しない）
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('ユーザーが最初からAUTO_ESCALATE_MAX_Mを超える範囲(15km)を選んでいた場合は広げない', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: makeElements(1) }) });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPoisAuto(LAT, LNG, 15000);
    expect(res.radiusUsed).toBe(15000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
