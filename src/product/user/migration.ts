/**
 * 既存の端末内保存（lib/storage.ts の VisitMap / SavedRoute[] / MapSettings）から
 * 新しいクラウド同期対応モデル（UserStationState[] / SavedRouteRef[] / UserSettings）への変換。
 *
 * 重要な設計判断:
 * 旧モデルの StationState は 'unvisited'|'visited'|'wishlist'|'stamped' の「排他的な1状態」
 * （タップで1段階ずつ循環し、スタンプ取得済みは「訪問済み」ではなく別状態として上書きされる）。
 * 新モデルは visited / wantToGo / stampCollected を独立したbooleanに分離する
 * （スタンプは訪問なしには取得できない、という現実の意味論をより正確に表現するため）。
 * そのため state==='stamped' は visited:true かつ stampCollected:true へ変換する
 * （データの追加・意味の明確化であり、既存記録の削除・改変ではない）。
 *
 * 既存のlocalStorageデータは一切書き換えない（読み取り専用の変換）。実際の移行実行・書き込みは
 * クラウド同期機能が有効になった後続Phaseで行う。
 */
import type { RoadPref, SavedRoute, StationState, VisitMap } from '../../types';
import type { MapSettings } from '../../lib/mapSettings';
import { CURRENT_SCHEMA_VERSION } from '../schema/version';
import type { AppUser, SavedRouteRef, UserSettings, UserStationState } from './userModels';

export function stationStateToFlags(state: StationState): {
  visited: boolean;
  wantToGo: boolean;
  stampCollected: boolean;
} {
  switch (state) {
    case 'visited':
      return { visited: true, wantToGo: false, stampCollected: false };
    case 'wishlist':
      return { visited: false, wantToGo: true, stampCollected: false };
    case 'stamped':
      return { visited: true, wantToGo: false, stampCollected: true };
    case 'unvisited':
    default:
      return { visited: false, wantToGo: false, stampCollected: false };
  }
}

export function migrateVisitMapToUserStationStates(userId: string, visits: VisitMap): UserStationState[] {
  return Object.entries(visits).map(([stationId, rec]) => {
    const flags = stationStateToFlags(rec.state);
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      userId,
      stationId,
      ...flags,
      visitedAt: rec.visitedAt,
      wantToGoAt: rec.wishlistAt,
      stampCollectedAt: rec.stampAt,
      memo: null,
      photoIds: [],
      updatedAt: rec.updatedAt,
    };
  });
}

export function migrateSavedRoutesToRefs(userId: string, routes: SavedRoute[]): SavedRouteRef[] {
  return routes.map((route) => ({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    userId,
    routeId: route.id,
    route,
    syncedAt: null,
  }));
}

export function migrateMapSettingsToUserSettings(
  userId: string,
  map: MapSettings,
  roadPrefDefault: RoadPref = 'highway_ok',
): UserSettings {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    userId,
    map,
    roadPrefDefault,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 端末内のみで完結する「ローカル匿名ユーザー」を表す。クラウド未接続のPhase1では
 * すべての利用者がこの形になる（authMethod:'local'、email/displayNameはnull）。
 */
export function createLocalUser(id: string, createdAt: string = new Date().toISOString()): AppUser {
  return {
    id,
    authMethod: 'local',
    email: null,
    displayName: null,
    plan: 'free',
    createdAt,
  };
}
