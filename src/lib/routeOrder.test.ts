/**
 * evaluateOrder/twoOptOrder の到達不能(Infinity)区間の扱いを決定的に検証する。
 *
 * 背景（Astra P1監査で指摘）: OSRMが正常応答した上で「到達不能」と判定した
 * 区間(Infinity)を、呼び出し側(planner.ts/manualRoute.ts)が概算値へ無条件で
 * 置き換えてしまうと、実際には車で移動できない区間が「実道路時間を使用」と
 * 表示されるコースに紛れ込む可能性があった。evaluateOrder自体はfallback省略時
 * には到達不能を含む並びをnullとして拒否し、fallback指定時のみ明示的に
 * hasUnreachableLegを立てて許容する。
 */
import { describe, expect, it } from 'vitest';
import { evaluateOrder, twoOptOrder, type OrderItem } from './routeOrder';
import type { RouteMatrix } from './routing';

interface Item extends OrderItem {
  id: string;
}

const A: Item = { id: 'a', mi: 1 };
const B: Item = { id: 'b', mi: 2 };
const C: Item = { id: 'c', mi: 3 };

/** 0=出発地点, 1=A, 2=B, 3=C。matrix[i][j] = i→jの所要時間(分)/距離(km) */
function makeMatrix(overrides: Record<string, number> = {}): RouteMatrix {
  const n = 4;
  const durationsMin: number[][] = [];
  const distancesKm: number[][] = [];
  for (let i = 0; i < n; i++) {
    durationsMin.push([]);
    distancesKm.push([]);
    for (let j = 0; j < n; j++) {
      const key = `${i}-${j}`;
      const d = i === j ? 0 : (overrides[key] ?? 10);
      durationsMin[i].push(d);
      distancesKm[i].push(i === j ? 0 : d); // 分=kmとして単純化（テストの可読性のため）
    }
  }
  return { durationsMin, distancesKm };
}

describe('evaluateOrder（到達不能区間の扱い）', () => {
  it('正常（全区間到達可能）なら普通に合計を返す', () => {
    const matrix = makeMatrix();
    const ev = evaluateOrder([A, B], matrix, 30, false);
    expect(ev).not.toBeNull();
    expect(ev!.hasUnreachableLeg).toBeFalsy();
    expect(ev!.driveMin).toBe(20); // 0→A(10) + A→B(10)
  });

  it('一部到達不能(Infinity)・fallback省略時はnullを返す（自動コース作成の既定動作）', () => {
    const matrix = makeMatrix({ '1-2': Number.POSITIVE_INFINITY }); // A→B が到達不能
    const ev = evaluateOrder([A, B], matrix, 30, false);
    expect(ev).toBeNull();
  });

  it('全区間到達不能・fallback省略時もnullを返す（離島/海峡相当）', () => {
    const matrix = makeMatrix({ '0-1': Number.POSITIVE_INFINITY, '1-2': Number.POSITIVE_INFINITY });
    expect(evaluateOrder([A, B], matrix, 30, false)).toBeNull();
  });

  it('一部到達不能・fallback指定時は概算で補い、hasUnreachableLeg=trueで成立させる', () => {
    const matrix = makeMatrix({ '1-2': Number.POSITIVE_INFINITY }); // A→B が到達不能
    const fallback = makeMatrix({ '1-2': 99 }); // 概算モデルならA→Bは99分
    const ev = evaluateOrder([A, B], matrix, 30, false, fallback);
    expect(ev).not.toBeNull();
    expect(ev!.hasUnreachableLeg).toBe(true);
    expect(ev!.driveMin).toBe(10 + 99); // 0→A(10・実道路) + A→B(99・fallback)
  });

  it('通信障害相当（呼び出し側がmatrix自体をfallbackにしている場合）はhasUnreachableLegを立てない', () => {
    // matrix自体が概算行列のケース（fallbackを渡さない = 到達不能セルは元々存在しない）
    const matrix = makeMatrix();
    const ev = evaluateOrder([A, B], matrix, 30, false);
    expect(ev!.hasUnreachableLeg).toBeFalsy();
  });

  it('帰路(returnToStart)の到達不能もfallbackで補える', () => {
    const matrix = makeMatrix({ '1-0': Number.POSITIVE_INFINITY }); // A→出発地点(帰路)が到達不能
    const fallback = makeMatrix({ '1-0': 55 });
    const ev = evaluateOrder([A], matrix, 30, true, fallback);
    expect(ev).not.toBeNull();
    expect(ev!.hasUnreachableLeg).toBe(true);
  });

  it('providerが返したmatrixオブジェクト自体は一切書き換えない（呼び出し側の責務の確認）', () => {
    const matrix = makeMatrix({ '1-2': Number.POSITIVE_INFINITY });
    // JSON往復はInfinityをnullに変えてしまうため、Infinityを保持できる複製手段を使う
    const before = { durationsMin: matrix.durationsMin.map((r) => [...r]), distancesKm: matrix.distancesKm.map((r) => [...r]) };
    const fallback = makeMatrix({ '1-2': 99 });
    evaluateOrder([A, B], matrix, 30, false, fallback);
    expect(matrix).toEqual(before); // evaluateOrder自体はmatrixを読むだけでmutationしない
  });
});

describe('twoOptOrder（到達不能区間を含む並びの改善）', () => {
  it('fallback省略時、到達不能を含む改善案は採用せず元の並びを返す', () => {
    // A→B→C の順で、A→Bが到達不能。2-optがこの並びを「採用不可」として弾けることを確認
    const matrix = makeMatrix({ '1-2': Number.POSITIVE_INFINITY });
    const result = twoOptOrder([A, B, C], matrix, 30, false);
    // 初期評価(bestEv)がnullになるため、2-optは何もせず元の並びをそのまま返す
    expect(result).toEqual([A, B, C]);
  });

  it('fallback指定時は到達不能を含んでいても改善計算を継続できる', () => {
    const matrix = makeMatrix({ '1-2': Number.POSITIVE_INFINITY });
    const fallback = makeMatrix({ '1-2': 99 });
    const result = twoOptOrder([A, B, C], matrix, 30, false, fallback);
    expect(result.length).toBe(3);
  });
});
