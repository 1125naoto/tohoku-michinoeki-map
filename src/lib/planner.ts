/**
 * 周遊コースの自動作成。
 *
 * お出かけ時間には「出発地点→最初の駅」「駅間の移動」「各駅の滞在」「帰路（帰着ON時）」
 * 「安全余裕」をすべて含め、超過するコースは絶対に返さない。
 *
 * 所要時間は RoutingProvider（OSRM実道路時間）を優先し、取得できない場合は
 * 概算モデル（geo.ts）へフォールバックする。どちらを使ったかは roadData で返す。
 *
 * アルゴリズム: 直線距離で候補を最大22駅へ絞り込み → 所要時間行列を1回取得 →
 * 貪欲挿入法（優先条件による重み付き）→ 2-opt改善。コースは最大3案
 * （制覇数優先 / バランス / ゆったり）を生成する。
 */
import type { PlanParams, PlannedRoute, RouteLeg, RouteStop, Station, VisitMap } from '../types';
import { estimateLegMin, formatMin, haversineKm, roadDistanceKm, type LatLng } from './geo';
import { osrmProvider, type RouteMatrix, type RoutingProvider } from './routing';

/** ルート対象になり得る駅か（開業前(upcoming)・休止は常に除外） */
export function isRoutable(st: Station): boolean {
  return st.status === 'open';
}

export interface PlanResult {
  courses: PlannedRoute[];
  roadData: 'road' | 'approx';
}

interface Candidate {
  st: Station;
  /** 行きたい(wishlist) */
  want: boolean;
  /** 既に訪問済み/スタンプ済みか（newCount計算用） */
  visitedAlready: boolean;
  /** 行列内のインデックス（0=出発地点） */
  mi: number;
}

const MAX_MATRIX_STATIONS = 22;

