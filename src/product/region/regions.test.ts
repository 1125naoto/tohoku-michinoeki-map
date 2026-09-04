import { describe, expect, it } from 'vitest';
import {
  PREFECTURE_TABLE,
  REGION_IDS,
  REGION_NAMES,
  prefectureByCode,
  prefectureByName,
  prefecturesInRegion,
} from './regions';

describe('PREFECTURE_TABLE', () => {
  it('全47都道府県を含む', () => {
    expect(PREFECTURE_TABLE).toHaveLength(47);
  });
  it('コードは01〜47で重複がない', () => {
    const codes = PREFECTURE_TABLE.map((p) => p.code);
    expect(new Set(codes).size).toBe(47);
    expect(codes[0]).toBe('01');
    expect(codes[46]).toBe('47');
  });
  it('都道府県名に重複がない', () => {
    const names = PREFECTURE_TABLE.map((p) => p.name);
    expect(new Set(names).size).toBe(47);
  });
  it('すべてのregionIdがREGION_IDSに含まれる', () => {
    for (const p of PREFECTURE_TABLE) {
      expect(REGION_IDS).toContain(p.regionId);
    }
  });
});

describe('REGION_NAMES', () => {
  it('全REGION_IDSに日本語名がある', () => {
    for (const id of REGION_IDS) {
      expect(REGION_NAMES[id]).toBeTruthy();
    }
  });
});

describe('prefectureByName / prefectureByCode', () => {
  it('東北6県を正しく解決する（既存アプリの互換性の要）', () => {
    const tohoku = ['青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県'];
    for (const name of tohoku) {
      const p = prefectureByName(name);
      expect(p).toBeDefined();
      expect(p?.regionId).toBe('tohoku');
    }
  });
  it('コードから逆引きできる', () => {
    expect(prefectureByCode('13')?.name).toBe('東京都');
    expect(prefectureByCode('47')?.name).toBe('沖縄県');
  });
  it('未知の名前・コードはundefinedを返す', () => {
    expect(prefectureByName('存在しない県')).toBeUndefined();
    expect(prefectureByCode('99')).toBeUndefined();
  });
});

describe('prefecturesInRegion', () => {
  it('北海道は1県のみ', () => {
    expect(prefecturesInRegion('hokkaido')).toHaveLength(1);
  });
  it('東北は6県', () => {
    expect(prefecturesInRegion('tohoku')).toHaveLength(6);
  });
  it('全地方の合計が47県になる', () => {
    const total = REGION_IDS.reduce((sum, id) => sum + prefecturesInRegion(id).length, 0);
    expect(total).toBe(47);
  });
});
