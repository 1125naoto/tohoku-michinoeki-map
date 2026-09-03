/**
 * 「地図から選ぶ」の選択途中を誤操作・再読み込みから守るための下書き保存。
 * 訪問記録・設定キーとは分離した専用キーに保存し、壊れたデータでアプリを落とさない。
 */
import type { ManualOrderMode } from './manualRoute';
import type { RoadPref } from '../types';

export const ROUTE_DRAFT_KEY = 'tohoku-me:manual-route-draft:v1';

export interface RouteDraft {
  selectedIds: string[];
  origin: { lat: number; lng: number; label: string } | null;
  returnToStart: boolean;
  orderMode: ManualOrderMode;
  budgetMin: number | null;
  stayMin: number;
  roadPref: RoadPref;
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
  inProgress: false,
  updatedAt: '',
};

function isOrigin(v: unknown): v is RouteDraft['origin'] {
  if (v === null) return true;
  if (typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.lat === 'number' && typeof o.lng === 'number' && typeof o.label === 'string';
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

export function loadRouteDraft(): RouteDraft | null {
  try {
    const raw = localStorage.getItem(ROUTE_DRAFT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRouteDraft(parsed)) return null;
    return parsed;
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
