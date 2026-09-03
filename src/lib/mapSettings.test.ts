import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MAP_SETTINGS,
  LABEL_ZOOM_ALL,
  LABEL_ZOOM_PARTIAL,
  MAP_SETTINGS_KEY,
  MARKER_ZOOM_DETAIL,
  MARKER_ZOOM_MEDIUM,
  loadMapSettings,
  saveMapSettings,
  zoomClasses,
} from './mapSettings';

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

describe('地図表示設定', () => {
  it('初期値は全駅表示・駅名自動', () => {
    expect(loadMapSettings()).toEqual(DEFAULT_MAP_SETTINGS);
    expect(DEFAULT_MAP_SETTINGS.markerMode).toBe('all');
    expect(DEFAULT_MAP_SETTINGS.labelMode).toBe('auto');
  });
  it('保存→読み込みで維持される', () => {
    saveMapSettings({ markerMode: 'cluster', labelMode: 'always' });
    expect(loadMapSettings()).toEqual({ markerMode: 'cluster', labelMode: 'always' });
  });
  it('壊れた値は初期値へフォールバック（訪問記録v2キーには触れない）', () => {
    localStorage.setItem(MAP_SETTINGS_KEY, '{bad json');
    expect(loadMapSettings()).toEqual(DEFAULT_MAP_SETTINGS);
    localStorage.setItem(MAP_SETTINGS_KEY, JSON.stringify({ markerMode: 'x', labelMode: 'y' }));
    expect(loadMapSettings()).toEqual(DEFAULT_MAP_SETTINGS);
    expect(localStorage.getItem('tohoku-me:visits:v2')).toBeNull();
  });
});

describe('ズーム閾値', () => {
  it('広域=小サイズ・ラベル非表示', () => {
    expect(zoomClasses(MARKER_ZOOM_MEDIUM - 1)).toEqual(['mz-wide', 'lz-hidden']);
  });
  it('県単位=中サイズ・一部ラベル', () => {
    expect(zoomClasses(LABEL_ZOOM_PARTIAL)).toEqual(['mz-medium', 'lz-partial']);
  });
  it('詳細=通常サイズ・全ラベル', () => {
    expect(zoomClasses(LABEL_ZOOM_ALL)).toEqual(['mz-detail', 'lz-all']);
    expect(zoomClasses(MARKER_ZOOM_DETAIL)).toEqual(['mz-detail', 'lz-partial']);
  });
});
