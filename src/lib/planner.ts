/**
 * 週末周遊ルートの提案アルゴリズム。
 * 使用可能時間 = 移動 + 各駅の滞在 + （帰着ありなら）帰路 をすべて含む。
 * 距離・時間は概算モデル（geo.ts）。実測ではないことをUIで必ず明示する。
 *
 * アルゴリズム: 候補絞り込み → 貪欲挿入法（時間予算内・優先度重み付き）→ 2-opt改善。
 */
import type { PlanParams, PlannedRoute, RouteLeg, RouteStop, Station, VisitMap } from '../types';
import { estimateLegMin, haversineKm, roadDistanceKm, type LatLng } from './geo';

interface Candidate {
  st: Station;
  want: boolean;
  visited: boolean;
}

/** ルート対象になり得る駅か（開業前・休止は常に除外） */
export function isRoutable(st: Station): boolean {
  return st.status === 'open';
}

function buildCandidates(stations: Station[], visits: VisitMap, p: PlanParams): Candidate[] {
  const originPref = nearestPref(stations, p.origin);
  return stations
    .filter(isRoutable)
    // 出発地点そのもの（出発地に指定した道の駅）は候補から除外
    .filter((st) => haversineKm(p.origin, st) > 0.05)
    .filter((st) => (p.prefs.length === 0 ? true : p.prefs.includes(st.pref)))
    .filter((st) => (p.crossPref ? true : st.pref === (p.prefs.length === 1 ? p.prefs[0] : originPref)))
    .map((st) => {
      const rec = visits[st.id];
      return {
        st,
        want: rec?.status === 'want',
        visited: rec?.status === 'visited',
      };
    })
    .filter((c) => {
      if (p.target === 'all') return true;
      return !c.visited; // unvisited / want_priority は訪問済みを除外
    });
}

function nearestPref(stations: Station[], origin: LatLng): string {
  let best = Infinity;
  let pref = '';
  for (const st of stations) {
    const d = haversineKm(origin, st);
    if (d < best) {
      best = d;
      pref = st.pref;
    }
  }
  return pref;
}

interface BuiltRoute {
  order: Candidate[];
  totalMin: number;
  totalKm: number;
}

/** 訪問順 order に対する総所要時間・距離を計算 */
function evaluate(order: Candidate[], p: PlanParams, departAt: Date): BuiltRoute | null {
  let totalMin = 0;
  let totalKm = 0;
  let cur: LatLng = p.origin;
  for (const c of order) {
    totalMin += estimateLegMin(cur, c.st, p.useHighway, departAt) + p.stayMin;
    totalKm += roadDistanceKm(cur, c.st);
    cur = c.st;
  }
  if (p.returnToStart && order.length > 0) {
    totalMin += estimateLegMin(cur, p.origin, p.useHighway, departAt);
    totalKm += roadDistanceKm(cur, p.origin);
  }
  if (totalMin > p.budgetMin) return null;
  return { order, totalMin, totalKm };
}

/** 貪欲挿入法: 予算内に収まる限り、重み付き追加コスト最小の駅を挿入 */
function greedyInsert(cands: Candidate[], p: PlanParams, departAt: Date, wantWeight: number, maxStops: number): Candidate[] {
  // 到達可能圏で粗く絞る（往復を想定して予算の半分で行ける範囲 + 余裕1.2倍）
  const reachableKm = ((p.budgetMin / 60) * 60 * 1.2) / 2;
  let pool = cands.filter((c) => haversineKm(p.origin, c.st) < reachableKm);
  let order: Candidate[] = [];

  while (order.length < maxStops) {
    let bestScore = Infinity;
    let bestOrder: Candidate[] | null = null;
    let bestCand: Candidate | null = null;
    for (const c of pool) {
      for (let i = 0; i <= order.length; i++) {
        const trial = [...order.slice(0, i), c, ...order.slice(i)];
        const ev = evaluate(trial, p, departAt);
        if (!ev) continue;
        const prev = evaluate(order, p, departAt);
        const added = ev.totalMin - (prev?.totalMin ?? 0);
        const weight = c.want ? wantWeight : 1;
        const score = added / weight;
        if (score < bestScore) {
          bestScore = score;
          bestOrder = trial;
          bestCand = c;
        }
      }
    }
    if (!bestOrder || !bestCand) break;
    order = bestOrder;
    pool = pool.filter((c) => c !== bestCand);
  }
  return order;
}

