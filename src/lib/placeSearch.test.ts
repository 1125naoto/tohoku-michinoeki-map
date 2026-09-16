import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchPlaces, searchStations } from './placeSearch';
import { STATIONS } from '../data';
import * as geocodeModule from './geocode';

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
    vi.spyOn(geocodeModule, 'geocode').mockResolvedValue([
      { label: '福島県福島市', lat: 37.76, lng: 140.47 },
    ]);
    const { candidates, geocodeFailed } = await searchPlaces('ふくしま', STATIONS);
    expect(geocodeFailed).toBe(false);
    expect(candidates[0].source).toBe('station');
    expect(candidates[candidates.length - 1].source).toBe('gsi');
  });

  it('複数候補をそのまま返す（勝手に1件へ決め打ちしない）', async () => {
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
    vi.spyOn(geocodeModule, 'geocode').mockResolvedValue([]);
    const { candidates, geocodeFailed } = await searchPlaces('ふくしま', STATIONS);
    expect(geocodeFailed).toBe(false);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.source === 'station')).toBe(true);
  });

  it('住所検索が通信失敗しても例外を投げず、道の駅の候補は返す', async () => {
    vi.spyOn(geocodeModule, 'geocode').mockRejectedValue(new Error('network'));
    const { candidates, geocodeFailed } = await searchPlaces('ふくしま', STATIONS);
    expect(geocodeFailed).toBe(true);
    expect(candidates.length).toBeGreaterThan(0);
  });

  it('どちらも0件なら空で返す（呼び出し側が案内文を出す）', async () => {
    vi.spyOn(geocodeModule, 'geocode').mockResolvedValue([]);
    const { candidates } = await searchPlaces('ホテルハマツ', STATIONS);
    expect(candidates).toEqual([]);
  });

  it('空入力では通信しない', async () => {
    const spy = vi.spyOn(geocodeModule, 'geocode').mockResolvedValue([]);
    const { candidates } = await searchPlaces('   ', STATIONS);
    expect(candidates).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
