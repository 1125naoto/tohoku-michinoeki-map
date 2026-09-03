/**
 * 記録のバックアップ・復元。
 * ローカルURLと公開URLはオリジンが異なりlocalStorageが引き継がれないため、
 * JSONファイルでの書き出し/読み込みを提供する。
 */
import type { SavedRoute, TripState, VisitMap } from '../types';
import {
  KEYS,
  isSavedRoutes,
  isTripState,
  isVisitMap,
  loadRoutes,
  loadTrip,
  loadVisits,
  saveRoutes,
  saveTrip,
  saveVisits,
} from './storage';
import { MAP_SETTINGS_KEY, loadMapSettings, saveMapSettings, type MapSettings } from './mapSettings';

export const BACKUP_SCHEMA_VERSION = 1;
export const APP_VERSION = '1.0.0';

export interface BackupFile {
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  visits: VisitMap;
  routes: SavedRoute[];
  trip: TripState | null;
  settings: {
    map: MapSettings;
  };
}

/** 現在の記録・設定からバックアップJSONを組み立てる */
export function buildBackup(): BackupFile {
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    visits: loadVisits(),
    routes: loadRoutes(),
    trip: loadTrip(),
    settings: { map: loadMapSettings() },
  };
}

export type ParseResult = { ok: true; data: BackupFile } | { ok: false; error: string };

/** バックアップJSONを検証つきでパースする（不正データでアプリを壊さない） */
export function parseBackup(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'JSONとして読み込めませんでした' };
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'バックアップ形式ではありません' };
  const o = raw as Record<string, unknown>;
  if (typeof o.schemaVersion !== 'number' || o.schemaVersion > BACKUP_SCHEMA_VERSION) {
    return { ok: false, error: '対応していないバックアップのバージョンです' };
  }
  const visits = o.visits ?? {};
  if (!isVisitMap(visits)) return { ok: false, error: '訪問記録の形式が不正です' };
  const routes = o.routes ?? [];
  if (!isSavedRoutes(routes)) return { ok: false, error: '保存ルートの形式が不正です' };
  const trip = o.trip ?? null;
  if (trip !== null && !isTripState(trip)) return { ok: false, error: '旅行中データの形式が不正です' };
  const map = (o.settings as { map?: unknown } | undefined)?.map;
  const mapSettings: MapSettings =
    typeof map === 'object' && map !== null
      ? {
          markerMode: (map as MapSettings).markerMode === 'cluster' ? 'cluster' : 'all',
          labelMode:
            (map as MapSettings).labelMode === 'always' || (map as MapSettings).labelMode === 'off'
              ? (map as MapSettings).labelMode
              : 'auto',
        }
      : { markerMode: 'all', labelMode: 'auto' };
  return {
    ok: true,
    data: {
      schemaVersion: o.schemaVersion,
      appVersion: typeof o.appVersion === 'string' ? o.appVersion : 'unknown',
      exportedAt: typeof o.exportedAt === 'string' ? o.exportedAt : '',
      visits,
      routes,
      trip,
      settings: { map: mapSettings },
    },
  };
}

export type RestoreMode = 'overwrite' | 'merge';

/** 復元を適用し、適用後の visits/routes/trip を返す（呼び出し側で画面へ即時反映） */
export function applyBackup(data: BackupFile, mode: RestoreMode) {
  let visits: VisitMap;
  let routes: SavedRoute[];
  let trip: TripState | null;
  if (mode === 'overwrite') {
    visits = data.visits;
    routes = data.routes;
    trip = data.trip;
  } else {
    // 統合: バックアップ側を優先しつつ、既存で欠けていないものは残す
    visits = { ...loadVisits(), ...data.visits };
    const cur = loadRoutes();
    const ids = new Set(data.routes.map((r) => r.id));
    routes = [...data.routes, ...cur.filter((r) => !ids.has(r.id))];
    trip = data.trip ?? loadTrip();
  }
  saveVisits(visits);
  saveRoutes(routes);
  saveTrip(trip);
  saveMapSettings(data.settings.map);
  return { visits, routes, trip, mapSettings: data.settings.map };
}

/** バックアップの保存対象キー一覧（参考） */
export const BACKUP_KEYS = [...Object.values(KEYS), MAP_SETTINGS_KEY];
