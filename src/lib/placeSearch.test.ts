import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchPlaces, searchStations } from './placeSearch';
import { STATIONS } from '../data';
import * as geocodeModule from './geocode';
import * as nominatimModule from './nominatim';

/** Nominatim（施設名検索）は既定で空にしておき、必要なテストだけ差し替える */
function mockOsm(places: { name: string; address: string | null; lat: number; lng: number }[] = []) {
  return vi
    .spyOn(nominatimModule, 'searchPlacesByName')
    .mockResolvedValue(places.map((p) => ({ ...p, kind: null })));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('道の駅名での地点検索（通信なし・アプリ内データ）', () => {
  it('道の駅名の一部で見つかる', () => {
    const hits = searchStations('ふくしま', STATIONS);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].source).toBe('station');
    expect(hits[0].label.startsWith('道の駅')).toBe(true);
  });

  it('「道の駅」を付けて入力しても同じ駅が見つかる', () => {
    const withPrefix = searchStations('道の駅ふくしま', STATIONS);
    const without = searchStations('ふくしま', STATIONS);
    expect(withPrefix.map((h) => h.id)).toEqual(without.map((h) => h.id));
  });

  it('市区町村名でも見つかり、所在地が補足表示に入る', () => {
    const hits = searchStations('秋田市', STATIONS);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].sub).toContain('秋田');
    expect(Number.isFinite(hits[0].lat)).toBe(true);
    expect(Number.isFinite(hits[0].lng)).toBe(true);
  });

  it('空文字では何も返さない', () => {
    expect(searchStations('   ', STATIONS)).toEqual([]);
  });

  it('候補は5件までに抑える（一覧が長くなりすぎないように）', () => {
    expect(searchStations('道', STATIONS).length).toBeLessThanOrEqual(5);
  });
});

describe('名称・住所検索（道の駅 + 国土地理院 住所検索）', () => {
  it('道の駅の候補が先、住所検索の候補が後に並ぶ', async () => {
    mockOsm();
    vi.spyOn(geocodeModule, 'geocode').mockResolvedValue([
      { label: '福島県福島市', lat: 37.76, lng: 140.47 },
    ]);
    const { candidates, geocodeFailed } = await searchPlaces('ふくしま', STATIONS);
    expect(geocodeFailed).toBe(false);
    expect(candidates[0].source).toBe('station');
    expect(candidates[candidates.length - 1].source).toBe('gsi');
  });

  it('複数候補をそのまま返す（勝手に1件へ決め打ちしない）', async () => {
    mockOsm();
    vi.spyOn(geocodeModule, 'geocode').mockResolvedValue([
      { label: '宮城県仙台市太白区郡山', lat: 38.22, lng: 140.89 },
      { label: '山形県東根市郡山', lat: 38.42, lng: 140.36 },
    ]);
    const { candidates } = await searchPlaces('郡山', STATIONS);
    const gsi = candidates.filter((c) => c.source === 'gsi');
    expect(gsi.length).toBe(2);
    expect(new Set(candidates.map((c) => c.id)).size).toBe(candidates.length);
  });

  it('住所検索が0件でも、道の駅が当たっていれば候補を返す', async () => {
    mockOsm();
    vi.spyOn(geocodeModule, 'geocode').mockResolvedValue([]);
    const { candidates, geocodeFailed } = await searchPlaces('ふくしま', STATIONS);
    expect(geocodeFailed).toBe(false);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.source === 'station')).toBe(true);
  });

  it('住所検索が通信失敗しても例外を投げず、道の駅の候補は返す', async () => {
    mockOsm();
    vi.spyOn(geocodeModule, 'geocode').mockRejectedValue(new Error('network'));
    const { candidates, geocodeFailed } = await searchPlaces('ふくしま', STATIONS);
    // 片方だけの失敗は「検索失敗」にしない（もう片方の候補を出せるため）
    expect(geocodeFailed).toBe(false);
    expect(candidates.length).toBeGreaterThan(0);
  });

  it('どれも0件なら空で返す（呼び出し側が案内文を出す）', async () => {
    mockOsm();
    vi.spyOn(geocodeModule, 'geocode').mockResolvedValue([]);
    const { candidates } = await searchPlaces('存在しない施設名XYZ', STATIONS);
    expect(candidates).toEqual([]);
  });

  it('空入力では通信しない', async () => {
    const spy = vi.spyOn(geocodeModule, 'geocode').mockResolvedValue([]);
    const osmSpy = mockOsm();
    const { candidates } = await searchPlaces('   ', STATIONS);
    expect(candidates).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    expect(osmSpy).not.toHaveBeenCalled();
  });

  it('施設名（IC・駅・ホテル）はOpenStreetMap側の候補として住所より先に出る', async () => {
    mockOsm([{ name: '郡山IC', address: '東北自動車道 郡山市 福島県', lat: 37.44, lng: 140.32 }]);
    vi.spyOn(geocodeModule, 'geocode').mockResolvedValue([
      { label: '宮城県仙台市太白区郡山', lat: 38.22, lng: 140.89 },
    ]);
    const { candidates, usedOsm } = await searchPlaces('郡山IC', STATIONS);
    expect(usedOsm).toBe(true);
    expect(candidates[0].label).toBe('郡山IC');
    expect(candidates[0].source).toBe('osm');
    expect(candidates[0].sub).toContain('郡山市');
    // 住所検索側の候補も残る（利用者が選べる）
    expect(candidates.some((c) => c.source === 'gsi')).toBe(true);
  });

  it('施設名検索が落ちても住所検索の候補は出す（その逆も同じ）', async () => {
    vi.spyOn(nominatimModule, 'searchPlacesByName').mockRejectedValue(new Error('down'));
    vi.spyOn(geocodeModule, 'geocode').mockResolvedValue([
      { label: '福島県郡山市', lat: 37.4, lng: 140.36 },
    ]);
    const { candidates, geocodeFailed, usedOsm } = await searchPlaces('郡山市', STATIONS);
    expect(geocodeFailed).toBe(false);
    expect(usedOsm).toBe(false);
    expect(candidates.some((c) => c.source === 'gsi')).toBe(true);
  });

  it('両方落ちたときだけ失敗として扱う', async () => {
    vi.spyOn(nominatimModule, 'searchPlacesByName').mockRejectedValue(new Error('down'));
    vi.spyOn(geocodeModule, 'geocode').mockRejectedValue(new Error('down'));
    const { candidates, geocodeFailed } = await searchPlaces('存在しない施設名XYZ', STATIONS);
    expect(geocodeFailed).toBe(true);
    expect(candidates).toEqual([]);
  });

  it('同じ地点が両方から返っても重複表示しない', async () => {
    mockOsm([{ name: '秋田駅', address: '秋田市 秋田県', lat: 39.717, lng: 140.13 }]);
    vi.spyOn(geocodeModule, 'geocode').mockResolvedValue([
      { label: '秋田県秋田市', lat: 39.717, lng: 140.13 },
    ]);
    const { candidates } = await searchPlaces('秋田駅', STATIONS);
    expect(candidates.filter((c) => Math.abs(c.lat - 39.717) < 1e-4).length).toBe(1);
  });
});