function nearestPref(stations: Station[], origin: LatLng): string {
  let best = Number.POSITIVE_INFINITY;
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

function buildCandidates(stations: Station[], visits: VisitMap, p: PlanParams): Candidate[] {
  const originPref = nearestPref(stations, p.origin);
  const targetPref = p.crossPref ? null : p.prefs.length === 1 ? p.prefs[0] : originPref;
  const list = stations
    .filter(isRoutable)
    .filter((st) => haversineKm(p.origin, st) > 0.05) // 出発地点と同位置の駅は除外
    .filter((st) => (p.prefs.length === 0 ? true : p.prefs.includes(st.pref)))
    .filter((st) => (targetPref ? st.pref === targetPref : true))
    .map((st) => {
      const state = visits[st.id]?.state ?? 'unvisited';
      return { st, state };
    })
    .filter(({ state }) => {
      if (state === 'visited') return p.includeVisited;
      if (state === 'stamped') return p.includeStamped;
      return true; // unvisited / wishlist は常に候補
    })
    .map(({ st, state }) => ({
      st,
      want: state === 'wishlist',
      visitedAlready: state === 'visited' || state === 'stamped',
      mi: -1,
    }));
  // 直線距離で近い順に絞る（実道路リクエストを最小化）
  list.sort((a, b) => haversineKm(p.origin, a.st) - haversineKm(p.origin, b.st));
  return list.slice(0, MAX_MATRIX_STATIONS);
}

/** 概算モデルで行列を作る（フォールバック） */
function estimateMatrix(points: LatLng[], p: PlanParams): RouteMatrix {
  const departAt = new Date(p.departAt);
  const highway = p.roadPref === 'highway_ok';
  const n = points.length;
  const durationsMin: number[][] = [];
  const distancesKm: number[][] = [];
  for (let i = 0; i < n; i++) {
    durationsMin.push([]);
    distancesKm.push([]);
    for (let j = 0; j < n; j++) {
      if (i === j) {
        durationsMin[i].push(0);
        distancesKm[i].push(0);
      } else {
        durationsMin[i].push(estimateLegMin(points[i], points[j], highway, departAt));
        distancesKm[i].push(roadDistanceKm(points[i], points[j]));
      }
    }
  }
  return { durationsMin, distancesKm };
}

interface CourseSpec {
  key: string;
  title: string;
  /** 安全余裕: max(floorMin, budget*pct) */
  marginPct: number;
  marginFloor: number;
  capStops: (maxStops: number, bestCount: number) => number;
  wantWeight: (p: PlanParams) => number;
}

const COURSE_SPECS: CourseSpec[] = [
  {
    key: 'max',
    title: '制覇数優先コース',
    marginPct: 0.06,
    marginFloor: 8,
    capStops: (max) => max,
    wantWeight: (p) => (p.priority === 'wishlist' ? 6 : p.priority === 'nearest' ? 1 : 1.3),
  },
  {
    key: 'balance',
    title: 'バランスコース',
    marginPct: 0.1,
    marginFloor: 10,
    capStops: (max, best) => Math.max(1, Math.min(max, Math.ceil(best * 0.8))),
    wantWeight: (p) => (p.priority === 'wishlist' ? 6 : 1.2),
  },
  {
    key: 'relax',
    title: 'ゆったりコース',
    marginPct: 0.18,
    marginFloor: 15,
    capStops: (max, best) => Math.max(1, Math.min(max, 4, best - 1 || 1)),
    wantWeight: (p) => (p.priority === 'wishlist' ? 6 : 1.2),
  },
];

/** 訪問順に対する 移動+滞在 の合計（分・区間ごとに切り上げで丸め超過を防止） */
function evaluate(
  order: Candidate[],
  matrix: RouteMatrix,
  p: PlanParams,
): { totalMin: number; driveMin: number; totalKm: number } | null {
  let drive = 0;
  let km = 0;
  let cur = 0; // 行列index（0=出発地点）
  for (const c of order) {
    const t = matrix.durationsMin[cur][c.mi];
    const d = matrix.distancesKm[cur][c.mi];
    if (!Number.isFinite(t)) return null;
    drive += Math.ceil(t);
    km += d;
    cur = c.mi;
  }
  if (p.returnToStart && order.length > 0) {
    const t = matrix.durationsMin[cur][0];
    if (!Number.isFinite(t)) return null;
    drive += Math.ceil(t);
    km += matrix.distancesKm[cur][0];
  }
  const totalMin = drive + order.length * p.stayMin;
  return { totalMin, driveMin: drive, totalKm: km };
}

function greedyInsert(
  cands: Candidate[],
  matrix: RouteMatrix,
  p: PlanParams,
  effectiveBudget: number,
  wantWeight: number,
  maxStops: number,
): Candidate[] {
  let pool = [...cands];
  let order: Candidate[] = [];
  while (order.length < maxStops) {
    let bestScore = Number.POSITIVE_INFINITY;
    let bestOrder: Candidate[] | null = null;
    let bestCand: Candidate | null = null;
    const prevEv = evaluate(order, matrix, p);
    for (const c of pool) {
      for (let i = 0; i <= order.length; i++) {
        const trial = [...order.slice(0, i), c, ...order.slice(i)];
        const ev = evaluate(trial, matrix, p);
        if (!ev || ev.totalMin > effectiveBudget) continue;
        const added = ev.totalMin - (prevEv?.totalMin ?? 0);
        const score = added / (c.want ? wantWeight : 1);
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

/** 2-opt: 過度な往復（順序の交差）を解消 */
function twoOpt(order: Candidate[], matrix: RouteMatrix, p: PlanParams): Candidate[] {
  if (order.length < 3) return order;
  let best = order;
  let bestEv = evaluate(best, matrix, p);
  if (!bestEv) return order;
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const trial = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
        const ev = evaluate(trial, matrix, p);
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

function buildRoute(
  spec: CourseSpec,
  order: Candidate[],
  matrix: RouteMatrix,
  p: PlanParams,
  marginMin: number,
  roadData: 'road' | 'approx',
): PlannedRoute | null {
  if (order.length === 0) return null;
  const ev = evaluate(order, matrix, p);
  if (!ev) return null;
  const departAt = new Date(p.departAt);
  const stops: RouteStop[] = [];
  const legs: RouteLeg[] = [];
  let t = new Date(departAt);
  let cur = 0;
  let curId: string | null = null;
  for (const c of order) {
    const driveMin = Math.ceil(matrix.durationsMin[cur][c.mi]);
    legs.push({
      fromId: curId,
      toId: c.st.id,
      distanceKm: Math.round(matrix.distancesKm[cur][c.mi] * 10) / 10,
      driveMin,
    });
    t = new Date(t.getTime() + driveMin * 60000);
    const arriveAt = t.toISOString();
    t = new Date(t.getTime() + p.stayMin * 60000);
    stops.push({ stationId: c.st.id, arriveAt, departAt: t.toISOString(), stayMin: p.stayMin });
    cur = c.mi;
    curId = c.st.id;
  }
  if (p.returnToStart) {
    const driveMin = Math.ceil(matrix.durationsMin[cur][0]);
    legs.push({
      fromId: curId,
      toId: null,
      distanceKm: Math.round(matrix.distancesKm[cur][0] * 10) / 10,
      driveMin,
    });
    t = new Date(t.getTime() + driveMin * 60000);
  }
  const newCount = order.filter((c) => !c.visitedAlready).length;
  const wantCount = order.filter((c) => c.want).length;

  let reason: string;
  if (p.priority === 'wishlist' && wantCount > 0) {
    reason = `行きたいに登録した${wantCount}駅を優先しました`;
  } else if (spec.key === 'relax') {
    reason = `移動を抑え、${formatMin(marginMin)}の余裕を持たせたゆったりコースです`;
  } else if (spec.key === 'balance') {
    reason = '移動時間と立ち寄り数のバランスを取ったコースです';
  } else if (p.priority === 'nearest') {
    reason = '近い駅から順に効率よく回るコースです';
  } else {
    reason = `${formatMin(p.budgetMin)}以内で未訪問${newCount}駅を回れるコースです`;
  }

  return {
    key: spec.key,
    title: spec.title,
    reason,
    params: p,
    stops,
    legs,
    totalMin: ev.totalMin,
    driveMin: ev.driveMin,
    stayTotalMin: order.length * p.stayMin,
    marginMin,
    totalKm: Math.round(ev.totalKm * 10) / 10,
    newCount,
    wantCount,
    returnAt: t.toISOString(),
    roadData,
  };
}

export interface PlanOptions {
  provider?: RoutingProvider;
  signal?: AbortSignal;
}

/** コースを最大3案作成する */
export async function planCourses(
  stations: Station[],
  visits: VisitMap,
  p: PlanParams,
  opts: PlanOptions = {},
): Promise<PlanResult> {
  const cands = buildCandidates(stations, visits, p);
  if (cands.length === 0) return { courses: [], roadData: 'approx' };

  const points: LatLng[] = [p.origin, ...cands.map((c) => c.st)];
  cands.forEach((c, i) => (c.mi = i + 1));

  // 実道路時間（OSRM）→ 失敗時は概算へフォールバック
  let matrix: RouteMatrix;
  let roadData: 'road' | 'approx';
  const provider = opts.provider ?? osrmProvider;
  try {
    matrix = await provider.table(points, opts.signal);
    roadData = 'road';
    // 到達不能セルは概算で補完
    const est = estimateMatrix(points, p);
    for (let i = 0; i < points.length; i++) {
      for (let j = 0; j < points.length; j++) {
        if (!Number.isFinite(matrix.durationsMin[i][j])) {
          matrix.durationsMin[i][j] = est.durationsMin[i][j];
          matrix.distancesKm[i][j] = est.distancesKm[i][j];
        }
      }
    }
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    matrix = estimateMatrix(points, p);
    roadData = 'approx';
  }

  const results: PlannedRoute[] = [];
  const seen = new Set<string>();
  let bestCount = 0;
  for (const spec of COURSE_SPECS) {
    const marginMin = Math.max(spec.marginFloor, Math.round(p.budgetMin * spec.marginPct));
    const effectiveBudget = p.budgetMin - marginMin;
    if (effectiveBudget <= p.stayMin) continue; // 設定時間が短すぎる
    const cap = spec.capStops(p.maxStops, bestCount || p.maxStops);
    const order = twoOpt(
      greedyInsert(cands, matrix, p, effectiveBudget, spec.wantWeight(p), cap),
      matrix,
      p,
    );
    const route = buildRoute(spec, order, matrix, p, marginMin, roadData);
    if (!route) continue;
    if (spec.key === 'max') bestCount = route.stops.length;
    const sig = route.stops.map((s) => s.stationId).join('>');
    if (seen.has(sig)) continue; // 同一結果は無理に複数表示しない
    seen.add(sig);
    results.push(route);
  }

  // 行きたい優先モードでは、行きたい駅を含むコースを最上位へ
  if (p.priority === 'wishlist') {
    results.sort((a, b) => b.wantCount - a.wantCount);
  }
  return { courses: results, roadData };
}
