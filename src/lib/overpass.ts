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
import { dedupePois, normalizeOsmElement, POI_SCHEMA_VERSION, type OsmElement, type Poi } from './poi';
import { nsKey } from './storageNamespace';

/**
 * OpenStreetMap Wikiが案内する公開Overpassインスタンス（いずれもCORS対応・実接続確認済み、2026-09時点）。
 * 最初の接続先が429/5xx/タイムアウト/ネットワークエラーの場合、次の接続先へ切り替える。
 * 同一接続先への無制限リトライはしない（各接続先1回のみ試行）。
 *
 * 優先順位は疎通確認の結果に基づく:
 *   1. overpass.private.coffee — 実接続確認済み・良好
 *   2. maps.mail.ru（VK Maps） — 実接続確認済み・良好、応答が特に速い
 *   3. overpass-api.de — 公式デフォルト。環境によっては到達しないことがあるため最終フォールバック
 * 旧 overpass.kumi.systems は private.coffee へ移行済みのため一覧から削除した。
 */
const OVERPASS_ENDPOINTS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];
/**
 * 接続先1つあたりのタイムアウト。実測（2026-09-04の実ブラウザ検証）で、成功する応答でも
 * 0.9〜8.9秒程度かかることがあったため、stagger raceで並行化した前提で余裕を持たせた。
 */
const TIMEOUT_MS = 8000;
/**
 * 接続先を並行起動する間隔（ミリ秒）。直列3本×6秒(最大18秒)だと1本目が遅い/死んでいるだけで
 * ユーザーを長時間待たせてしまうため、1本目を即開始し、STAGGER_MSごとに次を追加で開始する
 * 「stagger（時差）race」方式にする。どれか1つが最初に成功した時点で残りは中断する。
 * 全滅時の最大待ち時間は概ね (本数-1)×STAGGER_MS + TIMEOUT_MS に収まる。
 */
let STAGGER_MS = 600;
/** テスト専用: stagger間隔を変更する（実タイマーでのテストを高速化するため。本番コードからは呼ばない） */
export function __setStaggerMsForTest(ms: number): void {
  STAGGER_MS = ms;
}
const CACHE_TTL_MS = 30 * 60 * 1000; // 同一条件の新鮮なキャッシュ: 30分
/**
 * 「前回成功した結果」を劣化フォールバックとして使える期間。
 * 全滅時だけでなく、stale-while-revalidateの即時表示にも使うため、
 * 「何も出ない」を避ける目的で長めに保持する（道の駅周辺の飲食店・観光地・温泉は
 * 短期間で大きく変わるものではないため、7日程度は実用上問題にならない）。
 */
const STALE_FALLBACK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * 端末保存の前回成功結果。v2からは保存形式が {v, entries} になり、
 * 書き込んだ時点の「Poiスキーマ版 + 静的POIデータ版」が現在と一致する場合だけ再利用する。
 * （旧ビルドが保存した旧分類の結果が、新ビルドでも静的キャッシュより優先されて
 *   表示され続ける不具合を防ぐ。旧キー 'tohoku-me:poi-last-ok:v1' は読まずに削除する）
 */
const STALE_FALLBACK_KEY = nsKey('tohoku-me:poi-last-ok:v2');
const STALE_FALLBACK_LEGACY_KEYS = [nsKey('tohoku-me:poi-last-ok:v1')];

/** 保存済み結果を再利用してよい版。Poiスキーマ版と静的POIデータ版（ビルド時に埋め込み）の組 */
export function poiCacheVersion(): string {
  const data = typeof __BUILD_INFO__ !== 'undefined' ? __BUILD_INFO__.poiDataVersion : 'dev';
  return `${POI_SCHEMA_VERSION}:${data}`;
}

/** 旧ビルド由来のPoi（subcategoriesが無い）を現行の形へ補正する（表示側のフォールバックに加えた二重の安全策） */
function normalizeStoredPoi(p: Poi): Poi {
  return p.subcategories ? p : { ...p, subcategories: [p.subcategory] };
}
/**
 * 飲食(food)以外のカテゴリ（観光・温泉・宿泊等）の出力上限。実データ監査(仙台/盛岡/山形/
 * 泉中央)ではこちらが上限に達したことは無かったため、従来の値のまま維持する。
 */
