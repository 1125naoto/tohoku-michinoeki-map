import { describe, expect, it } from 'vitest';
import { clearSelection, moveSelection, removeSelection, toggleSelection } from './routeSelection';

describe('選択のトグル', () => {
  it('未選択の駅をタップすると追加される', () => {
    const r = toggleSelection([], 'a');
    expect(r).toEqual({ ids: ['a'], result: 'added' });
  });
  it('選択済みの駅をもう一度タップすると解除される', () => {
    const r = toggleSelection(['a', 'b'], 'a');
    expect(r).toEqual({ ids: ['b'], result: 'removed' });
  });
  it('解除後は残りの駅の番号が自動的に振り直される（配列の並びがそのまま番号になる）', () => {
    const r = toggleSelection(['a', 'b', 'c'], 'a');
    expect(r.ids).toEqual(['b', 'c']); // b=①, c=②
  });
  it('上限到達時は追加せず max-reached を返す（候補を黙って捨てない）', () => {
    const ids = Array.from({ length: 5 }, (_, i) => `s${i}`);
    const r = toggleSelection(ids, 'new', 5);
    expect(r).toEqual({ ids, result: 'max-reached' });
  });
  it('同じ駅の重複追加は起きない（既に選択済みなら解除として扱う）', () => {
    const r = toggleSelection(['a'], 'a', 5);
    expect(r.ids).not.toContain('a');
  });
});

describe('全解除・個別削除', () => {
  it('removeSelectionは指定IDだけ取り除く', () => {
    expect(removeSelection(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });
  it('clearSelectionは空配列を返す', () => {
    expect(clearSelection()).toEqual([]);
  });
});

describe('並び替え', () => {
  it('上へ移動', () => {
    expect(moveSelection(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
  });
  it('下へ移動', () => {
    expect(moveSelection(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
  });
  it('範囲外への移動は何もしない', () => {
    expect(moveSelection(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveSelection(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });
});
