/**
 * Googleマップの「URLを開くだけ」の連携（Maps URLs）。
 * APIキー・課金は不要。https://developers.google.com/maps/documentation/urls
 */
import type { LatLng } from './geo';
import type { RoadPref, Station } from '../types';

/** 施設をGoogleマップで正確に開く: 名称+住所で検索（座標はズレ防止の中心指定に使わずクエリで特定） */
export function stationSearchUrl(st: Station): string {
  const q = `道の駅${st.name} ${st.address}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/**
 * 道路の希望 → Google Maps URLs の avoid パラメータ。
 * - highway_ok（おまかせ・早いルート）: 指定なし（Googleマップに任せる）
 * - no_tolls（有料道路を使わない）: avoid=tolls
 * - no_highway（一般道を優先）: avoid=highways,tolls（高速・有料の両方を避ける）
 */
export function avoidParam(roadPref: RoadPref): string | null {
  if (roadPref === 'no_highway') return 'highways,tolls';
  if (roadPref === 'no_tolls') return 'tolls';
  return null;
}

/**
 * 旅行中の「次の駅へナビ」用URL。
 * origin を省略すると現在地からの経路になる。名称+住所で正しい施設を特定し、
 * dir_action=navigate で（対応環境では）ナビを直接開始する。
 */
export function navToStationUrl(st: Station, roadPref: RoadPref = 'highway_ok'): string {
  const dest = `道の駅${st.name} ${st.address}`;
  let url =
    `https://www.google.com/maps/dir/?api=1` +
    `&destination=${encodeURIComponent(dest)}` +
    `&travelmode=driving&dir_action=navigate`;
  const avoid = avoidParam(roadPref);
  if (avoid) url += `&avoid=${avoid}`;
  return url;
}

/** 帰路など任意地点へのナビURL（現在地→指定座標） */
export function navToPointUrl(p: LatLng, roadPref: RoadPref = 'highway_ok'): string {
  let url =
    `https://www.google.com/maps/dir/?api=1` +
    `&destination=${p.lat.toFixed(6)},${p.lng.toFixed(6)}` +
    `&travelmode=driving&dir_action=navigate`;
  const avoid = avoidParam(roadPref);
  if (avoid) url += `&avoid=${avoid}`;
  return url;
}

/** 座標そのものを開く（フォールバック用） */
export function latLngUrl(p: LatLng): string {
  return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
}

const fmt = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

/**
 * Google Maps URLsの `waypoints` パラメータ自体は最大9地点までを公式に許容するが、
 * Astra監査P1（実機確認）でスマートフォンのGoogleマップアプリ（URLからアプリへ
 * ハンドオフされた場合）は、それより少ない経由地数で一部が無視される・アプリ側の
 * 上限に阻まれて経路が正しく開かないことが確認された。ここではモバイル実機で
 * 確実に動く値まで保守的に下げる（overengineeringな機種判定はせず、
 * 「常に安全に動く値」に統一することで挙動を一本化する）。
 */
export const MAX_WAYPOINTS = 3;

/**
 * 経路URLを生成。経由地が上限を超える場合は複数区間URLに分割する。
 * points: 出発地点 → 経由地... → 最終地点（帰着する場合は最後に出発地点を含めて渡す）
 */
export function directionsUrls(points: LatLng[], roadPref: RoadPref = 'highway_ok'): string[] {
  if (points.length < 2) return [];
  const urls: string[] = [];
  const avoid = avoidParam(roadPref);
  // 1URLに入る地点数 = origin + waypoints(≤MAX_WAYPOINTS) + destination
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
    if (avoid) url += `&avoid=${avoid}`;
    urls.push(url);
    start = end;
  }
  return urls;
}
