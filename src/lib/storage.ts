/**
 * localStorage への永続化。
 * - マスターデータ(駅一覧)とユーザー記録を完全分離（記録は駅IDのみ参照）
 * - 壊れたデータを読んでもアプリを落とさない（バックアップ退避して空で継続）
 * - v1(status+stampフラグ) → v2(相互排他のstate) へ自動移行。v1データは消さずに残す
 */
import type { SavedRoute, StationState, TripState, VisitMap, VisitRecord } from '../types';
import { nsKey } from './storageNamespace';

export const KEYS = {
  visits: nsKey('tohoku-me:visits:v2'),
  routes: nsKey('tohoku-me:routes:v1'),
  trip: nsKey('tohoku-me:trip:v1'),
} as const;

/** 旧形式（〜d6dc4af）の訪問記録キー。移行後もバックアップとして残す */
export const LEGACY_VISITS_KEY = nsKey('tohoku-me:visits:v1');

function getStore(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** 安全にJSONを読む。壊れていたら .corrupt へ退避して fallback を返す */
export function safeLoad<T>(key: string, validate: (v: unknown) => v is T, fallback: T): T {
  const store = getStore();
  if (!store) return fallback;
  let raw: string | null = null;
  try {
    raw = store.getItem(key);
  } catch {
    return fallback;
  }
  if (raw == null) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (validate(parsed)) return parsed;
    throw new Error('validation failed');
  } catch {
    try {
      store.setItem(`${key}.corrupt.${Date.now()}`, raw);
      store.removeItem(key);
    } catch {
      /* 容量超過などは無視 */
    }
    return fallback;
  }
}