const OVERPASS_ELEMENT_LIMIT = 80;
/**
 * 飲食(amenity=restaurant/cafe/fast_food/bar/pub)専用の出力上限。
 * 以前はfoodも観光等と同じ1本のクエリ・同じ80件上限を共有しており、都市部では
 * 観光施設等に押し出されてラーメン等の実在店舗がそもそもOverpassの応答に含まれない
 * ことが実データ監査で確認された(仙台駅3km圏内で80件上限に到達、食べる64件中
 * ラーメンはわずか2件)。foodを独立したクエリ・独立した上限にすることで、
 * 「取得はできたが分類で漏れる」ではなく「そもそも取得できていない」問題を解消する。
 * 上げすぎるとOverpass応答が遅くなり接続先タイムアウト(TIMEOUT_MS)に抵触するため
 * (実測: 100件で約5秒・150件で約12秒)、実用上安全な範囲に留める。
 */
const FOOD_ELEMENT_LIMIT = 100;
/** アプリで実際に表示する件数の上限（「すべて」表示のみに適用。カテゴリ/細分類を選んだ場合は絞り込み後の全件を出す） */
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
  /** trueなら食べる系(food)クエリが取得できず、当時の結果はfood系が不完全だった */
  foodIncomplete: boolean;
  /** trueなら温泉・観光等(other)クエリが取得できず、当時の結果はother系が不完全だった */
  otherIncomplete: boolean;
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
    for (const k of STALE_FALLBACK_LEGACY_KEYS) localStorage.removeItem(k);
  } catch {
    /* localStorageが無い環境（テスト等）では何もしない */
  }
}

// 直前のリクエストを中断するための共通コントローラ（連打防止・前回リクエストの中断）
let inFlightController: AbortController | null = null;

/**
 * node・way・relationのすべてを対象にする（nwr）。建物や敷地として登録された
 * 施設（way/relation）も座標(center)から取得できるようにするため、node限定にしない。
 *
 * 飲食(food)とそれ以外(other)を別クエリに分ける（下記2関数）。理由は
 * FOOD_ELEMENT_LIMITのコメントを参照。2クエリは呼び出し側で並行実行するため、
 * 体感速度は「遅い方のクエリ」に律速され、直列実行のような2倍化はしない。
 */
function buildFoodQuery(lat: number, lng: number, radiusM: number): string {
  const around = `(around:${radiusM},${lat},${lng})`;
  return (
    `[out:json][timeout:8];` +
    `nwr["amenity"~"^(restaurant|cafe|fast_food|bar|pub)$"]${around};` +
    `out center body ${FOOD_ELEMENT_LIMIT};`
  );
}

function buildOtherQuery(lat: number, lng: number, radiusM: number): string {
  const around = `(around:${radiusM},${lat},${lng})`;
  return (
    `[out:json][timeout:8];` +
    `(` +
    `nwr["amenity"~"^(public_bath|foot_bath|shelter|place_of_worship)$"]${around};` +
    `nwr["tourism"~"^(attraction|viewpoint|museum|zoo|aquarium|camp_site|artwork|gallery|picnic_site|hotel|guest_house|hostel|motel)$"]${around};` +
    `nwr["leisure"~"^(park|spa)$"]${around};` +
    `nwr["natural"~"^(hot_spring|beach|waterfall|peak|cliff)$"]${around};` +
    `nwr["shop"~"^(confectionery|pastry)$"]${around};` +
    `nwr["highway"="rest_area"]${around};` +
    `);` +
    `out center body ${OVERPASS_ELEMENT_LIMIT};`
  );
}

interface StaleFallbackStore {
  v: string;
  entries: Record<string, { at: number; pois: Poi[] }>;
}

