/**
 * 周辺スポット検索（Overpass API・APIキー不要）。
 *
 * 公開Overpass APIは無保証・混雑・停止の可能性があるため、routing.ts（OSRM）と
 * 同じ方針で小規模利用に抑える: 同一条件は30分以上キャッシュ・接続先ごとに
 * タイムアウト・接続先を跨いだフェイルオーバー（429/5xx/タイムアウト/通信エラー
 * で次の接続先へ）・全体の試行回数の上限・前回リクエストの中断・取得件数の上限を
 * 実装する。失敗してもアプリ全体を落とさず、呼び出し側でGoogleマップ検索へ
 * フォールバックできるようにする。
 */
import { dedupePois, normalizeOsmElement, type OsmElement, type Poi } from './poi';

/**
 * 公式に公開されている複数のOverpassインスタンス（いずれもCORS対応・実接続確認済み）。
 * 最初の接続先が429/5xx/タイムアウト/ネットワークエラーの場合、次の接続先へ切り替える。
 * 同一接続先への無制限リトライはしない（各接続先1回のみ試行）。
 */
const OVERPASS_ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 30 * 60 * 1000; // 同一条件の新鮮なキャッシュ: 30分
/** 全接続先が失敗した場合にだけ使う「最後に成功した結果」の保持期間（劣化フォールバック） */
const STALE_FALLBACK_TTL_MS = 24 * 60 * 60 * 1000;
const STALE_FALLBACK_KEY = 'tohoku-me:poi-last-ok:v1';
/** Overpass側の出力上限（サーバー負荷を抑える）。表示件数の上限は呼び出し側でさらに絞る */
const OVERPASS_ELEMENT_LIMIT = 80;
/** アプリで実際に表示する件数の上限 */
export const POI_RESULT_LIMIT = 30;

export type SearchRadiusM = 1000 | 3000 | 5000 | 10000 | 15000;
export const DEFAULT_RADIUS_M: SearchRadiusM = 3000;
export const RADIUS_CHOICES: { label: string; value: SearchRadiusM }[] = [
  { label: '1km', value: 1000 },
  { label: '3km', value: 3000 },
  { label: '5km', value: 5000 },
  { label: '10km', value: 10000 },
  { label: '15km', value: 15000 },
];

/**
 * 結果が少ない場合に自動的に検索範囲を広げる上限（実データ監査の結果、道の駅は
 * 郊外・山間部が多く3kmでは食事処等が0件になりやすいため、10kmまでは自動で広げる。
 * 15kmはユーザーが手動で選んだ場合のみ使う「必要ならさらに広げる」選択肢に留める）。
 */
export const AUTO_ESCALATE_MAX_M: SearchRadiusM = 10000;
/** この件数未満なら「少ない」とみなし自動で次の検索範囲を試す */
export const MIN_AUTO_RESULTS = 3;

interface CacheEntry {
  at: number;
  pois: Poi[];
}
const cache = new Map<string, CacheEntry>();

function cacheKey(lat: number, lng: number, radius: number): string {
  // 約10m精度に丸めてキー化（微小なGPS揺れでキャッシュを無駄にしない）
  return `${lat.toFixed(4)},${lng.toFixed(4)}:${radius}`;
}

/** テスト用にキャッシュを空にする（メモリキャッシュ・端末保存の劣化フォールバックの両方） */
export function clearPoiCache(): void {
  cache.clear();
  try {
    localStorage.removeItem(STALE_FALLBACK_KEY);
  } catch {
    /* localStorageが無い環境（テスト等）では何もしない */
  }
}

// 直前のリクエストを中断するための共通コントローラ（連打防止・前回リクエストの中断）
let inFlightController: AbortController | null = null;

/**
 * node・way・relationのすべてを対象にする（nwr）。建物や敷地として登録された
 * 施設（way/relation）も座標(center)から取得できるようにするため、node限定にしない。
 */
function buildQuery(lat: number, lng: number, radiusM: number): string {
  const around = `(around:${radiusM},${lat},${lng})`;
  return (
    `[out:json][timeout:8];` +
    `(` +
    `nwr["amenity"~"^(restaurant|cafe|fast_food|bar|pub|public_bath|foot_bath|shelter|place_of_worship)$"]${around};` +
    `nwr["tourism"~"^(attraction|viewpoint|museum|zoo|aquarium|camp_site|artwork|gallery|picnic_site|hotel|guest_house|hostel|motel)$"]${around};` +
    `nwr["leisure"~"^(park|spa)$"]${around};` +
    `nwr["natural"~"^(hot_spring|beach|waterfall|peak|cliff)$"]${around};` +
    `nwr["shop"~"^(confectionery|pastry)$"]${around};` +
    `nwr["highway"="rest_area"]${around};` +
    `);` +
    `out center body ${OVERPASS_ELEMENT_LIMIT};`
  );
}

