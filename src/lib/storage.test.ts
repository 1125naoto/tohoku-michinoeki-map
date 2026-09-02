/**
 * 保存まわりの機能テスト（仕様§18の一部）:
 * 状態遷移・スタンプ別管理・壊れたデータへの耐性。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  KEYS,
  applyStamp,
  applyStatus,
  clearAllUserData,
  loadRoutes,
  loadTrip,
  loadVisits,
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

describe('訪問記録の状態遷移', () => {
  it('未訪問→訪問済みに変更でき、訪問日時が記録される', () => {
    const now = new Date('2026-09-02T10:00:00Z');
    const m = applyStatus({}, 'mne-1', 'visited', now);
    expect(m['mne-1'].status).toBe('visited');
    expect(m['mne-1'].visitedAt).toBe(now.toISOString());
  });

  it('訪問済み→未訪問へ戻すと訪問日時が消える', () => {
    let m = applyStatus({}, 'mne-1', 'visited');
    m = applyStatus(m, 'mne-1', 'none');
    expect(m['mne-1'].status).toBe('none');
    expect(m['mne-1'].visitedAt).toBeNull();
  });

  it('行きたいへ変更できる', () => {
    const m = applyStatus({}, 'mne-1', 'want');
    expect(m['mne-1'].status).toBe('want');
    expect(m['mne-1'].visitedAt).toBeNull();
  });

  it('スタンプ取得は訪問と別に記録され、状態も訪問済みになる', () => {
    const now = new Date('2026-09-02T11:30:00Z');
    const m = applyStamp({}, 'mne-1', true, now);
    expect(m['mne-1'].stamp).toBe(true);
    expect(m['mne-1'].stampAt).toBe(now.toISOString());
    expect(m['mne-1'].status).toBe('visited');
    // 内部では訪問日時とスタンプ日時が別フィールド
    expect(m['mne-1'].visitedAt).not.toBeUndefined();
  });

  it('スタンプ取消では訪問済み状態は維持される', () => {
    let m = applyStamp({}, 'mne-1', true);
    m = applyStamp(m, 'mne-1', false);
    expect(m['mne-1'].stamp).toBe(false);
    expect(m['mne-1'].stampAt).toBeNull();
    expect(m['mne-1'].status).toBe('visited');
  });
});

describe('永続化と耐障害性', () => {
  it('保存して再読み込みしても記録が残る', () => {
    const m = applyStatus({}, 'mne-42', 'visited');
    saveVisits(m);
    const loaded = loadVisits();
    expect(loaded['mne-42'].status).toBe('visited');
  });

  it('壊れたJSONでも落ちず、空データで継続し、元データを退避する', () => {
    localStorage.setItem(KEYS.visits, '{broken json!!');
    expect(() => loadVisits()).not.toThrow();
    expect(loadVisits()).toEqual({});
    // 退避されている
    const backupKeys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
    expect(backupKeys.some((k) => k?.startsWith(`${KEYS.visits}.corrupt.`))).toBe(true);
  });

  it('型が不正なデータでも落ちない', () => {
    localStorage.setItem(KEYS.visits, JSON.stringify({ a: { status: 'INVALID' } }));
    expect(loadVisits()).toEqual({});
    localStorage.setItem(KEYS.routes, JSON.stringify([{ nonsense: 1 }]));
    expect(loadRoutes()).toEqual([]);
    localStorage.setItem(KEYS.trip, JSON.stringify(12345));
    expect(loadTrip()).toBeNull();
  });

  it('マスターデータ更新後も記録が駅IDで引ける（IDのみ参照の分離設計）', () => {
    const m = applyStatus({}, 'mne-18900', 'visited');
    saveVisits(m);
    // 駅リストに何が起きても visits は独立して読める
    expect(loadVisits()['mne-18900'].status).toBe('visited');
  });

  it('全消去で3キーすべて消える', () => {
    saveVisits(applyStatus({}, 'x', 'visited'));
    clearAllUserData();
    expect(loadVisits()).toEqual({});
    expect(loadRoutes()).toEqual([]);
    expect(loadTrip()).toBeNull();
  });
});
