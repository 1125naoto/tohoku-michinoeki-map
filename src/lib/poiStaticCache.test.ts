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

  it('要求した駅と異なるstationIdが返った場合はnullにする（別駅のデータを誤って表示しない）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...SAMPLE, stationId: 'mne-other' }) }));
    const result = await loadStaticPoiCache('mne-19013');
    expect(result).toBeNull();
  });

  it('lat/lng/radiusM/generatedAtが欠けている・型不正な場合はnullにする', async () => {
    for (const broken of [
      { ...SAMPLE, lat: 'not-a-number' },
      { ...SAMPLE, radiusM: -1 },
      { ...SAMPLE, generatedAt: 'not-a-date' },
    ]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => broken }));
      const result = await loadStaticPoiCache('mne-19013');
      expect(result).toBeNull();
    }
  });

  it('個々のPOI要素が不正(id/category/座標欠如等)な場合、その要素だけを除外し全体は落とさない', async () => {
    const withBroken = {
      ...SAMPLE,
      pois: [
        ...SAMPLE.pois,
        { id: 'osm:node/2', category: 'not-a-real-category', subcategory: 'shokudo', lat: 38, lng: 140, distanceM: 1 },
        { id: 'osm:node/3', category: 'food', subcategory: 'shokudo', lat: 'bad', lng: 140, distanceM: 1 },
        { category: 'food', subcategory: 'shokudo', lat: 38, lng: 140, distanceM: 1 }, // idが無い
      ],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => withBroken }));
    const result = await loadStaticPoiCache('mne-19013');
    expect(result?.pois).toHaveLength(1);
    expect(result?.pois[0].id).toBe('osm:node/1');
  });

  it('sourceUrl/websiteがhttp(s)以外のスキーム(javascript:等)の場合、そのまま渡さずnull/空文字にする', async () => {
    const withBadUrl = {
      ...SAMPLE,
      pois: [
        {
          ...SAMPLE.pois[0],
          website: 'javascript:alert(1)',
          sourceUrl: 'javascript:alert(2)',
        },
      ],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => withBadUrl }));
    const result = await loadStaticPoiCache('mne-19013');
    expect(result?.pois[0].website).toBeNull();
    expect(result?.pois[0].sourceUrl).toBe('');
  });

  it('AbortSignalが既に中断済みの場合、通信を試みずnullを返す', async () => {
    // 実際のfetch()は中断済みsignalを渡すとAbortErrorで即rejectする。モックでも同じ挙動を再現する。
    const fetchMock = vi.fn().mockImplementation((_url: string, opts: { signal: AbortSignal }) => {
      if (opts.signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
      return Promise.resolve({ ok: true, json: async () => SAMPLE });
    });
    vi.stubGlobal('fetch', fetchMock);
    const ctrl = new AbortController();
    ctrl.abort();
    const result = await loadStaticPoiCache('mne-19013', ctrl.signal);
    expect(result).toBeNull();
  });
});
