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

  it('旧形式（Phase 11以前・schemaVersion等の追加フィールドが無い）のキャッシュも問題なく読み込める', async () => {
    // scripts/fetch_poi_cache.py が旧版で生成したファイルには schemaVersion/source/
    // queryVersion/status/endpointsUsed が存在しない。後方互換のため必須にしていない。
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => SAMPLE }));
    const result = await loadStaticPoiCache('mne-19013');
    expect(result?.schemaVersion).toBeUndefined();
    expect(result?.pois).toHaveLength(1);
  });

  it('Phase 11以降の新形式（schemaVersion等を含む）のキャッシュも読み込める', async () => {
    const newFormat = { ...SAMPLE, schemaVersion: 3, source: 'overpass', queryVersion: 2, status: 'ok', endpointsUsed: ['https://overpass-api.de/api/interpreter'] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => newFormat }));
    const result = await loadStaticPoiCache('mne-19013');
    expect(result?.schemaVersion).toBe(3);
    expect(result?.status).toBe('ok');
    expect(result?.pois).toHaveLength(1);
  });

  it('正常応答で本当に0件だった場合（status:"ok"・pois:[]）もnullではなくデータとして返す', async () => {
    // 「APIが本当に失敗した」場合はそもそもファイルが存在しない(404)ため上のテストでカバーされる。
    // ここでは「取得はできたが周辺に対象施設が無かった」正常系がnull扱いされないことを確認する。
    const emptyOk = { ...SAMPLE, pois: [], status: 'ok' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => emptyOk }));
    const result = await loadStaticPoiCache('mne-19013');
    expect(result).not.toBeNull();
    expect(result?.status).toBe('ok');
    expect(result?.pois).toEqual([]);
  });
});