/** 現在の版と一致する保存済みストアだけを返す。旧形式・版違いは破棄する（読まない） */
function readStaleStore(): StaleFallbackStore | null {
  try {
    for (const k of STALE_FALLBACK_LEGACY_KEYS) localStorage.removeItem(k);
    const raw = localStorage.getItem(STALE_FALLBACK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StaleFallbackStore>;
    if (!parsed || parsed.v !== poiCacheVersion() || typeof parsed.entries !== 'object' || parsed.entries === null) {
      localStorage.removeItem(STALE_FALLBACK_KEY);
      return null;
    }
    return parsed as StaleFallbackStore;
  } catch {
    return null;
  }
}

function readStaleFallback(key: string): Poi[] | null {
  const store = readStaleStore();
  const hit = store?.entries[key];
  if (!hit || Date.now() - hit.at > STALE_FALLBACK_TTL_MS) return null;
  return hit.pois.map(normalizeStoredPoi);
}

function writeStaleFallback(key: string, pois: Poi[]): void {
  try {
    const store = readStaleStore() ?? { v: poiCacheVersion(), entries: {} };
    store.entries[key] = { at: Date.now(), pois };
    // 際限なく増やさない（最新10件のみ保持）
    const entries = Object.entries(store.entries).sort((a, b) => b[1].at - a[1].at).slice(0, 10);
    localStorage.setItem(STALE_FALLBACK_KEY, JSON.stringify({ v: store.v, entries: Object.fromEntries(entries) }));
  } catch {
    /* localStorageが使えない/容量超過等は無視（劣化フォールバックが効かないだけで致命的ではない） */
  }
}

/**
 * stale-while-revalidate用: 通信を一切せず、既存のメモリキャッシュ/端末保存の
 * 前回成功結果を同期的に覗く。呼び出し側（App.tsx）は検索開始と同時にこれを表示し、
 * 裏で searchNearbyPoisAuto() の結果が届いたら置き換えることで、
 * 「何も出ない」状態を極力見せない。見つからなければnull。
 */
export function peekCachedPois(lat: number, lng: number, radiusM: SearchRadiusM): Poi[] | null {
  const key = cacheKey(lat, lng, radiusM);
  const fresh = cache.get(key);
  if (fresh) return fresh.pois;
  return readStaleFallback(key);
}

/** 1接続先ぶんの試行結果（診断表示用。DEV/検証環境限定でUIに出す想定） */
export interface EndpointAttemptLog {
  url: string;
  radiusM: number;
  /**
   * 'aborted' = 他の接続先が先に成功した、または開始前に中断された（stagger race）。
   * 'malformed' = HTTP 200だがOverpassのエラーremark(実行時エラー等)を含む、
   * またはelements配列が存在しない応答（正常な0件成功と区別するため失敗扱いにする）。
   */
  outcome: 'ok' | 'http_error' | 'timeout' | 'network_error' | 'aborted' | 'malformed';
  status?: number;
  elementCount?: number;
}

export interface PoiSearchResult {
  pois: Poi[];
  /** trueなら通信/解析エラーによるフォールバック（呼び出し側でGoogleマップ検索の案内を出す） */
  failed: boolean;
  /** trueなら「今回の検索」ではなく、新鮮なキャッシュまたは前回成功時の保存結果を表示している */
  fromCache: boolean;
  /** 各接続先への試行ログ（キャッシュヒット時は空配列）。診断表示専用で挙動には影響しない */
  attemptLog: EndpointAttemptLog[];
  /**
   * trueなら食べる(food)クエリが全滅し、food系カテゴリ(ラーメン等)の結果が
   * 欠けている可能性がある（=「周辺に無い」への断定はできない）。failed:falseでも
   * 立ちうる（片方だけ成功した部分成功のケース）。
   */
  foodIncomplete: boolean;
  /** trueなら温泉・観光等(other)クエリが全滅し、該当カテゴリの結果が欠けている可能性がある */
  otherIncomplete: boolean;
}

/**
 * 1つの接続先へ1回だけ試行する。429/5xx/タイムアウト/通信エラーはnullを返す（例外を投げない）。
 * 接続先ごとに独立したタイムアウトを持たせるため、試行のたびに新しいAbortControllerを使う
 * （1つを使い回すと、最初の接続先のタイムアウトで以後の接続先も中断済み扱いになってしまう）。
 *
 * User-Agent/RefererについてOverpassのポリシーは「呼び出し元を識別できること」を求めているが、
 * ブラウザのfetch()ではこの2つは「forbidden header」でありJSから上書きできない
 * （ブラウザが実際のUA・Referer[ページのオリジン]を自動付与する）。そのためここでは明示的に
 * 設定しない。逆に検証用スクリプト（poi_audit.py等、ブラウザではない）側では、
 * ブラウザ同様に振る舞うようUser-Agent/Refererを明示的に付与する必要がある。
 */
async function tryEndpoint(
  url: string,
  query: string,
  radiusM: number,
  outerSignal?: AbortSignal,
): Promise<{ elements: OsmElement[] | null; log: EndpointAttemptLog }> {
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
    if (!res.ok) {
      if (import.meta.env.DEV) {
        console.warn(`[overpass] ${url} → HTTP ${res.status}${res.status === 429 ? ' (rate limited)' : ''}`);
      }
      return { elements: null, log: { url, radiusM, outcome: 'http_error', status: res.status } };
    }
    const json = (await res.json()) as { elements?: unknown; remark?: unknown };
    // HTTP 200だけで成功と判定しない: Overpassはクエリのランタイムエラー
    // （例: 一部タイムアウト）等をHTTP 200 + remarkフィールドで返すことがある。
    // これを「正常応答・0件」として保存/表示すると、実際には取得できていない
    // カテゴリを「周辺に存在しない」と誤って断定してしまうため、失敗として扱う
    // （呼び出し側のstagger raceが他の接続先へフェイルオーバーする）。
    if (typeof json.remark === 'string') {
      if (import.meta.env.DEV) {
        console.warn(`[overpass] ${url} → remark(実行時エラー疑い): ${json.remark}`);
      }
      return { elements: null, log: { url, radiusM, outcome: 'malformed', status: res.status } };
    }
    if (!Array.isArray(json.elements)) {
      if (import.meta.env.DEV) {
        console.warn(`[overpass] ${url} → elements配列が無い不正な応答`, json);
      }
      return { elements: null, log: { url, radiusM, outcome: 'malformed', status: res.status } };
    }
    const elements = json.elements as OsmElement[];
    return { elements, log: { url, radiusM, outcome: 'ok', status: res.status, elementCount: elements.length } };
  } catch (e) {
    if (outerSignal?.aborted) throw e; // 呼び出し元の意図的な中断は次の接続先へ回さず伝播する
    const isTimeout = e instanceof DOMException && e.name === 'AbortError';
    if (import.meta.env.DEV) {
      console.warn(`[overpass] ${url} → ${isTimeout ? 'timeout' : 'network error'}:`, e);
    }
    return { elements: null, log: { url, radiusM, outcome: isTimeout ? 'timeout' : 'network_error' } };
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener('abort', onOuterAbort);
  }
}

