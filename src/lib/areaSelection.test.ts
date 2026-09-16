import { beforeEach, describe, expect, it } from 'vitest';
import {
  AREA_SELECTION_KEY,
  AREA_SESSION_KEY,
  isAreaChosenThisSession,
  loadAreaSelection,
  markAreaChosenThisSession,
  saveAreaSelection,
} from './areaSelection';
import { KEYS } from './storage';
import { MAP_SETTINGS_KEY } from './mapSettings';
import { prefecturesInArea } from './ui';

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
  (globalThis as { sessionStorage?: Storage }).sessionStorage = new MemoryStorage();
});

describe('COLD START / BACKGROUND RESUME の区別（セッション印）', () => {
  it('新しいセッションでは未通過（＝地域選択画面から始まる）', () => {
    expect(isAreaChosenThisSession()).toBe(false);
  });

  it('一度通過すると同一セッション中は通過済みのまま（復帰・再読み込みで入口へ戻さない）', () => {
    markAreaChosenThisSession();
    expect(isAreaChosenThisSession()).toBe(true);
  });

  it('保存済みの県があってもセッション印がなければ未通過（前回県での自動スタートはしない）', () => {
    saveAreaSelection(['福島県']);
    expect(loadAreaSelection()).toEqual({ prefectures: ['福島県'] });
    expect(isAreaChosenThisSession()).toBe(false);
  });

  it('セッション印はsessionStorage側のみで、永続データのキーには書き込まない', () => {
    markAreaChosenThisSession();
    expect(sessionStorage.getItem(AREA_SESSION_KEY)).toBe('1');
    expect(localStorage.getItem(AREA_SESSION_KEY)).toBeNull();
    expect(localStorage.getItem(KEYS.visits)).toBeNull();
    expect(localStorage.getItem(KEYS.routes)).toBeNull();
    expect(localStorage.getItem(KEYS.trip)).toBeNull();
  });
});

describe('地域選択（「どこを旅しますか？」）の保存', () => {
  it('初回は未選択（null）＝地域選択画面を出す条件になる', () => {
    expect(loadAreaSelection()).toBeNull();
  });

  it('地方を選ぶとその地方の都道府県一式が保存され、次回は前回状態から再開できる', () => {
    const tohoku = prefecturesInArea('東北');
    saveAreaSelection(tohoku);
    expect(loadAreaSelection()).toEqual({ prefectures: tohoku });
  });

  it('都道府県を選んだ場合もそのまま保存される', () => {
    saveAreaSelection(['福島県']);
    expect(loadAreaSelection()).toEqual({ prefectures: ['福島県'] });
  });

  it('「全国を見る」（空配列）も選択済みとして保存され、nullとは区別される', () => {
    saveAreaSelection([]);
    expect(loadAreaSelection()).toEqual({ prefectures: [] });
    expect(loadAreaSelection()).not.toBeNull();
  });

  it('壊れた値・未知の県名では落ちず、既知の県名だけが残る', () => {
    localStorage.setItem(AREA_SELECTION_KEY, '{bad json');
    expect(loadAreaSelection()).toBeNull();
    localStorage.setItem(AREA_SELECTION_KEY, JSON.stringify({ prefectures: ['福島県', '架空県', 123] }));
    expect(loadAreaSelection()).toEqual({ prefectures: ['福島県'] });
    localStorage.setItem(AREA_SELECTION_KEY, JSON.stringify({ prefectures: 'not-an-array' }));
    expect(loadAreaSelection()).toBeNull();
  });

  it('既存ユーザーデータのキー（訪問記録・保存ルート・旅行中・地図設定）には一切書き込まない', () => {
    saveAreaSelection(['福島県']);
    loadAreaSelection();
    expect(localStorage.getItem(KEYS.visits)).toBeNull();
    expect(localStorage.getItem(KEYS.routes)).toBeNull();
    expect(localStorage.getItem(KEYS.trip)).toBeNull();
    expect(localStorage.getItem(MAP_SETTINGS_KEY)).toBeNull();
  });

  it('既存の訪問記録が入っていても、地域選択の保存で消えない', () => {
    localStorage.setItem(KEYS.visits, JSON.stringify({ 'mne-18900': { state: 'stamped' } }));
    localStorage.setItem(KEYS.routes, JSON.stringify([{ id: 'r1' }]));
    saveAreaSelection(prefecturesInArea('東北'));
    expect(localStorage.getItem(KEYS.visits)).toContain('stamped');
    expect(localStorage.getItem(KEYS.routes)).toContain('r1');
  });

  it('保存キーは既存キーと衝突しない専用キーである', () => {
    expect(AREA_SELECTION_KEY).toContain('area-selection');
    expect(AREA_SELECTION_KEY).not.toBe(KEYS.visits);
    expect(AREA_SELECTION_KEY).not.toBe(KEYS.routes);
    expect(AREA_SELECTION_KEY).not.toBe(KEYS.trip);
    expect(AREA_SELECTION_KEY).not.toBe(MAP_SETTINGS_KEY);
  });
});
