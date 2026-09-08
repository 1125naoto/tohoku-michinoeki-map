import { describe, expect, it } from 'vitest';
import { STATIONS } from '../../data';
import type { Station } from '../../types';
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

  it('facilities未収録の駅（対象地域が未監査）はすべて不明(null)で埋める（データを捏造しない）', () => {
    // 実データ監査済みの東北6県はfacilitiesを持つため、意図的に未収録の駅を模して検証する
    // （全国化の他地域はまだ監査していないため、この状態が実際に発生する）。
    const unaudited: Station = { ...STATIONS[0], facilities: undefined };
    const n = toNationwideStation(unaudited);
    expect(n.facilities).toEqual(UNKNOWN_FACILITIES);
  });

  it('新規フィールド(phone/closedDays/travelAreaTags)は不明(null/空)で埋める', () => {
    const n = toNationwideStation(STATIONS[0]);
    expect(n.phone).toBeNull();
    expect(n.closedDays).toBeNull();
    expect(n.travelAreaTags).toEqual([]);
  });

  it('実データ監査済みのRVパーク・温泉データ(facilities)は破棄せず変換後も引き継ぐ', () => {
    // きらら289: 実データ監査でrvPark='yes'・onsen='yes'と確定済み（data/facility-audit.json参照）。
    // 全国化変換で捏造データにも「不明」にも丸めず、実データをそのまま反映することを保証する。
    const kirara = STATIONS.find((s) => s.name === 'きらら289');
    expect(kirara).toBeDefined();
    const n = toNationwideStation(kirara!);
    expect(n.facilities.onsen).toBe(true);
    expect(n.facilities.rvPark).toBe(true);

    // しちのへ: rvPark='no'・onsen='no'（近隣に別施設のRVパークがあるが道の駅併設ではない）。
    // falseも「不明(null)」に丸めず、確認済みの不在として正しくfalseになることを保証する。
    const shichinohe = STATIONS.find((s) => s.name === 'しちのへ');
    expect(shichinohe).toBeDefined();
    const n2 = toNationwideStation(shichinohe!);
    expect(n2.facilities.onsen).toBe(false);
    expect(n2.facilities.rvPark).toBe(false);

    // 他の新設フィールド(parking/ev/restaurant/shop/stampAvailable)は東北データでは未収集のためnullのまま
    expect(n.facilities.parking).toBeNull();
    expect(n.facilities.ev).toBeNull();
    expect(n.facilities.restaurant).toBeNull();
    expect(n.facilities.shop).toBeNull();
    expect(n.facilities.stampAvailable).toBeNull();
  });

  it('未知の都道府県名は例外を投げる（壊れたデータの混入を防ぐ）', () => {
    const fake = { ...STATIONS[0], pref: '存在しない県' } as unknown as (typeof STATIONS)[number];
    expect(() => toNationwideStation(fake)).toThrow(/未知の都道府県名/);
  });
});