/**
 * OVERPASS_ENDPOINTSをstagger race（時差並行）で試行する。1本目は即座に開始し、
 * 以降はSTAGGER_MSごとに追加で開始する。最初に成功したものを採用し、残りは
 * AbortControllerで中断する（同一接続先への無制限リトライはしない・各接続先1回のみ）。
 * 全滅した場合のみ、全接続先の試行ログとともに elements:null を返す。
 */
async function raceEndpoints(
  query: string,
  radiusM: number,
  outerSignal?: AbortSignal,
): Promise<{ elements: OsmElement[] | null; attemptLog: EndpointAttemptLog[] }> {
  const attemptLog: EndpointAttemptLog[] = [];
  const controllers = OVERPASS_ENDPOINTS.map(() => new AbortController());
  const onOuterAbort = () => controllers.forEach((c) => c.abort());
  outerSignal?.addEventListener('abort', onOuterAbort);
  if (outerSignal?.aborted) onOuterAbort();

  const runOne = (url: string, index: number) =>
    (async (): Promise<{ elements: OsmElement[] | null; log: EndpointAttemptLog }> => {
      const delay = index * STAGGER_MS;
      if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
      if (controllers[index].signal.aborted) {
        return { elements: null, log: { url, radiusM, outcome: 'aborted' } };
      }
      return tryEndpoint(url, query, radiusM, controllers[index].signal);
    })();

  return new Promise((resolve, reject) => {
    let settled = false;
    let remaining = OVERPASS_ENDPOINTS.length;
    const cleanup = () => outerSignal?.removeEventListener('abort', onOuterAbort);

    OVERPASS_ENDPOINTS.forEach((url, i) => {
      runOne(url, i)
        .then((result) => {
          attemptLog.push(result.log);
          remaining--;
          if (settled) return;
          if (result.elements !== null) {
            settled = true;
            controllers.forEach((c, j) => {
              if (j !== i) c.abort();
            });
            cleanup();
            resolve({ elements: result.elements, attemptLog });
          } else if (remaining === 0) {
            settled = true;
            cleanup();
            resolve({ elements: null, attemptLog });
          }
        })
        .catch((e: unknown) => {
          remaining--;
          if (settled) return;
          if (outerSignal?.aborted) {
            // 呼び出し元の意図的な中断（新しい検索の開始等）はそのまま上位へ伝播する
            settled = true;
            cleanup();
            reject(e as Error);
          } else if (remaining === 0) {
            settled = true;
            cleanup();
            resolve({ elements: null, attemptLog });
          }
        });
    });
  });
}