function readStaleFallback(key: string): Poi[] | null {
  try {
    const raw = localStorage.getItem(STALE_FALLBACK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, { at: number; pois: Poi[] }>;
    const hit = parsed[key];
    if (!hit || Date.now() - hit.at > STALE_FALLBACK_TTL_MS) return null;
    return hit.pois;
  } catch {
    return null;
  }
}

function writeStaleFallback(key: string, pois: Poi[]): void {
  try {
    const raw = localStorage.getItem(STALE_FALLBACK_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, { at: number; pois: Poi[] }>) : {};
    parsed[key] = { at: Date.now(), pois };
    // 際限なく増やさない（最新10件のみ保持）
    const entries = Object.entries(parsed).sort((a, b) => b[1].at - a[1].at).slice(0, 10);
    localStorage.setItem(STALE_FALLBACK_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* localStorageが使えない/容量超過等は無視（劣化フォールバックが効かないだけで致命的ではない） */
  }
}

export interface PoiSearchResult {
  pois: Poi[];
  /** trueなら通信/解析エラーによるフォールバック（呼び出し側でGoogleマップ検索の案内を出す） */
  failed: boolean;
  /** trueなら「今回の検索」ではなく、新鮮なキャッシュまたは前回成功時の保存結果を表示している */
  fromCache: boolean;
}

/**
 * 1つの接続先へ1回だけ試行する。429/5xx/タイムアウト/通信エラーはnullを返す（例外を投げない）。
 * 接続先ごとに独立したタイムアウトを持たせるため、試行のたびに新しいAbortControllerを使う
 * （1つを使い回すと、最初の接続先のタイムアウトで以後の接続先も中断済み扱いになってしまう）。
 */
async function tryEndpoint(url: string, query: string, outerSignal?: AbortSignal): Promise<OsmElement[] | null> {
  const attemptCtrl = new AbortController();
  const onOuterAbort = () => attemptCtrl.abort();
  outerSignal?.addEventListener('abort', onOuterAbort);
  if (outerSignal?.aborted) attemptCtrl.abort();
  const timer = setTimeout(() => attemptCtrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: attemptCtrl.signal,
    });
    if (!res.ok) return null; // 429/5xx等
    const json = (await res.json()) as { elements?: OsmElement[] };
    return json.elements ?? [];
  } catch (e) {
    if (outerSignal?.aborted) throw e; // 呼び出し元の意図的な中断は次の接続先へ回さず伝播する
    return null; // ネットワークエラー・タイムアウト（この接続先だけの失敗）
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener('abort', onOuterAbort);
  }
}

/**
 * 指定地点周辺のPOIを検索する。失敗時は例外を投げず failed:true を返す
 * （アプリ全体を落とさない・呼び出し側でGoogleマップ検索へ誘導するため）。
 * 複数のOverpassインスタンスへ順に1回ずつ試行し、いずれかが成功すれば打ち切る。
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
    return { pois: hit.pois, failed: false, fromCache: true };
  }

  // 前回の検索が残っていれば中断してから新しいリクエストを開始する
  inFlightController?.abort();
  const ctrl = new AbortController();
  inFlightController = ctrl;
  const onOuterAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onOuterAbort);

  const query = buildQuery(lat, lng, radiusM);
  try {
    let elements: OsmElement[] | null = null;
    for (const url of OVERPASS_ENDPOINTS) {
      elements = await tryEndpoint(url, query, ctrl.signal);
      if (elements !== null) break; // 成功したら他の接続先は試さない（同一接続先への無制限リトライもしない）
      if (ctrl.signal.aborted) break; // 呼び出し側の意図的な中断（新しい検索の開始等）
    }

    if (elements !== null) {
      const origin = { lat, lng };
      const pois = dedupePois(
        elements.map((el) => normalizeOsmElement(el, origin)).filter((p): p is Poi => p !== null),
      )
        .sort((a, b) => a.distanceM - b.distanceM)
        .slice(0, POI_RESULT_LIMIT);
      cache.set(key, { at: Date.now(), pois });
      // 際限なく増やさない
      if (cache.size > 40) {
        const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest) cache.delete(oldest[0]);
      }
      writeStaleFallback(key, pois);
      return { pois, failed: false, fromCache: false };
    }

    // 全接続先が失敗: 前回成功時の結果があればそれを劣化フォールバックとして返す
    const stale = readStaleFallback(key);
    if (stale) return { pois: stale, failed: false, fromCache: true };
    return { pois: [], failed: true, fromCache: false };
  } finally {
    signal?.removeEventListener('abort', onOuterAbort);
    if (inFlightController === ctrl) inFlightController = null;
  }
}

export interface PoiSearchAutoResult extends PoiSearchResult {
  /** 実際に使われた検索範囲（結果が少なく自動で広げた場合はstartRadiusと異なる） */
  radiusUsed: SearchRadiusM;
}

/**
 * startRadiusで検索し、結果が少なく(MIN_AUTO_RESULTS未満)・失敗もしていない場合は
 * AUTO_ESCALATE_MAX_Mまで自動的に検索範囲を広げて再検索する（0件だからといって
 * そこで打ち切らない）。通信が失敗した場合は範囲を変えても無意味なため広げない。
 * ユーザーが最初からAUTO_ESCALATE_MAX_Mを超える範囲（15km）を選んでいた場合は、
 * それ以上は自動で広げない（明示的に選んだ範囲を勝手に超えない）。
 */
export async function searchNearbyPoisAuto(
  lat: number,
  lng: number,
  startRadius: SearchRadiusM,
  signal?: AbortSignal,
): Promise<PoiSearchAutoResult> {
  let radius = startRadius;
  let result = await searchNearbyPois(lat, lng, radius, signal);
  while (!result.failed && result.pois.length < MIN_AUTO_RESULTS && radius < AUTO_ESCALATE_MAX_M) {
    const next = RADIUS_CHOICES.find((r) => r.value > radius && r.value <= AUTO_ESCALATE_MAX_M);
    if (!next) break;
    radius = next.value;
    result = await searchNearbyPois(lat, lng, radius, signal);
  }
  return { ...result, radiusUsed: radius };
}

