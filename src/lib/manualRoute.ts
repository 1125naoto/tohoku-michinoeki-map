/**
 * 「地図から選ぶ」ルート作成: ユーザーが選んだ道の駅・周辺スポットだけを対象に
 * 順序・時間を計算する。
 *
 * 自動コース作成（planner.ts）との違いは「候補をアプリが自動選定するか、
 * ユーザーが手動で選ぶか」だけであり、所要時間行列の取得・順序評価・2-opt改善は
 * routeOrder.ts / planner.ts の estimateMatrix を共有し、重複実装しない。
 * 道の駅と周辺スポット（POI）は所要時間計算上は同じ「地点」として扱うが、
 * 滞在時間は地点ごとに個別に持てる（routeOrder.tsの滞在時間アクセサを利用）。
 */
import type { CustomStopInfo, PlannedRoute, PlanParams, RoadPref, RouteLeg, RouteStop, Station, StopType } from '../types';
import { estimateMatrix } from './planner';
import { osrmProvider, type RouteMatrix, type RoutingProvider } from './routing';
import { evaluateOrder, twoOptOrder, type OrderItem } from './routeOrder';
import { statusAtArrival } from './hours';
import { CUSTOM_STOP_DEFAULT_STAY_MIN, DEFAULT_STAY_MIN, stopTypeOf, type Poi } from './poi';

/**
 * 自由地点（アプリ未登録の場所）のRouteStop.stationId用の合成ID。
 * 道の駅ID(mne-…)・Poi.id(osm:…)と衝突しない接頭辞にする。
 */
