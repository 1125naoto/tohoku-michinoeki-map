/**
 * 周辺スポット検索（Overpass API・APIキー不要）。
 *
 * 公開Overpass APIは無保証・混雑・停止の可能性があるため、routing.ts（OSRM）と
 * 同じ方針で小規模利用に抑える: 同一条件は30分以上キャッシュ・タイムアウト・
 * 再試行1回・前回リクエストの中断・取得件数の上限を実装する。失敗してもアプリ
 * 全体を落とさず、呼び出し側でGoogleマップ検索へフォールバックできるようにする。
 */
import { normalizeOsmElement, type OsmElement, type Poi } from './poi';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30分以上
/** Overpass側の出力上限（サーバー負荷を抑える）。表示件数の上限は呼び出し側でさらに絞る */
const OVERPASS_ELEMENT_LIMIT = 80;
/** アプリで実際に表示する件数の上限 */
export const POI_RESULT_LIMIT = 30;

export type SearchRadiusM = 1000 | 3000 | 5000 | 10000;
export const DEFAULT_RADIUS_M: SearchRadiusM = 3000;
export const RADIUS_CHOICES: { label: string; value: SearchRadiusM }[] = [
  { label: '1km', value: 1000 },
  { label: '3km', value: 3000 },
  { label: '5km', value: 5000 },
  { label: '10km', value: 10000 },
];

interface CacheEntry {
  at: number;
  pois: Poi[];
}
const cache = new Map<string, CacheEntry>();

function cacheKey(lat: number, lng: number, radius: number): string {
  // 約10m精度に丸めてキー化（微小なGPS揺れでキャッシュを無駄にしない）
  return `${lat.toFixed(4)},${lng.toFixed(4)}:${radius}`;
}

/** テスト用にキャッシュを空にする */
export function clearPoiCache(): void {
  cache.clear();
}

// 直前のリクエストを中断するための共通コントローラ（連打防止・前回リクエストの中断）
let inFlightController: AbortController | null = null;

function buildQuery(lat: number, lng: number, radiusM: number): string {
  const around = `(around:${radiusM},${lat},${lng})`;
  return (
    `[out:json][timeout:8];` +
    `(` +
    `node["amenity"~"^(restaurant|cafe|fast_food|bar|pub|public_bath|foot_bath|shelter|place_of_worship)$"]${around};` +
    `node["tourism"~"^(attraction|viewpoint|museum|zoo|aquarium|camp_site|artwork|gallery|picnic_site)$"]${around};` +
    `node["leisure"~"^(park|spa)$"]${around};` +
    `node["natural"~"^(hot_spring|beach|waterfall|peak|cliff)$"]${around};` +
    `node["shop"~"^(confectionery|pastry)$"]${around};` +
    `way["highway"="rest_area"]${around};` +
    `);` +
    `out center body ${OVERPASS_ELEMENT_LIMIT};`
  );
}

export interface PoiSearchResult {
  pois: Poi[];
  /** trueなら通信/解析エラーによるフォールバック（呼び出し側でGoogleマップ検索の案内を出す） */
  failed: boolean;
}

/**
 * 指定地点周辺のPOIを検索する。失敗時は例外を投げず failed:true を返す
 * （アプリ全体を落とさない・呼び出し側でGoogleマップ検索へ誘導するため）。
 */
export async function searchNearbyPois(
  lat: number,
  lng: number,
  radiusM: SearchRadiusM,
  signal?: AbortSignal,
): Promise<PoiSearchResult> {
  const key = cacheKey(lat, lng, radiusM);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at <= CACHE_TTL_MS) {
    return { pois: hit.pois, failed: false };
  }

  // 前回の検索が残っていれば中断してから新しいリクエストを開始する
  inFlightController?.abort();
  const ctrl = new AbortController();
  inFlightController = ctrl;
  const onOuterAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onOuterAbort);

  const query = buildQuery(lat, lng, radiusM);
  let lastErr: unknown;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(OVERPASS_URL, {
          method: 'POST',
          body: `data=${encodeURIComponent(query)}`,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { elements?: OsmElement[] };
        const origin = { lat, lng };
        const pois = (json.elements ?? [])
          .map((el) => normalizeOsmElement(el, origin))
          .filter((p): p is Poi => p !== null)
          .sort((a, b) => a.distanceM - b.distanceM)
          .slice(0, POI_RESULT_LIMIT);
        cache.set(key, { at: Date.now(), pois });
        // 際限なく増やさない
        if (cache.size > 40) {
          const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
          if (oldest) cache.delete(oldest[0]);
        }
        return { pois, failed: false };
      } catch (e) {
        lastErr = e;
        if (signal?.aborted) throw e; // 呼び出し側の意図的な中断は再試行しない（連打防止）
      } finally {
        clearTimeout(timer);
      }
    }
  } finally {
    signal?.removeEventListener('abort', onOuterAbort);
    if (inFlightController === ctrl) inFlightController = null;
  }
  if (signal?.aborted) throw lastErr; // 呼び出し元へ中断を伝える（結果を上書きしない）
  return { pois: [], failed: true };
}
