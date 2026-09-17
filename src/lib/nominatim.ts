/**
 * 施設名検索: OpenStreetMap Nominatim（無料・APIキー不要）。
 *
 * 国土地理院の住所検索APIは住所・地名の索引しか持たず、IC・駅・ホテル等の施設名では
 * 目的地に到達できない（「郡山IC」→ 無関係な大字「郡山」が返る）ことを実応答で確認した。
 * 一方Nominatimは同じ語で施設そのものを返せる（実測）:
 *   郡山IC → 郡山IC（東北自動車道・福島県郡山市, motorway_junction）
 *   郡山駅 → 郡山（駅・福島県郡山市）／秋田駅 → 秋田駅
 *   鶴ヶ城 → 鶴ヶ城（会津若松市）／ホテルメトロポリタン秋田 → 該当ホテル
 *
 * 公開インスタンスの利用条件（OSMF Nominatim Usage Policy）に合わせる:
 * - 1リクエスト/秒を超えない → 本ファイルで1.5秒間隔に制限する
 * - オートコンプリート禁止 → 入力中は呼ばず、検索ボタンを押したときだけ呼ぶ
 * - 大量・機械的な問い合わせ禁止 → 件数を絞り、1回の操作につき1リクエスト
 * - 出典表示が必要 → 検索結果の下に「© OpenStreetMap contributors」を出す
 * - UAはブラウザからは変更できないが、Refererでアプリを識別できる
 * ブラウザから直接呼べることも確認済み（access-control-allow-origin: * / OPTIONS 204）。
 *
 * 失敗しても呼び出し側は住所検索・道の駅・地図指定で続行できる（例外は投げず空を返す）。
 */
export interface NominatimPlace {
  /** 施設名など（display_nameの先頭要素） */
  name: string;
  /** 所在地の説明（名前を除いた残り） */
  address: string | null;
  lat: number;
  lng: number;
  /** OSMの種別（station / motorway_junction / hotel など。表示・並べ替えに使う） */
  kind: string | null;
  /** OSMの大分類（highway / railway / tourism など。addressdetails=1で得られるcategory） */
  category: string | null;
  /** 都道府県（address.province）。取得できなければnull */
  prefecture: string | null;
  /** 市区町村（address.city / town / village のいずれか）。取得できなければnull */
  city: string | null;
  /** 路線・道路名（address.road）。ICなら「東北自動車道」等 */
  road: string | null;
}

/**
 * 道路施設の表記ゆれを内部の検索語だけ正規化する（画面の入力文字は書き換えない）。
 * OSMの施設名は「郡山IC」のようにIC表記なので、「インターチェンジ」「インター」で
 * 入力されると一致しない（実測: 「郡山インターチェンジ」はNominatimで0件）。
 * 固有名詞の辞書は作らず、一般的な語尾の言い換えだけを扱う。
 */
export function normalizeFacilityQuery(query: string): string {
  return query
    .replace(/インターチェンジ/g, 'IC')
    .replace(/インター(?!ネット)/g, 'IC')
    .replace(/ジャンクション/g, 'JCT')
    .replace(/パーキングエリア/g, 'PA')
    .replace(/サービスエリア/g, 'SA');
}

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const MIN_INTERVAL_MS = 1500;
const LIMIT = 5;
/** 同じ検索語を短時間に繰り返し投げないためのキャッシュ保持時間 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 50;

/**
 * 施設名検索そのものを止められるスイッチ。
 * 公開インスタンス側の障害・制限時に、アプリを壊さず名称検索だけを切れるようにしておく
 * （offにしても住所検索・道の駅名検索・「地図で選ぶ」で地点指定は続けられる）。
 */
export const FACILITY_SEARCH_ENABLED = true;

/**
 * 直列化キュー。
 * 以前は各リクエストが「前回時刻」を見てからsleepしていたため、同時に2本
 * （元の語と正規化した語）を投げると両方が同じ待ち時間を計算して**ほぼ同時に発射**していた。
 * ここでは前の処理が終わるまで次を始めない鎖にし、公開インスタンスへの同時アクセスを防ぐ。
 */
let queue: Promise<unknown> = Promise.resolve();
let lastCall = 0;

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  // 失敗しても鎖を切らない（次のリクエストが実行できなくなるのを防ぐ）
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const cache = new Map<string, { at: number; places: NominatimPlace[] }>();

function readCache(q: string): NominatimPlace[] | null {
  const hit = cache.get(q);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(q);
    return null;
  }
  return hit.places;
}

function writeCache(q: string, places: NominatimPlace[]): void {
  cache.set(q, { at: Date.now(), places });
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * 施設名・地名で検索する。日本国内に限定し、最大5件。
 * 呼び出しは「検索」ボタン押下時のみ（入力のたびに呼ばない）。
 */
export async function searchPlacesByName(query: string): Promise<NominatimPlace[]> {
  const q = query.trim();
  if (!q) return [];

  if (!FACILITY_SEARCH_ENABLED) return [];

  const normalized = normalizeFacilityQuery(q);
  if (normalized !== q) {
    // 「郡山インターチェンジ」等はOSMの施設名（郡山IC）と一致しないため、正規化した語でも引く。
    // 並列ではなく順番に流す（公開インスタンスへ同時に2本投げない）。
    const original = await requestNominatim(q);
    const viaNormalized = await requestNominatim(normalized).catch(() => [] as NominatimPlace[]);
    const seen = new Set(original.map((p) => `${p.lat},${p.lng}`));
    return [...original, ...viaNormalized.filter((p) => !seen.has(`${p.lat},${p.lng}`))];
  }
  return requestNominatim(q);
}

/** 1回分の問い合わせ（直列キュー＋最低間隔＋同一語キャッシュ） */
async function requestNominatim(q: string): Promise<NominatimPlace[]> {
  const cached = readCache(q);
  if (cached) return cached;
  return enqueue(async () => {
    const again = readCache(q); // 順番待ちの間に同じ語が取得済みになっていれば再利用する
    if (again) return again;
    const places = await requestNominatimNow(q);
    writeCache(q, places);
    return places;
  });
}

async function requestNominatimNow(q: string): Promise<NominatimPlace[]> {
  const wait = Math.max(0, lastCall + MIN_INTERVAL_MS - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();

  const url =
    `${ENDPOINT}?format=jsonv2&addressdetails=1&dedupe=1&countrycodes=jp&accept-language=ja` +
    `&limit=${LIMIT}&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`施設検索に失敗しました (HTTP ${res.status})`);
  const json: unknown = await res.json();
  if (!Array.isArray(json)) return [];

  const out: NominatimPlace[] = [];
  for (const raw of json) {
    if (!isRecord(raw)) continue;
    const lat = Number(raw.lat);
    const lng = Number(raw.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const display = typeof raw.display_name === 'string' ? raw.display_name : '';
    const parts = display
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const name = typeof raw.name === 'string' && raw.name ? raw.name : (parts[0] ?? q);
    // 名前と重複する先頭要素・末尾の「日本」「郵便番号」は所在地表示から省く
    const rest = parts
      .slice(parts[0] === name ? 1 : 0)
      .filter((p) => p !== '日本' && !/^\d{3}-\d{4}$/.test(p));
    const addr = isRecord(raw.address) ? raw.address : {};
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
    out.push({
      name,
      address: rest.length > 0 ? rest.join(' ') : null,
      lat,
      lng,
      kind: str(raw.type),
      category: str(raw.category),
      prefecture: str(addr.province) ?? str(addr.state),
      city: str(addr.city) ?? str(addr.town) ?? str(addr.village) ?? str(addr.county),
      road: str(addr.road),
    });
  }
  return out;
}
