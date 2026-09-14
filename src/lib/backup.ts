/**
 * 記録のバックアップ・復元。
 * ローカルURLと公開URLはオリジンが異なりlocalStorageが引き継がれないため、
 * JSONファイルでの書き出し/読み込みを提供する。
 */
import type { SavedRoute, TripState, VisitMap } from '../types';
import {
  KEYS,
  isSavedRoute,
  isTripState,
  isVisitRecord,
  loadRoutes,
  loadTrip,
  loadVisits,
  saveRoutes,
  saveTrip,
  saveVisits,
} from './storage';
import { MAP_SETTINGS_KEY, loadMapSettings, saveMapSettings, type MapSettings } from './mapSettings';
import {
  ROUTE_DRAFT_KEY,
  isRouteDraft,
  loadRouteDraft,
  saveRouteDraft,
  clearRouteDraft,
  sanitizeRouteDraft,
  type RouteDraft,
} from './routeDraft';

/**
 * 2: 「地図から選ぶ」の選択下書き(manualDraft)を追加。
 * schemaVersion 1（下書きフィールドなし）のバックアップも復元時はそのまま読める
 * （manualDraftをnull扱いにするだけで、visits/routes/tripの互換性はそのまま）。
 */
export const BACKUP_SCHEMA_VERSION = 2;
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
  /** 「地図から選ぶ」の選択途中（schemaVersion 1にはなかった項目。未保存時はnull） */
  manualDraft: RouteDraft | null;
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
    manualDraft: loadRouteDraft(),
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
  // visits/routesは「1件の壊れた記録」で復元全体を拒否しない: 個別に検証し、
  // 不正な要素だけを除外する（Astra監査P1）。ただしフィールド自体が根本的に
  // 配列/オブジェクトですらない場合は、ファイル自体が壊れているとみなし拒否する。
  const rawVisits = o.visits ?? {};
  if (typeof rawVisits !== 'object' || rawVisits === null || Array.isArray(rawVisits)) {
    return { ok: false, error: '訪問記録の形式が不正です' };
  }
  const visits: VisitMap = {};
  for (const [id, rec] of Object.entries(rawVisits as Record<string, unknown>)) {
    if (isVisitRecord(rec)) visits[id] = rec;
  }
  const rawRoutes = o.routes ?? [];
  if (!Array.isArray(rawRoutes)) return { ok: false, error: '保存ルートの形式が不正です' };
  const routes: SavedRoute[] = rawRoutes.filter(isSavedRoute);
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
  // manualDraft: 壊れている/存在しない(旧schemaVersion 1)場合は「下書きなし」として
  // 扱うだけにとどめ、バックアップ全体は拒否しない（他フィールドはすべて有効なため）
  const rawDraft = o.manualDraft;
  const manualDraft = isRouteDraft(rawDraft) ? sanitizeRouteDraft(rawDraft) : null;
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
      manualDraft,
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
  // 復元は3キーへの書き込みを要するため、1つでも失敗したら呼び出し側へ伝える
  // （Astra監査P1: 以前は戻り値を捨てており、容量超過等で一部だけ保存されなくても
  // 画面上は「復元完了」に見えてしまっていた）。
  const savedVisits = saveVisits(visits);
  const savedRoutes = saveRoutes(routes);
  const savedTrip = saveTrip(trip);
  const saved = savedVisits && savedRoutes && savedTrip;
  saveMapSettings(data.settings.map);
  // 下書きは1件しか持てないためマージ対象にはならない: バックアップにあれば採用し、
  // 上書きモードでバックアップに無ければ削除する。統合モードでバックアップに無い場合は
  // 今の下書き（あれば）をそのまま残す。
  let manualDraft: RouteDraft | null;
  if (data.manualDraft) {
    saveRouteDraft(data.manualDraft);
    manualDraft = data.manualDraft;
  } else if (mode === 'overwrite') {
    clearRouteDraft();
    manualDraft = null;
  } else {
    manualDraft = loadRouteDraft();
  }
  return { visits, routes, trip, mapSettings: data.settings.map, manualDraft, saved };
}

/** バックアップの保存対象キー一覧（参考） */
export const BACKUP_KEYS = [...Object.values(KEYS), MAP_SETTINGS_KEY, ROUTE_DRAFT_KEY];
