/**
 * localStorage への永続化。
 * - マスターデータ(駅一覧)とユーザー記録を完全分離（記録は駅IDのみ参照）
 * - 壊れたデータを読んでもアプリを落とさない（バックアップ退避して空で継続）
 * - 将来のスキーマ変更に備えて keyごとにバージョンを持つ
 */
import type { SavedRoute, TripState, VisitMap, VisitRecord, VisitStatus } from '../types';

export const KEYS = {
  visits: 'tohoku-me:visits:v1',
  routes: 'tohoku-me:routes:v1',
  trip: 'tohoku-me:trip:v1',
} as const;

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

const VISIT_STATUSES: VisitStatus[] = ['none', 'want', 'visited'];

export function isVisitRecord(v: unknown): v is VisitRecord {
  if (!isRecord(v)) return false;
  return (
    VISIT_STATUSES.includes(v.status as VisitStatus) &&
    typeof v.stamp === 'boolean' &&
    typeof v.updatedAt === 'string'
  );
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

// ---- 読み書きAPI ----

export function loadVisits(): VisitMap {
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
  for (const k of Object.values(KEYS)) {
    try {
      store.removeItem(k);
    } catch {
      /* noop */
    }
  }
}

// ---- 訪問記録の更新ヘルパー ----

export function emptyRecord(): VisitRecord {
  return { status: 'none', visitedAt: null, stamp: false, stampAt: null, updatedAt: new Date().toISOString() };
}

export function applyStatus(map: VisitMap, stationId: string, status: VisitStatus, now = new Date()): VisitMap {
  const prev = map[stationId] ?? emptyRecord();
  const rec: VisitRecord = {
    ...prev,
    status,
    visitedAt: status === 'visited' ? (prev.visitedAt ?? now.toISOString()) : prev.visitedAt,
    updatedAt: now.toISOString(),
  };
  if (status === 'none') {
    rec.visitedAt = null;
  }
  return { ...map, [stationId]: rec };
}

/** スタンプ取得: 内部では訪問と区別して保持しつつ、状態も visited に揃える */
export function applyStamp(map: VisitMap, stationId: string, stamp: boolean, now = new Date()): VisitMap {
  const prev = map[stationId] ?? emptyRecord();
  const rec: VisitRecord = {
    ...prev,
    stamp,
    stampAt: stamp ? (prev.stampAt ?? now.toISOString()) : null,
    status: stamp ? 'visited' : prev.status,
    visitedAt: stamp ? (prev.visitedAt ?? now.toISOString()) : prev.visitedAt,
    updatedAt: now.toISOString(),
  };
  return { ...map, [stationId]: rec };
}
