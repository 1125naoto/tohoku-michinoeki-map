import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  PlanParams,
  PlannedRoute,
  Prefecture,
  SavedRoute,
  StatusFilter,
  StopProgress,
  TripState,
  VisitStatus,
} from './types';
import { STATIONS, getStation } from './data';
import { computeStats } from './lib/stats';
import { planRoutes } from './lib/planner';
import type { LatLng } from './lib/geo';
import {
  applyStamp,
  applyStatus,
  clearAllUserData,
  loadRoutes,
  loadTrip,
  loadVisits,
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
  const setStatus = useCallback((id: string, status: VisitStatus) => {
    setVisits((prev) => {
      const next = applyStatus(prev, id, status);
      saveVisits(next);
      return next;
    });
  }, []);
  const setStamp = useCallback((id: string, stamp: boolean) => {
    setVisits((prev) => {
      const next = applyStamp(prev, id, stamp);
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
        for (const id of visitedIds) next = applyStatus(next, id, 'visited');
        for (const id of stampIds) next = applyStamp(next, id, true);
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

  const openStation = useCallback((id: string) => {
    setSelectedId(id);
    setTab('map');
  }, []);

  return (
    <div className="app">
      {!online && (
        <div className="offline-banner" data-testid="offline-banner">
          オフラインです。訪問記録・保存ルートは閲覧/更新できます。地図タイル・外部リンクは利用できません。
        </div>
      )}
      <StatsHeader stats={stats} prefFilter={prefFilter} onSelectPref={setPrefFilter} />
      <div className="filter-row" role="toolbar" aria-label="絞り込み">
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
        <span style={{ borderLeft: '1px solid var(--border)', margin: '0 2px' }} />
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

      <main className="app-main">
        {/* 地図は常にマウントしたまま表示切替（状態保持のため） */}
        <div style={{ position: 'absolute', inset: 0, visibility: tab === 'map' ? 'visible' : 'hidden' }}>
          <MapView
            stations={STATIONS}
            visits={visits}
            prefFilter={prefFilter}
            statusFilter={statusFilter}
            onSelect={openStation}
            pickMode={pickMode}
            onPick={(p) => {
              setOrigin({ lat: p.lat, lng: p.lng, label: `地図指定 (${p.lat.toFixed(3)}, ${p.lng.toFixed(3)})` });
              setPickMode(false);
              setTab('route');
            }}
            routeLine={routeLine}
            focusStationId={tab === 'map' ? selectedId : null}
          />
          {trip && activeSaved && tab === 'map' && (
            <button className="trip-banner" onClick={() => setTab('route')} data-testid="trip-banner">
              ▶ 旅行中: {activeSaved.name}（タップで旅行画面へ）
            </button>
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
                onVisit={(id) => setStatus(id, 'visited')}
                onStamp={(id) => setStamp(id, true)}
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
          <StationSheet
            station={selected}
            visits={visits}
            onSetStatus={setStatus}
            onSetStamp={setStamp}
            onClose={() => {
              setSelectedId(null);
              if (location.hash.startsWith('#station=')) history.replaceState(null, '', location.pathname);
            }}
          />
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
