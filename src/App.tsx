import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AreaName,
  CustomStopInfo,
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
import { AREAS } from './types';
import { STATIONS, getStation } from './data';
import { computeStats } from './lib/stats';
import { planCourses } from './lib/planner';
import { osrmProvider } from './lib/routing';
import { latLngUrl, navToPointUrl, navToStationUrl, stationSearchUrl } from './lib/gmaps';
import { googleWebSearchUrl, stationNearbySearchQuery } from './lib/websearch';
import {
  filterSummary,
  filterStations,
  isFacilityFilterActive,
  matchesFacilityFilter,
  prefecturesInArea,
  type FacilityFilter,
  type SelectedPrefectures,
} from './lib/ui';
import { loadMapSettings, saveMapSettings, type MapSettings } from './lib/mapSettings';
import {
  isAreaChosenThisSession,
  loadAreaSelection,
  markAreaChosenThisSession,
  saveAreaSelection,
} from './lib/areaSelection';
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
import { MAX_MANUAL_STATIONS, makeCustomStopId } from './lib/manualRoute';
import { toggleSelection, removeSelection, moveSelection } from './lib/routeSelection';
import { CATEGORY_LABEL, DEFAULT_STAY_MIN, poiDisplayName, poiGoogleSearchUrl, RAINY_DAY_SUBCATEGORIES, type Poi, type PoiCategory, type PoiSubcategory } from './lib/poi';
import {
  peekCachedPois,
  DEFAULT_RADIUS_M,
  POI_RESULT_LIMIT,
  type EndpointAttemptLog,
  type SearchRadiusM,
} from './lib/overpass';
import { StaticOsmPoiProvider, OverpassPoiProvider } from './lib/poiProvider';
import { describeGeolocationError, getBestCurrentPosition } from './lib/geolocation';
import PoiSearchPanel, { sortPois, type PoiSortMode } from './components/PoiSearchPanel';
import PoiDetailSheet from './components/PoiDetailSheet';
import DiagnosticsPanel from './components/DiagnosticsPanel';
import RegionLanding from './components/RegionLanding';
import PrefectureChipGroups from './components/PrefectureChipGroups';
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
  /**
   * 端末への保存(localStorage)が失敗した場合true（容量超過・プライベートブラウジング
   * での書き込み拒否等）。falseに戻すのは保存が実際に成功した時のみとし、
   * 「保存できたことにして黙って続行」しない（Astra監査P1）。
   */
  const [storageWriteFailed, setStorageWriteFailed] = useState(false);
  /** 失敗のみを記録する（一度失敗したら、後続の別の保存が成功しても勝手に消さない。
   * ユーザーが状況を確認して閉じる操作をするまで警告を残す） */
  const noteSaveResult = useCallback((ok: boolean) => {
    if (!ok) setStorageWriteFailed(true);
  }, []);
  const [tab, setTab] = useState<Tab>('map');
  /**
   * 表示中の都道府県。前回選んだ県を初期値にしておき、地域選択画面での初期チェックと
   * 「変更せずに戻る」の戻り先に使う（未選択＝空配列＝全国。絞り込みロジックは不変）。
   */
  const [selectedPrefectures, setSelectedPrefectures] = useState<SelectedPrefectures>(
    () => loadAreaSelection()?.prefectures ?? [],
  );
  /**
   * 「どこを旅しますか？」（地域選択画面）を表示するか。
   *
   * COLD START（アプリを新しく開いた）では、前回の県が保存されていても必ずここから
   * 始める。全国1,237施設をいきなり地図に出すと情報量が多すぎるうえ、前回の県のまま
   * 勝手に始まると「今どの範囲を見ているのか」が分からないため。
   *
   * BACKGROUND RESUME（Google検索・Googleマップ・他アプリへ行って戻っただけ）は
   * 区別し、今見ている画面をそのまま維持する。これは
   * - 復帰ではReactが再マウントされないのでこのstateがそのまま残る
   * - 同一セッション中の再読み込み（Service Workerの更新適用など）でも戻らないよう、
   *   sessionStorageの印（isAreaChosenThisSession）で判定する
   * の二段で担保する。visibilitychange / pageshow / focus では再表示しない。
   *
   * 次の場合はユーザーが意図した画面をふさいでしまうため出さない:
   * - 駅への共有リンク(#station=...)で開いたとき（その駅を見に来ている）
   * - 旅行中(TripState)のまま再訪したとき（進行中の旅を邪魔しない）
   * 地図からはいつでも「地域・県を変更」で開き直せる。
   */
  const [showRegionLanding, setShowRegionLanding] = useState(
    () => !isAreaChosenThisSession() && hashStationId() == null && loadTrip() == null,
  );
  /**
   * ユーザーが地域を選択済みか（＝以後の絞り込み変更を次回起動用に保存してよいか）。
   * 地域選択画面をスキップしただけの状態では保存せず、次に通常起動したときに
   * きちんと地域選択画面を出す。
   */
  const [areaSelectionMade, setAreaSelectionMade] = useState(() => loadAreaSelection() != null);
  /** 都道府県チップのトグル（既に選択中なら解除、未選択なら追加）。'all'で全国（絞り込み解除）。 */
  const toggleClearPref = useCallback((p: Prefecture | 'all') => {
    if (p === 'all') {
      setSelectedPrefectures([]);
      return;
    }
    setSelectedPrefectures((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }, []);
  /**
   * 「地方」チップ: その地方に属する都道府県一式へ一括切替（既存の単一選択の使い勝手を維持）。
   * 既にその地方の県だけがちょうど選択されている場合はもう一度押すと全国へ戻す（従来どおりのトグル）。
   * 都道府県チップの個別トグルとは独立して動作する。
   */
  const toggleAreaFilter = useCallback((area: AreaName) => {
    const areaPrefs = prefecturesInArea(area);
    setSelectedPrefectures((prev) => {
      const isExactlyThisArea = prev.length === areaPrefs.length && areaPrefs.every((p) => prev.includes(p));
      return isExactlyThisArea ? [] : areaPrefs;
    });
  }, []);

  /**
   * 地域選択画面での確定操作。選んだ内容を次回起動用に保存して地図へ進む。
   * 保存先は専用キー（areaSelection）で、訪問済み・行きたい・スタンプ・保存ルート・
   * 設定の既存キーには一切触れない。
   */
  const commitAreaSelection = useCallback((prefs: SelectedPrefectures) => {
    setSelectedPrefectures(prefs);
    saveAreaSelection(prefs);
    markAreaChosenThisSession();
    setAreaSelectionMade(true);
    setShowRegionLanding(false);
  }, []);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [facilityFilter, setFacilityFilter] = useState<FacilityFilter>({ rvPark: false, onsen: false });
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
  // 選択済みの自由地点（キー: 合成ID `custom:…`）。アプリ未登録のホテル・飲食店等
  const [selectedCustomStops, setSelectedCustomStops] = useState<Record<string, CustomStopInfo>>({});

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
  /** 現在地取得失敗時の案内文（権限拒否/取得不可/タイムアウト/Secure Context制限を区別する） */
  const [poiGeoErrorMessage, setPoiGeoErrorMessage] = useState<string | null>(null);
  /** Overpass検索リクエストの状態 */
  const [poiRequestStatus, setPoiRequestStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  /** 表示中の結果が新鮮なキャッシュ/前回成功時の保存結果である間true */
  const [poiFromCache, setPoiFromCache] = useState(false);
  /** stale-while-revalidate: キャッシュを即表示しつつ裏で最新データを取得中の間true */
  const [poiRevalidating, setPoiRevalidating] = useState(false);
  const [poiRawResults, setPoiRawResults] = useState<Poi[]>([]);
  /** 直近の検索の接続先ごとの試行ログ（診断表示専用。本番の公開URLでは表示しない） */
  const [poiAttemptLog, setPoiAttemptLog] = useState<EndpointAttemptLog[]>([]);
  /** 直近の検索結果でfood(食べる)/other(観光・温泉等)系の取得が不完全だった場合true */
  const [poiFoodIncomplete, setPoiFoodIncomplete] = useState(false);
  const [poiOtherIncomplete, setPoiOtherIncomplete] = useState(false);
  const [poiDetail, setPoiDetail] = useState<Poi | null>(null);
  const poiAbortRef = useRef<AbortController | null>(null);
  // 旧コードとの互換用エイリアス（同じ意味の派生値。読みやすさのためだけに用意）
  const poiSearchActive = isPoiPanelOpen;
  const poiOrigin = searchOrigin;
  const setPoiOrigin = setSearchOrigin;
  const poiLoading = poiRequestStatus === 'loading';
  const poiFailed = poiRequestStatus === 'error';

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
    } else {
      // 「すべて」表示のみ従来通り近い順の上限件数に絞る。カテゴリ/細分類を選んだ場合は
      // 絞り込み後の全件を出す（poiRawResultsは既にoverpass.ts側で全カテゴリ横断の
      // 距離順上位N件へ絞られておらず、ここで絞ると「ラーメン」等の細分類がその上位N件に
      // 入らなかっただけで0件に見えてしまう不具合の原因だったため、絞り込み前には適用しない）
      list = list.slice(0, POI_RESULT_LIMIT);
    }
    return list;
  }, [poiRawResults, poiCategory, poiSubcategory]);
  // 細分類（例:ラーメン）が0件のとき「カテゴリ自体(食べる)が0件」と誤表示しないための、
  // カテゴリのみで絞った件数（実機で「ラーメン0件」なのに「食べるが見つかりません」と
  // 出て紛らわしいと判明したため区別する）
  const poiCategoryRawCount = useMemo(
    () => (poiCategory ? poiRawResults.filter((p) => p.category === poiCategory).length : 0),
    [poiRawResults, poiCategory],
  );
  // 動作診断用: 直近の成功したOverpass試行の生要素数（分類前）。キャッシュ表示時はnull
  // （coverage不足=そもそも生取得が少ない、と分類漏れ=生取得は多いのに分類後が少ない、を区別するため）
  const poiRawOverpassCount = useMemo(() => {
    // food/otherクエリを並行実行するため、成功した試行ぶんの件数を合算する
    // （診断表示専用の概算値。検索範囲の自動拡張が起きた場合は直近の拡張分も含みうる）
    const oks = poiAttemptLog.filter((a) => a.outcome === 'ok' && a.elementCount != null);
    if (oks.length === 0) return null;
    return oks.reduce((sum, a) => sum + (a.elementCount ?? 0), 0);
  }, [poiAttemptLog]);
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
      setPoiFoodIncomplete(false);
      setPoiOtherIncomplete(false);

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
      // 現在地起点の検索（o.stationIdが無い）はここを通らず、必ず下のOverpassPoiProviderで
      // その場のlat/lngを中心にライブ検索する（駅中心の静的データを現在地検索に流用しない）。
      if (!hadCache && o.stationId) {
        const staticResult = await new StaticOsmPoiProvider(o.stationId).search(o, radius, ctrl.signal);
        if (ctrl.signal.aborted) return;
        if (!staticResult.failed && staticResult.pois.length > 0) {
          hadCache = true;
          setPoiRawResults(staticResult.pois);
          setPoiRequestStatus('ok');
          setPoiFromCache(true);
          setPoiRevalidating(true);
        }
      }

      try {
        const res = await new OverpassPoiProvider().search(o, radius, ctrl.signal);
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
          setPoiFoodIncomplete(res.foodIncomplete);
          setPoiOtherIncomplete(res.otherIncomplete);
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
    setPoiGeoErrorMessage(null);
    if (!('geolocation' in navigator)) {
      setGeolocationStatus('denied');
      setPoiGeoErrorMessage('この端末では位置情報を使えません。道の駅を選んで検索してください。');
      return;
    }
    void getBestCurrentPosition().then(({ position, error }) => {
      if (position) {
        setGeolocationStatus('ok');
        setSearchOrigin({ lat: position.coords.latitude, lng: position.coords.longitude, label: '現在地' });
        return;
      }
      setGeolocationStatus('denied');
      // 現在地の取得失敗はOverpass通信の失敗とは別原因（権限拒否・タイムアウト等）。
      // 同じ「検索に失敗しました」表示にすると、実際には検索すら始まっていないのに
      // Googleマップへ誘導してしまい、アプリ内検索が機能しないという誤解を生む。
      // さらに権限拒否/取得不可/タイムアウトを区別し、原因に応じた案内文にする。
      setPoiGeoErrorMessage(
        `${describeGeolocationError(error ?? { code: 2 })} 道の駅を選んで検索してください。`,
      );
    });
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
    setPoiGeoErrorMessage(null);
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
      // id は駅ID／Poi.id／自由地点IDのいずれか1つの名前空間にしか存在しない
      if (id in selectedPois) {
        const nextPois = { ...selectedPois };
        delete nextPois[id];
        setSelectedPois(nextPois);
        persistDraft({ selectedIds: ids, selectedPois: nextPois });
      } else if (id in selectedCustomStops) {
        const nextCustom = { ...selectedCustomStops };
        delete nextCustom[id];
        setSelectedCustomStops(nextCustom);
        persistDraft({ selectedIds: ids, selectedCustomStops: nextCustom });
      } else {
        persistDraft({ selectedIds: ids });
      }
    },
    [routeSelectedIds, selectedPois, selectedCustomStops, persistDraft],
  );
  const clearAllSelection = useCallback(() => {
    setRouteSelectedIds([]);
    setSelectedPois({});
    setSelectedCustomStops({});
    persistDraft({ selectedIds: [], selectedPois: {}, selectedCustomStops: {} });
  }, [persistDraft]);
  /** 自由地点（アプリ未登録のホテル・飲食店等）を経由地として追加する */
  const addCustomStop = useCallback(
    (info: CustomStopInfo) => {
      const id = makeCustomStopId();
      const { ids, result } = toggleSelection(routeSelectedIds, id, MAX_MANUAL_STATIONS);
      if (result === 'max-reached') {
        setSelectMsg(`一度に選べるのは最大${MAX_MANUAL_STATIONS}件です`);
        setTimeout(() => setSelectMsg(null), 3000);
        return;
      }
      setRouteSelectedIds(ids);
      setSelectedCustomStops((prev) => {
        const next = { ...prev, [id]: info };
        persistDraft({ selectedIds: ids, selectedCustomStops: next });
        return next;
      });
    },
    [routeSelectedIds, persistDraft],
  );
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

  /**
   * 自動コース作成の結果（道の駅のみ）を「地図から選ぶ」の選択状態へ引き継ぎ、
   * 手動ルート作成の画面（ManualRouteBuilder）へ移る。自動ルート探索の
   * アルゴリズム自体は複雑化させず、生成後にPOI・自由地点・最終目的地を
   * 追加できるようにするための橋渡し（選んだ順番=自動コースの並びをそのまま
   * 引き継ぎ、道の駅の並び自体は変えない）。
   */
  const extendAutoRouteWithStops = useCallback(
    (route: PlannedRoute) => {
      const ids = route.stops.map((s) => s.stationId);
      setRouteSelectedIds(ids);
      setSelectedPois({});
      setSelectedCustomStops({});
      setOrigin(route.params.origin);
      setCourseMode('manual');
      setLastCourseMode('manual');
      try {
        localStorage.setItem(COURSE_MODE_KEY, 'manual');
      } catch {
        /* noop */
      }
      const draft: RouteDraft = {
        ...DEFAULT_ROUTE_DRAFT,
        selectedIds: ids,
        origin: route.params.origin,
        returnToStart: route.params.returnToStart,
        orderMode: 'selected',
        budgetMin: null,
        stayMin: route.params.stayMin,
        roadPref: route.params.roadPref,
        inProgress: true,
      };
      setManualDraftSnapshot(draft);
      saveRouteDraft(draft);
      setResults(null);
      setRouteStage('form');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const resumeDraft = useCallback(() => {
    if (!pendingDraft) return;
    setRouteSelectedIds(pendingDraft.selectedIds);
    setSelectedPois(pendingDraft.selectedPois);
    setSelectedCustomStops(pendingDraft.selectedCustomStops);
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
  /** 都道府県名 → 集計 の索引（地方ごとにグループ化して県ボタンを描画するため） */
  const prefStatByName = useMemo(() => new Map(stats.byPref.map((p) => [p.pref, p])), [stats.byPref]);
  const selected = selectedId ? getStation(selectedId) : undefined;
  /** 絞り込み結果の駅一覧（地図のピン探しではなく、一覧タップで数秒で選べるようにするため） */
  const filteredStationList = useMemo(
    () => filterStations(STATIONS, visits, selectedPrefectures, statusFilter, stationQuery, facilityFilter),
    [selectedPrefectures, statusFilter, stationQuery, visits, facilityFilter],
  );
  /** 設備条件のみ（県・状態は無視）で絞った件数。0件時の案内文と「該当N駅」表示に使う */
  const facilityOnlyCount = useMemo(
    () => (isFacilityFilterActive(facilityFilter) ? STATIONS.filter((s) => matchesFacilityFilter(s, facilityFilter)).length : null),
    [facilityFilter],
  );
  // 県別・状態フィルターは「地図マーカーを絞り込む」専用（従来のシンプルな挙動）。
  // 一覧の自動展開は駅名・市町村検索が入力されているときだけ（県/状態を押しただけで
  // 一覧が全面展開され地図を隠してしまう問題の修正）。
  const stationListActive = stationQuery.trim() !== '';
  /**
   * 一度地域を選んだあとは、絞り込みパネルでの都道府県変更も次回起動用に保存する
   * （地域選択画面の選択と絞り込み状態を一致させ、次回は前回の地図状態から再開する）。
   */
  useEffect(() => {
    if (!areaSelectionMade) return;
    saveAreaSelection(selectedPrefectures);
  }, [areaSelectionMade, selectedPrefectures]);
  /**
   * 共有リンク・旅行中の復帰で地域選択を出さなかった場合は、このセッションでは
   * 以後も出さない（同一セッション中の再読み込みで急に入口画面へ戻さないため）。
   * 初回マウント時の判定だけを見る（以後の開閉には反応しない）。
   */
  const landingSkippedRef = useRef(!showRegionLanding);
  useEffect(() => {
    if (landingSkippedRef.current) markAreaChosenThisSession();
  }, []);
  const activeSaved = trip ? (savedRoutes.find((r) => r.id === trip.savedRouteId) ?? null) : null;
  /**
   * 「地域を変更」ボタンに出す現在の表示範囲の短い要約。
   * 選択がちょうど1つの地方と一致すれば地方名（例:「東北」）、それ以外は県名を短くまとめる。
   */
  const regionSummary = useMemo(() => {
    if (selectedPrefectures.length === 0) return '全国';
    const exactArea = AREAS.find((a) => {
      const ps = prefecturesInArea(a);
      return ps.length === selectedPrefectures.length && ps.every((p) => selectedPrefectures.includes(p));
    });
    if (exactArea) return exactArea;
    if (selectedPrefectures.length <= 2) return selectedPrefectures.join('・');
    return `${selectedPrefectures[0]}ほか${selectedPrefectures.length - 1}件`;
  }, [selectedPrefectures]);

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
      noteSaveResult(saveVisits(next));
      return next;
    });
  }, [noteSaveResult]);

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

  /**
   * 周辺スポットの外部探索導線を3つの役割に分離する（Fable 5.1 Root Cause Audit
   * 再監査結果の最終形）。
   * (1) アプリ内POI＝道の駅周辺の候補をすぐ見る（この関数群とは無関係、既存のまま）
   * (2) Google Web検索＝カテゴリごとに、より詳しく・網羅的に探す（webSearchUrlFor）
   * (3) Google Maps＝道の駅そのものの場所・口コミ・写真・営業時間・ナビを見る
   *     （googleMapsUrlFor）。Google Mapsには「駅周辺のカテゴリ検索」をさせない
   *     （Maps URLs公式仕様だけでは地点固定+カテゴリ検索を保証できないため）。
   * 駅origin: stationSearchUrl（名称+住所）。それ以外のorigin（現在地・ルート上の
   * 地点等）: latLngUrl（座標そのもの）。
   */
  const googleMapsUrlFor = useCallback((origin: PoiOrigin): string => {
    const station = origin.stationId ? getStation(origin.stationId) : undefined;
    return station ? stationSearchUrl(station) : latLngUrl(origin);
  }, []);

  /**
   * 駅originの場合のみGoogle Web検索CTAを生成する。非駅origin（現在地・地図上の
   * 自由地点等）は確実な地名（駅名）を持たないため、カテゴリWeb検索を無理に
   * 生成せずnullを返し、CTA自体を非表示にする（Google Maps導線のみ使う）。
   */
  const webSearchUrlFor = useCallback((origin: PoiOrigin | null, category: PoiCategory | null): string | null => {
    const station = origin?.stationId ? getStation(origin.stationId) : undefined;
    if (!station) return null;
    return googleWebSearchUrl(stationNearbySearchQuery(station, category));
  }, []);

  const persistRoutes = (rs: SavedRoute[]) => {
    setSavedRoutes(rs);
    noteSaveResult(saveRoutes(rs));
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
      noteSaveResult(saveTrip(t));
      setTab('route');
    },
    [saveRoute, noteSaveResult],
  );

  const setProgress = useCallback((stationId: string, p: StopProgress) => {
    setTrip((prev) => {
      if (!prev) return prev;
      const next = { ...prev, progress: { ...prev.progress, [stationId]: p } };
      noteSaveResult(saveTrip(next));
      return next;
    });
  }, [noteSaveResult]);

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
        noteSaveResult(saveVisits(next));
        return next;
      });
      if (trip) {
        const rs = loadRoutes().map((r) => (r.id === trip.savedRouteId ? { ...r, done: true } : r));
        persistRoutes(rs);
      }
      setTrip(null);
      noteSaveResult(saveTrip(null));
      setRouteLine(null);
      setRouteStops(null);
      setRouteLineApprox(false);
      setRouteStage('form');
      setResults(null);
      setViewingSavedId(null);
      setCourseMode('choose');
    },
    [trip, noteSaveResult],
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
    setSelectedCustomStops({});
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
    noteSaveResult(applied.saved);
  }, [noteSaveResult]);

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
      noteSaveResult(saveVisits(next));
      return next;
    });
    setToast(null);
  }, [toast, noteSaveResult]);

  const closeSheet = useCallback(() => {
    setSelectedId(null);
    if (location.hash.startsWith('#station=')) history.replaceState(null, '', location.pathname);
  }, []);

  return (
    <div className={`app${mapFullscreen ? ' map-fs' : ''}${showRegionLanding ? ' region-landing-open' : ''}`}>
      {!online && !mapFullscreen && (
        <div className="offline-banner" data-testid="offline-banner">
          オフラインです。訪問記録・保存ルートは閲覧/更新できます。地図タイル・外部リンクは利用できません。
        </div>
      )}
      {storageWriteFailed && !mapFullscreen && (
        <div className="offline-banner" data-testid="storage-write-failed-banner">
          端末への保存に失敗しました（空き容量不足、またはプライベートブラウジング等の制限の可能性があります）。
          直前の変更が保存されていない場合があります。空き容量を確認するか、通常のブラウジングモードでお試しください。
          <button
            onClick={() => setStorageWriteFailed(false)}
            style={{ marginLeft: 8 }}
            data-testid="storage-write-failed-dismiss"
          >
            閉じる
          </button>
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
      {showRegionLanding && (
        <RegionLanding
          areas={stats.byArea}
          statByPref={prefStatByName}
          totalStations={stats.total}
          selectedPrefectures={selectedPrefectures}
          onCommit={commitAreaSelection}
          onCancel={areaSelectionMade ? () => setShowRegionLanding(false) : null}
        />
      )}
      {!mapFullscreen && (
        <StatsHeader stats={stats} selectedPrefectures={selectedPrefectures} onToggleClearPref={toggleClearPref} />
      )}
      {/*
        「地域を変更」と「絞り込み」は同じ1行に並べる。地図の上に行を増やすと地図の
        高さが減り、実機・E2Eの双方で地図マーカーが周辺スポットパネルの下に隠れて
        タップできなくなるため（行は増やさない）。
        高さはiOSの最小タップ領域(44px)に合わせる。Owner実機で「🗾 福島県 を押しても
        反応しない」と報告された原因が、34pxしかない細い帯で、指が上の全幅ボタン
        (.stats-main)側に逸れていたことにあるため（E2Eは要素中心を正確に叩くので再現しない）。
      */}
      {!mapFullscreen && (
        <div className="top-actions">
          <button
            type="button"
            className="change-region-btn"
            onClick={() => setShowRegionLanding(true)}
            aria-label={`地域・県を変更する（現在: ${regionSummary}）`}
            data-testid="btn-change-region"
          >
            <span className="crb-label">🗾 地域・県を変更</span>
            <span className="crb-current" data-testid="btn-change-region-current">
              {regionSummary}
            </span>
          </button>
          <button
            className="filters-toggle"
            onClick={() => setFiltersOpen(!filtersOpen)}
            aria-expanded={filtersOpen}
            data-testid="filters-toggle"
          >
            {filtersOpen
              ? '▲ 絞り込みをたたむ'
              : `▼ ${filterSummary(selectedPrefectures, statusFilter, stationQuery, facilityFilter)}`}
          </button>
        </div>
      )}
      <div
        className="filter-groups"
        style={filtersOpen && !mapFullscreen ? undefined : { display: 'none' }}
      >
        <div className="filter-row" role="toolbar" aria-label="地方で絞り込み">
          <span className="fg-label">地方</span>
          <button
            className={`chip${selectedPrefectures.length === 0 ? ' active' : ''}`}
            onClick={() => toggleClearPref('all')}
            data-testid="chip-all"
          >
            すべて
          </button>
          {stats.byArea.map((a) => {
            const areaPrefs = prefecturesInArea(a.area);
            const areaActive =
              selectedPrefectures.length === areaPrefs.length && areaPrefs.every((p) => selectedPrefectures.includes(p));
            return (
              <button
                key={a.area}
                className={`chip${areaActive ? ' active' : ''}`}
                onClick={() => toggleAreaFilter(a.area)}
                data-testid={`chip-area-${a.area}`}
              >
                {a.area} {a.visited}/{a.total}
              </button>
            );
          })}
        </div>
        <div className="filter-row" role="toolbar" aria-label="都道府県で絞り込み（複数選択可）">
          <span className="fg-label">都道府県</span>
          <button
            className={`chip${selectedPrefectures.length === 0 ? ' active' : ''}`}
            onClick={() => toggleClearPref('all')}
            data-testid="chip-pref-all"
          >
            全国
          </button>
        </div>
        {/*
          都道府県は47件あり、.filter-row(横スクロール1行)へ並べると実機で
          「地方チップしか実質使えない」状態になる（スマホ幅では数件しか見えず、
          任意の県を自由に複数タップするのが事実上不可能だった）。
          地方ごとに見出し+折り返しグリッドで表示し、47県すべてを個別にタップできるようにする。
          data-testid（chip-<県名>）は変更しない（複数選択のロジック・既存テストへの影響を避ける）。
        */}
        <PrefectureChipGroups
          areas={stats.byArea}
          statByPref={prefStatByName}
          selectedPrefectures={selectedPrefectures}
          onToggle={toggleClearPref}
          testIdPrefix="chip-"
          containerTestId="pref-select-groups"
        />
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
        <div className="filter-row" role="toolbar" aria-label="設備で絞り込み">
          <span className="fg-label">設備</span>
          <button
            className={`chip${facilityFilter.rvPark ? ' active' : ''}`}
            onClick={() => setFacilityFilter((f) => ({ ...f, rvPark: !f.rvPark }))}
            data-testid="facility-filter-rvpark"
          >
            🚐 RVパーク
          </button>
          <button
            className={`chip${facilityFilter.onsen ? ' active' : ''}`}
            onClick={() => setFacilityFilter((f) => ({ ...f, onsen: !f.onsen }))}
            data-testid="facility-filter-onsen"
          >
            ♨️ 温泉
          </button>
          {isFacilityFilterActive(facilityFilter) && (
            <span className="fg-count" data-testid="facility-filter-count">
              該当{facilityOnlyCount}駅
            </span>
          )}
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
        {/*
          地図は常にマウントしたまま表示切替（状態保持のため）。地域選択中は地図を
          隠す（全国1,237件のマーカーを裏で描画し続けない）。ここは inline style で
          指定しているため、祖先(.app-main)のvisibilityだけでは隠れない点に注意。
        */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            visibility: tab === 'map' && !showRegionLanding ? 'visible' : 'hidden',
          }}
        >
          <MapView
            stations={STATIONS}
            visits={visits}
            selectedPrefectures={selectedPrefectures}
            statusFilter={statusFilter}
            facilityFilter={facilityFilter}
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
              onRequestRestart={() => setPendingCourseAction('restart')}
            />
          )}
          {tab === 'map' && routeSelectMode && showSelectionSheet && (
            <RouteSelectionSheet
              stations={STATIONS}
              selectedIds={routeSelectedIds}
              getStation={getStation}
              selectedPois={selectedPois}
              selectedCustomStops={selectedCustomStops}
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
              onAddCustomStop={addCustomStop}
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
              geoErrorMessage={poiGeoErrorMessage}
              searched={poiRequestStatus !== 'idle'}
              resultCount={poiSearchResults.length}
              totalRawCount={poiRawResults.length}
              categoryRawCount={poiCategoryRawCount}
              autoExpanded={poiAutoExpanded}
              fromCache={poiFromCache}
              attemptLog={poiAttemptLog}
              foodIncomplete={poiFoodIncomplete}
              otherIncomplete={poiOtherIncomplete}
              revalidating={poiRevalidating}
              onRetry={runPoiSearchNow}
              mapsUrl={searchOrigin ? googleMapsUrlFor(searchOrigin) : ''}
              webSearchUrl={webSearchUrlFor(searchOrigin, poiCategory)}
              originStation={searchOrigin?.stationId ? (getStation(searchOrigin.stationId) ?? null) : null}
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
                    noteSaveResult(saveTrip(next));
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
                onExtendWithStops={extendAutoRouteWithStops}
              />
            ) : courseMode === 'choose' ? (
              <CourseModePicker lastUsed={lastCourseMode} onChoose={chooseCourseMode} onBack={() => setTab('map')} />
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
                  contextPrefectures={selectedPrefectures}
                  getStation={getStation}
                  selectedIds={routeSelectedIds}
                  selectedPois={selectedPois}
                  selectedCustomStops={selectedCustomStops}
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
                  onRequestRestart={() => setPendingCourseAction('restart')}
                  initialSettings={{
                    returnToStart: manualDraftSnapshot.returnToStart,
                    orderMode: manualDraftSnapshot.orderMode,
                    budgetMin: manualDraftSnapshot.budgetMin,
                    stayMin: manualDraftSnapshot.stayMin,
                    roadPref: manualDraftSnapshot.roadPref,
                    finalDestination: manualDraftSnapshot.finalDestination,
                  }}
                  onSettingsChange={persistDraft}
                />
              )
            ) : (
              <PlannerForm
                stations={STATIONS}
                contextPrefectures={selectedPrefectures}
                origin={origin}
                onOriginChange={setOrigin}
                onRequestMapPick={() => {
                  setPickMode(true);
                  setTab('map');
                }}
                onSubmit={submitPlan}
                planning={planning}
                onBack={() => setCourseMode('choose')}
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
            <DiagnosticsPanel
              poi={{
                originLabel: searchOrigin?.label ?? null,
                stationId: searchOrigin?.stationId ?? null,
                totalCount: poiRawResults.length,
                category: poiCategory ? CATEGORY_LABEL[poiCategory] : null,
                categoryCount: poiCategory ? poiCategoryRawCount : poiRawResults.length,
                subcategory: poiSubcategory,
                filteredCount: poiSearchResults.length,
                fromStaticCache: poiFromCache,
                radiusM: searchOrigin ? poiRadius : null,
                rawOverpassCount: poiFromCache ? null : poiRawOverpassCount,
              }}
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
