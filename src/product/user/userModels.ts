/**
 * 将来クラウド同期する想定のユーザーデータモデル。
 * 既存の localStorage 保存（lib/storage.ts の VisitMap/SavedRoute等）とは独立した型で、
 * migration.ts が既存データからの非破壊的な変換を担う。
 */
import type { MapSettings } from '../../lib/mapSettings';
import type { RoadPref, SavedRoute } from '../../types';
import type { PlanId } from '../entitlement/entitlement';
import { CURRENT_SCHEMA_VERSION, type Versioned } from '../schema/version';

export type AuthMethod = 'local' | 'google' | 'email';

export interface AppUser {
  /** クラウド未接続時（Phase1）は端末内で生成した安定UUID。クラウド接続後はprovider発行のIDに統一する */
  id: string;
  authMethod: AuthMethod;
  email: string | null;
  displayName: string | null;
  plan: PlanId;
  createdAt: string;
}

export interface UserStationState extends Versioned {
  userId: string;
  stationId: string;
  visited: boolean;
  wantToGo: boolean;
  stampCollected: boolean;
  visitedAt: string | null;
  wantToGoAt: string | null;
  stampCollectedAt: string | null;
  /** PREMIUM機能（MEMO）。無料プランではUI側で編集不可にする想定 */
  memo: string | null;
  /** PREMIUM機能（PHOTO_LOG）。Phase1では常に空配列 */
  photoIds: string[];
  updatedAt: string;
}

export interface UserSettings extends Versioned {
  userId: string;
  map: MapSettings;
  roadPrefDefault: RoadPref;
  updatedAt: string;
}

export interface SavedRouteRef extends Versioned {
  userId: string;
  routeId: string;
  route: SavedRoute;
  /** クラウド未同期はnull。CLOUD_SYNC機能が有効な場合のみ更新される */
  syncedAt: string | null;
}

export interface UserStateSnapshot extends Versioned {
  user: AppUser;
  stationStates: UserStationState[];
  savedRoutes: SavedRouteRef[];
  settings: UserSettings;
}

export function emptyUserStateSnapshot(user: AppUser, settings: UserSettings): UserStateSnapshot {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    user,
    stationStates: [],
    savedRoutes: [],
    settings,
  };
}
