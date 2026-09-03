/**
 * localStorage への永続化。
 * - マスターデータ(駅一覧)とユーザー記録を完全分離（記録は駅IDのみ参照）
 * - 壊れたデータを読んでもアプリを落とさない（バックアップ退避して空で継続）
 * - v1(status+stampフラグ) → v2(相互排他のstate) へ自動移行。v1データは消さずに残す
 */
import type { SavedRoute, StationState, TripState, VisitMap, VisitRecord } from '../types';

export const KEYS = {
  visits: 'tohoku-me:visits:v2',
  routes: 'tohoku-me:routes:v1',
  trip: 'tohoku-me:trip:v1',
} as const;

/** 旧形式（〜d6dc4af）の訪問記録キー。移行後もバックアップとして残す */
export const LEGACY_VISITS_KEY = 'tohoku-me:visits:v1';

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

export function isSavedRoutes(v: unknown): v is SavedRoute[] {
  if (!Array.isArray(v)) return false;
  return v.every(
    (r) =>
      isRecord(r) &&
      typeof r.id === 'string' &&
      typeof r.name === 'string' &&
      isRecord(r.route) &&
      Array.isArray((r.route as Record<string, unknown>).stops),
  );
}

export function isTripState(v: unknown): v is TripState {
  return isRecord(v) && typeof v.savedRouteId === 'string' && isRecord(v.progress);
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

export function saveVisits(v: VisitMap): void {
  safeSave(KEYS.visits, v);
}

export function loadRoutes(): SavedRoute[] {
  return safeLoad<SavedRoute[]>(KEYS.routes, isSavedRoutes, []);
}
export function saveRoutes(r: SavedRoute[]): void {
  safeSave(KEYS.routes, r);
}

export function loadTrip(): TripState | null {
  const isTripOrNull = (v: unknown): v is TripState | null => v === null || isTripState(v);
  return safeLoad<TripState | null>(KEYS.trip, isTripOrNull, null);
}
export function saveTrip(t: TripState | null): void {
  safeSave(KEYS.trip, t);
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
