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
import { planCourses } from './lib/planner';
import { osrmProvider } from './lib/routing';
import { navToPointUrl, navToStationUrl } from './lib/gmaps';
import { filterSummary, filterStations } from './lib/ui';
import { loadMapSettings, saveMapSettings, type MapSettings } from './lib/mapSettings';
import { applyBackup, buildBackup, parseBackup, type BackupFile, type ParseResult, type RestoreMode } from './lib/backup';
import type { LatLng } from './lib/geo';
import type { Station } from './types';
import {
  applyState,
  clearAllUserData,
  loadRoutes,
  loadTrip,
  loadVisits,
  saveRoutes,
  saveTrip,
  saveVisits,
} from './lib/storage';
import { MAX_MANUAL_STATIONS } from './lib/manualRoute';
import { toggleSelection, removeSelection, moveSelection } from './lib/routeSelection';
import { CATEGORY_LABEL, DEFAULT_STAY_MIN, poiDisplayName, poiGoogleSearchUrl, RAINY_DAY_SUBCATEGORIES, type Poi, type PoiCategory, type PoiSubcategory } from './lib/poi';
import {
  searchNearbyPoisAuto,
  peekCachedPois,
  DEFAULT_RADIUS_M,
  type EndpointAttemptLog,
  type SearchRadiusM,
} from './lib/overpass';
import { loadStaticPoiCache } from './lib/poiStaticCache';
import PoiSearchPanel, { sortPois, type PoiSortMode } from './components/PoiSearchPanel';
import PoiDetailSheet from './components/PoiDetailSheet';
import {
  DEFAULT_ROUTE_DRAFT,
  clearRouteDraft,
  loadRouteDraft,
  saveRouteDraft,
  type RouteDraft,
} from './lib/routeDraft';
import MapView from './components/MapView';
import StatsHeader from './components/StatsHeader';
import StationSheet from './components/StationSheet';
import PlannerForm, { type OriginValue } from './components/PlannerForm';
import RouteResults, { routePoints } from './components/RouteResults';
import TripView from './components/TripView';
import SavedRoutesView from './components/SavedRoutesView';
import CourseModePicker, { type CourseMode } from './components/CourseModePicker';
import ManualRouteBuilder from './components/ManualRouteBuilder';
import RouteSelectBar from './components/RouteSelectBar';
import RouteSelectionSheet from './components/RouteSelectionSheet';
import ConfirmDialog from './components/ConfirmDialog';

type Tab = 'map' | 'route' | 'records';

/**
 * 周辺スポットの検索地点。stationIdは道の駅起点で選んだ場合のみ設定され、
 * 事前生成された静的POIキャッシュ(public/data/poi/<stationId>.json)を
 * 参照するために使う（現在地・地図指定・ルート立ち寄り先には無い）。
 */
