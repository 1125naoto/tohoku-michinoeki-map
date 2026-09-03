import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RADIUS_M, POI_RESULT_LIMIT, clearPoiCache, searchNearbyPois } from './overpass';

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

beforeEach(() => {
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

  it('2回失敗した場合はfailed:trueで打ち切る（無限リトライしない）', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('down'));
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.failed).toBe(true);
  });

  it('HTTPエラーステータスもfailed扱いになる', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 504, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const res = await searchNearbyPois(LAT, LNG, DEFAULT_RADIUS_M);
    expect(res.failed).toBe(true);
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
