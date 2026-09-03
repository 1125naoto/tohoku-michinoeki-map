import { beforeEach, describe, expect, it } from 'vitest';
import { BACKUP_SCHEMA_VERSION, applyBackup, buildBackup, parseBackup } from './backup';
import { KEYS, loadRoutes, loadTrip, loadVisits, saveRoutes, saveTrip, saveVisits } from './storage';
import type { SavedRoute, TripState, VisitMap } from '../types';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemoryStorage();
});

const rec = (state: VisitMap[string]['state'], at: string): VisitMap[string] => ({
  state,
  visitedAt: state === 'visited' || state === 'stamped' ? at : null,
  wishlistAt: state === 'wishlist' ? at : null,
  stampAt: state === 'stamped' ? at : null,
  updatedAt: at,
});

const sampleVisits: VisitMap = {
  'mne-00001': rec('visited', '2026-08-01T00:00:00.000Z'),
  'mne-00002': rec('stamped', '2026-08-02T00:00:00.000Z'),
};

const sampleRoute: SavedRoute = {
  id: 'r-1',
  name: 'テストコース',
  createdAt: '2026-08-10T00:00:00.000Z',
  route: { stops: [] },
  done: false,
} as unknown as SavedRoute;

describe('バックアップの書き出し', () => {
  it('現在の記録・設定を含むJSONを組み立てる', () => {
    saveVisits(sampleVisits);
    const b = buildBackup();
    expect(b.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(typeof b.exportedAt).toBe('string');
    expect(b.visits).toEqual(sampleVisits);
    expect(Array.isArray(b.routes)).toBe(true);
    expect(b.settings.map.markerMode).toBe('all');
  });
  it('書き出し→パースで往復できる', () => {
    saveVisits(sampleVisits);
    const text = JSON.stringify(buildBackup());
    const r = parseBackup(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.visits).toEqual(sampleVisits);
  });
});

describe('バックアップの検証', () => {
  it('壊れたJSONはエラーになる（記録は変更しない）', () => {
    saveVisits(sampleVisits);
    const r = parseBackup('{bad json');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('JSON');
    expect(loadVisits()).toEqual(sampleVisits);
  });
  it('配列やnullはバックアップ形式として拒否する', () => {
    expect(parseBackup('[]').ok).toBe(false);
    expect(parseBackup('null').ok).toBe(false);
    expect(parseBackup('"text"').ok).toBe(false);
  });
  it('未来のschemaVersionは拒否する', () => {
    const r = parseBackup(JSON.stringify({ schemaVersion: BACKUP_SCHEMA_VERSION + 1, visits: {} }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('バージョン');
  });
  it('visitsの形式が不正なら拒否する', () => {
    const r = parseBackup(
      JSON.stringify({ schemaVersion: 1, visits: { 'mne-1': { state: '謎の状態' } } })
    );
    expect(r.ok).toBe(false);
  });
  it('settings欠落時は初期値で補完する', () => {
    const r = parseBackup(JSON.stringify({ schemaVersion: 1, visits: sampleVisits }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.settings.map).toEqual({ markerMode: 'all', labelMode: 'auto' });
  });
});

describe('復元の適用', () => {
  const backupText = () =>
    JSON.stringify({
      schemaVersion: 1,
      appVersion: '1.0.0',
      exportedAt: '2026-08-20T00:00:00.000Z',
      visits: sampleVisits,
      routes: [sampleRoute],
      trip: null,
      settings: { map: { markerMode: 'cluster', labelMode: 'always' } },
    });

  it('上書き: 既存の記録を置き換える', () => {
    saveVisits({ 'mne-99999': rec('wishlist', '2026-07-01T00:00:00.000Z') });
    const r = parseBackup(backupText());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const applied = applyBackup(r.data, 'overwrite');
    expect(applied.visits).toEqual(sampleVisits);
    expect(loadVisits()).toEqual(sampleVisits);
    expect(loadVisits()['mne-99999']).toBeUndefined();
    expect(loadRoutes().map((x) => x.id)).toEqual(['r-1']);
  });

  it('統合: 既存に無い記録を追加しつつバックアップ側を優先する', () => {
    saveVisits({
      'mne-99999': rec('wishlist', '2026-07-01T00:00:00.000Z'),
      'mne-00001': rec('unvisited', '2026-07-02T00:00:00.000Z'),
    });
    const existingRoute = { ...sampleRoute, id: 'r-keep', name: '既存コース' } as SavedRoute;
    saveRoutes([existingRoute]);
    const trip: TripState = { savedRouteId: 'r-keep', startedAt: '2026-08-30T00:00:00.000Z', progress: {} };
    saveTrip(trip);
    const r = parseBackup(backupText());
    if (!r.ok) throw new Error('parse失敗');
    const applied = applyBackup(r.data, 'merge');
    expect(applied.visits['mne-99999']?.state).toBe('wishlist'); // 既存は残る
    expect(applied.visits['mne-00001']?.state).toBe('visited'); // バックアップ優先
    expect(loadRoutes().map((x) => x.id).sort()).toEqual(['r-1', 'r-keep']);
    expect(loadTrip()).toEqual(trip); // バックアップのtripがnullなら既存維持
  });

  it('復元は地図設定キーにも反映される', () => {
    const r = parseBackup(backupText());
    if (!r.ok) throw new Error('parse失敗');
    applyBackup(r.data, 'overwrite');
    expect(localStorage.getItem('tohoku-me:map-settings:v1')).toContain('cluster');
    expect(localStorage.getItem(KEYS.visits)).toContain('mne-00001');
  });
});
