/**
 * 訪問順の評価・改善（自動コース作成・地図から選ぶルート作成の両方から使う共通ロジック）。
 * 駅集合の絞り込み方法（自動選定 or ユーザーの手動選択）が違うだけで、
 * 「所要時間行列から順序を評価する」「2-optで改善する」計算自体は同一のため、
 * ここへ切り出して重複実装を避けている。
 */
import type { RouteMatrix } from './routing';

/** 所要時間行列上の位置（0=出発地点）だけを要求する最小インターフェース */
export interface OrderItem {
  /** 行列内のインデックス（0=出発地点） */
  mi: number;
}

export interface OrderEval {
  totalMin: number;
  driveMin: number;
  totalKm: number;
}

/**
 * 各地点の滞在時間。数値なら全地点一律（自動コース作成のように滞在時間が
 * 全駅共通の場合）、関数なら地点ごとに個別の滞在時間を返す（道の駅とPOIが
 * 混在する「地図から選ぶ」ルートのように、地点ごとに滞在時間が異なる場合）。
 */
type StayMinSpec<T> = number | ((item: T) => number);

function stayOf<T>(spec: StayMinSpec<T>, item: T): number {
  return typeof spec === 'function' ? spec(item) : spec;
}

/** 訪問順に対する 移動+滞在 の合計（分・区間ごとに切り上げで丸め超過を防止） */
export function evaluateOrder<T extends OrderItem>(
  order: T[],
  matrix: RouteMatrix,
  stayMin: StayMinSpec<T>,
  returnToStart: boolean,
): OrderEval | null {
  let drive = 0;
  let km = 0;
  let stay = 0;
  let cur = 0; // 行列index（0=出発地点）
  for (const c of order) {
    const t = matrix.durationsMin[cur][c.mi];
    const d = matrix.distancesKm[cur][c.mi];
    if (!Number.isFinite(t)) return null;
    drive += Math.ceil(t);
    km += d;
    stay += stayOf(stayMin, c);
    cur = c.mi;
  }
  if (returnToStart && order.length > 0) {
    const t = matrix.durationsMin[cur][0];
    if (!Number.isFinite(t)) return null;
    drive += Math.ceil(t);
    km += matrix.distancesKm[cur][0];
  }
  const totalMin = drive + stay;
  return { totalMin, driveMin: drive, totalKm: km };
}

/** 2-opt: 過度な往復（順序の交差）を解消する（帰路を含めて評価するため帰着ONも考慮済み） */
export function twoOptOrder<T extends OrderItem>(
  order: T[],
  matrix: RouteMatrix,
  stayMin: StayMinSpec<T>,
  returnToStart: boolean,
): T[] {
  if (order.length < 3) return order;
  let best = order;
  let bestEv = evaluateOrder(best, matrix, stayMin, returnToStart);
  if (!bestEv) return order;
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const trial = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
        const ev = evaluateOrder(trial, matrix, stayMin, returnToStart);
        if (ev && bestEv && ev.totalMin < bestEv.totalMin) {
          best = trial;
          bestEv = ev;
          improved = true;
        }
      }
    }
  }
  return best;
}
