import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  PlanParams,
  PlannedRoute,
  Prefecture,
  SavedRoute,
  StationState,
  StatusFilter,
  StopProgress,
  TripState,
  VisitRecord,
} from './types';
import { STATIONS, getStation } from './data';
import { computeStats } from './lib/stats';
import { planRoutes } from './lib/planner';
import type { LatLng } from './lib/geo';
import {
  applyState,
  clearAllUserData,
  loadRoutes,
  loadTrip,
  loadVisits,
  nextState,
  saveRoutes,
  saveTrip,
  saveVisits,
} from './lib/storage';
import MapView from './components/MapView';
import StatsHeader from './components/StatsHeader';
import StationSheet from './components/StationSheet';
import PlannerForm, { type OriginValue } from './components/PlannerForm';
import RouteResults, { routePoints } from './components/RouteResults';
import TripView from './components/TripView';
import SavedRoutesView from './components/SavedRoutesView';

type Tab = 'map' | 'route' | 'records';
type RouteStage = 'form' | 'results';

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'none', label: '未訪問' },
  { key: 'want', label: '行きたい' },
  { key: 'visited', label: '訪問済み' },
  { key: 'stamp', label: 'スタンプ済み' },
];

function hashStationId(): string | null {
  const m = /#station=([\w-]+)/.exec(location.hash);
  return m ? m[1] : null;
}

