/**
 * 保存まわりの機能テスト:
 * 循環状態遷移・v1→v2移行・壊れたデータへの耐性。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  KEYS,
  LEGACY_VISITS_KEY,
  applyState,
  clearAllUserData,
  loadRoutes,
  loadTrip,
  loadVisits,
  migrateLegacyVisits,
  nextState,
  saveVisits,
} from './storage';

// Node環境用の localStorage スタブ
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

describe('循環状態遷移', () => {
  it('未訪問→訪問済み→行きたい→スタンプ取得済み→未訪問の順で循環する', () => {
    expect(nextState('unvisited')).toBe('visited');
    expect(nextState('visited')).toBe('wishlist');
    expect(nextState('wishlist')).toBe('stamped');
    expect(nextState('stamped')).toBe('unvisited');
  });

  it('applyStateで各状態へ変わった日時が保存される', () => {
    const now = new Date('2026-09-03T10:00:00Z');
    let m = applyState({}, 's1', 'visited', now);
    expect(m['s1'].state).toBe('visited');
    expect(m['s1'].visitedAt).toBe(now.toISOString());
    m = applyState(m, 's1', 'wishlist', new Date('2026-09-03T10:05:00Z'));
    expect(m['s1'].state).toBe('wishlist');
    expect(m['s1'].wishlistAt).toBe('2026-09-03T10:05:00.000Z');
    m = applyState(m, 's1', 'stamped', new Date('2026-09-03T10:10:00Z'));
    expect(m['s1'].state).toBe('stamped');
    expect(m['s1'].stampAt).toBe('2026-09-03T10:10:00.000Z');
    expect(m['s1'].visitedAt).not.toBeNull(); // スタンプ済みは訪問扱い
    m = applyState(m, 's1', 'unvisited');
    expect(m['s1']).toBeUndefined(); // 未訪問=記録なし
  });

  it('状態は相互排他（同時に複数状態にならない）', () => {
    let m = applyState({}, 's1', 'stamped');
    m = applyState(m, 's1', 'wishlist');
    expect(m['s1'].state).toBe('wishlist');
    expect(m['s1'].stampAt).toBeNull(); // スタンプ状態は残らない
  });
});

describe('v1→v2 移行', () => {
  const v1 = {
    a: { status: 'visited', visitedAt: '2026-01-01T00:00:00Z', stamp: false, stampAt: null, updatedAt: '2026-01-01T00:00:00Z' },
    b: { status: 'want', visitedAt: null, stamp: false, stampAt: null, updatedAt: '2026-01-02T00:00:00Z' },
    c: { status: 'visited', visitedAt: '2026-01-03T00:00:00Z', stamp: true, stampAt: '2026-01-03T01:00:00Z', updatedAt: '2026-01-03T01:00:00Z' },
    d: { status: 'none', visitedAt: null, stamp: false, stampAt: null, updatedAt: '2026-01-04T00:00:00Z' },
    e: { status: 'want', visitedAt: null, stamp: true, stampAt: '2026-01-05T00:00:00Z', updatedAt: '2026-01-05T00:00:00Z' },
  };

  it('優先順位どおり変換される（stamp > want > visited > none）', () => {
    const m = migrateLegacyVisits(v1);
    expect(m['a'].state).toBe('visited');
    expect(m['a'].visitedAt).toBe('2026-01-01T00:00:00Z');
    expect(m['b'].state).toBe('wishlist');
    expect(m['c'].state).toBe('stamped');
    expect(m['c'].stampAt).toBe('2026-01-03T01:00:00Z');
    expect(m['d']).toBeUndefined(); // noneは持ち越さない
    expect(m['e'].state).toBe('stamped'); // stamp優先
  });

  it('loadVisitsはv2が無ければv1から自動移行し、v1は消さずに残す', () => {
    localStorage.setItem(LEGACY_VISITS_KEY, JSON.stringify(v1));
    const loaded = loadVisits();
    expect(loaded['a'].state).toBe('visited');
    expect(loaded['c'].state).toBe('stamped');
    expect(localStorage.getItem(LEGACY_VISITS_KEY)).not.toBeNull(); // 旧データ保持
    expect(localStorage.getItem(KEYS.visits)).not.toBeNull(); // v2が作成される
    // 2回目以降はv2を読む
    const again = loadVisits();
    expect(again['a'].state).toBe('visited');
  });

  it('v1が壊れていても落ちず、空で開始しv1は触らない', () => {
    localStorage.setItem(LEGACY_VISITS_KEY, '{broken!!');
    expect(() => loadVisits()).not.toThrow();
    expect(loadVisits()).toEqual({});
    expect(localStorage.getItem(LEGACY_VISITS_KEY)).toBe('{broken!!');
  });
});

describe('永続化と耐障害性', () => {
  it('保存して再読み込みしても記録が残る', () => {
    saveVisits(applyState({}, 'mne-42', 'wishlist'));
    expect(loadVisits()['mne-42'].state).toBe('wishlist');
  });

  it('壊れたv2でも落ちず、空データで継続し、元データを退避する', () => {
    localStorage.setItem(KEYS.visits, '{{{{ broken');
    expect(() => loadVisits()).not.toThrow();
    expect(loadVisits()).toEqual({});
    const backupKeys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
    expect(backupKeys.some((k) => k?.startsWith(`${KEYS.visits}.corrupt.`))).toBe(true);
  });

  it('型が不正なデータでも落ちない', () => {
    localStorage.setItem(KEYS.visits, JSON.stringify({ a: { state: 'INVALID' } }));
    expect(loadVisits()).toEqual({});
    localStorage.setItem(KEYS.routes, JSON.stringify([{ nonsense: 1 }]));
    expect(loadRoutes()).toEqual([]);
    localStorage.setItem(KEYS.trip, JSON.stringify(12345));
    expect(loadTrip()).toBeNull();
  });

  it('全消去でv1/v2/ルート/旅行がすべて消える', () => {
    localStorage.setItem(LEGACY_VISITS_KEY, '{}');
    saveVisits(applyState({}, 'x', 'visited'));
    clearAllUserData();
    expect(loadVisits()).toEqual({});
    expect(loadRoutes()).toEqual([]);
    expect(loadTrip()).toBeNull();
    expect(localStorage.getItem(LEGACY_VISITS_KEY)).toBeNull();
  });
});
