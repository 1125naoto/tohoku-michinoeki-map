import { describe, expect, it } from 'vitest';
import { STATIONS } from '../../data';
import { toNationwideStation, UNKNOWN_FACILITIES } from './nationwideStation';

describe('toNationwideStation', () => {
  it('実データ182施設すべてを例外なく変換できる（既存データとの互換性の実証）', () => {
    for (const s of STATIONS) {
      expect(() => toNationwideStation(s)).not.toThrow();
    }
  });

  it('id/name/lat/lngなど既存フィールドをそのまま保持する', () => {
    const s = STATIONS[0];
    const n = toNationwideStation(s);
    expect(n.id).toBe(s.id);
    expect(n.name).toBe(s.name);
    expect(n.lat).toBe(s.lat);
    expect(n.lng).toBe(s.lng);
    expect(n.status).toBe(s.status);
  });

  it('都道府県から正しいprefectureCode/regionIdを解決する', () => {
    const aomori = STATIONS.find((s) => s.pref === '青森県');
    expect(aomori).toBeDefined();
    const n = toNationwideStation(aomori!);
    expect(n.prefectureCode).toBe('02');
    expect(n.regionId).toBe('tohoku');
  });

  it('新規フィールドは不明(null/空)で埋める（データを捏造しない）', () => {
    const n = toNationwideStation(STATIONS[0]);
    expect(n.facilities).toEqual(UNKNOWN_FACILITIES);
    expect(n.phone).toBeNull();
    expect(n.closedDays).toBeNull();
    expect(n.travelAreaTags).toEqual([]);
  });

  it('未知の都道府県名は例外を投げる（壊れたデータの混入を防ぐ）', () => {
    const fake = { ...STATIONS[0], pref: '存在しない県' } as unknown as (typeof STATIONS)[number];
    expect(() => toNationwideStation(fake)).toThrow(/未知の都道府県名/);
  });
});