export function safeSave(key: string, value: unknown): boolean {
  const store = getStore();
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// ---- 型ガード ----

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const STATES: StationState[] = ['unvisited', 'visited', 'wishlist', 'stamped'];

export function isVisitRecord(v: unknown): v is VisitRecord {
  if (!isRecord(v)) return false;
  return STATES.includes(v.state as StationState) && typeof v.updatedAt === 'string';
}

export function isVisitMap(v: unknown): v is VisitMap {
  if (!isRecord(v)) return false;
  return Object.values(v).every(isVisitRecord);
}

/** 立ち寄り先(周辺スポット)の座標等、RouteStop.poiとして最低限信頼できる形か */
function isRouteStopPoi(v: unknown): boolean {
  if (!isRecord(v)) return false;
  return (
    typeof v.id === 'string' &&
    !!v.id &&
    typeof v.lat === 'number' &&
    Number.isFinite(v.lat) &&
    typeof v.lng === 'number' &&
    Number.isFinite(v.lng)
  );
}

/** PlannedRoute.stops の1件。stationId/日時/滞在時間は必須、poiは付いていれば座標を検証する */
function isRouteStop(v: unknown): boolean {
  if (!isRecord(v)) return false;
  if (typeof v.stationId !== 'string' || !v.stationId) return false;
  if (typeof v.arriveAt !== 'string' || typeof v.departAt !== 'string') return false;
  if (typeof v.stayMin !== 'number' || !Number.isFinite(v.stayMin)) return false;
  if (v.poi !== undefined && !isRouteStopPoi(v.poi)) return false;
  return true;
}

/** PlannedRoute.legs の1件。fromId/toIdはnull許容、距離・時間は有限数であること */
function isRouteLeg(v: unknown): boolean {
  if (!isRecord(v)) return false;
  if (v.fromId !== null && typeof v.fromId !== 'string') return false;
  if (v.toId !== null && typeof v.toId !== 'string') return false;
  if (typeof v.distanceKm !== 'number' || !Number.isFinite(v.distanceKm)) return false;
  if (typeof v.driveMin !== 'number' || !Number.isFinite(v.driveMin)) return false;
  return true;
}

/**
 * 保存ルート1件を検証する（バックアップ復元等、信頼できない入力の境界で使う想定）。
 * stops/legsの各要素の必須フィールドまで検証する（Astra監査P1: 以前はstopsが配列
 * であること程度しか見ておらず、1件の要素破損がstationId解決やlegs参照箇所で
 * クラッシュしうる状態だった）。
 */
export function isSavedRoute(v: unknown): v is SavedRoute {
  if (!isRecord(v)) return false;
  if (typeof v.id !== 'string' || !v.id) return false;
  if (typeof v.name !== 'string') return false;
  if (typeof v.done !== 'boolean') return false;
  const route = v.route;
  if (!isRecord(route)) return false;
  if (!Array.isArray(route.stops) || !route.stops.every(isRouteStop)) return false;
  if (!Array.isArray(route.legs) || !route.legs.every(isRouteLeg)) return false;
  return true;
}

export function isSavedRoutes(v: unknown): v is SavedRoute[] {
  if (!Array.isArray(v)) return false;
  return v.every(isSavedRoute);
}

const STOP_PROGRESS_VALUES = ['pending', 'arrived', 'done', 'skipped'];

export function isTripState(v: unknown): v is TripState {
  if (!isRecord(v)) return false;
  if (typeof v.savedRouteId !== 'string' || !v.savedRouteId) return false;
  if (typeof v.startedAt !== 'string') return false;
  if (!isRecord(v.progress)) return false;
  return Object.values(v.progress).every((p) => STOP_PROGRESS_VALUES.includes(p as string));
}

// ---- v1 → v2 移行 ----

/**
 * 旧形式 {status:'none'|'want'|'visited', stamp:boolean, ...} を新しい排他状態へ変換する。
 * 優先順位: スタンプ取得済み > 行きたい > 訪問済み > 未訪問
 */
export function migrateLegacyVisits(rawV1: unknown): VisitMap {
  const out: VisitMap = {};
  if (!isRecord(rawV1)) return out;
  for (const [id, rec] of Object.entries(rawV1)) {
    if (!isRecord(rec)) continue;
    const status = rec.status;
    const stamp = rec.stamp === true;
    let state: StationState = 'unvisited';
    if (stamp) state = 'stamped';
    else if (status === 'want') state = 'wishlist';
    else if (status === 'visited') state = 'visited';
    if (state === 'unvisited') continue; // 空記録は持ち越さない
    const now = new Date().toISOString();
    out[id] = {
      state,
      visitedAt:
        state === 'visited' || state === 'stamped'
          ? typeof rec.visitedAt === 'string'
            ? rec.visitedAt
            : now
          : null,
      wishlistAt: state === 'wishlist' ? (typeof rec.updatedAt === 'string' ? rec.updatedAt : now) : null,
      stampAt: state === 'stamped' ? (typeof rec.stampAt === 'string' ? rec.stampAt : now) : null,
      updatedAt: typeof rec.updatedAt === 'string' ? rec.updatedAt : now,
    };
  }
  return out;
}

// ---- 読み書きAPI ----

export function loadVisits(): VisitMap {
  const store = getStore();
  if (store) {
    let hasV2 = false;
    try {
      hasV2 = store.getItem(KEYS.visits) != null;
    } catch {
      /* noop */
    }
    if (!hasV2) {
      // 初回のみ v1 から移行（v1は消さずバックアップとして残す）
      try {
        const rawV1 = store.getItem(LEGACY_VISITS_KEY);
        if (rawV1 != null) {
          let migrated: VisitMap = {};
          try {
            migrated = migrateLegacyVisits(JSON.parse(rawV1));
          } catch {
            /* v1が壊れている場合は空から開始（v1自体は触らない） */
          }
          safeSave(KEYS.visits, migrated);
          return migrated;
        }
      } catch {
        /* noop */
      }
    }
  }
  return safeLoad<VisitMap>(KEYS.visits, isVisitMap, {});
}

/**
 * trueなら保存成功。falseの場合（容量超過・プライベートブラウジングでの
 * 書き込み拒否等）、呼び出し側は「保存できた」と偽らず利用者に伝えること
 * （Astra監査P1: 以前はこの戻り値を全呼び出し元が握りつぶしており、保存に
 * 失敗していても画面上は成功したかのように見えてしまっていた）。
 */
export function saveVisits(v: VisitMap): boolean {
  return safeSave(KEYS.visits, v);
}

export function loadRoutes(): SavedRoute[] {
  return safeLoad<SavedRoute[]>(KEYS.routes, isSavedRoutes, []);
}
/** 戻り値の意味は saveVisits と同じ */
export function saveRoutes(r: SavedRoute[]): boolean {
  return safeSave(KEYS.routes, r);
}

export function loadTrip(): TripState | null {
  const isTripOrNull = (v: unknown): v is TripState | null => v === null || isTripState(v);
  return safeLoad<TripState | null>(KEYS.trip, isTripOrNull, null);
}
/** 戻り値の意味は saveVisits と同じ */
export function saveTrip(t: TripState | null): boolean {
  return safeSave(KEYS.trip, t);
}

/** 全記録を削除（確認UIを通してからのみ呼ぶこと） */
export function clearAllUserData(): void {
  const store = getStore();
  if (!store) return;
  for (const k of [...Object.values(KEYS), LEGACY_VISITS_KEY]) {
    try {
      store.removeItem(k);
    } catch {
      /* noop */
    }
  }
}

// ---- 状態遷移 ----

/** タップ1回で進む循環順: 未訪問 → 訪問済み → 行きたい → スタンプ取得済み → 未訪問 */
export const STATE_CYCLE: StationState[] = ['unvisited', 'visited', 'wishlist', 'stamped'];

export function nextState(cur: StationState): StationState {
  const i = STATE_CYCLE.indexOf(cur);
  return STATE_CYCLE[(i + 1) % STATE_CYCLE.length];
}

/** 駅の状態を指定の排他状態へ変更する（各状態へ変わった日時を保存） */
export function applyState(map: VisitMap, stationId: string, state: StationState, now = new Date()): VisitMap {
  const iso = now.toISOString();
  if (state === 'unvisited') {
    const next = { ...map };
    delete next[stationId];
    return next;
  }
  const prev = map[stationId];
  const rec: VisitRecord = {
    state,
    visitedAt:
      state === 'visited' || state === 'stamped'
        ? state === 'visited'
          ? iso
          : (prev?.visitedAt ?? iso)
        : null,
    wishlistAt: state === 'wishlist' ? iso : null,
    stampAt: state === 'stamped' ? iso : null,
    updatedAt: iso,
  };
  return { ...map, [stationId]: rec };
}

export function stateOf(map: VisitMap, stationId: string): StationState {
  return map[stationId]?.state ?? 'unvisited';
}
