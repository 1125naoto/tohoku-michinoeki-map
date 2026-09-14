/**
 * 道の駅ごとに事前生成された周辺スポットの静的キャッシュ（public/data/poi/<stationId>.json）。
 * scripts/fetch_poi_cache.py がOverpassから事前取得し、GitHub Pagesの一部として同梱・配信される。
 *
 * ユーザーのスマホが毎回Overpass公開APIの生死に依存する構造を避けるため、
 * 道の駅起点の検索ではこれを最優先で即時表示し、裏でOverpassへの再検証（より新しい
 * データへの更新）を試みる。静的ファイルはGitHub Pages自体から配信されるため、
 * Overpass公開ミラーの瞬間的な不調とは無関係に、常に同程度の可用性で読み込める。
 */
import { CATEGORY_LABEL, SUBCATEGORY_LABEL, type Poi } from './poi';

/** 静的JSON取得の上限（overpass.tsのTIMEOUT_MSと同一値。GitHub Pages配信でも
 * 端末の回線状況によっては応答が返らないことがあるため、無期限に待たせない） */
const STATIC_FETCH_TIMEOUT_MS = 8000;

const VALID_CATEGORIES = new Set(Object.keys(CATEGORY_LABEL));
const VALID_SUBCATEGORIES = new Set(Object.keys(SUBCATEGORY_LABEL));

function isHttpUrl(v: unknown): v is string {
  return typeof v === 'string' && (v.startsWith('https://') || v.startsWith('http://'));
}

export interface StaticPoiCacheFile {
  stationId: string;
  lat: number;
  lng: number;
  radiusM: number;
  /** scripts/fetch_poi_cache.py が生成した日時（ISO文字列） */
  generatedAt: string;
  pois: Poi[];
  /**
   * 以下はPhase 11（全国POI static cache生成）で追加した後方互換フィールド。
   * 旧ビルド時代に生成されたファイルには存在しない場合があるため、すべて省略可能とし、
   * 読み込み側（loadStaticPoiCache）はこれらの有無にかかわらず動作すること。
   */
  /** 生成時点のPoiスキーマ版（src/lib/poi.ts の POI_SCHEMA_VERSION） */
  schemaVersion?: number;
  source?: 'overpass';
  /** 生成スクリプトのクエリ構造の版（v1=単一クエリ、v2=food/other分離） */
  queryVersion?: number;
  /**
   * 'ok' = food/otherとも正常応答（0件の場合を含む、本当にAPIから取得できた結果）。
   * 'partial' = food/otherの片方のみ取得できた（Astra監査P1で追加。foodIncomplete/
   * otherIncompleteで詳細を判定する）。ファイルが存在すること自体が「少なくとも
   * 片方は取得成功」を意味するため、両方とも本当に失敗した駅はそもそもファイルが
   * 生成されない（0件を装った偽の成功結果を作らない）。
   * このフィールド自体が無い（旧生成ファイル）場合は 'ok' 相当として扱ってよい。
   */
  status?: 'ok' | 'partial';
  /** trueならfood(食べる)系カテゴリの取得が不完全だった（省略時はfalse相当） */
  foodIncomplete?: boolean;
  /** trueならother(観光・温泉等)系カテゴリの取得が不完全だった（省略時はfalse相当） */
  otherIncomplete?: boolean;
  /** 実際に応答を返した接続先（診断用） */
  endpointsUsed?: string[];
}

/**
 * 1件のPOI要素が最低限信頼できる形かを検証する（旧ビルド/破損JSON/将来の
 * スキーマ変更由来の不正な要素がUIを壊さないようにするため）。id/category/
 * subcategory/座標/distanceMのいずれかが欠けている・型が違う要素は捨てる
 * （1件の不正で全体の表示を諦めない）。sourceUrl/websiteはhttp(s)以外の
 * スキーム（javascript: 等）を許さず、その場合はnullへ落とす（HTML属性へ
 * そのまま渡されるため。src/components/PoiDetailSheet.tsx参照）。
 */
function sanitizePoi(raw: unknown): Poi | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.id !== 'string' || !p.id) return null;
  if (typeof p.category !== 'string' || !VALID_CATEGORIES.has(p.category)) return null;
  if (typeof p.subcategory !== 'string' || !VALID_SUBCATEGORIES.has(p.subcategory)) return null;
  if (typeof p.lat !== 'number' || !Number.isFinite(p.lat)) return null;
  if (typeof p.lng !== 'number' || !Number.isFinite(p.lng)) return null;
  if (typeof p.distanceM !== 'number' || !Number.isFinite(p.distanceM)) return null;
  const subcategories = Array.isArray(p.subcategories)
    ? (p.subcategories.filter((s): s is string => typeof s === 'string' && VALID_SUBCATEGORIES.has(s)) as Poi['subcategories'])
    : undefined;
  return {
    id: p.id,
    category: p.category as Poi['category'],
    subcategory: p.subcategory as Poi['subcategory'],
    subcategories: (subcategories && subcategories.length > 0 ? subcategories : [p.subcategory]) as Poi['subcategories'],
    name: typeof p.name === 'string' ? p.name : null,
    lat: p.lat,
    lng: p.lng,
    address: typeof p.address === 'string' ? p.address : null,
    openingHoursRaw: typeof p.openingHoursRaw === 'string' ? p.openingHoursRaw : null,
    phone: typeof p.phone === 'string' ? p.phone : null,
    website: isHttpUrl(p.website) ? p.website : null,
    distanceM: p.distanceM,
    source: 'overpass',
    sourceUrl: isHttpUrl(p.sourceUrl) ? p.sourceUrl : '',
  };
}

/**
 * 指定駅の静的POIキャッシュを読み込む。未生成（404）・形式不正・通信不可・
 * タイムアウト・呼び出し側の中断（signal）はすべてnull
 * （呼び出し側でOverpass検索やフォールバックに進めるよう、例外は投げない）。
 */
export async function loadStaticPoiCache(stationId: string, outerSignal?: AbortSignal): Promise<StaticPoiCacheFile | null> {
  const ctrl = new AbortController();
  const onOuterAbort = () => ctrl.abort();
  outerSignal?.addEventListener('abort', onOuterAbort);
  if (outerSignal?.aborted) ctrl.abort();
  const timer = setTimeout(() => ctrl.abort(), STATIC_FETCH_TIMEOUT_MS);
  try {
    const base = import.meta.env.BASE_URL;
    const res = await fetch(`${base}data/poi/${stationId}.json`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<StaticPoiCacheFile> | null;
    if (!data || typeof data !== 'object') return null;
    // stationIdは要求した駅と一致することを確認する（別駅のデータやキャッシュ
    // 破損を、要求した駅の結果として誤って表示しないため）。
    if (data.stationId !== stationId) return null;
    if (typeof data.lat !== 'number' || !Number.isFinite(data.lat)) return null;
    if (typeof data.lng !== 'number' || !Number.isFinite(data.lng)) return null;
    if (typeof data.radiusM !== 'number' || !Number.isFinite(data.radiusM) || data.radiusM <= 0) return null;
    if (typeof data.generatedAt !== 'string' || Number.isNaN(Date.parse(data.generatedAt))) return null;
    if (!Array.isArray(data.pois)) return null;
    const pois = data.pois.map(sanitizePoi).filter((p): p is Poi => p !== null);
    return { ...data, stationId, lat: data.lat, lng: data.lng, radiusM: data.radiusM, generatedAt: data.generatedAt, pois };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener('abort', onOuterAbort);
  }
}
