/**
 * 全国化対応の道の駅データモデル（Station superset）。
 * 既存の src/types.ts Station は変更しない（東北6県版はそのまま動作する）。
 * toNationwideStation() で既存Stationを非破壊的に変換できることをテストで保証する。
 */
import type { Station } from '../../types';
import { prefectureByName, type RegionId } from '../region/regions';

export const STATION_SCHEMA_VERSION = 2;

export interface StationFacilities {
  parking: boolean | null;
  ev: boolean | null;
  onsen: boolean | null;
  /**
   * 日本RV協会(JRVA)認定RVパークの併設有無（onsite/integratedのみtrue）。
   * 東北6県は実データ監査済み（tohoku-me-existing、data/facility-audit.json参照）。
   * 他地域は未収集のためnull。
   */
  rvPark: boolean | null;
  restaurant: boolean | null;
  shop: boolean | null;
  stampAvailable: boolean | null;
}

export const UNKNOWN_FACILITIES: StationFacilities = {
  parking: null,
  ev: null,
  onsen: null,
  rvPark: null,
  restaurant: null,
  shop: null,
  stampAvailable: null,
};

/**
 * 既存Station.facilities（'yes'|'no'|'unknown'）を、全国化スキーマの
 * boolean|null規約へ変換する。'unknown'およびfacilities未収録（=対象地域が
 * まだ監査されていない）はnull（不明）とし、falseに丸めない。
 */
function toTriBool(status: 'yes' | 'no' | 'unknown' | undefined): boolean | null {
  if (status === 'yes') return true;
  if (status === 'no') return false;
  return null; // 'unknown' または未収録
}

export interface NationwideStation {
  schemaVersion: typeof STATION_SCHEMA_VERSION;
  id: string;
  name: string;
  kana: string | null;
  prefecture: string;
  /** JIS X 0401 都道府県コード */
  prefectureCode: string;
  regionId: RegionId;
  /** 自由記述の旅行エリアタグ（例: "北東北", "会津"）。将来の絞り込み拡張用。Phase1では未設定でよい */
  travelAreaTags: string[];
  city: string;
  address: string;
  lat: number;
  lng: number;
  status: Station['status'];
  officialUrl: string | null;
  infoUrl: string;
  phone: string | null;
  closedDays: string | null;
  facilities: StationFacilities;
  /** データの出所（例: "mlit", "tohoku-me-manual"） */
  source: string;
  /** 出所データの更新日 (YYYY-MM-DD)。不明ならnull */
  sourceUpdatedAt: string | null;
  /** アプリ側でこの内容を確認した日 (YYYY-MM-DD) */
  lastVerifiedAt: string;
  note?: string;
}

/**
 * 既存の東北6県Stationを、全国化対応のNationwideStationへ変換する。
 * 新規フィールドは「不明」を表す null/空配列で埋め、既存データを一切破壊しない。
 * prefectureByName() が解決できない都道府県名が来た場合のみ例外にする
 * （全国化データ投入時に静かに壊れたデータが混ざるのを防ぐ）。
 */
export function toNationwideStation(s: Station): NationwideStation {
  const pref = prefectureByName(s.pref);
  if (!pref) {
    throw new Error(`未知の都道府県名です: ${s.pref}（stationId=${s.id}）`);
  }
  return {
    schemaVersion: STATION_SCHEMA_VERSION,
    id: s.id,
    name: s.name,
    kana: s.kana,
    prefecture: s.pref,
    prefectureCode: pref.code,
    regionId: pref.regionId,
    travelAreaTags: [],
    city: s.city,
    address: s.address,
    lat: s.lat,
    lng: s.lng,
    status: s.status,
    officialUrl: s.officialUrl,
    infoUrl: s.infoUrl,
    phone: null,
    closedDays: null,
    facilities: {
      ...UNKNOWN_FACILITIES,
      onsen: toTriBool(s.facilities?.onsen),
      rvPark: toTriBool(s.facilities?.rvPark),
    },
    source: 'tohoku-me-existing',
    sourceUpdatedAt: null,
    lastVerifiedAt: s.verifiedAt,
    ...(s.note !== undefined ? { note: s.note } : {}),
  };
}
