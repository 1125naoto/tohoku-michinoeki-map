/**
 * 距離・所要時間の概算モデル。
 * APIキー不要で動かすため、直線距離に道路補正係数を掛けた概算を使う。
 * 概算であることは必ずUIに明示する（planner.ts / RouteResults 参照）。
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const R = 6371.0088; // 地球平均半径 km

/** 2点間の大円距離 (km) */
export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** 直線距離 → 道路距離の補正係数（東北の一般道・山間部を考慮してやや大きめ） */
export const ROAD_FACTOR = 1.35;

/** 想定平均速度 km/h（信号・市街地・休憩を織り込んだ実効値） */
export const SPEED_GENERAL = 40;
export const SPEED_HIGHWAY = 60;

/** 1区間ごとの固定バッファ（分）: 駐車・出入り・小休止 */
export const LEG_BUFFER_MIN = 5;

/** 冬季(11〜3月)の割増係数（積雪・凍結を考慮） */
export const WINTER_FACTOR = 1.2;

/** 概算道路距離 (km) */
export function roadDistanceKm(a: LatLng, b: LatLng): number {
  return haversineKm(a, b) * ROAD_FACTOR;
}

export function isWinter(date: Date): boolean {
  const m = date.getMonth() + 1;
  return m >= 11 || m <= 3;
}

/**
 * 区間の概算所要時間（分）。
 * - 直線距離×1.35 を道路距離とみなす
 * - 高速利用時は長距離区間ほど速度が上がる
 * - 冬季は2割増し
 * - 1区間あたり固定バッファ5分
 */
export function estimateLegMin(a: LatLng, b: LatLng, useHighway: boolean, departAt: Date): number {
  const km = roadDistanceKm(a, b);
  let speed = SPEED_GENERAL;
  if (useHighway && km >= 20) {
    // 長い区間ほど高速道路の恩恵が大きいと仮定
    speed = km >= 50 ? SPEED_HIGHWAY : 50;
  }
  let min = (km / speed) * 60;
  if (isWinter(departAt)) min *= WINTER_FACTOR;
  return Math.ceil(min + LEG_BUFFER_MIN);
}

/** 分 → 「◯時間◯分」 */
export function formatMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m}分`;
  if (m === 0) return `${h}時間`;
  return `${h}時間${m}分`;
}

/** Date → "HH:MM" */
export function formatHM(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
