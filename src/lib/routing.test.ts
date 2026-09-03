/**
 * OSRM Provider のテスト（fetchをスタブしてネットワークに出ない）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRoutingCache, osrmProvider } from './routing';

const pts = [
  { lat: 37.4, lng: 140.35 },
  { lat: 37.7, lng: 140.47 },
];

function okTableResponse() {
  return {
    ok: true,
    json: async () => ({
      code: 'Ok',
      durations: [
        [0, 1800],
        [1750, 0],
      ],
      distances: [
        [0, 24000],
        [23500, 0],
      ],
    }),
  } as Response;
}

beforeEach(() => {
  clearRoutingCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('osrmProvider.table', () => {
  it('OSRM応答を分・kmへ変換する', async () => {
    const fetchMock = vi.fn(async () => okTableResponse());
    vi.stubGlobal('fetch', fetchMock);
    const m = await osrmProvider.table(pts);
    expect(m.durationsMin[0][1]).toBe(30); // 1800秒 → 30分
    expect(m.distancesKm[0][1]).toBe(24); // 24000m → 24km
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(url).toContain('router.project-osrm.org/table/v1/driving/');
    expect(url).toContain('140.35,37.4;140.47,37.7'); // lng,lat順
  });

  it('同一地点集合はキャッシュされ、再リクエストしない', async () => {
    const fetchMock = vi.fn(async () => okTableResponse());
    vi.stubGlobal('fetch', fetchMock);
    await osrmProvider.table(pts);
    await osrmProvider.table(pts);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('HTTPエラーは再試行の後に例外を投げる（フォールバック側で処理）', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500 }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    await expect(osrmProvider.table(pts)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2); // 再試行は1回まで
  });
});

describe('osrmProvider.route', () => {
  it('経路形状を[lat,lng]列で返す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          code: 'Ok',
          routes: [
            {
              duration: 600,
              distance: 5000,
              geometry: { coordinates: [[140.35, 37.4], [140.4, 37.5]] },
            },
          ],
        }),
      }) as Response),
    );
    const r = await osrmProvider.route(pts);
    expect(r.points[0]).toEqual([37.4, 140.35]);
    expect(r.durationMin).toBe(10);
    expect(r.distanceKm).toBe(5);
  });
});