/** 2-opt: 訪問順の交差を解消して総時間を縮める（過度な往復の抑制） */
function twoOpt(order: Candidate[], p: PlanParams, departAt: Date): Candidate[] {
  if (order.length < 3) return order;
  let best = order;
  let bestEv = evaluate(best, p, departAt);
  if (!bestEv) return order;
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const trial = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
        const ev = evaluate(trial, p, departAt);
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

function toPlanned(key: string, title: string, order: Candidate[], p: PlanParams): PlannedRoute | null {
  const departAt = new Date(p.departAt);
  const ev = evaluate(order, p, departAt);
  if (!ev || order.length === 0) return null;
  const stops: RouteStop[] = [];
  const legs: RouteLeg[] = [];
  let t = new Date(departAt);
  let cur: LatLng = p.origin;
  let curId: string | null = null;
  for (const c of order) {
    const driveMin = estimateLegMin(cur, c.st, p.useHighway, departAt);
    const distanceKm = roadDistanceKm(cur, c.st);
    legs.push({ fromId: curId, toId: c.st.id, distanceKm: Math.round(distanceKm * 10) / 10, driveMin });
    t = new Date(t.getTime() + driveMin * 60000);
    const arriveAt = t.toISOString();
    t = new Date(t.getTime() + p.stayMin * 60000);
    stops.push({ stationId: c.st.id, arriveAt, departAt: t.toISOString(), stayMin: p.stayMin });
    cur = c.st;
    curId = c.st.id;
  }
  if (p.returnToStart) {
    const driveMin = estimateLegMin(cur, p.origin, p.useHighway, departAt);
    legs.push({ fromId: curId, toId: null, distanceKm: Math.round(roadDistanceKm(cur, p.origin) * 10) / 10, driveMin });
    t = new Date(t.getTime() + driveMin * 60000);
  }
  const newCount = order.filter((c) => !c.visited).length;
  return {
    key,
    title,
    params: p,
    stops,
    legs,
    totalMin: ev.totalMin,
    totalKm: Math.round(ev.totalKm * 10) / 10,
    newCount,
    returnAt: t.toISOString(),
  };
}

/** ルート候補を最大3種類生成する */
export function planRoutes(stations: Station[], visits: VisitMap, p: PlanParams): PlannedRoute[] {
  const departAt = new Date(p.departAt);
  const cands = buildCandidates(stations, visits, p);
  if (cands.length === 0) return [];

  const results: PlannedRoute[] = [];
  const seen = new Set<string>();
  const push = (r: PlannedRoute | null) => {
    if (!r) return;
    // 駅順が同じでも滞在時間が異なれば別コースとして提示する
    const sig = `${r.stops.map((s) => s.stationId).join('>')}::${r.params.stayMin}`;
    if (r.stops.length > 0 && !seen.has(sig)) {
      seen.add(sig);
      results.push(r);
    }
  };

  // 1. 最多制覇コース
  const maxOrder = twoOpt(greedyInsert(cands, p, departAt, 1.5, p.maxStops), p, departAt);
  push(toPlanned('max', '最多制覇コース', maxOrder, p));

  // 2. ゆったりコース（滞在+15分・立ち寄りは最大3駅）
  const relaxedParams: PlanParams = { ...p, stayMin: p.stayMin + 15, maxStops: Math.min(3, p.maxStops) };
  const relaxedOrder = twoOpt(
    greedyInsert(cands, relaxedParams, departAt, 1.5, relaxedParams.maxStops),
    relaxedParams,
    departAt,
  );
  push(toPlanned('relaxed', 'ゆったりコース', relaxedOrder, relaxedParams));

  // 3. 行きたい優先コース（行きたい駅がある場合のみ）
  if (cands.some((c) => c.want)) {
    const wantOrder = twoOpt(greedyInsert(cands, p, departAt, 6, p.maxStops), p, departAt);
    push(toPlanned('want', '行きたい優先コース', wantOrder, p));
  }

  return results;
}