/**
 * 指定地点周辺のPOIを検索する。失敗時は例外を投げず failed:true を返す
 * （アプリ全体を落とさない・呼び出し側でGoogleマップ検索へ誘導するため）。
 * 複数のOverpassインスタンスをstagger raceで並行試行し、最初に成功したものを採用する。
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
    return {
      pois: hit.pois,
      failed: false,
      fromCache: true,
      attemptLog: [],
      foodIncomplete: hit.foodIncomplete,
      otherIncomplete: hit.otherIncomplete,
    };
  }

  // 前回の検索が残っていれば中断してから新しいリクエストを開始する
  inFlightController?.abort();
  const ctrl = new AbortController();
  inFlightController = ctrl;
  const onOuterAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onOuterAbort);

  const foodQuery = buildFoodQuery(lat, lng, radiusM);
  const otherQuery = buildOtherQuery(lat, lng, radiusM);
  try {
    // food/otherを並行実行する（直列にすると単純に2倍遅くなるため）。
    const [foodRaced, otherRaced] = await Promise.all([
      raceEndpoints(foodQuery, radiusM, ctrl.signal),
      raceEndpoints(otherQuery, radiusM, ctrl.signal),
    ]);
    const attemptLog = [...foodRaced.attemptLog, ...otherRaced.attemptLog];

    // 「今回の検索」自体を失敗扱いにするのは両方全滅した場合のみ。
    // 片方だけ成功していれば、それだけでも表示する（部分的なデータ＞何も出さない）。
    // ただしfood/otherそれぞれの取得成否は呼び出し側が追跡できるよう返す
    // （未取得カテゴリを「周辺に存在しない」と断定させないため）。
    const foodIncomplete = foodRaced.elements === null;
    const otherIncomplete = otherRaced.elements === null;
    if (foodIncomplete && otherIncomplete) {
      const stale = readStaleFallback(key);
      if (stale) return { pois: stale, failed: false, fromCache: true, attemptLog, foodIncomplete, otherIncomplete };
      return { pois: [], failed: true, fromCache: false, attemptLog, foodIncomplete, otherIncomplete };
    }

    const elements = [...(foodRaced.elements ?? []), ...(otherRaced.elements ?? [])];
    const origin = { lat, lng };
    // ここではPOI_RESULT_LIMITで絞らない。カテゴリ/細分類（例:ラーメン）ごとの
    // 絞り込みは呼び出し側（App.tsx）がこの後クライアント側で行うため、ここで
    // 全カテゴリ横断の距離順上位N件に絞ってしまうと、絞り込み前に候補が
    // 消えてしまう（実際にラーメン0件の原因の一つだったため廃止した）。
    const pois = dedupePois(
      elements.map((el) => normalizeOsmElement(el, origin)).filter((p): p is Poi => p !== null),
    ).sort((a, b) => a.distanceM - b.distanceM);
    cache.set(key, { at: Date.now(), pois, foodIncomplete, otherIncomplete });
    // 際限なく増やさない
    if (cache.size > 40) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) cache.delete(oldest[0]);
    }
    // food/otherの片方でも不完全だった場合、その欠けた結果を「前回成功時の
    // 保存結果」として劣化フォールバックに書き込まない（完全な既存の保存結果を
    // 不完全なデータで上書きして壊さないため）。
    if (!foodIncomplete && !otherIncomplete) writeStaleFallback(key, pois);
    return { pois, failed: false, fromCache: false, attemptLog, foodIncomplete, otherIncomplete };
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
  const attemptLog = [...result.attemptLog];
  while (!result.failed && result.pois.length < MIN_AUTO_RESULTS && radius < AUTO_ESCALATE_MAX_M) {
    const next = RADIUS_CHOICES.find((r) => r.value > radius && r.value <= AUTO_ESCALATE_MAX_M);
    if (!next) break;
    radius = next.value;
    result = await searchNearbyPois(lat, lng, radius, signal);
    attemptLog.push(...result.attemptLog);
  }
  return { ...result, attemptLog, radiusUsed: radius };
}

