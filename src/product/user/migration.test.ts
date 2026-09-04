import { describe, expect, it } from 'vitest';
import type { SavedRoute, VisitMap } from '../../types';
import { DEFAULT_MAP_SETTINGS } from '../../lib/mapSettings';
import {
  createLocalUser,
  migrateMapSettingsToUserSettings,
  migrateSavedRoutesToRefs,
  migrateVisitMapToUserStationStates,
  stationStateToFlags,
} from './migration';

describe('stationStateToFlags', () => {
  it('unvisitedはすべてfalse', () => {
    expect(stationStateToFlags('unvisited')).toEqual({
      visited: false,
      wantToGo: false,
      stampCollected: false,
    });
  });
  it('visitedはvisitedのみtrue', () => {
    expect(stationStateToFlags('visited')).toEqual({
      visited: true,
      wantToGo: false,
      stampCollected: false,
    });
  });
  it('wishlistはwantToGoのみtrue', () => {
    expect(stationStateToFlags('wishlist')).toEqual({
      visited: false,
      wantToGo: true,
      stampCollected: false,
    });
  });
  it('stampedはvisitedとstampCollectedの両方がtrue（スタンプは訪問を伴うため）', () => {
    expect(stationStateToFlags('stamped')).toEqual({
      visited: true,
      wantToGo: false,
      stampCollected: true,
    });
  });
});

describe('migrateVisitMapToUserStationStates', () => {
  it('VisitMapの全エントリを変換し、日時フィールドを保持する', () => {
    const visits: VisitMap = {
      'st-1': {
        state: 'stamped',
        visitedAt: '2026-01-01T00:00:00.000Z',
        wishlistAt: null,
        stampAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
      'st-2': {
        state: 'wishlist',
        visitedAt: null,
        wishlistAt: '2026-01-03T00:00:00.000Z',
        stampAt: null,
        updatedAt: '2026-01-03T00:00:00.000Z',
      },
    };
    const result = migrateVisitMapToUserStationStates('user-1', visits);
    expect(result).toHaveLength(2);
    const st1 = result.find((r) => r.stationId === 'st-1')!;
    expect(st1.visited).toBe(true);
    expect(st1.stampCollected).toBe(true);
    expect(st1.visitedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(st1.stampCollectedAt).toBe('2026-01-02T00:00:00.000Z');
    expect(st1.memo).toBeNull();
    expect(st1.photoIds).toEqual([]);
  });

  it('空のVisitMapは空配列を返す（未訪問駅を捏造しない）', () => {
    expect(migrateVisitMapToUserStationStates('user-1', {})).toEqual([]);
  });
});

describe('migrateSavedRoutesToRefs', () => {
  it('SavedRoute[]をuserId付きの参照へ変換し、syncedAtはnull(未同期)にする', () => {
    const routes = [{ id: 'r1', name: 'テスト', createdAt: '2026-01-01T00:00:00.000Z' }] as unknown as SavedRoute[];
    const refs = migrateSavedRoutesToRefs('user-1', routes);
    expect(refs).toHaveLength(1);
    expect(refs[0].userId).toBe('user-1');
    expect(refs[0].routeId).toBe('r1');
    expect(refs[0].syncedAt).toBeNull();
  });
});

describe('migrateMapSettingsToUserSettings', () => {
  it('MapSettingsをラップしてUserSettingsにする', () => {
    const settings = migrateMapSettingsToUserSettings('user-1', DEFAULT_MAP_SETTINGS);
    expect(settings.userId).toBe('user-1');
    expect(settings.map).toEqual(DEFAULT_MAP_SETTINGS);
    expect(settings.roadPrefDefault).toBe('highway_ok');
  });
});

describe('createLocalUser', () => {
  it('authMethod:local, plan:free のローカル利用者を作る', () => {
    const user = createLocalUser('device-uuid-1', '2026-01-01T00:00:00.000Z');
    expect(user).toEqual({
      id: 'device-uuid-1',
      authMethod: 'local',
      email: null,
      displayName: null,
      plan: 'free',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });
});
