import { useEffect, useState } from 'react';
import type { CustomStopInfo, PlannedRoute, RoadPref, Station } from '../types';
import { formatHM, formatMin } from '../lib/geo';
import { statusAtArrival } from '../lib/hours';
import { poiDisplayName, type Poi } from '../lib/poi';
import OriginPicker, { type ExtraOriginMode } from './OriginPicker';
import RoadPrefPicker from './RoadPrefPicker';
import CustomStopForm from './CustomStopForm';
import type { OriginValue } from './PlannerForm';
import {
  MAX_MANUAL_STATIONS,
  MIN_MANUAL_STATIONS,
  buildManualMatrix,
  buildManualRoute,
  computeMarginMin,
  evaluateManual,
  fitToBudget,
  orderManual,
  type ManualCandidateLike,
  type ManualOrderMode,
  type ManualPlanParams,
} from '../lib/manualRoute';
import type { RouteMatrix } from '../lib/routing';

const BUDGETS = [
  { label: '2時間', min: 120 },
  { label: '4時間', min: 240 },
  { label: '6時間', min: 360 },
  { label: '8時間', min: 480 },
];
const STAYS = [15, 30, 45, 60];

interface Props {
  stations: Station[];
  getStation: (id: string) => Station | undefined;
  selectedIds: string[];
  /** 選択済みの周辺スポット（キー: Poi.id）。地図選択モードで追加されたもの */
  selectedPois: Record<string, Poi>;
  /** 選択済みの自由地点（キー: 合成ID `custom:…`） */
  selectedCustomStops: Record<string, CustomStopInfo>;
  /** 地点ごとの滞在時間の上書き（キー: 駅ID or Poi.id or 自由地点ID） */
  stayOverrides: Record<string, number>;
  origin: OriginValue | null;
  onOriginChange: (o: OriginValue | null) => void;
  onRequestMapPick: () => void;
  /** 「選択駅を減らす」「選択を変更」: 選択は保持したまま地図選択モードへ戻る */
  onBackToMapSelect: () => void;
  /** 「選択から外す」: 対象駅を選択集合から取り除く（このコンポーネントは設定画面へ戻る） */
  onRemoveFromSelection: (id: string) => void;
  onDone: (route: PlannedRoute) => void;
  onCancel: () => void;
  /** ↻ 最初からやり直す（確認ダイアログはApp側が担当。ここでは要求するだけ） */
  onRequestRestart: () => void;
  /** 下書きから復元する初期値（下書きが無ければ既定値のまま） */
  initialSettings?: {
    returnToStart: boolean;
    orderMode: ManualOrderMode;
    budgetMin: number | null;
    stayMin: number;
    roadPref: RoadPref;
    finalDestination: CustomStopInfo | null;
  };
  /** 設定変更のたびに呼ばれる（App側で下書きへ保存するため） */
  onSettingsChange?: (s: {
    returnToStart: boolean;
    orderMode: ManualOrderMode;
    budgetMin: number | null;
    stayMin: number;
    roadPref: RoadPref;
    finalDestination: CustomStopInfo | null;
  }) => void;
}

type Phase = 'settings' | 'computing' | 'error' | 'over-budget' | 'order-review' | 'hours-review';