export function makeCustomStopId(): string {
  return `custom:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isCustomStopId(id: string): boolean {
  return id.startsWith('custom:');
}

/**
 * 一度に選べる地点（道の駅+周辺スポット合計）の上限。出発地点+選択数の合計を、
 * 自動コース作成で本番実績のある安全上限（出発地点+22駅=23地点、
 * planner.ts の MAX_MATRIX_STATIONS）以下に収まるよう、余裕を持たせて20とした。
 * OSRM公開デモへの負荷試験は行わない（「常識的な軽負荷利用」の利用規約に反するため）。
 */
export const MAX_MANUAL_STATIONS = 20;
/** コース作成に必要な最低選択数 */
export const MIN_MANUAL_STATIONS = 2;

export type ManualOrderMode = 'selected' | 'optimized';

export interface ManualPlanParams {
  origin: { lat: number; lng: number; label: string };
  departAt: string;
  /** 道の駅の既定滞在時間（分）。周辺スポットはカテゴリ既定値またはstayOverridesを使う */
  stayMin: number;
  /**
   * 出発地点へ戻るか。finalDestinationが指定されているときは無視される
   * （最終目的地がゴールになるため、そこからさらに出発地点へ戻る動線は現状扱わない）。
   */
  returnToStart: boolean;
  roadPref: RoadPref;
  /** null = 時間制限なし */
  budgetMin: number | null;
  orderMode: ManualOrderMode;
  /** 地点ごとの滞在時間の上書き（キー: 駅ID または Poi.id） */
  stayOverrides?: Record<string, number>;
  /**
   * 「③別の最終目的地を指定」（アプリ未登録のホテル・旅館等）。指定時は選択済みの
   * 道の駅・POI・自由地点をすべて回ったあと、最後にここへ向かう区間を必ず追加する
   * （順序最適化(2-opt)の対象からは除外し、常に最終地点として固定する）。
   */
  finalDestination?: CustomStopInfo | null;
}

/** 道の駅・周辺スポットを問わない、順序計算のための共通地点表現 */
export interface ManualPoint {
  id: string;
  name: string | null;
  lat: number;
  lng: number;
  stayMin: number;
  stopType: StopType;
  poi?: Poi;
  /** stopType==='custom'のときの自由地点詳細 */
  custom?: CustomStopInfo;
}

export interface ManualCandidateLike extends OrderItem {
  st: ManualPoint;
}
type ManualCandidate = ManualCandidateLike;

export interface ManualMatrixResult {
  matrix: RouteMatrix;
  roadData: 'road' | 'approx';
  /** selectedIds の順で mi(1始まり) を割り当てた候補一覧 */
  candidates: ManualCandidate[];
  /**
   * 概算モデルによる代替行列。roadData==='road'のとき、matrix内の到達不能
   * (Infinity)区間をこの値で補うためだけに使う（呼び出し側の各関数へ渡す）。
   * matrix自体は書き換えない（osrmProviderの内部キャッシュと同一オブジェクトのため）。
   */
  fallback: RouteMatrix;
  /**
   * 「③別の最終目的地を指定」の候補（未指定ならnull）。candidatesには含まれない
   * （順序最適化の対象外）。呼び出し側は order 確定後にこれを配列の末尾へ追加してから
   * evaluateManual/buildManualRouteへ渡す。
   */
  finalCandidate: ManualCandidate | null;
}

export interface ManualPlanOptions {
  provider?: RoutingProvider;
  signal?: AbortSignal;
}

function customPoint(id: string, c: CustomStopInfo, stayMin?: number): ManualPoint {
  return {
    id,
    name: c.name,
    lat: c.lat,
    lng: c.lng,
    stayMin: stayMin ?? CUSTOM_STOP_DEFAULT_STAY_MIN,
    stopType: 'custom',
    custom: c,
  };
}

function resolvePoint(
  id: string,
  stationsById: Map<string, Station>,
  pois: Record<string, Poi>,
  customStops: Record<string, CustomStopInfo>,
  p: Pick<ManualPlanParams, 'stayMin' | 'stayOverrides'>,
): ManualPoint | null {
  const st = stationsById.get(id);
  if (st) {
    return {
      id: st.id,
      name: st.name,
      lat: st.lat,
      lng: st.lng,
      stayMin: p.stayOverrides?.[id] ?? p.stayMin,
      stopType: 'station',
    };
  }
  const poi = pois[id];
  if (poi) {
    return {
      id: poi.id,
      name: poi.name,
      lat: poi.lat,
      lng: poi.lng,
      stayMin: p.stayOverrides?.[id] ?? DEFAULT_STAY_MIN[poi.subcategory],
      stopType: stopTypeOf(poi.subcategory),
      poi,
    };
  }
  const custom = customStops[id];
  if (custom) return customPoint(id, custom, p.stayOverrides?.[id]);
  return null;
}

/**
 * 選択地点の所要時間行列を取得する（OSRM成功→実道路 / 失敗→概算フォールバック）。
 * finalDestinationを指定した場合、routePoints/matrixの末尾に追加されるが、
 * candidatesには含めない（順序最適化(2-opt)の対象から外し、常に最終地点として
 * 別途扱うため）。呼び出し側は返り値の finalCandidate を使う。
 */
export async function buildManualMatrix(
  stations: Station[],
  pois: Record<string, Poi>,
  selectedIds: string[],
  p: Pick<ManualPlanParams, 'origin' | 'departAt' | 'roadPref' | 'stayMin' | 'stayOverrides' | 'finalDestination'>,
  opts: ManualPlanOptions = {},
  customStops: Record<string, CustomStopInfo> = {},
): Promise<ManualMatrixResult> {
  const byId = new Map(stations.map((s) => [s.id, s]));
  const points = selectedIds
    .map((id) => resolvePoint(id, byId, pois, customStops, p))
    .filter((x): x is ManualPoint => x !== null);
  const finalPoint = p.finalDestination ? customPoint(makeCustomStopId(), p.finalDestination) : null;
  const routePoints = [p.origin, ...points, ...(finalPoint ? [finalPoint] : [])];
  const candidates: ManualCandidate[] = points.map((pt, i) => ({ st: pt, mi: i + 1 }));
  const finalCandidate: ManualCandidate | null = finalPoint ? { st: finalPoint, mi: points.length + 1 } : null;

  const provider = opts.provider ?? osrmProvider;
  const fallback = estimateMatrix(routePoints, p);
  let matrix: RouteMatrix;
  let roadData: 'road' | 'approx';
  try {
    // providerが返すmatrixはrouting.ts内部キャッシュと同一オブジェクトのため、
    // ここでは一切書き換えない（到達不能セルの補完は呼び出し側がfallbackを
    // 都度参照して行う。§ManualMatrixResult.fallbackのコメント参照）。
    matrix = await provider.table(routePoints, opts.signal);
    roadData = 'road';
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    matrix = fallback;
    roadData = 'approx';
  }
  return { matrix, roadData, candidates, fallback, finalCandidate };
}

const stayAccessor = (c: ManualCandidate) => c.st.stayMin;

/**
 * 選んだ順のまま、または移動時間が短くなるよう自動調整した順序を返す。
 * fallbackを渡すと、到達不能区間があっても評価自体は打ち切らず概算で補って
 * 順序調整を続行する（地図から選ぶルートはユーザーが選んだ地点を勝手に
 * 落とさない方針のため）。
 */
export function orderManual(
  candidates: ManualCandidate[],
  matrix: RouteMatrix,
  p: Pick<ManualPlanParams, 'returnToStart' | 'orderMode'>,
  fallback?: RouteMatrix,
): ManualCandidate[] {
  if (p.orderMode === 'selected') return candidates;
  return twoOptOrder(candidates, matrix, stayAccessor, p.returnToStart, fallback);
}

export function evaluateManual(
  order: ManualCandidate[],
  matrix: RouteMatrix,
  p: Pick<ManualPlanParams, 'returnToStart'>,
  fallback?: RouteMatrix,
) {
  return evaluateOrder(order, matrix, stayAccessor, p.returnToStart, fallback);
}

export interface FitToBudgetResult {
  /** 固定の最終目的地まで含めて時間内に収まったか。falseなら「時間内に作れない」 */
  feasible?: boolean;
  kept: ManualCandidate[];
  excluded: ManualCandidate[];
}

/**
 * 予算時間に収まるよう、除外すると最も時間短縮になる地点から順に取り除く（貪欲法）。
 * ユーザーの確認なしに呼び出し側で結果を確定させないこと（除外候補の提示が必須）。
 * 安全余裕は候補を減らすたびに縮む（computeMarginMinで都度再計算）ため、
 * 呼び出し側は元の（絞り込み前の）安全余裕を差し引いた予算を渡さないこと
 * （固定の余裕を引いてしまうと、絞り込むほど不要に厳しくなり全除外され得る）。
 */
export function fitToBudget(
  order: ManualCandidate[],
  matrix: RouteMatrix,
  p: Pick<ManualPlanParams, 'returnToStart'>,
  budgetMin: number,
  fallback?: RouteMatrix,
  /**
   * 常に末尾に固定される立ち寄り先（③別の最終目的地）。除外候補にはしないが、
   * ここまでの移動時間と滞在時間は時間予算の判定に必ず含める。
   * 以前はこれを外したまま予算判定していたため、最終目的地を戻すと予算を超える組み合わせを
   * 「時間内に回れる分」として提示してしまっていた。
   */
  fixedTail?: ManualCandidate | null,
): FitToBudgetResult {
  /** 固定の最終目的地まで含めた実際の行程で評価する */
  const evaluateWithTail = (list: ManualCandidate[]) =>
    evaluateOrder(fixedTail ? [...list, fixedTail] : list, matrix, stayAccessor, p.returnToStart, fallback);

  let cur = [...order];
  const excluded: ManualCandidate[] = [];
  let feasible = false;
  for (;;) {
    const ev = evaluateWithTail(cur);
    if (ev && ev.totalMin + computeMarginMin(ev.totalMin) <= budgetMin) {
      feasible = true;
      break;
    }
    if (cur.length === 0) break; // これ以上減らせない（固定の最終目的地だけで予算超過）
    let bestIdx = -1;
    let bestTotal = Number.POSITIVE_INFINITY;
    for (let i = 0; i < cur.length; i++) {
      const trial = [...cur.slice(0, i), ...cur.slice(i + 1)];
      const tev = evaluateWithTail(trial);
      if (tev && tev.totalMin < bestTotal) {
        bestTotal = tev.totalMin;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break; // 安全弁（行列が全て到達不能等の異常時）
    excluded.push(cur[bestIdx]);
    cur = [...cur.slice(0, bestIdx), ...cur.slice(bestIdx + 1)];
  }
  return { kept: cur, excluded, feasible };
}

/** 立ち寄り先種別ごとの滞在時間の内訳（分）。Gate7の予定表内訳表示に使う */
export interface StayBreakdown {
  station: number;
  restaurant: number;
  cafe: number;
  onsen: number;
  tourism: number;
  lodging: number;
  park: number;
  other: number;
  custom: number;
}

export function computeStayBreakdown(stops: RouteStop[]): StayBreakdown {
  const b: StayBreakdown = {
    station: 0,
    restaurant: 0,
    cafe: 0,
    onsen: 0,
    tourism: 0,
    lodging: 0,
    park: 0,
    other: 0,
    custom: 0,
  };
  for (const s of stops) {
    const t = s.stopType ?? 'station';
    b[t] += s.stayMin;
  }
  return b;
}

/** 安全余裕（分）: 総時間の約10%、最低10分（自動コース作成の考え方と整合させる） */
export function computeMarginMin(totalMin: number): number {
  return Math.max(10, Math.round(totalMin * 0.1));
}

/**
 * 確定した訪問順から PlannedRoute を組み立てる（自動コース作成の buildRoute と同じ構造）。
 *
 * fallbackを渡すと、到達不能(Infinity)区間があっても構築自体は失敗させず、
 * その区間だけ概算値(fallback)で補いつつ leg.unreachable=true を立てて
 * 明示する（「手動routeでは問題区間を明示する」方針）。fallback省略時は
 * 従来どおり到達不能を含む場合はnullを返す。
 */
export function buildManualRoute(
  order: ManualCandidate[],
  matrix: RouteMatrix,
  p: ManualPlanParams,
  roadData: 'road' | 'approx',
  title: string,
  reason: string,
  fallback?: RouteMatrix,
): PlannedRoute | null {
  if (order.length === 0) return null;
  // 最終目的地（自由地点）を指定した場合、それ自体がゴールのため出発地点へは戻らない
  // （最終目的地はorder配列の末尾に既に含まれている前提。§ManualMatrixResult.finalCandidate参照）。
  const effectiveReturnToStart = p.returnToStart && !p.finalDestination;
  const ev = evaluateOrder(order, matrix, stayAccessor, effectiveReturnToStart, fallback);
  if (!ev) return null;
  const departAt = new Date(p.departAt);
  const stops: RouteStop[] = [];
  const legs: RouteLeg[] = [];
  let t = new Date(departAt);
  let cur = 0;
  let curId: string | null = null;
  let stayTotalMin = 0;
  for (const c of order) {
    const rawMin = matrix.durationsMin[cur][c.mi];
    const unreachable = !Number.isFinite(rawMin);
    const driveMin = Math.ceil(unreachable ? fallback!.durationsMin[cur][c.mi] : rawMin);
    const distanceKm = unreachable ? fallback!.distancesKm[cur][c.mi] : matrix.distancesKm[cur][c.mi];
    legs.push({
      fromId: curId,
      toId: c.st.id,
      distanceKm: Math.round(distanceKm * 10) / 10,
      driveMin,
      ...(unreachable ? { unreachable: true } : {}),
    });
    t = new Date(t.getTime() + driveMin * 60000);
    const arriveAt = t.toISOString();
    t = new Date(t.getTime() + c.st.stayMin * 60000);
    stayTotalMin += c.st.stayMin;
    stops.push({
      stationId: c.st.id,
      arriveAt,
      departAt: t.toISOString(),
      stayMin: c.st.stayMin,
      stopType: c.st.stopType,
      poi: c.st.poi,
      custom: c.st.custom,
    });
    cur = c.mi;
    curId = c.st.id;
  }
  if (effectiveReturnToStart) {
    const rawMin = matrix.durationsMin[cur][0];
    const unreachable = !Number.isFinite(rawMin);
    const driveMin = Math.ceil(unreachable ? fallback!.durationsMin[cur][0] : rawMin);
    const distanceKm = unreachable ? fallback!.distancesKm[cur][0] : matrix.distancesKm[cur][0];
    legs.push({
      fromId: curId,
      toId: null,
      distanceKm: Math.round(distanceKm * 10) / 10,
      driveMin,
      ...(unreachable ? { unreachable: true } : {}),
    });
    t = new Date(t.getTime() + driveMin * 60000);
  }
  // 営業時間見込みは道の駅（hours.jsonにデータがある）のみ集計。POIは対象外
  const hoursSummary = { open: 0, closing: 0, closed: 0, unknown: 0 };
  for (const s of stops) {
    if ((s.stopType ?? 'station') !== 'station') continue;
    hoursSummary[statusAtArrival(s.stationId, new Date(s.arriveAt))]++;
  }

  // PlanParams互換の params を保持（RouteResults/TripView/保存ルートが共通で読めるようにする）
  const params: PlanParams = {
    origin: p.origin,
    departAt: p.departAt,
    budgetMin: p.budgetMin ?? ev.totalMin,
    stayMin: p.stayMin,
    returnToStart: effectiveReturnToStart,
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

  const stationCount = order.filter((c) => c.st.stopType === 'station').length;

  return {
    key: 'manual',
    title,
    reason,
    params,
    stops,
    legs,
    totalMin: ev.totalMin,
    driveMin: ev.driveMin,
    stayTotalMin,
    marginMin: computeMarginMin(ev.totalMin),
    totalKm: Math.round(ev.totalKm * 10) / 10,
    hasUnreachableLeg: ev.hasUnreachableLeg,
    // 達成率に影響するのは道の駅のみ（周辺スポットは含めない）
    newCount: stationCount,
    wantCount: 0,
    returnAt: t.toISOString(),
    roadData,
    hoursSummary,
  };
}
