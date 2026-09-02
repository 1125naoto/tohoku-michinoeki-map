/**
 * Googleマップの「URLを開くだけ」の連携（Maps URLs）。
 * APIキー・課金は不要。https://developers.google.com/maps/documentation/urls
 */
import type { LatLng } from './geo';
import type { Station } from '../types';

/** 施設をGoogleマップで正確に開く: 名称+住所で検索（座標はズレ防止の中心指定に使わずクエリで特定） */
export function stationSearchUrl(st: Station): string {
  const q = `道の駅${st.name} ${st.address}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/** 座標そのものを開く（フォールバック用） */
export function latLngUrl(p: LatLng): string {
  return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
}

const fmt = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

/** Google Maps URLs の経由地上限（origin/destinationを除く waypoints） */
export const MAX_WAYPOINTS = 9;

/**
 * 経路URLを生成。経由地が上限を超える場合は複数区間URLに分割する。
 * points: 出発地点 → 経由地... → 最終地点（帰着する場合は最後に出発地点を含めて渡す）
 */
export function directionsUrls(points: LatLng[]): string[] {
  if (points.length < 2) return [];
  const urls: string[] = [];
  // 1URLに入る地点数 = origin + waypoints(≤9) + destination = 11
  const chunkSize = MAX_WAYPOINTS + 2;
  let start = 0;
  while (start < points.length - 1) {
    const end = Math.min(start + chunkSize - 1, points.length - 1);
    const segment = points.slice(start, end + 1);
    const origin = segment[0];
    const destination = segment[segment.length - 1];
    const waypoints = segment.slice(1, -1);
    let url =
      `https://www.google.com/maps/dir/?api=1` +
      `&origin=${encodeURIComponent(fmt(origin))}` +
      `&destination=${encodeURIComponent(fmt(destination))}` +
      `&travelmode=driving`;
    if (waypoints.length > 0) {
      url += `&waypoints=${encodeURIComponent(waypoints.map(fmt).join('|'))}`;
    }
    urls.push(url);
    start = end;
  }
  return urls;
}
