import { describe, expect, it } from 'vitest';
import { filterSummary } from './ui';

describe('絞り込みサマリー', () => {
  it('未選択時は「東北全体・すべて」', () => {
    expect(filterSummary(null, 'all')).toBe('絞り込み：東北全体・すべて');
  });
  it('県と状態を反映する', () => {
    expect(filterSummary('宮城県', 'visited')).toBe('絞り込み：宮城県・訪問済み');
    expect(filterSummary('青森県', 'stamp')).toBe('絞り込み：青森県・スタンプ済み');
  });
});
