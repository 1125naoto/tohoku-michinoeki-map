import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadStaticPoiCache } from './poiStaticCache';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SAMPLE = {
  stationId: 'mne-19013',
  lat: 38.354481,
  lng: 140.387127,
  radiusM: 10000,
  generatedAt: '2026-09-05T00:00:00Z',
  pois: [
    {
      id: 'osm:node/1',
      category: 'food',
      subcategory: 'shokudo',
      name: 'テスト食堂',
      lat: 38.36,
      lng: 140.39,
      address: null,
      openingHoursRaw: null,
      phone: null,
      website: null,
      distanceM: 500,
      source: 'overpass',
      sourceUrl: 'https://www.openstreetmap.org/node/1',
    },
  ],
};

describe('loadStaticPoiCache', () => {
  it('成功時はpois配列を含むデータを返す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => SAMPLE }),
    );
    const result = await loadStaticPoiCache('mne-19013');
    expect(result?.pois.length).toBe(1);
    expect(result?.pois[0].name).toBe('テスト食堂');
  });

  it('404(未生成)の場合はnullを返す（例外を投げない）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const result = await loadStaticPoiCache('mne-99999');
    expect(result).toBeNull();
  });

  it('通信エラーの場合はnullを返す（例外を投げない）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const result = await loadStaticPoiCache('mne-19013');
    expect(result).toBeNull();
  });

  it('形式不正（poisが配列でない）の場合はnullを返す', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ stationId: 'x' }) }));
    const result = await loadStaticPoiCache('mne-19013');
    expect(result).toBeNull();
  });
});