type PoiOrigin = { lat: number; lng: number; label: string; stationId?: string };
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
  const [stationQuery, setStationQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(() => hashStationId());
  const [origin, setOrigin] = useState<OriginValue | null>(null);
  const [pickMode, setPickMode] = useState(false);
  const [routeStage, setRouteStage] = useState<RouteStage>('form');
  const [results, setResults] = useState<PlannedRoute[] | null>(null);
  const [planning, setPlanning] = useState(false);
  const [routeLine, setRouteLine] = useState<LatLng[] | null>(null);
  /** ルート線が実道路形状でない（駅間を直線で結んだ概略表示）とき true */
  const [routeLineApprox, setRouteLineApprox] = useState(false);
  const [routeStops, setRouteStops] = useState<{ lat: number; lng: number; order: number }[] | null>(null);
  const planAbortRef = useRef<AbortController | null>(null);
  /** results/routeStage='results'が「保存」タブから開いた保存済みコースの再表示であるとき、そのID */
  const [viewingSavedId, setViewingSavedId] = useState<string | null>(null);
  /** コース取り消し/作り直しの確認ダイアログ（'discard'=このコースを取り消す, 'restart'=最初から作り直す） */
  const [pendingCourseAction, setPendingCourseAction] = useState<'discard' | 'restart' | null>(null);
  const [routeActionMsg, setRouteActionMsg] = useState<string | null>(null);
  const routeActionMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showRouteActionMsg = useCallback((msg: string) => {
    if (routeActionMsgTimer.current) clearTimeout(routeActionMsgTimer.current);
    setRouteActionMsg(msg);
    routeActionMsgTimer.current = setTimeout(() => setRouteActionMsg(null), 5000);
  }, []);
  const [online, setOnline] = useState(() => navigator.onLine);
  // スマホでは絞り込みを初期状態で閉じ、地図を広く使う
  const [filtersOpen, setFiltersOpen] = useState(
    () => !window.matchMedia('(max-width: 700px)').matches,
  );
  // 地図全画面モード（CSSのみで実現。Fullscreen APIには依存しない。再読み込みで通常表示に戻る）
  const [mapFullscreen, setMapFullscreen] = useState(false);
  const mapFsRef = useRef(false);
  mapFsRef.current = mapFullscreen;
  const fsHistoryRef = useRef(false); // 履歴にpush済みか
  const enterMapFullscreen = useCallback(() => {
    setMapFullscreen(true);
    try {
      history.pushState({ mapFs: true }, '');
      fsHistoryRef.current = true;
    } catch {
      /* noop */
    }
  }, []);
  const exitMapFullscreen = useCallback(() => {
    setMapFullscreen(false);
    if (fsHistoryRef.current) {
      fsHistoryRef.current = false;
      try {
        if (history.state?.mapFs) history.back();
      } catch {
        /* noop */
      }
    }
  }, []);
  // 地図表示設定（全駅表示/まとめて表示・駅名表示）。localStorage保存で再読み込み後も維持
  const [mapSettings, setMapSettings] = useState<MapSettings>(() => loadMapSettings());
  const changeMapSettings = useCallback((s: MapSettings) => {
    setMapSettings(s);
    saveMapSettings(s);
  }, []);

  // ---- コース作成方式（おすすめコース/地図から選ぶ）----
  const COURSE_MODE_KEY = 'tohoku-me:course-mode-last:v1';
  const [lastCourseMode, setLastCourseMode] = useState<CourseMode | null>(() => {
    try {
      const v = localStorage.getItem(COURSE_MODE_KEY);
      return v === 'auto' || v === 'manual' ? v : null;
    } catch {
      return null;
    }
  });
  // タブを開くたびに常にこの画面を経由させる（初めて使う人にも違いがすぐ分かるように）
  const [courseMode, setCourseMode] = useState<CourseMode | 'choose'>('choose');
  // 地図から選ぶ: 選択モード・選択済み駅ID（選んだ順）・下書き
  const [routeSelectMode, setRouteSelectMode] = useState(false);
  const [routeSelectedIds, setRouteSelectedIds] = useState<string[]>([]);
  // 選択済みの周辺スポット（キー: Poi.id）。routeSelectedIds内のPOI由来IDを解決するための実データ
  const [selectedPois, setSelectedPois] = useState<Record<string, Poi>>({});

  // ---- 周辺スポット検索（Gate1〜4） ----
  // 検索パネルの開閉と、検索条件・通信状態は完全に別のstateとして管理する
  // （位置情報の失敗やOverpassの失敗でパネルが開かなくなる設計を禁止するため）。
  const [isPoiPanelOpen, setIsPoiPanelOpen] = useState(false);
  /** 検索地点の選び方（道の駅を選ぶ/現在地/地図で指定/ルート上の立ち寄り先）。初期値は「道の駅を選ぶ」 */
  const [poiOriginMode, setPoiOriginMode] = useState<'station' | 'current' | 'route'>('station');
  /** 選択中（まだ検索を実行していない場合を含む）の検索地点 */
  const [searchOrigin, setSearchOrigin] = useState<PoiOrigin | null>(null);
  // 初期値は「すべて」。道の駅の周辺は郊外が多く、特定カテゴリ（例:食べる）だけでは
  // 0件に見えやすいため、まず全カテゴリを見せてから絞り込んでもらう
  const [poiCategory, setPoiCategory] = useState<PoiCategory | null>(null);
  /** 結果が少なく自動的に検索範囲を広げた場合true（ユーザーが明示的に選んだ範囲ではない旨を案内する） */
  const [poiAutoExpanded, setPoiAutoExpanded] = useState(false);
  const [poiSubcategory, setPoiSubcategory] = useState<string>('all');
  const [poiRadius, setPoiRadius] = useState<SearchRadiusM>(DEFAULT_RADIUS_M);
  /** 現在地取得の状態（Overpass通信の状態とは完全に分離する） */
  const [geolocationStatus, setGeolocationStatus] = useState<'idle' | 'requesting' | 'denied' | 'ok'>('idle');
  /** Overpass検索リクエストの状態 */
  const [poiRequestStatus, setPoiRequestStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  /** 表示中の結果が新鮮なキャッシュ/前回成功時の保存結果である間true */
  const [poiFromCache, setPoiFromCache] = useState(false);
  /** stale-while-revalidate: キャッシュを即表示しつつ裏で最新データを取得中の間true */
  const [poiRevalidating, setPoiRevalidating] = useState(false);
  const [poiRawResults, setPoiRawResults] = useState<Poi[]>([]);
  /** 直近の検索の接続先ごとの試行ログ（診断表示専用。本番の公開URLでは表示しない） */
  const [poiAttemptLog, setPoiAttemptLog] = useState<EndpointAttemptLog[]>([]);
  const [poiDetail, setPoiDetail] = useState<Poi | null>(null);
  const poiAbortRef = useRef<AbortController | null>(null);
  // 旧コードとの互換用エイリアス（同じ意味の派生値。読みやすさのためだけに用意）
  const poiSearchActive = isPoiPanelOpen;
  const poiOrigin = searchOrigin;
  const setPoiOrigin = setSearchOrigin;
  const poiLoading = poiRequestStatus === 'loading';
  const poiFailed = poiRequestStatus === 'error';
  const poiGeoFailed = geolocationStatus === 'denied';

  // カテゴリ/サブカテゴリでの絞り込みはクライアント側で行う（同じ地点+半径ならAPIへ再検索しない）
  const poiSearchResults = useMemo(() => {
    let list = poiRawResults;
    if (poiCategory) {
      list = list.filter((p) => p.category === poiCategory);
      // subcategoriesはlocalStorage経由の旧データに無いことがあるため、
      // 常に subcategory（単数）へフォールバックしてから判定する
      if (poiSubcategory === '__rainy__') {
        list = list.filter((p) => (p.subcategories ?? [p.subcategory]).some((s) => RAINY_DAY_SUBCATEGORIES.includes(s)));
      } else if (poiSubcategory !== 'all') {
        list = list.filter((p) => (p.subcategories ?? [p.subcategory]).includes(poiSubcategory as PoiSubcategory));
      }
    }
    return list;
  }, [poiRawResults, poiCategory, poiSubcategory]);
  const [poiSort, setPoiSort] = useState<PoiSortMode>('distance');
  const sortedPoiResults = useMemo(() => sortPois(poiSearchResults, poiSort), [poiSearchResults, poiSort]);

  /**
   * 実際にOverpassへ通信する。呼び出すのは「この周辺を検索」ボタン、または
   * 道の駅シート等「検索地点が既に確定している」文脈からの呼び出しのみで、
   * 検索パネルを開いた時点・検索地点を選んだ時点では絶対に呼ばない。
   */
  const runPoiSearch = useCallback(
    async (o: PoiOrigin, radius: SearchRadiusM) => {
      poiAbortRef.current?.abort();
      const ctrl = new AbortController();
      poiAbortRef.current = ctrl;
      setSearchOrigin(o);
      setIsPoiPanelOpen(true);
      setPoiAutoExpanded(false);

      // stale-while-revalidate: 過去に成功した結果があれば通信を待たずに即表示し、
      // 裏で最新データを取得する。取得が失敗してもこの表示は消さない
      // （「周辺スポット画面は何も表示されない状態を作らない」ため）。
      let hadCache = false;
      const localCached = peekCachedPois(o.lat, o.lng, radius);
      if (localCached !== null) {
        hadCache = true;
        setPoiRawResults(localCached);
        setPoiRequestStatus('ok');
        setPoiFromCache(true);
        setPoiRevalidating(true);
      } else {
        setPoiRequestStatus('loading');
        setPoiRevalidating(false);
      }

      // ローカルキャッシュが無く、道の駅起点の検索なら、事前生成された静的キャッシュを試す。
      // 同一オリジンの静的ファイル（GitHub Pages配信）のため、Overpass公開ミラーの
      // 瞬間的な不調とは無関係に読める。「毎回Overpassに直接依存する」構造そのものを避ける。
      if (!hadCache && o.stationId) {
        const staticCache = await loadStaticPoiCache(o.stationId);
        if (ctrl.signal.aborted) return;
        if (staticCache && staticCache.pois.length > 0) {
          hadCache = true;
          setPoiRawResults(staticCache.pois);
          setPoiRequestStatus('ok');
          setPoiFromCache(true);
          setPoiRevalidating(true);
        }
      }

      try {
        const res = await searchNearbyPoisAuto(o.lat, o.lng, radius, ctrl.signal);
        if (ctrl.signal.aborted) return;
        setPoiRevalidating(false);
        setPoiAttemptLog(res.attemptLog);
        if (res.failed) {
          // 失敗時、キャッシュを表示済みならそのまま見せ続ける（statusはok/fromCacheのまま維持）
          if (!hadCache) {
            setPoiRawResults([]);
            setPoiRequestStatus('error');
          }
        } else {
          setPoiRawResults(res.pois);
          setPoiRequestStatus('ok');
          setPoiFromCache(res.fromCache);
        }
        if (res.radiusUsed !== radius) {
          setPoiRadius(res.radiusUsed);
          setPoiAutoExpanded(true);
        }
      } catch {
        if (ctrl.signal.aborted) return;
        setPoiRevalidating(false);
        if (!hadCache) {
          setPoiRawResults([]);
          setPoiRequestStatus('error');
        }
      } finally {
        if (poiAbortRef.current === ctrl) {
          poiAbortRef.current = null;
        }
      }
    },
    [],
  );

  /** 「この周辺を検索」ボタン: 選択済みの検索地点で初めて通信を開始する */
  const runPoiSearchNow = useCallback(() => {
    if (!searchOrigin) return;
    void runPoiSearch(searchOrigin, poiRadius);
  }, [searchOrigin, poiRadius, runPoiSearch]);

  const changePoiRadius = useCallback(
    (r: SearchRadiusM) => {
      setPoiRadius(r);
      // 検索が既に一度実行済み（結果か失敗が表示されている）場合のみ、条件変更で再検索する。
      // まだ一度も検索していない段階では、地点未選択のまま通信を始めてしまわないようにする。
      if (searchOrigin && poiRequestStatus !== 'idle') void runPoiSearch(searchOrigin, r);
    },
    [searchOrigin, poiRequestStatus, runPoiSearch],
  );

  /** 「現在地」を検索地点として選ぶ。権限拒否・失敗してもパネルは閉じず、他の方法へ誘導する */
  const usePoiCurrentLocation = useCallback(() => {
    setGeolocationStatus('requesting');
    if (!('geolocation' in navigator)) {
      setGeolocationStatus('denied');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeolocationStatus('ok');
        setSearchOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: '現在地' });
      },
      // 現在地の取得失敗はOverpass通信の失敗とは別原因（権限拒否・タイムアウト等）。
      // 同じ「検索に失敗しました」表示にすると、実際には検索すら始まっていないのに
      // Googleマップへ誘導してしまい、アプリ内検索が機能しないという誤解を生む。
      () => setGeolocationStatus('denied'),
      { timeout: 10000 },
    );
  }, []);

  /**
   * 道の駅シート等、検索地点が既に確定している文脈から開く場合の入口。
   * この場合はユーザーの意図が単一で明確なため、パネルを開くと同時に検索も実行する。
   */
  const searchNearbyFor = useCallback(
    (o: PoiOrigin) => {
      setTab('map');
      setPoiOriginMode('station');
      void runPoiSearch(o, poiRadius);
    },
    [poiRadius, runPoiSearch],
  );

  const closePoiSearch = useCallback(() => {
    poiAbortRef.current?.abort();
    setIsPoiPanelOpen(false);
    setPoiRequestStatus('idle');
    setGeolocationStatus('idle');
    setPoiOriginMode('station');
    setPoiRawResults([]);
    setPoiOrigin(null);
    setPoiCategory(null);
    setPoiSubcategory('all');
    setPoiAutoExpanded(false);
    setPoiRevalidating(false);
    setPoiDetail(null);
  }, []);

  const [showSelectionSheet, setShowSelectionSheet] = useState(false);
  const [selectMsg, setSelectMsg] = useState<string | null>(null);
  const [manualDraftSnapshot, setManualDraftSnapshot] = useState<RouteDraft>(
    () => loadRouteDraft() ?? DEFAULT_ROUTE_DRAFT,
  );
  // 前回の選択が残っていれば起動時に再開を確認する（訪問記録キーとは別データ）
  const [pendingDraft, setPendingDraft] = useState<RouteDraft | null>(() => {
    const d = loadRouteDraft();
    return d && d.inProgress && d.selectedIds.length > 0 ? d : null;
  });

  const persistDraft = useCallback((patch: Partial<RouteDraft>) => {
    setManualDraftSnapshot((cur) => {
      const next = { ...cur, ...patch, inProgress: true };
      saveRouteDraft(next);
      return next;
    });
  }, []);

  const chooseCourseMode = useCallback((m: CourseMode) => {
    setLastCourseMode(m);
    try {
      localStorage.setItem(COURSE_MODE_KEY, m);
    } catch {
      /* noop */
    }
    setCourseMode(m);
    if (m === 'manual') {
      // カードから新規に始めるときは常にまっさらな選択から（続きは下書き再開ダイアログの役目）
      setRouteSelectedIds([]);
      clearRouteDraft();
      setManualDraftSnapshot(DEFAULT_ROUTE_DRAFT);
      setResults(null);
      setRouteStage('form');
      setRouteSelectMode(true);
      setTab('map');
    }
  }, []);

  const backToMapSelect = useCallback(() => {
    setRouteSelectMode(true);
    setTab('map');
  }, []);

  const proceedFromSelection = useCallback(() => {
    setRouteSelectMode(false);
    setShowSelectionSheet(false);
    setTab('route');
  }, []);

  const cancelManualSelection = useCallback(() => {
    setRouteSelectMode(false);
    setShowSelectionSheet(false);
    setRouteSelectedIds([]);
    setCourseMode('choose');
    clearRouteDraft();
    setManualDraftSnapshot(DEFAULT_ROUTE_DRAFT);
  }, []);

  const toggleRouteSelect = useCallback(
    (id: string) => {
      const { ids, result } = toggleSelection(routeSelectedIds, id, MAX_MANUAL_STATIONS);
      if (result === 'max-reached') {
        setSelectMsg(`一度に選べるのは最大${MAX_MANUAL_STATIONS}駅です`);
        setTimeout(() => setSelectMsg(null), 3000);
        return;
      }
      setRouteSelectedIds(ids);
      persistDraft({ selectedIds: ids });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeSelectedIds, persistDraft],
  );
  const removeFromSelection = useCallback(
    (id: string) => {
      const ids = removeSelection(routeSelectedIds, id);
      setRouteSelectedIds(ids);
      setSelectedPois((prev) => {
        if (!(id in prev)) {
          persistDraft({ selectedIds: ids });
          return prev;
        }
        const next = { ...prev };
        delete next[id];
        persistDraft({ selectedIds: ids, selectedPois: next });
        return next;
      });
    },
    [routeSelectedIds, persistDraft],
  );
  const clearAllSelection = useCallback(() => {
    setRouteSelectedIds([]);
    setSelectedPois({});
    persistDraft({ selectedIds: [], selectedPois: {} });
  }, [persistDraft]);
  const moveSelectionItem = useCallback(
    (index: number, dir: -1 | 1) => {
      const ids = moveSelection(routeSelectedIds, index, dir);
      setRouteSelectedIds(ids);
      persistDraft({ selectedIds: ids });
    },
    [routeSelectedIds, persistDraft],
  );
  /** 周辺スポットの選択トグル（地図タップ・詳細シートの両方から呼ばれる） */
  const togglePoiSelect = useCallback(
    (poi: Poi) => {
      const { ids, result } = toggleSelection(routeSelectedIds, poi.id, MAX_MANUAL_STATIONS);
      if (result === 'max-reached') {
        setSelectMsg(`一度に選べるのは最大${MAX_MANUAL_STATIONS}件です`);
        setTimeout(() => setSelectMsg(null), 3000);
        return;
      }
      setRouteSelectedIds(ids);
      setSelectedPois((prev) => {
        const next = { ...prev };
        if (result === 'removed') delete next[poi.id];
        else next[poi.id] = poi;
        persistDraft({ selectedIds: ids, selectedPois: next });
        return next;
      });
    },
    [routeSelectedIds, persistDraft],
  );
  /** 通常閲覧中（選択モードでない）に周辺スポットを選択した場合、その場で地図選択モードへ入る */
  const togglePoiSelectWithModeEntry = useCallback(
    (poi: Poi) => {
      if (!routeSelectMode) {
        setCourseMode('manual');
        setRouteSelectMode(true);
      }
      togglePoiSelect(poi);
    },
    [routeSelectMode, togglePoiSelect],
  );

  const handleManualOriginChange = useCallback(
    (o: OriginValue | null) => {
      setOrigin(o);
      persistDraft({ origin: o });
    },
    [persistDraft],
  );

  const handleManualDone = useCallback((route: PlannedRoute) => {
    setResults([route]);
    setRouteStage('results');
    setViewingSavedId(null);
    // 選択はあえて残す: 結果画面の「← コース一覧に戻る」で選択・設定を調整し直せるようにする
    clearRouteDraft();
    setManualDraftSnapshot(DEFAULT_ROUTE_DRAFT);
  }, []);

  const resumeDraft = useCallback(() => {
    if (!pendingDraft) return;
    setRouteSelectedIds(pendingDraft.selectedIds);
    setSelectedPois(pendingDraft.selectedPois);
    if (pendingDraft.origin) setOrigin(pendingDraft.origin);
    setManualDraftSnapshot(pendingDraft);
    setLastCourseMode('manual');
    try {
      localStorage.setItem(COURSE_MODE_KEY, 'manual');
    } catch {
      /* noop */
    }
    setCourseMode('manual');
    setPendingDraft(null);
    setTab('route');
  }, [pendingDraft]);

  const discardDraft = useCallback(() => {
    clearRouteDraft();
    setManualDraftSnapshot(DEFAULT_ROUTE_DRAFT);
    setPendingDraft(null);
  }, []);

  // 営業状態表示の基準時刻（1分ごとに更新。テストはclock固定で制御可能）
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60 * 1000);
    return () => clearInterval(t);
  }, []);
  const now = useMemo(() => new Date(nowTick), [nowTick]);

  // ホーム画面追加の案内（初回のみ・閉じたら再表示しない。保存タブから再表示可能）
  const A2HS_KEY = 'tohoku-me:a2hs-hint:v1';
  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  const [showA2hs, setShowA2hs] = useState(() => {
    try {
      return !isStandalone() && localStorage.getItem(A2HS_KEY) == null;
    } catch {
      return false;
    }
  });
  const dismissA2hs = useCallback(() => {
    setShowA2hs(false);
    try {
      localStorage.setItem(A2HS_KEY, '1');
    } catch {
      /* noop */
    }
  }, []);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  const stats = useMemo(() => computeStats(STATIONS, visits), [visits]);
  const selected = selectedId ? getStation(selectedId) : undefined;
  /** 絞り込み結果の駅一覧（地図のピン探しではなく、一覧タップで数秒で選べるようにするため） */
  const filteredStationList = useMemo(
    () => filterStations(STATIONS, visits, prefFilter, statusFilter, stationQuery),
    [prefFilter, statusFilter, stationQuery, visits],
  );
  // 県別・状態フィルターは「地図マーカーを絞り込む」専用（従来のシンプルな挙動）。
  // 一覧の自動展開は駅名・市町村検索が入力されているときだけ（県/状態を押しただけで
  // 一覧が全面展開され地図を隠してしまう問題の修正）。
  const stationListActive = stationQuery.trim() !== '';
  const activeSaved = trip ? (savedRoutes.find((r) => r.id === trip.savedRouteId) ?? null) : null;

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const onHash = () => setSelectedId(hashStationId());
    window.addEventListener('hashchange', onHash);
    // PCのEscで全画面解除（シート表示中はまずシートを閉じる）
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !mapFsRef.current) return;
      setSelectedId((cur) => {
        if (cur != null) return null; // 1回目: シートを閉じる
        setMapFullscreen(false); // 2回目: 全画面解除
        fsHistoryRef.current = false;
        return cur;
      });
    };
    window.addEventListener('keydown', onKey);
    // Android等の戻る操作: シート→全画面の順で閉じる（履歴を壊さない）。
    // ハッシュ遷移（駅シートの開閉）でも同種イベントが発火し得るため、
    // 「全画面エントリより手前へ戻ったときだけ」解除する。
    const onPop = (e: PopStateEvent) => {
      if (!mapFsRef.current) return;
      // 駅シートを開く前進ナビ等は無視（戻るでシートが閉じるのはhashchange側が処理）
      if (location.hash.startsWith('#station=')) return;
      // まだ全画面エントリ上（シートを閉じてfsエントリへ戻った状態）なら維持
      if ((e.state as { mapFs?: boolean } | null)?.mapFs) return;
      setMapFullscreen(false);
      fsHistoryRef.current = false;
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
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
  const submitPlan = useCallback(async (params: PlanParams) => {
    // 連打防止: 前回の計算を中断してから開始
    planAbortRef.current?.abort();
    const ctrl = new AbortController();
    planAbortRef.current = ctrl;
    setPlanning(true);
    try {
      const res = await planCourses(STATIONS, loadVisits(), params, { signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      setResults(res.courses);
      setRouteStage('results');
      setViewingSavedId(null);
    } catch {
      if (ctrl.signal.aborted) return;
      setResults([]);
      setRouteStage('results');
    } finally {
      if (planAbortRef.current === ctrl) {
        setPlanning(false);
        planAbortRef.current = null;
      }
    }
  }, []);

  /** 外部URLを新しいタブで直接開く（ブロック時のみ現在タブで遷移） */
  const openExternal = useCallback((url: string) => {
    const w = window.open(url, '_blank');
    if (w) {
      try {
        w.opener = null;
      } catch {
        /* noop */
      }
    } else {
      location.assign(url);
    }
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
      setRouteStops(null);
      setRouteLineApprox(false);
      setRouteStage('form');
      setResults(null);
      setViewingSavedId(null);
      setCourseMode('choose');
    },
    [trip],
  );

  /**
   * 「作成途中の下書き」「作成結果として現在表示中のコース」を一括で消す。
   * このコースを取り消す／最初から作り直す の共通処理。
   * 触れないもの: visits（訪問・スタンプ・行きたい記録）、savedRoutes（保存済みコース）、trip（旅行中の状態）。
   */
  const discardCurrentCourse = useCallback(() => {
    setResults(null);
    setRouteStage('form');
    setRouteLine(null);
    setRouteStops(null);
    setRouteLineApprox(false);
    setRouteSelectMode(false);
    setShowSelectionSheet(false);
    setRouteSelectedIds([]);
    setSelectedPois({});
    setManualDraftSnapshot(DEFAULT_ROUTE_DRAFT);
    clearRouteDraft();
    setViewingSavedId(null);
    setCourseMode('choose');
  }, []);

  const previewOnMap = useCallback((r: PlannedRoute) => {
    const pts = routePoints(r, getStation);
    // 訪問順の番号マーカー
    setRouteStops(
      r.stops
        .map((s, i) => {
          const st = getStation(s.stationId);
          return st ? { lat: st.lat, lng: st.lng, order: i + 1 } : null;
        })
        .filter((x): x is { lat: number; lng: number; order: number } => x !== null),
    );
    // まず概略（直線）を表示し、実道路形状が取れたら差し替える
    setRouteLine(pts);
    setRouteLineApprox(true);
    setTab('map');
    osrmProvider
      .route(pts)
      .then((shape) => {
        setRouteLine(shape.points.map(([lat, lng]) => ({ lat, lng })));
        setRouteLineApprox(false);
      })
      .catch(() => {
        /* 概略表示のまま（「概略表示」ラベルを出す） */
      });
  }, []);

  const resetAll = useCallback(() => {
    clearAllUserData();
    clearRouteDraft();
    setVisits({});
    setSavedRoutes([]);
    setTrip(null);
    setResults(null);
    setRouteStage('form');
    setRouteLine(null);
    setRouteStops(null);
    setRouteLineApprox(false);
    setRouteSelectedIds([]);
    setSelectedPois({});
    setRouteSelectMode(false);
    setShowSelectionSheet(false);
    setManualDraftSnapshot(DEFAULT_ROUTE_DRAFT);
    setViewingSavedId(null);
    setCourseMode('choose');
  }, []);

  // 記録のバックアップ書き出し（この端末のlocalStorageのみのため、機種変更・別ブラウザ移行用にJSONで保存）
  const exportBackup = useCallback(() => {
    const data = buildBackup();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const pad = (n: number) => String(n).padStart(2, '0');
    const d = new Date();
    const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `michinoeki-backup-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  const readBackupFile = useCallback(async (file: File): Promise<ParseResult> => {
    const text = await file.text();
    return parseBackup(text);
  }, []);

  // 復元を適用し、画面の状態（訪問記録・保存ルート・旅行中・地図設定・選択下書き）にも即時反映する
  const applyRestore = useCallback((data: BackupFile, mode: RestoreMode) => {
    const applied = applyBackup(data, mode);
    setVisits(applied.visits);
    setSavedRoutes(applied.routes);
    setTrip(applied.trip);
    setMapSettings(applied.mapSettings);
    const d = applied.manualDraft;
    setManualDraftSnapshot(d ?? DEFAULT_ROUTE_DRAFT);
    setPendingDraft(d && d.inProgress && d.selectedIds.length > 0 ? d : null);
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

  /** マーカーのタップ: 詳細シートを開くだけ。訪問状態は一切変更しない（誤タップでの色変化を防ぐ） */
  const handleOpenStation = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const STATE_MESSAGE: Record<StationState, string> = {
    unvisited: '未訪問に戻しました',
    visited: '訪問済みに変更しました ✓',
    wishlist: '行きたいに変更しました ★',
    stamped: 'スタンプ取得済みに変更しました 印',
  };
  /** 詳細シート内の明示的なボタンから呼ばれる、唯一の状態変更経路 */
  const handleSetStationState = useCallback(
    (id: string, next: StationState) => {
      const st = getStation(id);
      if (!st) return;
      const prev = visitsRef.current[id];
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
    <div className={`app${mapFullscreen ? ' map-fs' : ''}`}>
      {!online && !mapFullscreen && (
        <div className="offline-banner" data-testid="offline-banner">
          オフラインです。訪問記録・保存ルートは閲覧/更新できます。地図タイル・外部リンクは利用できません。
        </div>
      )}
      {pendingDraft && (
        <ConfirmDialog
          title="前回の続きがあります"
          message={`「地図から選ぶ」で選んでいた道の駅（${pendingDraft.selectedIds.length}駅）の続きがあります。続けますか？`}
          confirmLabel="続ける"
          onConfirm={resumeDraft}
          onCancel={discardDraft}
        />
      )}
      {pendingCourseAction === 'discard' && (
        <ConfirmDialog
          title="コースを取り消しますか？"
          message="現在のコースを取り消しますか？地図上の経路・番号・選択した立ち寄り先が消えます。訪問記録とスタンプ記録は消えません。"
          confirmLabel="コースを取り消す"
          cancelLabel="取り消さない"
          danger
          onConfirm={() => {
            discardCurrentCourse();
            setPendingCourseAction(null);
            showRouteActionMsg('コースを取り消しました。訪問記録は残っています');
          }}
          onCancel={() => setPendingCourseAction(null)}
        />
      )}
      {pendingCourseAction === 'restart' && (
        <ConfirmDialog
          title="最初から作り直しますか？"
          message="最初から作り直しますか？現在の選択・設定はすべて消えます。訪問記録とスタンプ記録は消えません。"
          confirmLabel="最初から作り直す"
          cancelLabel="作り直さない"
          danger
          onConfirm={() => {
            discardCurrentCourse();
            setPendingCourseAction(null);
            showRouteActionMsg('最初から作り直します。訪問記録は残っています');
          }}
          onCancel={() => setPendingCourseAction(null)}
        />
      )}
      {routeActionMsg && (
        <div className="route-action-toast" data-testid="route-action-toast">
          {routeActionMsg}
        </div>
      )}
      {!mapFullscreen && (
        <StatsHeader stats={stats} prefFilter={prefFilter} onSelectPref={setPrefFilter} />
      )}
      {!mapFullscreen && (
        <button
          className="filters-toggle"
          onClick={() => setFiltersOpen(!filtersOpen)}
          aria-expanded={filtersOpen}
          data-testid="filters-toggle"
        >
          {filtersOpen ? '▲ 絞り込みをたたむ' : `▼ ${filterSummary(prefFilter, statusFilter, stationQuery)}`}
        </button>
      )}
      <div
        className="filter-groups"
        style={filtersOpen && !mapFullscreen ? undefined : { display: 'none' }}
      >
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
        <div className="filter-row station-search-row">
          <span className="fg-label">検索</span>
          <input
            type="text"
            inputMode="search"
            className="station-search-input"
            placeholder="駅名・市町村で検索（例: 猪苗代、会津）"
            value={stationQuery}
            onChange={(e) => setStationQuery(e.target.value)}
            data-testid="station-search-input"
          />
          {stationQuery !== '' && (
            <button
              className="chip"
              onClick={() => setStationQuery('')}
              aria-label="検索文字をクリア"
              data-testid="station-search-clear"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      {tab === 'map' && !mapFullscreen && filtersOpen && stationListActive && (
        <div className="station-result-list" data-testid="station-result-list">
          {filteredStationList.length === 0 ? (
            <p className="station-result-empty" data-testid="station-result-empty">
              条件に一致する道の駅がありません。絞り込みを変更してください。
            </p>
          ) : (
            filteredStationList.map((s) => {
              const st = visits[s.id]?.state ?? 'unvisited';
              return (
                <button
                  key={s.id}
                  className="station-result-row"
                  data-testid={`station-result-${s.id}`}
                  onClick={() => handleOpenStation(s.id)}
                >
                  <span className="station-result-name">{s.name}</span>
                  <span className="station-result-city">
                    {s.pref} {s.city}
                  </span>
                  {s.status === 'open' && st !== 'unvisited' && (
                    <span className={`badge ${st === 'visited' ? 'visited' : st === 'wishlist' ? 'want' : 'stamp'}`}>
                      {st === 'visited' ? '✓ 訪問済み' : st === 'wishlist' ? '★ 行きたい' : '印 スタンプ済み'}
                    </span>
                  )}
                  {s.status !== 'open' && <span className="badge pre">開業前</span>}
                </button>
              );
            })
          )}
        </div>
      )}

      <main className="app-main">
        {/* 地図は常にマウントしたまま表示切替（状態保持のため） */}
        <div style={{ position: 'absolute', inset: 0, visibility: tab === 'map' ? 'visible' : 'hidden' }}>
          <MapView
            stations={STATIONS}
            visits={visits}
            prefFilter={prefFilter}
            statusFilter={statusFilter}
            onOpenStation={handleOpenStation}
            onMapTap={closeSheet}
            pickMode={pickMode}
            onPick={(p) => {
              setOrigin({ lat: p.lat, lng: p.lng, label: `地図指定 (${p.lat.toFixed(3)}, ${p.lng.toFixed(3)})` });
              setPickMode(false);
              setTab('route');
            }}
            routeLine={routeLine}
            routeStops={routeStops}
            focusStationId={tab === 'map' ? selectedId : null}
            sheetOpen={selectedId != null}
            now={now}
            fullscreen={mapFullscreen}
            selectedId={selectedId}
            settings={mapSettings}
            onChangeSettings={changeMapSettings}
            routeSelectMode={routeSelectMode}
            routeSelectedIds={routeSelectedIds}
            onToggleRouteSelect={toggleRouteSelect}
            poiResults={poiSearchActive ? poiSearchResults : []}
            onTapPoi={(poi) => setPoiDetail(poi)}
            onTogglePoiSelect={togglePoiSelect}
          />
          {/* 全画面の切替（CSSのみで確実に動作。左上・44px以上・safe-area対応） */}
          {tab === 'map' &&
            (mapFullscreen ? (
              <button className="fs-btn" onClick={exitMapFullscreen} data-testid="fullscreen-exit">
                ✕ 全画面を終了
              </button>
            ) : (
              <button className="fs-btn" onClick={enterMapFullscreen} data-testid="fullscreen-btn">
                ⛶ 全画面
              </button>
            ))}
          {routeLine && routeLineApprox && tab === 'map' && (
            <div className="map-hint" style={{ top: 56 }} data-testid="route-approx-note">
              ルート線は概略表示です（実道路の形ではありません）
            </div>
          )}
          {tab === 'map' && !trip && !toast && !routeSelectMode && (
            <button
              className={mapFullscreen ? 'course-pill' : 'trip-banner'}
              style={mapFullscreen ? undefined : { background: 'var(--select)', textAlign: 'center' }}
              onClick={() => {
                setMapFullscreen(false);
                fsHistoryRef.current = false;
                setTab('route');
              }}
              data-testid="make-course-btn"
            >
              🚗 コースを作る
            </button>
          )}
          {tab === 'map' && routeSelectMode && !showSelectionSheet && (
            <RouteSelectBar
              count={routeSelectedIds.length}
              onShowList={() => setShowSelectionSheet(true)}
              onCreate={proceedFromSelection}
              onClearAll={clearAllSelection}
              onExit={cancelManualSelection}
            />
          )}
          {tab === 'map' && routeSelectMode && showSelectionSheet && (
            <RouteSelectionSheet
              selectedIds={routeSelectedIds}
              getStation={getStation}
              selectedPois={selectedPois}
              now={now}
              onRemove={removeFromSelection}
              onMove={moveSelectionItem}
              onClearAll={clearAllSelection}
              onClose={() => setShowSelectionSheet(false)}
              onProceed={proceedFromSelection}
              onOpenPoiDetail={(poi) => {
                setShowSelectionSheet(false);
                setPoiDetail(poi);
              }}
            />
          )}
          {tab === 'map' && selectMsg && (
            <div className="map-hint" data-testid="route-select-msg">
              {selectMsg}
            </div>
          )}
          {tab === 'map' && !poiSearchActive && (
            <button
              className="poi-search-btn"
              onClick={() => setIsPoiPanelOpen(true)}
              data-testid="poi-search-open"
              aria-label="周辺スポットを探す"
            >
              🔍 周辺スポット
            </button>
          )}
          {tab === 'map' && !trip && routeLine && (
            <button
              className="route-discard-btn"
              onClick={() => setPendingCourseAction('discard')}
              data-testid="map-route-discard"
              aria-label="このコースを取り消す"
            >
              ❌ このコースを取り消す
            </button>
          )}
          {tab === 'map' && poiSearchActive && (
            <PoiSearchPanel
              stations={STATIONS.filter((s) => s.status === 'open')}
              originMode={poiOriginMode}
              onChangeOriginMode={setPoiOriginMode}
              origin={searchOrigin}
              onPickStation={(st) =>
                setSearchOrigin({ lat: st.lat, lng: st.lng, label: `道の駅${st.name}`, stationId: st.id })
              }
              onUseCurrentLocation={usePoiCurrentLocation}
              geolocationStatus={geolocationStatus}
              routeStopOptions={routeSelectedIds
                .map((id, i) => {
                  const st = getStation(id);
                  if (st) return { id, label: `${i + 1}. 道の駅${st.name}`, lat: st.lat, lng: st.lng, name: st.name };
                  const poi = selectedPois[id];
                  if (poi) return { id, label: `${i + 1}. ${poiDisplayName(poi)}`, lat: poi.lat, lng: poi.lng, name: poiDisplayName(poi) };
                  return null;
                })
                .filter((x): x is { id: string; label: string; lat: number; lng: number; name: string } => x !== null)}
              onPickRouteStop={(s) => setSearchOrigin({ lat: s.lat, lng: s.lng, label: s.name })}
              category={poiCategory}
              onChangeCategory={(c) => {
                setPoiCategory(c);
                setPoiSubcategory('all');
              }}
              subcategory={poiSubcategory}
              onChangeSubcategory={setPoiSubcategory}
              radius={poiRadius}
              onChangeRadius={changePoiRadius}
              canSearch={searchOrigin !== null}
              onSearch={runPoiSearchNow}
              loading={poiLoading}
              failed={poiFailed}
              geoFailed={poiGeoFailed}
              searched={poiRequestStatus !== 'idle'}
              resultCount={poiSearchResults.length}
              totalRawCount={poiRawResults.length}
              autoExpanded={poiAutoExpanded}
              fromCache={poiFromCache}
              attemptLog={poiAttemptLog}
              revalidating={poiRevalidating}
              onRetry={runPoiSearchNow}
              onGoogleFallback={() => {
                const label = poiCategory ? CATEGORY_LABEL[poiCategory] : '周辺スポット';
                const near = searchOrigin ? `${searchOrigin.lat},${searchOrigin.lng}` : '';
                openExternal(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${label} ${near}`)}`);
              }}
              onClose={closePoiSearch}
              results={sortedPoiResults}
              sort={poiSort}
              onChangeSort={setPoiSort}
              selectedIds={routeSelectedIds}
              onTapResult={(poi) => setPoiDetail(poi)}
              onToggleSelect={togglePoiSelectWithModeEntry}
            />
          )}
          {tab === 'map' && poiDetail && (
            <PoiDetailSheet
              poi={poiDetail}
              distanceLabel={`${poiOrigin?.label ?? '検索地点'}から`}
              selectedNumber={
                routeSelectedIds.includes(poiDetail.id) ? routeSelectedIds.indexOf(poiDetail.id) + 1 : null
              }
              stayMin={manualDraftSnapshot.stayOverrides[poiDetail.id] ?? DEFAULT_STAY_MIN[poiDetail.subcategory]}
              onChangeStayMin={(min) =>
                persistDraft({ stayOverrides: { ...manualDraftSnapshot.stayOverrides, [poiDetail.id]: min } })
              }
              onToggleRoute={() => togglePoiSelectWithModeEntry(poiDetail)}
              onNav={() => openExternal(navToPointUrl({ lat: poiDetail.lat, lng: poiDetail.lng }, 'highway_ok'))}
              onGoogleSearch={() => openExternal(poiGoogleSearchUrl(poiDetail))}
              onClose={() => setPoiDetail(null)}
            />
          )}
          {tab === 'map' && showA2hs && !selectedId && !pickMode && !routeSelectMode && (
            <div className="a2hs-banner" data-testid="a2hs-banner">
              <b>📲 ホーム画面に追加すると、アプリのように使えます</b>
              <br />
              {isIOS
                ? 'Safariの共有ボタン（□↑）→「ホーム画面に追加」を選んでください。'
                : 'ブラウザのメニュー（⋮）→「アプリをインストール」または「ホーム画面に追加」を選んでください。'}
              <div className="actions">
                <button className="btn-primary" onClick={dismissA2hs} data-testid="a2hs-close">
                  わかった
                </button>
              </div>
            </div>
          )}
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
                onArrived={(id) => setState(id, 'visited')}
                onStamp={(id) => setState(id, 'stamped')}
                onFinish={finishTrip}
                onEndTrip={() => {
                  finishTrip([], []);
                  showRouteActionMsg('旅行を終了しました。訪問記録・スタンプ記録は残っています');
                }}
                onShowMap={() => previewOnMap(activeSaved.route)}
                onExit={() => setTab('map')}
                onNavToStation={(st: Station) =>
                  openExternal(navToStationUrl(st, trip.roadPref ?? activeSaved.route.params.roadPref))
                }
                onNavToPoi={(poi) =>
                  openExternal(
                    navToPointUrl({ lat: poi.lat, lng: poi.lng }, trip.roadPref ?? activeSaved.route.params.roadPref),
                  )
                }
                onNavHome={() =>
                  openExternal(
                    navToPointUrl(
                      { lat: activeSaved.route.params.origin.lat, lng: activeSaved.route.params.origin.lng },
                      trip.roadPref ?? activeSaved.route.params.roadPref,
                    ),
                  )
                }
                roadPref={trip.roadPref ?? activeSaved.route.params.roadPref}
                onChangeRoadPref={(rp) =>
                  setTrip((prev) => {
                    if (!prev) return prev;
                    const next = { ...prev, roadPref: rp };
                    saveTrip(next);
                    return next;
                  })
                }
              />
            ) : routeStage === 'results' && results ? (
              <RouteResults
                routes={results}
                getStation={getStation}
                onSave={(r, name) => saveRoute(r, name)}
                onStartTrip={startTrip}
                onPreviewOnMap={previewOnMap}
                onBack={() => setRouteStage('form')}
                onRequestDiscard={() => setPendingCourseAction('discard')}
                onRequestRestart={() => setPendingCourseAction('restart')}
                viewingSavedName={viewingSavedId ? (savedRoutes.find((r) => r.id === viewingSavedId)?.name ?? null) : null}
              />
            ) : courseMode === 'choose' ? (
              <CourseModePicker lastUsed={lastCourseMode} onChoose={chooseCourseMode} />
            ) : courseMode === 'manual' ? (
              routeSelectMode ? (
                <div className="empty" data-testid="manual-select-hint">
                  地図で道の駅を選んでください。
                  <br />
                  <button style={{ marginTop: 8 }} onClick={() => setTab('map')} data-testid="manual-go-to-map">
                    地図へ戻る
                  </button>
                </div>
              ) : (
                <ManualRouteBuilder
                  stations={STATIONS}
                  getStation={getStation}
                  selectedIds={routeSelectedIds}
                  selectedPois={selectedPois}
                  stayOverrides={manualDraftSnapshot.stayOverrides}
                  origin={origin}
                  onOriginChange={handleManualOriginChange}
                  onRequestMapPick={() => {
                    setPickMode(true);
                    setTab('map');
                  }}
                  onBackToMapSelect={backToMapSelect}
                  onRemoveFromSelection={removeFromSelection}
                  onDone={handleManualDone}
                  onCancel={cancelManualSelection}
                  initialSettings={{
                    returnToStart: manualDraftSnapshot.returnToStart,
                    orderMode: manualDraftSnapshot.orderMode,
                    budgetMin: manualDraftSnapshot.budgetMin,
                    stayMin: manualDraftSnapshot.stayMin,
                    roadPref: manualDraftSnapshot.roadPref,
                  }}
                  onSettingsChange={persistDraft}
                />
              )
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
                planning={planning}
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
                setViewingSavedId(sr.id);
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
                setTab('route');
                void submitPlan(sr.route.params);
              }}
              onDelete={(id) => persistRoutes(loadRoutes().filter((r) => r.id !== id))}
              activeRouteId={trip?.savedRouteId ?? viewingSavedId ?? null}
              onDeleteAndClear={(id) => {
                persistRoutes(loadRoutes().filter((r) => r.id !== id));
                if (trip?.savedRouteId === id) {
                  finishTrip([], []);
                } else if (viewingSavedId === id) {
                  discardCurrentCourse();
                }
                showRouteActionMsg('保存済みコースを削除し、コースを終了しました。訪問記録は残っています');
              }}
              onResetAll={resetAll}
              onShowInstallHint={() => {
                setShowA2hs(true);
                setTab('map');
              }}
              onExportBackup={exportBackup}
              onReadBackupFile={readBackupFile}
              onApplyRestore={applyRestore}
            />
          </div>
        )}

        {selected && tab === 'map' && (
          <StationSheet
            station={selected}
            visits={visits}
            onSetState={handleSetStationState}
            onClose={closeSheet}
            onSearchNearby={() => {
              closeSheet();
              searchNearbyFor({
                lat: selected.lat,
                lng: selected.lng,
                label: `道の駅${selected.name}`,
                stationId: selected.id,
              });
            }}
          />
        )}
      </main>

      {mapFullscreen ? null : (
      <nav className="tabbar" aria-label="メインナビゲーション">
        <button className={tab === 'map' ? 'active' : ''} onClick={() => setTab('map')} data-testid="tab-map">
          <span className="icon">🗾</span>地図
        </button>
        <button
          className={`${tab === 'route' ? 'active' : ''}${trip ? ' trip-live' : ''}`}
          onClick={() => setTab('route')}
          data-testid="tab-route"
        >
          <span className="icon">🚗</span>
          {trip ? '旅行中' : 'コース'}
        </button>
        <button
          className={tab === 'records' ? 'active' : ''}
          onClick={() => setTab('records')}
          data-testid="tab-records"
        >
          <span className="icon">📖</span>保存
        </button>
      </nav>
      )}
    </div>
  );
}
