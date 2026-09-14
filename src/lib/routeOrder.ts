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
  /** trueなら、到達不能区間をfallback行列の概算値で補って算出した */
  hasUnreachableLeg?: boolean;
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

/**
 * 訪問順に対する 移動+滞在 の合計（分・区間ごとに切り上げで丸め超過を防止）。
 *
 * matrixが到達不能（Infinity、OSRMが正常応答した上での判定）な区間を含む場合:
 *  - fallback省略時（自動コース作成の既定動作）: nullを返し、呼び出し側
 *    （greedyInsert等）がその並び順を候補から自然に除外する
 *    （「自動提案では成立するrouteのみ採用」を満たす）。
 *  - fallback指定時（地図から選ぶルート作成）: 到達不能区間だけfallback行列の
 *    概算値で補って計算を続行し、hasUnreachableLeg=trueを返す
 *    （ユーザーが明示的に選んだ地点を勝手に落とさず、区間を明示する）。
 */
export function evaluateOrder<T extends OrderItem>(
  order: T[],
  matrix: RouteMatrix,
  stayMin: StayMinSpec<T>,
  returnToStart: boolean,
  fallback?: RouteMatrix,
): OrderEval | null {
  let drive = 0;
  let km = 0;
  let stay = 0;
  let cur = 0; // 行列index（0=出発地点）
  let hasUnreachableLeg = false;
  for (const c of order) {
    let t = matrix.durationsMin[cur][c.mi];
    let d = matrix.distancesKm[cur][c.mi];
    if (!Number.isFinite(t)) {
      if (!fallback) return null;
      t = fallback.durationsMin[cur][c.mi];
      d = fallback.distancesKm[cur][c.mi];
      hasUnreachableLeg = true;
    }
    drive += Math.ceil(t);
    km += d;
    stay += stayOf(stayMin, c);
    cur = c.mi;
  }
  if (returnToStart && order.length > 0) {
    let t = matrix.durationsMin[cur][0];
    let d = matrix.distancesKm[cur][0];
    if (!Number.isFinite(t)) {
      if (!fallback) return null;
      t = fallback.durationsMin[cur][0];
      d = fallback.distancesKm[cur][0];
      hasUnreachableLeg = true;
    }
    drive += Math.ceil(t);
    km += d;
  }
  const totalMin = drive + stay;
  return { totalMin, driveMin: drive, totalKm: km, hasUnreachableLeg };
}

/**
 * 2-opt: 過度な往復（順序の交差）を解消する（帰路を含めて評価するため帰着ONも考慮済み）。
 * fallbackは地図から選ぶルート作成でのみ指定する（§evaluateOrderの説明を参照）。
 */
export function twoOptOrder<T extends OrderItem>(
  order: T[],
  matrix: RouteMatrix,
  stayMin: StayMinSpec<T>,
  returnToStart: boolean,
  fallback?: RouteMatrix,
): T[] {
  if (order.length < 3) return order;
  let best = order;
  let bestEv = evaluateOrder(best, matrix, stayMin, returnToStart, fallback);
  if (!bestEv) return order;
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const trial = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
        const ev = evaluateOrder(trial, matrix, stayMin, returnToStart, fallback);
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