export default function App() {
  const [visits, setVisits] = useState(() => loadVisits());
  const [savedRoutes, setSavedRoutes] = useState(() => loadRoutes());
  const [trip, setTrip] = useState<TripState | null>(() => loadTrip());
  const [tab, setTab] = useState<Tab>('map');
  const [prefFilter, setPrefFilter] = useState<Prefecture | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(() => hashStationId());
  const [origin, setOrigin] = useState<OriginValue | null>(null);
  const [pickMode, setPickMode] = useState(false);
  const [routeStage, setRouteStage] = useState<RouteStage>('form');
  const [results, setResults] = useState<PlannedRoute[] | null>(null);
  const [routeLine, setRouteLine] = useState<LatLng[] | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);

  const stats = useMemo(() => computeStats(STATIONS, visits), [visits]);
  const selected = selectedId ? getStation(selectedId) : undefined;
  const activeSaved = trip ? (savedRoutes.find((r) => r.id === trip.savedRouteId) ?? null) : null;

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const onHash = () => setSelectedId(hashStationId());
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  // ---- 訪問記録 ----
  const setState = useCallback((id: string, state: StationState) => {
    setVisits((prev) => {
      const next = applyState(prev, id, state);
      saveVisits(next);
      return next;
    });
  }, []);

  // ---- ルート ----
  const submitPlan = useCallback((params: PlanParams) => {
    const rs = planRoutes(STATIONS, loadVisits(), params);
    setResults(rs);
    setRouteStage('results');
  }, []);

  const persistRoutes = (rs: SavedRoute[]) => {
    setSavedRoutes(rs);
    saveRoutes(rs);
  };

  const saveRoute = useCallback(
    (r: PlannedRoute, name: string): SavedRoute => {
      const sr: SavedRoute = {
        id: `route-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        createdAt: new Date().toISOString(),
        route: r,
        done: false,
      };
      persistRoutes([sr, ...loadRoutes()]);
      return sr;
    },
    [],
  );

  const startTrip = useCallback(
    (r: PlannedRoute) => {
      // 保存済みでなければ自動保存してから旅行を開始
      let sr = loadRoutes().find(
        (x) => x.route.stops.map((s) => s.stationId).join('>') === r.stops.map((s) => s.stationId).join('>') && !x.done,
      );
      if (!sr) sr = saveRoute(r, `${r.title} ${new Date(r.params.departAt).toLocaleDateString('ja-JP')}`);
      const t: TripState = { savedRouteId: sr.id, startedAt: new Date().toISOString(), progress: {} };
      setTrip(t);
      saveTrip(t);
      setTab('route');
    },
    [saveRoute],
  );

  const setProgress = useCallback((stationId: string, p: StopProgress) => {
    setTrip((prev) => {
      if (!prev) return prev;
      const next = { ...prev, progress: { ...prev.progress, [stationId]: p } };
      saveTrip(next);
      return next;
    });
  }, []);

  const finishTrip = useCallback(
    (visitedIds: string[], stampIds: string[]) => {
      setVisits((prev) => {
        let next = prev;
        const stampSet = new Set(stampIds);
        for (const id of visitedIds) {
          if (stampSet.has(id)) continue; // スタンプ側で処理
          if (next[id]?.state === 'stamped') continue; // 既存スタンプを格下げしない
          next = applyState(next, id, 'visited');
        }
        for (const id of stampIds) next = applyState(next, id, 'stamped');
        saveVisits(next);
        return next;
      });
      if (trip) {
        const rs = loadRoutes().map((r) => (r.id === trip.savedRouteId ? { ...r, done: true } : r));
        persistRoutes(rs);
      }
      setTrip(null);
      saveTrip(null);
      setRouteLine(null);
      setRouteStage('form');
      setResults(null);
    },
    [trip],
  );

  const previewOnMap = useCallback((r: PlannedRoute) => {
    setRouteLine(routePoints(r, getStation));
    setTab('map');
  }, []);

  const resetAll = useCallback(() => {
    clearAllUserData();
    setVisits({});
    setSavedRoutes([]);
    setTrip(null);
    setResults(null);
    setRouteStage('form');
    setRouteLine(null);
  }, []);

  // 最新の訪問記録をコールバックから参照するためのref
  const visitsRef = useRef(visits);
  useEffect(() => {
    visitsRef.current = visits;
  }, [visits]);

  /** 1タップ後に表示するコンパクトなポップアップ（駅名+結果+詳細+元に戻す） */
  interface TapToast {
    stationId: string;
    name: string;
    message: string;
    /** 元に戻す用: 変更前の記録（undefined=記録なし、null=元に戻す非表示） */
    prev: VisitRecord | undefined | null;
    key: number;
  }
  const [toast, setToast] = useState<TapToast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((t: Omit<TapToast, 'key'>) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ ...t, key: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }, []);

  const openOfficial = useCallback((id: string) => {
    const st = getStation(id);
    if (!st) return;
    // 公式URLがない施設は登録済み情報ページ（全国道の駅連絡会/国交省）へフォールバック
    const url = st.officialUrl ?? st.infoUrl;
    // 新しいタブで開く。注意: features に 'noopener' を渡すと成功時も null が返り
    // ブロック判定できないため、開いた後に opener を切る方式にする。
    // 本当にポップアップブロックされた場合（null）のみ、中間画面を挟まず現在のタブで直接遷移する
    // （訪問記録はlocalStorage保存済みのため、ブラウザの「戻る」で復帰しても保持される）
    const w = window.open(url, '_blank');
    if (w) {
      try {
        w.opener = null;
      } catch {
        /* cross-origin等で触れない場合は無視 */
      }
    } else {
      location.assign(url);
    }
  }, []);

  /**
   * マーカーのタップ: 状態を1段階だけ進める（未訪問→訪問済み→行きたい→スタンプ取得済み→未訪問）。
   * タップ間隔に関係なく、押した瞬間に即時反映する。開業前はユーザー操作では変更しない。
   */
  const STATE_MESSAGE: Record<StationState, string> = {
    unvisited: '未訪問に戻しました',
    visited: '訪問済みに変更しました ✓',
    wishlist: '行きたいに変更しました ★',
    stamped: 'スタンプ取得済みに変更しました 印',
  };
  const handleTapStation = useCallback(
    (id: string) => {
      const st = getStation(id);
      if (!st) return;
      if (st.status !== 'open') {
        showToast({ stationId: id, name: st.name, message: '開業前の施設です（状態は変更できません）', prev: null });
        return;
      }
      const prev = visitsRef.current[id];
      const next = nextState(prev?.state ?? 'unvisited');
      setState(id, next);
      showToast({ stationId: id, name: st.name, message: STATE_MESSAGE[next], prev });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showToast, setState],
  );

  /** 元に戻す: 変更前の記録を復元 */
  const undoToast = useCallback(() => {
    if (!toast || toast.prev === null) return;
    setVisits((cur) => {
      const next = { ...cur };
      if (toast.prev) next[toast.stationId] = toast.prev;
      else delete next[toast.stationId];
      saveVisits(next);
      return next;
    });
    setToast(null);
  }, [toast]);

  const closeSheet = useCallback(() => {
    setSelectedId(null);
    if (location.hash.startsWith('#station=')) history.replaceState(null, '', location.pathname);
  }, []);

  return (
    <div className="app">
      {!online && (
        <div className="offline-banner" data-testid="offline-banner">
          オフラインです。訪問記録・保存ルートは閲覧/更新できます。地図タイル・外部リンクは利用できません。
        </div>
      )}
      <StatsHeader stats={stats} prefFilter={prefFilter} onSelectPref={setPrefFilter} />
      <div className="filter-groups">
        <div className="filter-row" role="toolbar" aria-label="地域で絞り込み">
          <span className="fg-label">地域</span>
          <button
            className={`chip${prefFilter === null ? ' active' : ''}`}
            onClick={() => setPrefFilter(null)}
            data-testid="chip-tohoku"
          >
            東北全体
          </button>
          {stats.byPref.map((p) => (
            <button
              key={p.pref}
              className={`chip${prefFilter === p.pref ? ' active' : ''}`}
              onClick={() => setPrefFilter(prefFilter === p.pref ? null : p.pref)}
              data-testid={`chip-${p.pref}`}
            >
              {p.pref.replace('県', '')} {p.visited}/{p.total}
            </button>
          ))}
        </div>
        <div className="filter-row" role="toolbar" aria-label="表示状態で絞り込み">
          <span className="fg-label">表示</span>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              className={`chip${statusFilter === f.key ? ' active' : ''}`}
              onClick={() => setStatusFilter(f.key)}
              data-testid={`filter-${f.key}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <main className="app-main">
        {/* 地図は常にマウントしたまま表示切替（状態保持のため） */}
        <div style={{ position: 'absolute', inset: 0, visibility: tab === 'map' ? 'visible' : 'hidden' }}>
          <MapView
            stations={STATIONS}
            visits={visits}
            prefFilter={prefFilter}
            statusFilter={statusFilter}
            onTapStation={handleTapStation}
            onMapTap={closeSheet}
            pickMode={pickMode}
            onPick={(p) => {
              setOrigin({ lat: p.lat, lng: p.lng, label: `地図指定 (${p.lat.toFixed(3)}, ${p.lng.toFixed(3)})` });
              setPickMode(false);
              setTab('route');
            }}
            routeLine={routeLine}
            focusStationId={tab === 'map' ? selectedId : null}
            sheetOpen={selectedId != null}
          />
          {trip && activeSaved && tab === 'map' && (
            <button className="trip-banner" onClick={() => setTab('route')} data-testid="trip-banner">
              ▶ 旅行中: {activeSaved.name}（タップで旅行画面へ）
            </button>
          )}
          {toast && tab === 'map' && (
            <div className="tap-toast" data-testid="tap-toast" key={toast.key}>
              <div className="tap-toast-text">
                <b data-testid="tap-toast-name">道の駅 {toast.name}</b>
                <span data-testid="tap-toast-msg">{toast.message}</span>
              </div>
              <div className="tap-toast-actions">
                {toast.prev !== null && (
                  <button onClick={undoToast} data-testid="tap-toast-undo">
                    元に戻す
                  </button>
                )}
                <button
                  data-testid="tap-toast-official"
                  onClick={() => openOfficial(toast.stationId)}
                >
                  公式HP
                </button>
                <button
                  className="btn-primary"
                  data-testid="tap-toast-detail"
                  onClick={() => {
                    setSelectedId(toast.stationId);
                    setToast(null);
                  }}
                >
                  詳細
                </button>
                <button aria-label="閉じる" onClick={() => setToast(null)} data-testid="tap-toast-close">
                  ✕
                </button>
              </div>
            </div>
          )}
        </div>

        {tab === 'route' && (
          <div className="pane" data-testid="route-pane">
            {trip && activeSaved ? (
              <TripView
                saved={activeSaved}
                trip={trip}
                visits={visits}
                getStation={getStation}
                onProgress={setProgress}
                onVisit={(id) => setState(id, 'visited')}
                onStamp={(id) => setState(id, 'stamped')}
                onFinish={finishTrip}
                onShowMap={() => previewOnMap(activeSaved.route)}
                onExit={() => setTab('map')}
              />
            ) : routeStage === 'results' && results ? (
              <RouteResults
                routes={results}
                getStation={getStation}
                onSave={(r, name) => saveRoute(r, name)}
                onStartTrip={startTrip}
                onPreviewOnMap={previewOnMap}
                onBack={() => setRouteStage('form')}
              />
            ) : (
              <PlannerForm
                stations={STATIONS}
                origin={origin}
                onOriginChange={setOrigin}
                onRequestMapPick={() => {
                  setPickMode(true);
                  setTab('map');
                }}
                onSubmit={submitPlan}
              />
            )}
          </div>
        )}

        {tab === 'records' && (
          <div className="pane" data-testid="records-pane">
            <SavedRoutesView
              routes={savedRoutes}
              getStation={getStation}
              onOpen={(sr) => {
                setResults([sr.route]);
                setRouteStage('results');
                setTab('route');
              }}
              onDuplicate={(sr) => {
                persistRoutes([
                  {
                    ...sr,
                    id: `route-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                    name: `${sr.name}（複製）`,
                    createdAt: new Date().toISOString(),
                    done: false,
                  },
                  ...loadRoutes(),
                ]);
              }}
              onRecalc={(sr) => {
                const rs = planRoutes(STATIONS, loadVisits(), sr.route.params);
                setResults(rs);
                setRouteStage('results');
                setTab('route');
              }}
              onDelete={(id) => persistRoutes(loadRoutes().filter((r) => r.id !== id))}
              onResetAll={resetAll}
            />
          </div>
        )}

        {selected && tab === 'map' && (
          <StationSheet station={selected} visits={visits} onSetState={setState} onClose={closeSheet} />
        )}
      </main>

      <nav className="tabbar" aria-label="メインナビゲーション">
        <button className={tab === 'map' ? 'active' : ''} onClick={() => setTab('map')} data-testid="tab-map">
          <span className="icon">🗾</span>地図
        </button>
        <button className={tab === 'route' ? 'active' : ''} onClick={() => setTab('route')} data-testid="tab-route">
          <span className="icon">🚗</span>ルート
        </button>
        <button
          className={tab === 'records' ? 'active' : ''}
          onClick={() => setTab('records')}
          data-testid="tab-records"
        >
          <span className="icon">📖</span>記録
        </button>
      </nav>
    </div>
  );
}
