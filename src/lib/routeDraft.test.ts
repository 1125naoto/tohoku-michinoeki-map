import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ROUTE_DRAFT, ROUTE_DRAFT_KEY, clearRouteDraft, loadRouteDraft, saveRouteDraft } from './routeDraft';

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

describe('下書きの保存・読み込み', () => {
  it('未保存時はnull', () => {
    expect(loadRouteDraft()).toBeNull();
  });
  it('保存→読み込みで内容が維持される', () => {
    const draft = { ...DEFAULT_ROUTE_DRAFT, selectedIds: ['a', 'b'], inProgress: true };
    saveRouteDraft(draft);
    const loaded = loadRouteDraft();
    expect(loaded?.selectedIds).toEqual(['a', 'b']);
    expect(loaded?.inProgress).toBe(true);
  });
  it('壊れたデータはnullを返す（アプリを落とさない）', () => {
    localStorage.setItem(ROUTE_DRAFT_KEY, '{bad json');
    expect(loadRouteDraft()).toBeNull();
    localStorage.setItem(ROUTE_DRAFT_KEY, JSON.stringify({ selectedIds: 'not-an-array' }));
    expect(loadRouteDraft()).toBeNull();
  });
  it('完成・キャンセル時にclearすると消える', () => {
    saveRouteDraft({ ...DEFAULT_ROUTE_DRAFT, selectedIds: ['a'] });
    expect(loadRouteDraft()).not.toBeNull();
    clearRouteDraft();
    expect(loadRouteDraft()).toBeNull();
  });
  it('訪問記録キーとは分離されている', () => {
    saveRouteDraft({ ...DEFAULT_ROUTE_DRAFT, selectedIds: ['a'] });
    expect(localStorage.getItem('tohoku-me:visits:v2')).toBeNull();
  });
});
