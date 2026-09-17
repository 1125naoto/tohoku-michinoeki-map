import { describe, expect, it } from 'vitest';
import { routeSignature } from './routeSelection';
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

describe('P1-03回帰: コースの同一性は立ち寄り先の並びだけで判定しない', () => {
  const base = {
    key: 'manual',
    title: 'コース',
    reason: '',
    stops: [
      { stationId: 'mne-1', arriveAt: '2026-01-01T01:00:00.000Z', departAt: '2026-01-01T01:30:00.000Z', stayMin: 30 },
      { stationId: 'mne-2', arriveAt: '2026-01-01T02:00:00.000Z', departAt: '2026-01-01T02:30:00.000Z', stayMin: 30 },
    ],
    legs: [],
    totalMin: 120,
    driveMin: 60,
    stayTotalMin: 60,
    marginMin: 10,
    totalKm: 50,
    newCount: 2,
    wantCount: 0,
    returnAt: '2026-01-01T03:00:00.000Z',
    roadData: 'approx' as const,
    hoursSummary: { open: 2, closing: 0, closed: 0, unknown: 0 },
    params: {
      origin: { lat: 37.4, lng: 140.3, label: 'A' },
      departAt: '2026-01-01T00:00:00.000Z',
      budgetMin: 240,
      stayMin: 30,
      returnToStart: true,
      roadPref: 'highway_ok' as const,
      priority: 'unvisited' as const,
      prefs: [],
    },
  };
  // 型の細部に依存しないよう、署名関数へ渡す最小構造だけを使う
  const asRoute = (over: Record<string, unknown> = {}) =>
    ({ ...base, ...over }) as unknown as Parameters<typeof routeSignature>[0];

  it('同じ駅・同じ順でも出発地点が違えば別コース', () => {
    const a = asRoute();
    const b = asRoute({ params: { ...base.params, origin: { lat: 38.9, lng: 139.9, label: 'B' } } });
    expect(routeSignature(a)).not.toBe(routeSignature(b));
  });

  it('同じ駅・同じ順でも出発時刻・滞在時間・道路の希望・帰着有無が違えば別コース', () => {
    const a = asRoute();
    for (const over of [
      { params: { ...base.params, departAt: '2026-01-02T00:00:00.000Z' } },
      { params: { ...base.params, stayMin: 60 } },
      { params: { ...base.params, roadPref: 'no_highway' as const } },
      { params: { ...base.params, returnToStart: false } },
    ]) {
      expect(routeSignature(a)).not.toBe(routeSignature(asRoute(over)));
    }
  });

  it('自由地点が末尾に増えれば別コース（最終目的地の違いを見落とさない）', () => {
    const a = asRoute();
    const b = asRoute({
      stops: [
        ...base.stops,
        {
          stationId: 'custom:1',
          arriveAt: '2026-01-01T03:00:00.000Z',
          departAt: '2026-01-01T03:30:00.000Z',
          stayMin: 30,
          stopType: 'custom' as const,
        },
      ],
    });
    expect(routeSignature(a)).not.toBe(routeSignature(b));
  });

  it('同一内容なら同じ署名になる（保存済みコースの再開は再利用できる）', () => {
    expect(routeSignature(asRoute())).toBe(routeSignature(asRoute()));
  });
});
