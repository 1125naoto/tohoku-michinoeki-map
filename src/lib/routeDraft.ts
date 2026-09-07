/**
 * 「地図から選ぶ」の選択途中を誤操作・再読み込みから守るための下書き保存。
 * 訪問記録・設定キーとは分離した専用キーに保存し、壊れたデータでアプリを落とさない。
 *
 * v2: 周辺スポット（POI）の検索結果選択・地点別滞在時間の上書きを追加。
 * 旧v1データ（selectedPois/stayOverridesが無い）も引き続き読み込める。
 */
import type { ManualOrderMode } from './manualRoute';
import type { RoadPref } from '../types';
import type { Poi, PoiCategory } from './poi';

export const ROUTE_DRAFT_KEY = 'tohoku-me:manual-route-draft:v1';

export interface RouteDraft {
  selectedIds: string[];
  origin: { lat: number; lng: number; label: string } | null;
  returnToStart: boolean;
  orderMode: ManualOrderMode;
  budgetMin: number | null;
  stayMin: number;
  roadPref: RoadPref;
  /** 選択済みの周辺スポット（キー: Poi.id）。selectedIds内のPOI由来IDを解決するための実データ */
  selectedPois: Record<string, Poi>;
  /** 地点ごとの滞在時間の上書き（キー: 駅ID or Poi.id） */
  stayOverrides: Record<string, number>;
  /** 選択・設定を始めていて未完成かどうか（起動時の「続けますか？」表示の判定に使う） */
  inProgress: boolean;
  updatedAt: string;
}

export const DEFAULT_ROUTE_DRAFT: RouteDraft = {
  selectedIds: [],
  origin: null,
  returnToStart: true,
  orderMode: 'optimized',
  budgetMin: 240,
  stayMin: 30,
  roadPref: 'highway_ok',
  selectedPois: {},
  stayOverrides: {},
  inProgress: false,
  updatedAt: '',
};

function isOrigin(v: unknown): v is RouteDraft['origin'] {
  if (v === null) return true;
  if (typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.lat === 'number' && typeof o.lng === 'number' && typeof o.label === 'string';
}

// 'lodging' の追加漏れがあり、宿泊の周辺スポットを含む下書きが再読み込み時に
// 黙って欠落していた（データ消失）。カテゴリ追加時はここも必ず更新すること。
const POI_CATEGORIES: PoiCategory[] = ['food', 'tourism', 'onsen', 'lodging'];

function isPoi(v: unknown): v is Poi {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    POI_CATEGORIES.includes(o.category as PoiCategory) &&
    typeof o.subcategory === 'string' &&
    (o.name === null || typeof o.name === 'string') &&
    typeof o.lat === 'number' &&
    typeof o.lng === 'number' &&
    (o.address === null || typeof o.address === 'string') &&
    (o.openingHoursRaw === null || typeof o.openingHoursRaw === 'string') &&
    typeof o.distanceM === 'number' &&
    o.source === 'overpass' &&
    typeof o.sourceUrl === 'string'
  );
}

/**
 * selectedPoisは壊れていても下書き全体を拒否せず、不正な項目だけを取り除く
 * （Gate9: 壊れたPOIデータだけが含まれる場合でも他のデータは保護する）。
 */
function sanitizePois(v: unknown): Record<string, Poi> {
  if (typeof v !== 'object' || v === null) return {};
  const out: Record<string, Poi> = {};
  for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
    if (isPoi(val)) out[key] = val;
  }
  return out;
}

function sanitizeStayOverrides(v: unknown): Record<string, number> {
  if (typeof v !== 'object' || v === null) return {};
  const out: Record<string, number> = {};
  for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'number' && Number.isFinite(val)) out[key] = val;
  }
  return out;
}

export function isRouteDraft(v: unknown): v is RouteDraft {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    Array.isArray(o.selectedIds) &&
    o.selectedIds.every((x) => typeof x === 'string') &&
    isOrigin(o.origin) &&
    typeof o.returnToStart === 'boolean' &&
    (o.orderMode === 'selected' || o.orderMode === 'optimized') &&
    (o.budgetMin === null || typeof o.budgetMin === 'number') &&
    typeof o.stayMin === 'number' &&
    typeof o.roadPref === 'string' &&
    typeof o.inProgress === 'boolean'
  );
}

/**
 * 検証済みのRouteDraft形状に対し、selectedPois/stayOverridesだけを個別に
 * サニタイズする（壊れたPOIデータだけを取り除き、他のフィールドは保護する）。
 * バックアップ復元時にも同じ関数を使い、挙動をそろえる。
 */
export function sanitizeRouteDraft(parsed: RouteDraft): RouteDraft {
  const o = parsed as unknown as Record<string, unknown>;
  return {
    ...parsed,
    selectedPois: sanitizePois(o.selectedPois),
    stayOverrides: sanitizeStayOverrides(o.stayOverrides),
  };
}

export function loadRouteDraft(): RouteDraft | null {
  try {
    const raw = localStorage.getItem(ROUTE_DRAFT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRouteDraft(parsed)) return null;
    return sanitizeRouteDraft(parsed);
  } catch {
    return null;
  }
}

export function saveRouteDraft(d: RouteDraft): void {
  try {
    localStorage.setItem(ROUTE_DRAFT_KEY, JSON.stringify({ ...d, updatedAt: new Date().toISOString() }));
  } catch {
    /* noop */
  }
}

/** 完成・明示キャンセル時に呼ぶ（下書きを残さない） */
export function clearRouteDraft(): void {
  try {
    localStorage.removeItem(ROUTE_DRAFT_KEY);
  } catch {
    /* noop */
  }
}
