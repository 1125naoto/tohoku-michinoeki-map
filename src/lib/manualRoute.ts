/**
 * 「地図から選ぶ」ルート作成: ユーザーが選んだ駅だけを対象に順序・時間を計算する。
 *
 * 自動コース作成（planner.ts）との違いは「候補駅をアプリが自動選定するか、
 * ユーザーが手動で選ぶか」だけであり、所要時間行列の取得・順序評価・2-opt改善は
 * routeOrder.ts / planner.ts の estimateMatrix を共有し、重複実装しない。
 */
import type { PlannedRoute, PlanParams, RoadPref, RouteLeg, RouteStop, Station } from '../types';
import { estimateMatrix } from './planner';
import { osrmProvider, type RouteMatrix, type RoutingProvider } from './routing';
import { evaluateOrder, twoOptOrder, type OrderItem } from './routeOrder';
import { statusAtArrival } from './hours';

/**
 * 一度に選べる駅の上限。出発地点+選択駅数の合計地点数を、自動コース作成で
 * 本番実績のある安全上限（出発地点+22駅=23地点、planner.ts の MAX_MATRIX_STATIONS）
 * 以下に収まるよう、余裕を持たせて20駅とした。OSRM公開デモへの負荷試験は行わない
 * （「常識的な軽負荷利用」の利用規約に反するため）。
 */
export const MAX_MANUAL_STATIONS = 20;
/** コース作成に必要な最低選択数 */
export const MIN_MANUAL_STATIONS = 2;

export type ManualOrderMode = 'selected' | 'optimized';

export interface ManualPlanParams {
  origin: { lat: number; lng: number; label: string };
  departAt: string;
  stayMin: number;
  returnToStart: boolean;
  roadPref: RoadPref;
  /** null = 時間制限なし */
  budgetMin: number | null;
  orderMode: ManualOrderMode;
}

export interface ManualCandidateLike extends OrderItem {
  st: Station;
}
type ManualCandidate = ManualCandidateLike;

export interface ManualMatrixResult {
  matrix: RouteMatrix;
  roadData: 'road' | 'approx';
  /** selectedIds の順で mi(1始まり) を割り当てた候補一覧 */
  candidates: ManualCandidate[];
}

export interface ManualPlanOptions {
  provider?: RoutingProvider;
  signal?: AbortSignal;
}

/** 選択駅の所要時間行列を取得する（OSRM成功→実道路 / 失敗→概算フォールバック） */
export async function buildManualMatrix(
  stations: Station[],
  selectedIds: string[],
  p: Pick<ManualPlanParams, 'origin' | 'departAt' | 'roadPref'>,
  opts: ManualPlanOptions = {},
): Promise<ManualMatrixResult> {
  const byId = new Map(stations.map((s) => [s.id, s]));
  const selected = selectedIds.map((id) => byId.get(id)).filter((s): s is Station => !!s);
  const points = [p.origin, ...selected];
  const candidates: ManualCandidate[] = selected.map((st, i) => ({ st, mi: i + 1 }));

  const provider = opts.provider ?? osrmProvider;
  let matrix: RouteMatrix;
  let roadData: 'road' | 'approx';
  try {
    matrix = await provider.table(points, opts.signal);
    roadData = 'road';
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
  return { matrix, roadData, candidates };
}

/** 選んだ順のまま、または移動時間が短くなるよう自動調整した順序を返す */
export function orderManual(
  candidates: ManualCandidate[],
  matrix: RouteMatrix,
  p: Pick<ManualPlanParams, 'stayMin' | 'returnToStart' | 'orderMode'>,
): ManualCandidate[] {
  if (p.orderMode === 'selected') return candidates;
  return twoOptOrder(candidates, matrix, p.stayMin, p.returnToStart);
}

export function evaluateManual(
  order: ManualCandidate[],
  matrix: RouteMatrix,
  p: Pick<ManualPlanParams, 'stayMin' | 'returnToStart'>,
) {
  return evaluateOrder(order, matrix, p.stayMin, p.returnToStart);
}

export interface FitToBudgetResult {
  kept: ManualCandidate[];
  excluded: ManualCandidate[];
}

/**
 * 予算時間に収まるよう、除外すると最も時間短縮になる駅から順に取り除く（貪欲法）。
 * ユーザーの確認なしに呼び出し側で結果を確定させないこと（除外候補の提示が必須）。
 */
export function fitToBudget(
  order: ManualCandidate[],
  matrix: RouteMatrix,
  p: Pick<ManualPlanParams, 'stayMin' | 'returnToStart'>,
  budgetMin: number,
): FitToBudgetResult {
  let cur = [...order];
  const excluded: ManualCandidate[] = [];
  while (cur.length > 0) {
    const ev = evaluateOrder(cur, matrix, p.stayMin, p.returnToStart);
    if (ev && ev.totalMin <= budgetMin) break;
    let bestIdx = -1;
    let bestTotal = Number.POSITIVE_INFINITY;
    for (let i = 0; i < cur.length; i++) {
      const trial = [...cur.slice(0, i), ...cur.slice(i + 1)];
      const tev = evaluateOrder(trial, matrix, p.stayMin, p.returnToStart);
      if (tev && tev.totalMin < bestTotal) {
        bestTotal = tev.totalMin;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break; // 安全弁（行列が全て到達不能等の異常時）
    excluded.push(cur[bestIdx]);
    cur = [...cur.slice(0, bestIdx), ...cur.slice(bestIdx + 1)];
  }
  return { kept: cur, excluded };
}

/** 確定した訪問順から PlannedRoute を組み立てる（自動コース作成の buildRoute と同じ構造） */
export function buildManualRoute(
  order: ManualCandidate[],
  matrix: RouteMatrix,
  p: ManualPlanParams,
  roadData: 'road' | 'approx',
  title: string,
  reason: string,
): PlannedRoute | null {
  if (order.length === 0) return null;
  const ev = evaluateOrder(order, matrix, p.stayMin, p.returnToStart);
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
  const hoursSummary = { open: 0, closing: 0, closed: 0, unknown: 0 };
  for (const s of stops) hoursSummary[statusAtArrival(s.stationId, new Date(s.arriveAt))]++;

  // PlanParams互換の params を保持（RouteResults/TripView/保存ルートが共通で読めるようにする）
  const params: PlanParams = {
    origin: p.origin,
    departAt: p.departAt,
    budgetMin: p.budgetMin ?? ev.totalMin,
    stayMin: p.stayMin,
    returnToStart: p.returnToStart,
    roadPref: p.roadPref,
    maxStops: order.length,
    prefs: [],
    crossPref: true,
    priority: 'unvisited',
    includeVisited: true,
    includeStamped: true,
    preferOpenHours: false,
    includeClosedHours: true,
    includeUnknownHours: true,
  };

  return {
    key: 'manual',
    title,
    reason,
    params,
    stops,
    legs,
    totalMin: ev.totalMin,
    driveMin: ev.driveMin,
    stayTotalMin: order.length * p.stayMin,
    marginMin: 0,
    totalKm: Math.round(ev.totalKm * 10) / 10,
    newCount: order.length,
    wantCount: 0,
    returnAt: t.toISOString(),
    roadData,
    hoursSummary,
  };
}
