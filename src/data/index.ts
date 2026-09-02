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

export const TOHOKU_BOUNDS: [[number, number], [number, number]] = [
  [36.7, 139.0],
  [41.7, 142.3],
];
