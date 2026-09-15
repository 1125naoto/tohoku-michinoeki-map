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
 * 「Googleマップで開く」CTA（周辺スポットパネル）の設計方針。
 * アプリ内のOSM/Overpass由来POIは、道の駅ナビの主目的（道の駅発見・車旅・
 * 周辺スポット発見・旅行ルート作成）に沿った「周辺に何がありそうか」の
 * 発見用途であり、Google Mapsと同等の店舗網羅性は構造上保証できない
 * （OSMの登録・タグ品質・網羅率に依存するため）。そのため大分類ボタンを
 * 押した瞬間にGoogleマップへ飛ばすのではなく、アプリ内候補表示とは別に、
 * 「さらに詳しく探したい場合はGoogleマップへ」という明確な二段構造のCTAを用意する。
 *
 * Fable 5.1 Root Cause Auditでの実機不具合（Owner iPhone QA・道の駅たまかわ）の
 * 根本原因: 以前は「キーワード + 生の緯度,経度」を1つの自由テキストとして
 * 連結してGoogleへ渡していたが（例: `飲食店 37.222832,140.418137`）、
 * Maps URLs Search actionにはその座標を検索中心として扱う公式パラメータが
 * 存在せず、Googleが自由テキストとして解釈した結果、検索地点が実際の
 * 指定座標ではなく端末の現在地扱いになっていた。座標や駅名を挟んでも
 * 「指定した地点を検索中心に固定したままカテゴリ検索する」こと自体が
 * Maps URLs公式仕様では保証できないため、query調整による対処は行わない。
 * 代わりに、CTAの役割を「Googleマップでカテゴリ検索まで代行する」から
 * 「指定した道の駅/地点を確実に開く」だけに変更し、そこから先のカテゴリ
 * 検索はGoogleマップ側の「周辺を検索」機能へ委ねる（stationSearchUrl /
 * latLngUrlという既存の正常系をそのまま再利用する）。
 */

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
 * ルート上の1地点。lat/lngは常に必須（実道路時間の計算・Googleマップの
 * フォールバック値として使う）。
 */
export interface RouteMapPoint extends LatLng {
  /** 人が読むための表示名（区間説明UI用）。省略時は座標を表示に使う */
  label?: string;
  /**
   * Googleマップへ渡す検索文字列（施設名+住所等）。指定があれば生の座標の
   *代わりにこれを使う。
   *
   * 実機不具合の根本原因: 生の座標だけを渡すと、Googleマップ側がその座標に
   * 最も近い別のPOI（駐車場の一区画等）を「その地点の名前」として表示・履歴に
   * 記録することがある（実例:「道の駅 鳥海 ふらっと」が「身障者用駐車場」と
   * 表示された）。既存の単一施設用リンク（stationSearchUrl/navToStationUrl）は
   * 既にこの形式（名称+住所のテキスト検索）を使っており問題が起きていないため、
   * 正式な住所・名称が分かっている地点（道の駅等）は同じ方式に統一する。
   * 出発地点（現在地・地図タップ等、確実な住所を持たない）はqueryを省略し、
   * 従来通り生の座標を使う。
   */
  query?: string;
}

/**
 * Google Maps URLsの `waypoints` パラメータ自体は最大9地点までを公式に許容するが、
 * Astra監査P1（実機確認）でスマートフォンのGoogleマップアプリ（URLからアプリへ
 * ハンドオフされた場合）は、それより少ない経由地数で一部が無視される・アプリ側の
 * 上限に阻まれて経路が正しく開かないことが確認された。ここではモバイル実機で
 * 確実に動く値まで保守的に下げる（overengineeringな機種判定はせず、
 * 「常に安全に動く値」に統一することで挙動を一本化する）。
 */
export const MAX_WAYPOINTS = 3;

/** 1区間分のGoogleマップURLと、UX表示用の区間説明 */
export interface DirectionsSegment {
  url: string;
  /** この区間の出発地点の表示名 */
  fromLabel: string;
  /** この区間の到着地点の表示名 */
  toLabel: string;
  /** 区間番号（1始まり） */
  index: number;
  /** 総区間数 */
  total: number;
}

const pointValue = (p: RouteMapPoint): string => p.query ?? fmt(p);
const pointLabel = (p: RouteMapPoint): string => p.label ?? fmt(p);

/**
 * 経路の区間情報を生成。経由地が上限を超える場合は複数区間に分割する。
 * points: 出発地点 → 経由地... → 最終地点（帰着する場合は最後に出発地点を含めて渡す）
 */
export function directionsSegments(points: RouteMapPoint[], roadPref: RoadPref = 'highway_ok'): DirectionsSegment[] {
  if (points.length < 2) return [];
  const chunks: RouteMapPoint[][] = [];
  // 1URLに入る地点数 = origin + waypoints(≤MAX_WAYPOINTS) + destination
  const chunkSize = MAX_WAYPOINTS + 2;
  let start = 0;
  while (start < points.length - 1) {
    const end = Math.min(start + chunkSize - 1, points.length - 1);
    chunks.push(points.slice(start, end + 1));
    start = end;
  }
  const avoid = avoidParam(roadPref);
  return chunks.map((segment, i) => {
    const origin = segment[0];
    const destination = segment[segment.length - 1];
    const waypoints = segment.slice(1, -1);
    let url =
      `https://www.google.com/maps/dir/?api=1` +
      `&origin=${encodeURIComponent(pointValue(origin))}` +
      `&destination=${encodeURIComponent(pointValue(destination))}` +
      `&travelmode=driving`;
    if (waypoints.length > 0) {
      // Google公式ドキュメントの例（waypoints=A|B|C）は地点の区切り「|」を
      // エンコードしない。以前は地点全体を1つの文字列に結合してから
      // encodeURIComponentしており「|」が「%7C」になっていた。これが原因で、
      // 実機（iPhone Googleマップアプリ）で経由地を含む区間（区間1/2等）だけ
      // 住所は表示されるが経路が開かない不具合が起きていた。
      // 地点ごとに個別にエンコードしてから、区切りは生の「|」で連結する。
      url += `&waypoints=${waypoints.map((w) => encodeURIComponent(pointValue(w))).join('|')}`;
    }
    if (avoid) url += `&avoid=${avoid}`;
    return { url, fromLabel: pointLabel(origin), toLabel: pointLabel(destination), index: i + 1, total: chunks.length };
  });
}

/** 経路URLだけが必要な場合の簡易版（区間説明が不要な呼び出し向け） */
export function directionsUrls(points: RouteMapPoint[], roadPref: RoadPref = 'highway_ok'): string[] {
  return directionsSegments(points, roadPref).map((s) => s.url);
}
