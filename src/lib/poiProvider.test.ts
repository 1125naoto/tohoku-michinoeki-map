import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExternalPlacesProvider, OverpassPoiProvider, StaticOsmPoiProvider } from './poiProvider';
import type { Poi } from './poi';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SAMPLE_POI: Poi = {
  id: 'osm:node/1',
  category: 'food',
  subcategory: 'shokudo',
  subcategories: ['shokudo'],
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
};

describe('StaticOsmPoiProvider（道の駅起点の事前生成静的キャッシュ）', () => {
  it('静的キャッシュにデータがあれば failed:false で返す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ stationId: 'mne-1', lat: 38, lng: 140, radiusM: 10000, generatedAt: '2026', pois: [SAMPLE_POI] }),
      }),
    );
    const result = await new StaticOsmPoiProvider('mne-1').search({ lat: 38, lng: 140 }, 3000);
    expect(result.failed).toBe(false);
    expect(result.fromCache).toBe(true);
    expect(result.pois).toHaveLength(1);
  });

  it('静的キャッシュ未生成(404)やpois空はfailed:trueとし、呼び出し側が次のproviderへ進めるようにする', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const result = await new StaticOsmPoiProvider('mne-unknown').search({ lat: 38, lng: 140 }, 3000);
    expect(result.failed).toBe(true);
    expect(result.pois).toEqual([]);
  });

  it('生成スクリプトが「正常応答・本当に0件」を保存した場合（status:"ok", pois:[]）も、APIの取得失敗と同じくfailed:trueとしてライブ検索へ進む', async () => {
    // static-osm providerの役割は「事前生成データがあれば優先表示する」ことであり、
    // 0件という結果自体は現地の実情が変わっている可能性があるため、静的な0件を
    // そのまま確定表示せずライブ検索で再確認させる（既存の意図的な設計。今回は
    // 追加したschema("status":"ok")がこの挙動を壊さないことを回帰確認する）。
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ stationId: 'mne-2', lat: 38, lng: 140, radiusM: 10000, generatedAt: '2026', status: 'ok', pois: [] }),
      }),
    );
    const result = await new StaticOsmPoiProvider('mne-2').search({ lat: 38, lng: 140 }, 3000);
    expect(result.failed).toBe(true);
    expect(result.pois).toEqual([]);
  });

  it('status:"partial"かつfoodIncomplete:trueの静的キャッシュは、その旨をfoodIncomplete:trueとして呼び出し側へ伝える', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          stationId: 'mne-3',
          lat: 38,
          lng: 140,
          radiusM: 10000,
          generatedAt: '2026',
          status: 'partial',
          foodIncomplete: true,
          otherIncomplete: false,
          pois: [SAMPLE_POI],
        }),
      }),
    );
    const result = await new StaticOsmPoiProvider('mne-3').search({ lat: 38, lng: 140 }, 3000);
    expect(result.failed).toBe(false);
    expect(result.foodIncomplete).toBe(true);
    expect(result.otherIncomplete).toBe(false);
  });

  it('foodIncomplete/otherIncompleteフィールドが無い旧生成ファイルは、両方falseとして扱う（後方互換）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ stationId: 'mne-4', lat: 38, lng: 140, radiusM: 10000, generatedAt: '2026', pois: [SAMPLE_POI] }),
      }),
    );
    const result = await new StaticOsmPoiProvider('mne-4').search({ lat: 38, lng: 140 }, 3000);
    expect(result.foodIncomplete).toBe(false);
    expect(result.otherIncomplete).toBe(false);
  });

  it('要求範囲(radius)がキャッシュの生成範囲(radiusM)より狭い場合、要求範囲を超えるPOIを含めない（Astra P1: 検索範囲の不一致修正）', async () => {
    const near: Poi = { ...SAMPLE_POI, id: 'osm:node/near', distanceM: 2000 };
    const far: Poi = { ...SAMPLE_POI, id: 'osm:node/far', distanceM: 8000 };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ stationId: 'mne-5', lat: 38, lng: 140, radiusM: 10000, generatedAt: '2026', pois: [near, far] }),
      }),
    );
    const result = await new StaticOsmPoiProvider('mne-5').search({ lat: 38, lng: 140 }, 3000);
    expect(result.failed).toBe(false);
    expect(result.pois.map((p) => p.id)).toEqual(['osm:node/near']);
    expect(result.radiusUsed).toBe(3000);
  });

  it('要求範囲(radius)がキャッシュの生成範囲(radiusM)を超える場合、静的キャッシュでは答えられずfailed:trueにする（呼び出し側がライブ検索へ回れるように）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ stationId: 'mne-6', lat: 38, lng: 140, radiusM: 10000, generatedAt: '2026', pois: [SAMPLE_POI] }),
      }),
    );
    const result = await new StaticOsmPoiProvider('mne-6').search({ lat: 38, lng: 140 }, 15000);
    expect(result.failed).toBe(true);
  });

  it('要求範囲(radius)がキャッシュの生成範囲(radiusM)と一致する場合、全件そのまま返す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ stationId: 'mne-7', lat: 38, lng: 140, radiusM: 10000, generatedAt: '2026', pois: [SAMPLE_POI] }),
      }),
    );
    const result = await new StaticOsmPoiProvider('mne-7').search({ lat: 38, lng: 140 }, 10000);
    expect(result.failed).toBe(false);
    expect(result.pois).toHaveLength(1);
    expect(result.radiusUsed).toBe(10000);
  });
});

describe('OverpassPoiProvider（ライブ検索。現在地検索は必ずこれを使う）', () => {
  it('search()に渡したorigin座標がそのままOverpassクエリに使われる（駅中心の静的データを流用しない）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elements: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    await new OverpassPoiProvider().search({ lat: 12.3456, lng: 65.4321 }, 3000);
    const body = fetchMock.mock.calls[0][1].body as string;
    const decoded = decodeURIComponent(body);
    expect(decoded).toContain('12.3456');
    expect(decoded).toContain('65.4321');
  });
});

describe('ExternalPlacesProvider（Phase 2プレースホルダー。今回は未実装で明示的に例外）', () => {
  it('呼び出すと明示的に例外を投げる（無言でOSM相当の空結果にフォールバックしない）', () => {
    expect(() => new ExternalPlacesProvider().search()).toThrow(/not implemented/);
  });
});
