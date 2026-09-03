/**
 * 実道路ルーティング層。
 *
 * 採用: OSRM 公開デモサーバー (router.project-osrm.org)
 *  - APIキー不要 / CORS可 / table(所要時間行列)・route(経路形状)対応 / OSMベースで日本の道路網に対応
 *  - 利用規約は「無保証・常識的な軽負荷利用」。そのため
 *      * 1回のコース作成につき table 1リクエスト（地点数は出発地+最大22駅に制限）
 *      * 経路形状は表示時のみ route 1リクエスト
 *      * 同一条件は30分キャッシュ / タイムアウト8秒 / 再試行1回 / AbortControllerで中断可能
 *  - 高速道路・有料道路の回避はデモサーバーでは指定不可（セルフホスト+プロファイルが必要）。
 *    回避条件はGoogleマップURL側にのみ反映し、アプリ内では「反映済み」と偽らない。
 *  - リアルタイム渋滞は含まれない（UIに明記）。
 *
 * RoutingProvider インターフェースで抽象化してあり、将来
 * セルフホストOSRM / Google Routes API 等へ差し替え可能。
 */
import type { LatLng } from './geo';

export interface RouteMatrix {
  /** [i][j] = 地点i→jの所要時間（分）。0番目は出発地点 */
  durationsMin: number[][];
  /** [i][j] = 距離（km） */
  distancesKm: number[][];
}

export interface RouteShape {
  /** [lat, lng] の列 */
  points: [number, number][];
  durationMin: number;
  distanceKm: number;
}

export interface RoutingProvider {
  readonly name: string;
  table(points: LatLng[], signal?: AbortSignal): Promise<RouteMatrix>;
  route(points: LatLng[], signal?: AbortSignal): Promise<RouteShape>;
}

const OSRM_BASE = 'https://router.project-osrm.org';
const TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 30 * 60 * 1000;

// ---- キャッシュ（同一地点集合・同一種別の結果を保持）----
const cache = new Map<string, { at: number; value: unknown }>();

function cacheKey(kind: string, points: LatLng[]): string {
  // 座標を約10m精度に丸めてキー化（微小なGPS揺れでキャッシュを無駄にしない）
  return kind + ':' + points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join(';');
}

function cacheGet<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value as T;
}

function cachePut(key: string, value: unknown): void {
  cache.set(key, { at: Date.now(), value });
  // 際限なく増やさない
  if (cache.size > 40) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
}

/** タイムアウト+外部Abort対応のfetch（再試行1回） */
async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const onOuter = () => ctrl.abort();
    signal?.addEventListener('abort', onOuter);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (signal?.aborted) throw e; // 呼び出し側の中断は再試行しない
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onOuter);
    }
  }
  throw lastErr;
}

const coordStr = (points: LatLng[]) => points.map((p) => `${p.lng},${p.lat}`).join(';');

export const osrmProvider: RoutingProvider = {
  name: 'osrm-demo',

  async table(points: LatLng[], signal?: AbortSignal): Promise<RouteMatrix> {
    const key = cacheKey('table', points);
    const hit = cacheGet<RouteMatrix>(key);
    if (hit) return hit;
    const url = `${OSRM_BASE}/table/v1/driving/${coordStr(points)}?annotations=duration,distance`;
    const json = (await fetchJson(url, signal)) as {
      code?: string;
      durations?: (number | null)[][];
      distances?: (number | null)[][];
    };
    if (json.code !== 'Ok' || !json.durations || !json.distances) {
      throw new Error(`OSRM table failed: ${json.code}`);
    }
    const n = points.length;
    const durationsMin: number[][] = [];
    const distancesKm: number[][] = [];
    for (let i = 0; i < n; i++) {
      durationsMin.push([]);
      distancesKm.push([]);
      for (let j = 0; j < n; j++) {
        const d = json.durations[i]?.[j];
        const m = json.distances[i]?.[j];
        durationsMin[i].push(d == null ? Number.POSITIVE_INFINITY : d / 60);
        distancesKm[i].push(m == null ? Number.POSITIVE_INFINITY : m / 1000);
      }
    }
    const result = { durationsMin, distancesKm };
    cachePut(key, result);
    return result;
  },

  async route(points: LatLng[], signal?: AbortSignal): Promise<RouteShape> {
    const key = cacheKey('route', points);
    const hit = cacheGet<RouteShape>(key);
    if (hit) return hit;
    const url = `${OSRM_BASE}/route/v1/driving/${coordStr(points)}?overview=full&geometries=geojson&steps=false`;
    const json = (await fetchJson(url, signal)) as {
      code?: string;
      routes?: { duration: number; distance: number; geometry: { coordinates: [number, number][] } }[];
    };
    const r = json.routes?.[0];
    if (json.code !== 'Ok' || !r) throw new Error(`OSRM route failed: ${json.code}`);
    const result: RouteShape = {
      points: r.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]),
      durationMin: r.duration / 60,
      distanceKm: r.distance / 1000,
    };
    cachePut(key, result);
    return result;
  },
};

/** テスト用にキャッシュを空にする */
export function clearRoutingCache(): void {
  cache.clear();
}
