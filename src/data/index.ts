import raw from './stations.json';
import type { Station, StationDataFile, Prefecture } from '../types';
import { PREFECTURES } from '../types';

const data = raw as unknown as StationDataFile;

export const STATIONS: Station[] = data.stations;
export const DATA_META = data.meta;

const byId = new Map(STATIONS.map((s) => [s.id, s]));

export function getStation(id: string): Station | undefined {
  return byId.get(id);
}

/** 県別の収録施設数（分母はデータから自動計算・ハードコード禁止） */
export function countsByPref(): Record<Prefecture, number> {
  const out = Object.fromEntries(PREFECTURES.map((p) => [p, 0])) as Record<Prefecture, number>;
  for (const s of STATIONS) out[s.pref]++;
  return out;
}

/**
 * 収録駅全体を包含する地図初期表示範囲。地域追加時にハードコードの範囲外へ
 * 駅がはみ出さないよう、駅データから動的に算出する（固定の東北範囲を使わない）。
 */
export function stationsBounds(stations: Station[]): [[number, number], [number, number]] {
  const lats = stations.map((s) => s.lat);
  const lngs = stations.map((s) => s.lng);
  return [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ];
}