export default function ManualRouteBuilder({
  stations,
  getStation,
  selectedIds,
  selectedPois,
  selectedCustomStops,
  stayOverrides,
  origin,
  onOriginChange,
  onRequestMapPick,
  onBackToMapSelect,
  onRemoveFromSelection,
  onDone,
  onCancel,
  onRequestRestart,
  initialSettings,
  onSettingsChange,
}: Props) {
  const [budgetLimited, setBudgetLimited] = useState(initialSettings?.budgetMin !== null);
  const [budgetMin, setBudgetMin] = useState(initialSettings?.budgetMin ?? 240);
  const [customBudget, setCustomBudget] = useState('');
  const [stayMin, setStayMin] = useState(initialSettings?.stayMin ?? 30);
  const [customStay, setCustomStay] = useState('');
  const [returnToStart, setReturnToStart] = useState(initialSettings?.returnToStart ?? true);
  const [orderMode, setOrderMode] = useState<ManualOrderMode>(initialSettings?.orderMode ?? 'optimized');
  const [roadPref, setRoadPref] = useState<RoadPref>(initialSettings?.roadPref ?? 'highway_ok');
  /** ③別の最終目的地を指定（アプリ未登録のホテル等）。指定時はreturnToStartより優先される */
  const [finalDestination, setFinalDestination] = useState<CustomStopInfo | null>(
    initialSettings?.finalDestination ?? null,
  );
  const [addingFinalDest, setAddingFinalDest] = useState(false);
  /** 終了方法: ①最後の地点で終了 ②出発地点へ戻る ③別の最終目的地を指定 */
  const endMode: 'last' | 'return' | 'custom' = finalDestination ? 'custom' : returnToStart ? 'return' : 'last';

  /** 駅・周辺スポット・自由地点のいずれにも対応した表示名解決（不明時はIDのまま） */
  const resolveName = (id: string): string => {
    const st = getStation(id);
    if (st) return st.name;
    const poi = selectedPois[id];
    if (poi) return poiDisplayName(poi);
    const custom = selectedCustomStops[id];
    if (custom) return custom.name ?? custom.address;
    return id;
  };

  useEffect(() => {
    onSettingsChange?.({
      returnToStart,
      orderMode,
      budgetMin: budgetLimited ? resolvedBudget() : null,
      stayMin: resolvedStay(),
      roadPref,
      finalDestination,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnToStart, orderMode, budgetLimited, budgetMin, customBudget, stayMin, customStay, roadPref, finalDestination]);

  const [phase, setPhase] = useState<Phase>('settings');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cache, setCache] = useState<{
    matrix: RouteMatrix;
    roadData: 'road' | 'approx';
    candidates: ManualCandidateLike[];
    /** ③最終目的地の候補（未指定時はnull）。2-optの対象外で、常に配列末尾へ追加する */
    finalCandidate: ManualCandidateLike | null;
    params: ManualPlanParams;
    /** 到達不能区間の補完専用（§manualRoute.ts ManualMatrixResult.fallback参照） */
    fallback: RouteMatrix;
  } | null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [optimizedOrderIds, setOptimizedOrderIds] = useState<string[]>([]);
  const [activeOrder, setActiveOrder] = useState<ManualCandidateLike[] | null>(null);
  const [overMin, setOverMin] = useState(0);
  const [excludedNames, setExcludedNames] = useState<string[]>([]);
  const [fitKept, setFitKept] = useState<ManualCandidateLike[] | null>(null);
  const [reviewRoute, setReviewRoute] = useState<PlannedRoute | null>(null);
  const [confirmedHours, setConfirmedHours] = useState<Set<string>>(new Set());

  const originFirst: ExtraOriginMode = { key: 'first', label: '最初に選んだ道の駅から出発' };
  const originNear: ExtraOriginMode = { key: 'near', label: '選択駅の近くから出発' };

  const handleExtraOrigin = (key: string) => {
    if (selectedIds.length === 0) return;
    if (key === 'first') {
      const st = getStation(selectedIds[0]);
      if (st) onOriginChange({ lat: st.lat, lng: st.lng, label: `道の駅${st.name}` });
    } else if (key === 'near') {
      const pts = selectedIds.map((id) => getStation(id)).filter((s): s is Station => !!s);
      if (pts.length === 0) return;
      const lat = pts.reduce((a, s) => a + s.lat, 0) / pts.length;
      const lng = pts.reduce((a, s) => a + s.lng, 0) / pts.length;
      onOriginChange({ lat, lng, label: '選択駅の近く' });
    }
  };

  const resolvedBudget = (): number => {
    if (customBudget !== '') {
      const raw = Number(customBudget);
      if (Number.isFinite(raw)) return Math.max(60, Math.min(720, Math.round(raw / 30) * 30));
    }
    return budgetMin;
  };
  const resolvedStay = (): number => {
    if (customStay !== '') {
      const raw = Number(customStay);
      if (Number.isFinite(raw)) return Math.max(5, Math.min(120, Math.round(raw / 5) * 5));
    }
    return stayMin;
  };

  const buildParams = (mode: ManualOrderMode): ManualPlanParams => ({
    origin: origin!,
    departAt: new Date().toISOString(),
    stayMin: resolvedStay(),
    returnToStart,
    roadPref,
    budgetMin: budgetLimited ? resolvedBudget() : null,
    orderMode: mode,
    stayOverrides,
    finalDestination,
  });

  /** ③最終目的地があれば、配列の末尾へ固定で追加する（2-opt・fitToBudgetの対象外） */
  const withFinal = (order: ManualCandidateLike[]): ManualCandidateLike[] =>
    cache?.finalCandidate ? [...order, cache.finalCandidate] : order;

  const start = async () => {
    if (!origin || selectedIds.length < MIN_MANUAL_STATIONS) return;
    setPhase('computing');
    setErrorMsg(null);
    try {
      const p = buildParams(orderMode);
      const { matrix, roadData, candidates, fallback, finalCandidate } = await buildManualMatrix(
        stations,
        selectedPois,
        selectedIds,
        p,
        {},
        selectedCustomStops,
      );
      setCache({ matrix, roadData, candidates, finalCandidate, params: p, fallback });
      const selOrder = orderManual(candidates, matrix, { ...p, orderMode: 'selected' }, fallback);
      const optOrder = orderManual(candidates, matrix, { ...p, orderMode: 'optimized' }, fallback);
      setSelectedOrderIds(selOrder.map((c) => c.st.id));
      setOptimizedOrderIds(optOrder.map((c) => c.st.id));
      const order = p.orderMode === 'selected' ? selOrder : optOrder;
      const withFinalNow = (o: ManualCandidateLike[]) => (finalCandidate ? [...o, finalCandidate] : o);
      proceedAfterOrder(p, matrix, roadData, withFinalNow(order), withFinalNow(selOrder), withFinalNow(optOrder), fallback);
    } catch {
      setErrorMsg('ルートを計算できませんでした。電波状況を確認してもう一度お試しください。');
      setPhase('settings');
    }
  };

  const proceedAfterOrder = (
    p: ManualPlanParams,
    matrix: RouteMatrix,
    roadData: 'road' | 'approx',
    order: ManualCandidateLike[],
    selOrder: ManualCandidateLike[],
    optOrder: ManualCandidateLike[],
    fallback: RouteMatrix,
  ) => {
    const changed =
      p.orderMode === 'optimized' && selOrder.map((c) => c.st.id).join('>') !== optOrder.map((c) => c.st.id).join('>');
    if (changed) {
      setActiveOrder(order);
      setPhase('order-review');
      return;
    }
    checkBudget(p, matrix, roadData, order, fallback);
  };

  const checkBudget = (
    p: ManualPlanParams,
    matrix: RouteMatrix,
    roadData: 'road' | 'approx',
    order: ManualCandidateLike[],
    fallback: RouteMatrix,
  ) => {
    const ev = evaluateManual(order, matrix, p, fallback);
    if (p.budgetMin != null && ev) {
      const margin = computeMarginMin(ev.totalMin);
      const withMargin = ev.totalMin + margin;
      if (withMargin > p.budgetMin) {
        setOverMin(withMargin - p.budgetMin);
        setActiveOrder(order);
        setPhase('over-budget');
        return;
      }
    }
    finalize(p, matrix, roadData, order, fallback);
  };

  const finalize = (
    p: ManualPlanParams,
    matrix: RouteMatrix,
    roadData: 'road' | 'approx',
    order: ManualCandidateLike[],
    fallback: RouteMatrix,
  ) => {
    const title = '地図から選んだコース';
    const reason =
      p.orderMode === 'selected' ? '選んだ順番のまま作成しました' : '移動時間を短くするため、順番を調整しました';
    const built = buildManualRoute(order, matrix, p, roadData, title, reason, fallback);
    if (!built) {
      setErrorMsg('ルートを作成できませんでした。選択や設定を見直してください。');
      setPhase('settings');
      return;
    }
    // 営業時間の確認は道の駅のみが対象（周辺スポットはhours.jsonにデータが無く対象外）
    const flagged = built.stops.filter((s) => {
      if ((s.stopType ?? 'station') !== 'station') return false;
      const st = statusAtArrival(s.stationId, new Date(s.arriveAt));
      return (st === 'closed' || st === 'unknown') && !confirmedHours.has(s.stationId);
    });
    if (flagged.length > 0) {
      setReviewRoute(built);
      setPhase('hours-review');
      return;
    }
    onDone(built);
  };

  if (!origin) {
    return (
      <div>
        <div className="card" data-testid="manual-selection-summary">
          <h3>選んだ{selectedIds.length}件</h3>
          <p className="addr">{selectedIds.map(resolveName).join(' → ')}</p>
        </div>
        <div className="card">
          <h3>出発地点を選んでください</h3>
          <OriginPicker
            stations={stations}
            origin={origin}
            onOriginChange={onOriginChange}
            onRequestMapPick={onRequestMapPick}
            extraModes={[originFirst, originNear]}
            onExtraMode={handleExtraOrigin}
          />
        </div>
        <button style={{ width: '100%' }} onClick={onCancel} data-testid="manual-cancel">
          ← 選択に戻る
        </button>
      </div>
    );
  }

  if (phase === 'computing') {
    return <div className="empty">⏳ ルートを計算しています…</div>;
  }

  if (phase === 'order-review' && cache) {
    return (
      <div>
        <div className="card" data-testid="order-review">
          <h3>順番を調整しました</h3>
          <p className="msg info">移動時間を短くするため、順番を調整しました。</p>
          <p>選んだ順: {selectedOrderIds.map(resolveName).join(' → ')}</p>
          <p>調整後: {optimizedOrderIds.map(resolveName).join(' → ')}</p>
          <div className="btn-grid">
            <button
              className="btn-primary"
              onClick={() => checkBudget(cache.params, cache.matrix, cache.roadData, activeOrder!, cache.fallback)}
              data-testid="order-review-keep"
            >
              この順番で進む
            </button>
            <button
              onClick={() => {
                const selOrder = orderManual(
                  cache.candidates,
                  cache.matrix,
                  { ...cache.params, orderMode: 'selected' },
                  cache.fallback,
                );
                setOrderMode('selected');
                checkBudget(
                  { ...cache.params, orderMode: 'selected' },
                  cache.matrix,
                  cache.roadData,
                  withFinal(selOrder),
                  cache.fallback,
                );
              }}
              data-testid="order-review-revert"
            >
              元の選択順へ戻す
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'over-budget' && cache && activeOrder) {
    const overEv = evaluateManual(activeOrder, cache.matrix, cache.params, cache.fallback)!;
    const overMargin = computeMarginMin(overEv.totalMin);
    return (
      <div>
        <div className="card" data-testid="over-budget">
          <h3>時間が足りないかもしれません</h3>
          <p className="msg warn">
            選択した{selectedIds.length}件をすべて回ると約{formatMin(overEv.totalMin + overMargin)}
            （安全余裕{formatMin(overMargin)}を含む）です。
            設定した{formatMin(cache.params.budgetMin ?? 0)}を約{formatMin(overMin)}超えます。
          </p>
          <div className="btn-grid">
            <button onClick={() => setPhase('settings')} data-testid="over-budget-change-time">
              時間を変更する
            </button>
            <button onClick={onBackToMapSelect} data-testid="over-budget-reduce">
              選択を減らす
            </button>
            <button
              onClick={() => {
                // ③最終目的地は除外候補にしない（常にゴールとして固定）。
                // finalCandidateを除いた分だけをfitToBudgetの対象にし、結果へ戻す。
                const withoutFinal = cache.finalCandidate
                  ? activeOrder.filter((c) => c !== cache.finalCandidate)
                  : activeOrder;
                const { kept, excluded } = fitToBudget(
                  withoutFinal,
                  cache.matrix,
                  cache.params,
                  cache.params.budgetMin ?? 0,
                  cache.fallback,
                );
                setFitKept(withFinal(kept));
                setExcludedNames(excluded.map((c) => c.st.name ?? resolveName(c.st.id)));
              }}
              data-testid="over-budget-fit"
            >
              時間内に回れる分だけで作成
            </button>
            <button
              onClick={() => finalize(cache.params, cache.matrix, cache.roadData, activeOrder, cache.fallback)}
              data-testid="over-budget-force"
            >
              時間を超えてこのまま作成
            </button>
          </div>
          {fitKept && (
            <div className="note-box" style={{ marginTop: 10 }} data-testid="over-budget-fit-result">
              {fitKept.length === 0 ? (
                <p>設定時間が短すぎるため、1件も回れません。時間を長くするか選択を見直してください。</p>
              ) : excludedNames.length > 0 ? (
                <>
                  <p>
                    時間内に収めるため、次の{excludedNames.length}件を除外します：
                    <br />
                    {excludedNames.join('、')}
                  </p>
                  <button
                    className="btn-primary"
                    style={{ width: '100%' }}
                    onClick={() => finalize(cache.params, cache.matrix, cache.roadData, fitKept, cache.fallback)}
                    data-testid="over-budget-fit-confirm"
                  >
                    この{fitKept.length}件で作成する
                  </button>
                </>
              ) : (
                <p>除外しなくても時間内に収まります。</p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'hours-review' && reviewRoute) {
    const flagged = reviewRoute.stops.filter((s) => {
      const st = statusAtArrival(s.stationId, new Date(s.arriveAt));
      return st === 'closed' || st === 'unknown';
    });
    return (
      <div>
        <div className="card" data-testid="hours-review">
          <h3>営業時間の確認</h3>
          <p className="msg warn">到着予定時刻に営業時間外・要確認となる可能性がある駅があります。</p>
          {flagged.map((s) => {
            const st = getStation(s.stationId);
            const confirmed = confirmedHours.has(s.stationId);
            return (
              <div key={s.stationId} className="note-box" style={{ marginTop: 8 }} data-testid="hours-review-row">
                <b>道の駅{st?.name}</b>は到着予定時刻（{formatHM(new Date(s.arriveAt))}）に営業時間外となる可能性があります。
                <div className="btn-grid" style={{ marginTop: 6 }}>
                  <button
                    className={confirmed ? 'active' : ''}
                    onClick={() => setConfirmedHours(new Set(confirmedHours).add(s.stationId))}
                    data-testid="hours-review-keep"
                  >
                    {confirmed ? '✓ 含めることを確認済み' : 'このまま含める'}
                  </button>
                  <button onClick={() => onRemoveFromSelection(s.stationId)} data-testid="hours-review-exclude">
                    選択から外す
                  </button>
                  {st && (
                    <a
                      className="btn-link"
                      href={st.officialUrl ?? st.infoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="hours-review-official"
                    >
                      公式情報を見る ↗
                    </a>
                  )}
                </div>
              </div>
            );
          })}
          <p className="msg info" style={{ marginTop: 8 }}>
            通常営業時間に基づく目安です。臨時休業・季節変更は公式情報をご確認ください。
          </p>
          <button
            className="btn-primary"
            style={{ width: '100%', marginTop: 8 }}
            onClick={() => onDone(reviewRoute)}
            data-testid="hours-review-continue"
          >
            このコースで進む
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="card">
        <h3>選んだ{selectedIds.length}件</h3>
        <p className="addr">{selectedIds.map(resolveName).join(' → ')}</p>
        <button style={{ width: '100%' }} onClick={onBackToMapSelect} data-testid="manual-change-selection">
          🗺️ 選択を変更する
        </button>
      </div>

      <div className="card">
        <h3>出発地点</h3>
        <OriginPicker
          stations={stations}
          origin={origin}
          onOriginChange={onOriginChange}
          onRequestMapPick={onRequestMapPick}
          extraModes={[originFirst, originNear]}
          onExtraMode={handleExtraOrigin}
        />
      </div>

      <div className="card">
        <h3>回る順番</h3>
        <div className="seg">
          <button className={orderMode === 'optimized' ? 'active' : ''} onClick={() => setOrderMode('optimized')} data-testid="order-mode-optimized">
            回りやすい順に自動調整（推奨）
          </button>
          <button className={orderMode === 'selected' ? 'active' : ''} onClick={() => setOrderMode('selected')} data-testid="order-mode-selected">
            選んだ順番で回る
          </button>
        </div>
      </div>

      <div className="card">
        <h3>お出かけ時間</h3>
        <div className="seg">
          <button className={!budgetLimited ? 'active' : ''} onClick={() => setBudgetLimited(false)} data-testid="budget-unlimited">
            時間制限なし
          </button>
          <button className={budgetLimited ? 'active' : ''} onClick={() => setBudgetLimited(true)} data-testid="budget-limited">
            時間を決める
          </button>
        </div>
        {budgetLimited && (
          <>
            <div className="seg" style={{ marginTop: 8 }}>
              {BUDGETS.map((b) => (
                <button
                  key={b.min}
                  className={customBudget === '' && budgetMin === b.min ? 'active' : ''}
                  onClick={() => {
                    setBudgetMin(b.min);
                    setCustomBudget('');
                  }}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <input
              type="number"
              inputMode="numeric"
              min={60}
              max={720}
              step={30}
              placeholder="自分で設定（分・30分きざみ）"
              aria-label="お出かけ時間を分で入力"
              value={customBudget}
              onChange={(e) => setCustomBudget(e.target.value)}
              style={{ width: '100%', marginTop: 6 }}
            />
          </>
        )}
      </div>

      <div className="card">
        <h3>道の駅に何分いる？</h3>
        <p className="msg info" style={{ marginTop: -4 }}>
          周辺スポットの滞在時間は、それぞれの詳細画面で個別に変更できます（既定はカテゴリごとの目安）。
        </p>
        <div className="seg">
          {STAYS.map((s) => (
            <button
              key={s}
              className={customStay === '' && stayMin === s ? 'active' : ''}
              onClick={() => {
                setStayMin(s);
                setCustomStay('');
              }}
            >
              {s}分
            </button>
          ))}
        </div>
        <input
          type="number"
          inputMode="numeric"
          min={5}
          max={120}
          step={5}
          placeholder="自分で設定（分）"
          aria-label="滞在時間を分で入力"
          value={customStay}
          onChange={(e) => setCustomStay(e.target.value)}
          style={{ width: '100%', marginTop: 6 }}
        />
      </div>

      <div className="card">
        <h3>終了方法</h3>
        <div className="seg" style={{ flexWrap: 'wrap' }}>
          <button
            className={endMode === 'last' ? 'active' : ''}
            onClick={() => {
              setReturnToStart(false);
              setFinalDestination(null);
            }}
            data-testid="end-mode-last"
          >
            ① 最後の地点で終了
          </button>
          <button
            className={endMode === 'return' ? 'active' : ''}
            onClick={() => {
              setReturnToStart(true);
              setFinalDestination(null);
            }}
            data-testid="end-mode-return"
          >
            ② 出発地点へ戻る
          </button>
          <button
            className={endMode === 'custom' ? 'active' : ''}
            onClick={() => setAddingFinalDest(true)}
            data-testid="end-mode-custom"
          >
            ③ 別の最終目的地を指定
          </button>
        </div>
        {endMode === 'custom' && finalDestination && !addingFinalDest && (
          <div className="note-box" style={{ marginTop: 8 }} data-testid="final-destination-summary">
            🏁 最終目的地: <b>{finalDestination.name ?? finalDestination.address}</b>
            <div className="btn-grid" style={{ marginTop: 6 }}>
              <button onClick={() => setAddingFinalDest(true)} data-testid="final-destination-edit">
                変更する
              </button>
              <button
                onClick={() => {
                  setFinalDestination(null);
                  setReturnToStart(false);
                }}
                data-testid="final-destination-clear"
              >
                指定をやめる
              </button>
            </div>
          </div>
        )}
        {addingFinalDest && (
          <CustomStopForm
            title="🏁 最終目的地を指定（旅行最後に立ち寄る場所）"
            submitLabel="最終目的地にする"
            onSubmit={(info) => {
              setFinalDestination(info);
              setReturnToStart(false);
              setAddingFinalDest(false);
            }}
            onCancel={() => setAddingFinalDest(false)}
          />
        )}
      </div>

      <div className="card">
        <h3>道路の希望</h3>
        <RoadPrefPicker value={roadPref} onChange={setRoadPref} />
      </div>

      {errorMsg && <div className="msg warn">{errorMsg}</div>}

      <button
        className="btn-primary"
        style={{ width: '100%', minHeight: 52, fontSize: 17 }}
        disabled={selectedIds.length < MIN_MANUAL_STATIONS}
        onClick={start}
        data-testid="manual-submit"
      >
        🚗 このコースで作成
      </button>
      <p className="msg info" style={{ marginTop: 10 }}>
        選択した{selectedIds.length}件すべてが候補になります（最大{MAX_MANUAL_STATIONS}件）。所要時間は目安です。
      </p>
      <button style={{ width: '100%', marginTop: 8 }} onClick={onCancel} data-testid="manual-cancel">
        ← 選択に戻る
      </button>
      <button style={{ width: '100%', marginTop: 8 }} onClick={onRequestRestart} data-testid="manual-request-restart">
        ↻ 最初からやり直す
      </button>
    </div>
  );
}
