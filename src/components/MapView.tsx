import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import type { Station, StatusFilter, VisitMap } from '../types';
import { stationsBounds } from '../data';
import type { LatLng } from '../lib/geo';
import { getStatus } from '../lib/hours';
import { escapeHtml, markerHtml, type MarkerState } from '../lib/markerVisual';
import { zoomClasses, type MapSettings } from '../lib/mapSettings';
import { STOP_TYPE_COLOR, STOP_TYPE_GLYPH, poiDisplayName, stopTypeOf, type Poi } from '../lib/poi';
import {
  matchesFilter,
  matchesFacilityFilter,
  matchesSelectedPrefectures,
  NO_FACILITY_FILTER,
  type FacilityFilter,
  type SelectedPrefectures,
} from '../lib/ui';
import { describeGeolocationError, getBestCurrentPosition } from '../lib/geolocation';

interface Props {
  stations: Station[];
  visits: VisitMap;
  selectedPrefectures: SelectedPrefectures;
  statusFilter: StatusFilter;
  /** 道の駅自体の設備条件（RVパーク・温泉）でマーカーを絞る。省略時は絞り込みなし */
  facilityFilter?: FacilityFilter;
  /**
   * マーカーのタップ/クリック。詳細シートを開くだけで、訪問状態は一切変更しない
   * （状態変更はシート内の明示的なボタンからのみ行う。誤タップでの色変化を防ぐ）。
   */
  onOpenStation: (id: string) => void;
  /** マーカー以外の地図タップ（詳細カードを閉じる用） */
  onMapTap: () => void;
  /** 出発地点の地図指定モード */
  pickMode: boolean;
  onPick: (p: LatLng) => void;
  /** ルート表示（旅行中・結果プレビュー） */
  routeLine: LatLng[] | null;
  /** 訪問順の番号マーカー */
  routeStops: { lat: number; lng: number; order: number }[] | null;
  focusStationId: string | null;
  /** 詳細カード表示中か（フォーカス時に上へずらす量の判断用） */
  sheetOpen: boolean;
  /** 営業状態判定の基準時刻（1分ごとに更新される。テストではclockで固定可能） */
  now: Date;
  /** 地図全画面モード（切替時にサイズ再計算し、中心・ズームを維持する） */
  fullscreen: boolean;
  /** 選択中の駅（最前面表示+駅名ラベルを常時表示） */
  selectedId: string | null;
  /** 地図表示設定（マーカー表示/駅名表示） */
  settings: MapSettings;
  onChangeSettings: (s: MapSettings) => void;
  /**
   * 「地図から選ぶ」ルート選択モード。trueの間はマーカータップが訪問状態を
   * 一切変更せず、onToggleRouteSelectでルート候補への追加/解除だけを行う。
   */
  routeSelectMode: boolean;
  /** ルートに選択済みの駅ID・周辺スポットID（選んだ順。番号バッジは配列内の位置から決まる） */
  routeSelectedIds: string[];
  onToggleRouteSelect: (id: string) => void;
  /** 表示中の周辺スポット検索結果（検索していない間は空配列） */
  poiResults: Poi[];
  /** 通常モードでの周辺スポットタップ（詳細シートを開く） */
  onTapPoi: (poi: Poi) => void;
  /** ルート選択モードでの周辺スポットタップ（選択の追加/解除） */
  onTogglePoiSelect: (poi: Poi) => void;
}

export { STATE_COLOR, BADGE_SYMBOL, markerHtml } from '../lib/markerVisual';
export type { MarkerState } from '../lib/markerVisual';

/** 排他状態 → マーカー表示状態（CSSクラス名）への対応 */
export function visitState(st: Station, visits: VisitMap): MarkerState {
  if (st.status !== 'open') return 'pre';
  switch (visits[st.id]?.state) {
    case 'stamped':
      return 'stamp';
    case 'visited':
      return 'visited';
    case 'wishlist':
      return 'want';
    default:
      return 'none';
  }
}

/**
 * 周辺スポット（POI）用マーカー。道の駅とは形（丸型+絵文字）・色系統を
 * 明確に分け、混同しないようにする。訪問状態の色循環対象ではないため
 * data-sid属性は付けない（data-poi-idを使う）。
 */
export function poiMarkerHtml(poi: Poi, selectedNumber?: number): string {
  const stopType = stopTypeOf(poi.subcategory);
  const glyph = STOP_TYPE_GLYPH[stopType];
  const color = STOP_TYPE_COLOR[stopType];
  const picked = selectedNumber != null;
  const numBadge = picked
    ? `<span class="rs-route-num" data-testid="route-select-num" aria-hidden="true">${selectedNumber}</span>`
    : '';
  const name = poiDisplayName(poi);
  const label = `<span class="poi-label" aria-hidden="true">${escapeHtml(name)}</span>`;
  return (
    `<div class="poi-hit${picked ? ' picked' : ''}">` +
    `<div class="poi-marker" data-poi-id="${poi.id}" style="background:${color}">${glyph}${numBadge}</div>` +
    `${label}</div>`
  );
}

const LEGEND_SEEN_KEY = 'tohoku-me:legend-seen:v1';

// 地図上とまったく同じマークHTMLを凡例でも使用（見た目の不一致を避ける）
function LegendSample({ state }: { state: MarkerState }) {
  return (
    <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: markerHtml(state, `legend-${state}`) }} />
  );
}

function Legend({
  settings,
  onChangeSettings,
}: {
  settings: MapSettings;
  onChangeSettings: (s: MapSettings) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // 凡例操作を地図クリック（シートを閉じる/出発地点指定）に伝播させない
    if (wrapRef.current) {
      L.DomEvent.disableClickPropagation(wrapRef.current);
      L.DomEvent.disableScrollPropagation(wrapRef.current);
    }
  }, []);
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(LEGEND_SEEN_KEY) == null; // 初回のみ自動展開
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(LEGEND_SEEN_KEY, '1');
    } catch {
      /* noop */
    }
  }, []);
  const isTouch =
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

  return (
    <div className="legend-wrap" ref={wrapRef}>
      <button className="legend-toggle" onClick={() => setOpen(!open)} data-testid="legend-toggle">
        {open ? '✕ 閉じる' : '❓ 使い方・凡例'}
      </button>
      {open && (
        <div className="legend-panel" data-testid="legend-panel">
          <h4>訪問状態（マーク全体の色）</h4>
          <div className="legend-item">
            <LegendSample state="none" />
            <span>道の駅（未訪問）</span>
          </div>
          <div className="legend-item">
            <LegendSample state="visited" />
            <span>✓ 訪問済み</span>
          </div>
          <div className="legend-item">
            <LegendSample state="want" />
            <span>★ 行きたい</span>
          </div>
          <div className="legend-item">
            <LegendSample state="stamp" />
            <span>済 スタンプ取得済み（訪問済みと同じ色＋赤い「済」）</span>
          </div>
          <div className="legend-item">
            <LegendSample state="pre" />
            <span>準 開業前</span>
          </div>
          <h4 style={{ marginTop: 8 }}>営業状態（左下の小さな丸）</h4>
          <div className="legend-item">
            <span className="hrs-dot hrs-open legend-dot" />
            <span>営業中</span>
          </div>
          <div className="legend-item">
            <span className="hrs-dot hrs-closing legend-dot">!</span>
            <span>まもなく終了</span>
          </div>
          <div className="legend-item">
            <span className="hrs-dot hrs-closed legend-dot">×</span>
            <span>営業時間外</span>
          </div>
          <div className="legend-item">
            <span className="hrs-dot hrs-unknown legend-dot">?</span>
            <span>要確認</span>
          </div>
          {settings.markerMode === 'cluster' && (
            <div className="legend-item">
              <span className="cluster-pill">3駅</span>
              <span>近くにある道の駅の件数</span>
            </div>
          )}
          <h4 style={{ marginTop: 8 }}>マーカー表示</h4>
          <div className="legend-seg">
            <button
              className={settings.markerMode === 'all' ? 'active' : ''}
              onClick={() => onChangeSettings({ ...settings, markerMode: 'all' })}
              data-testid="setting-marker-all"
            >
              全駅表示（推奨）
            </button>
            <button
              className={settings.markerMode === 'cluster' ? 'active' : ''}
              onClick={() => onChangeSettings({ ...settings, markerMode: 'cluster' })}
              data-testid="setting-marker-cluster"
            >
              まとめて表示
            </button>
          </div>
          <h4 style={{ marginTop: 8 }}>駅名表示</h4>
          <div className="legend-seg">
            <button
              className={settings.labelMode === 'auto' ? 'active' : ''}
              onClick={() => onChangeSettings({ ...settings, labelMode: 'auto' })}
              data-testid="setting-label-auto"
            >
              自動
            </button>
            <button
              className={settings.labelMode === 'always' ? 'active' : ''}
              onClick={() => onChangeSettings({ ...settings, labelMode: 'always' })}
              data-testid="setting-label-always"
            >
              常に表示
            </button>
            <button
              className={settings.labelMode === 'off' ? 'active' : ''}
              onClick={() => onChangeSettings({ ...settings, labelMode: 'off' })}
              data-testid="setting-label-off"
            >
              非表示
            </button>
          </div>
          <div className="legend-hint" style={{ marginTop: 6 }}>
            駅名は拡大すると表示されます。
          </div>
          <div className="legend-hint">
            道の駅マークを押すと詳細が開きます（訪問状態は変わりません）。
            <br />
            訪問済み・行きたい・スタンプ取得済みへの変更は、詳細内のボタンから行えます。
            <br />
            ※営業状態は通常営業時間に基づく目安です。臨時休業・季節変更は公式情報をご確認ください。
            {!isTouch && (
              <>
                <br />
                カーソルを合わせると駅名を表示します。
              </>
            )}
          </div>
          <details className="legend-details">
            <summary>「地図から選ぶ」の使い方</summary>
            <div className="legend-hint">
              コース作成で「地図から選ぶ」を選ぶと、地図上で道の駅を選べるようになります。
              <br />
              ルート選択中は、道の駅マークを押すとコースへ追加されます。
              <br />
              もう一度押すと選択を解除します。
              <br />
              選択中は訪問記録の色は変わりません。
              <br />
              選んだ順番のまま、または回りやすい順に自動調整できます。
            </div>
          </details>
          <details className="legend-details">
            <summary>データの出典・通信について</summary>
            <div className="legend-hint">
              地図・道の駅周辺の情報は OpenStreetMap の登録データを使用しています（
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
                出典・ライセンス ↗
              </a>
              ）。
              <br />
              「周辺スポットを探す」は OpenStreetMap の公開Overpass API、ルート検索は OSRM
              （Project OSRM）の公開デモサーバーへ、検索・計算に必要な座標をそのつど送信します。
              <br />
              「名称・住所から探す」で検索ボタンを押したときは、入力した施設名・住所が
              OpenStreetMap の Nominatim と国土地理院の住所検索APIへ送信されます（入力中は送信しません）。
              「Googleで探す」「Googleマップで開く」を押した場合は、Googleの各サービスへ移動します。
              いずれもアカウント登録は不要で、このアプリは利用履歴を保存しません。
              <br />
              現在地は、位置情報の利用を許可した場合に上記の検索・ルート計算のためだけに使い、
              それ以外の目的では送信しません。訪問記録・保存ルート・作成中のコースは
              お使いの端末内（localStorage）にのみ保存され、外部サーバーへは送信されません。
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

export default function MapView({
  stations,
  visits,
  selectedPrefectures,
  statusFilter,
  facilityFilter = NO_FACILITY_FILTER,
  onOpenStation,
  onMapTap,
  pickMode,
  onPick,
  routeLine,
  routeStops,
  focusStationId,
  sheetOpen,
  now,
  fullscreen,
  selectedId,
  settings,
  onChangeSettings,
  routeSelectMode,
  routeSelectedIds,
  onToggleRouteSelect,
  poiResults,
  onTapPoi,
  onTogglePoiSelect,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const allLayerRef = useRef<L.LayerGroup | null>(null);
  const poiLayerRef = useRef<L.LayerGroup | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);
  const orderLayerRef = useRef<L.LayerGroup | null>(null);
  const pickRef = useRef(pickMode);
  const onPickRef = useRef(onPick);
  const onOpenRef = useRef(onOpenStation);
  const onMapTapRef = useRef(onMapTap);
  const routeSelectModeRef = useRef(routeSelectMode);
  const onToggleRouteSelectRef = useRef(onToggleRouteSelect);
  const onTapPoiRef = useRef(onTapPoi);
  const onTogglePoiSelectRef = useRef(onTogglePoiSelect);
  pickRef.current = pickMode;
  onPickRef.current = onPick;
  onOpenRef.current = onOpenStation;
  onMapTapRef.current = onMapTap;
  routeSelectModeRef.current = routeSelectMode;
  onToggleRouteSelectRef.current = onToggleRouteSelect;
  onTapPoiRef.current = onTapPoi;
  onTogglePoiSelectRef.current = onTogglePoiSelect;

  // 1回の物理タップから touchend と click が二重発火しても「1タップ=1回」を守るための
  // デデュープ（80ms未満の同一ID再入は同じ物理タップとみなす）。
  // 履歴はマーカー再構築やReact再描画の影響を受けないコンポーネントレベルのrefで保持する。
  const lastTapRef = useRef<{ id: string; at: number } | null>(null);
  const handleMarkerTap = (id: string) => {
    const now = Date.now();
    const lastTap = lastTapRef.current;
    lastTapRef.current = { id, at: now };
    if (lastTap && lastTap.id === id && now - lastTap.at < 80) return;
    // ルート選択モード中は詳細シートを開かず、選択の追加/解除だけを行う
    if (routeSelectModeRef.current) {
      onToggleRouteSelectRef.current(id);
      return;
    }
    // 詳細シートを開くだけ。訪問状態はここでは一切変更しない
    onOpenRef.current(id);
  };

  // 周辺スポットのタップ（道の駅と同じデデュープを適用。訪問状態には一切触れない）
  const lastPoiTapRef = useRef<{ id: string; at: number } | null>(null);
  const handlePoiTap = (poi: Poi) => {
    const now = Date.now();
    const lastTap = lastPoiTapRef.current;
    lastPoiTapRef.current = { id: poi.id, at: now };
    if (lastTap && lastTap.id === poi.id && now - lastTap.at < 80) return;
    if (routeSelectModeRef.current) {
      onTogglePoiSelectRef.current(poi);
      return;
    }
    onTapPoiRef.current(poi);
  };

  // 初期化
  useEffect(() => {
    if (!rootRef.current || mapRef.current) return;
    const map = L.map(rootRef.current, { zoomControl: false, attributionControl: true });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    map.fitBounds(stationsBounds(stations), { padding: [4, 4] });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    const cluster = L.markerClusterGroup({
      maxClusterRadius: 52,
      disableClusteringAtZoom: 11,
      // クラスタタップ→範囲へズーム。分離できない密集はスパイダー表示で個別選択可能
      zoomToBoundsOnClick: true,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      iconCreateFunction: (c) => {
        const n = c.getChildCount();
        const w = n >= 100 ? 62 : n >= 10 ? 54 : 44;
        return L.divIcon({
          html: `<div class="cluster-pill">${n}駅</div>`,
          className: '',
          iconSize: [w, 30],
        });
      },
    });
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (pickRef.current) onPickRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
      else onMapTapRef.current();
    });
    mapRef.current = map;
    clusterRef.current = cluster;
    // 全駅個別表示用のレイヤー（クラスタと排他で地図へ載せる）
    allLayerRef.current = L.layerGroup();
    // 周辺スポット用のレイヤー（道の駅の表示モードとは独立して常に地図へ載せる）
    poiLayerRef.current = L.layerGroup().addTo(map);
    // ズームに応じたサイズ/ラベルのCSSクラスをコンテナへ付与（再描画なしで切替）
    const applyZoomClasses = () => {
      const el = rootRef.current;
      if (!el) return;
      el.classList.remove('mz-wide', 'mz-medium', 'mz-detail', 'lz-hidden', 'lz-partial', 'lz-all');
      el.classList.add(...zoomClasses(map.getZoom()));
    };
    applyZoomClasses();
    map.on('zoomend', applyZoomClasses);
    // E2E検証用: 中心・ズームの取得/設定フック
    (window as unknown as { __getMapState?: () => unknown }).__getMapState = () => ({
      lat: map.getCenter().lat,
      lng: map.getCenter().lng,
      zoom: map.getZoom(),
    });
    (window as unknown as { __setMapView?: (lat: number, lng: number, z: number) => void }).__setMapView = (
      lat,
      lng,
      z,
    ) => map.setView([lat, lng], z, { animate: false });
    // E2E検証用: 中心をピクセル単位でずらす（横長で地図領域が縦に狭いビューポートでは、
    // 幾何中心にセンタリングしても下部固定バーと重なることがあるため、そのバーを避けて
    // 対象マーカーを安全な位置へ寄せるのに使う。実ユーザー向け機能ではない）
    (window as unknown as { __panMapBy?: (dx: number, dy: number) => void }).__panMapBy = (dx, dy) =>
      map.panBy([dx, dy], { animate: false });
    // 画面回転・visualViewport変化でもタイル欠け・ずれを起こさない
    const onResize = () => {
      const c = map.getCenter();
      const z = map.getZoom();
      requestAnimationFrame(() => {
        map.invalidateSize({ animate: false });
        map.setView(c, z, { animate: false });
      });
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      map.remove();
      mapRef.current = null;
      clusterRef.current = null;
      poiLayerRef.current = null;
    };
  }, []);

  // 全画面切替の直後にLeafletへサイズ変更を通知（中心・ズームは維持）。
  // マウント時は実行しない（初期フォーカス処理を上書きしないため）
  const fsMountRef = useRef(true);
  useEffect(() => {
    if (fsMountRef.current) {
      fsMountRef.current = false;
      return;
    }
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    const z = map.getZoom();
    // レイアウト確定後に2フレーム待ってから再計算（タイル欠け・灰色領域防止）
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        map.invalidateSize({ animate: false });
        map.setView(c, z, { animate: false });
      }),
    );
  }, [fullscreen]);

  // マーカー更新（全駅個別レイヤー or 従来クラスタの排他運用）
  useEffect(() => {
    const map = mapRef.current;
    const cluster = clusterRef.current;
    const allLayer = allLayerRef.current;
    if (!map || !cluster || !allLayer) return;
    // 切替時の二重表示・残骸防止: 両方を一旦クリアし、対象だけを地図へ載せる
    cluster.clearLayers();
    allLayer.clearLayers();
    // ルート選択モード中は駅を選びやすいよう、まとめ表示中でも一時的に全駅個別表示へ切り替える。
    // 永続設定(settings.markerMode)自体は変更しないため、選択モード終了で自動的に元へ戻る。
    const useCluster = settings.markerMode === 'cluster' && !routeSelectMode;
    if (useCluster) {
      if (map.hasLayer(allLayer)) map.removeLayer(allLayer);
      if (!map.hasLayer(cluster)) map.addLayer(cluster);
    } else {
      if (map.hasLayer(cluster)) map.removeLayer(cluster);
      if (!map.hasLayer(allLayer)) map.addLayer(allLayer);
    }
    const target: L.LayerGroup = useCluster ? cluster : allLayer;
    const shown = stations.filter(
      (st) =>
        matchesSelectedPrefectures(st, selectedPrefectures) &&
        matchesFilter(st, visits, statusFilter) &&
        matchesFacilityFilter(st, facilityFilter),
    );
    for (const st of shown) {
      const state = visitState(st, visits);
      const hs = getStatus(st.id, now);
      const selected = st.id === selectedId;
      const routeIdx = routeSelectMode ? routeSelectedIds.indexOf(st.id) : -1;
      const routeSelectNumber = routeIdx >= 0 ? routeIdx + 1 : undefined;
      const marker = L.marker([st.lat, st.lng], {
        icon: L.divIcon({
          html: markerHtml(state, st.id, hs.kind, st.name, selected, routeSelectNumber),
          className: '',
          // 44×44の透明タップ領域（見た目の縮小はCSSで行う）
          iconSize: [44, 44],
          iconAnchor: [22, 22],
          tooltipAnchor: [0, -26],
        }),
        alt: `道の駅${st.name}`,
        keyboard: true,
        // 選択中の駅・ルート選択済みの駅を最前面へ
        zIndexOffset: selected ? 2000 : routeSelectNumber != null ? 1500 : 0,
      });
      // PC: ホバーで駅名+営業状態+今日の営業時間
      const hoursLine =
        hs.kind === 'upcoming' ? '開業前' : `${hs.label}${hs.today !== '—' ? `<br>本日: ${hs.today}` : ''}`;
      marker.bindTooltip(`<b>道の駅 ${st.name}</b><br>${hoursLine}`, {
        direction: 'top',
        className: 'rs-tooltip',
        opacity: 1,
      });
      marker.on('click', () => handleMarkerTap(st.id));
      // マーカー連打が地図のダブルクリックズームを発火させないよう伝播だけ止める
      // （dblclickに機能は割り当てない。各clickが既に詳細シートを開いている）
      marker.on('dblclick', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stop(e.originalEvent);
      });
      target.addLayer(marker);
    }
  }, [
    stations,
    visits,
    selectedPrefectures,
    statusFilter,
    facilityFilter,
    now,
    selectedId,
    settings.markerMode,
    routeSelectMode,
    routeSelectedIds,
  ]);

  // 周辺スポット（POI）マーカー。道の駅の表示モードとは独立して常時再構築する
  useEffect(() => {
    const map = mapRef.current;
    const layer = poiLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    for (const poi of poiResults) {
      const idx = routeSelectMode ? routeSelectedIds.indexOf(poi.id) : -1;
      const selectedNumber = idx >= 0 ? idx + 1 : undefined;
      const marker = L.marker([poi.lat, poi.lng], {
        icon: L.divIcon({
          html: poiMarkerHtml(poi, selectedNumber),
          className: '',
          iconSize: [44, 44],
          iconAnchor: [22, 22],
          tooltipAnchor: [0, -26],
        }),
        alt: poiDisplayName(poi),
        keyboard: true,
        zIndexOffset: selectedNumber != null ? 1800 : 500,
      });
      marker.bindTooltip(`<b>${escapeHtml(poiDisplayName(poi))}</b>`, {
        direction: 'top',
        className: 'rs-tooltip',
        opacity: 1,
      });
      marker.on('click', () => handlePoiTap(poi));
      marker.on('dblclick', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stop(e.originalEvent);
      });
      layer.addLayer(marker);
    }
  }, [poiResults, routeSelectMode, routeSelectedIds]);

  // 周辺スポットの検索結果が変わったら、地図の表示範囲をその結果に合わせる。
  // これをしないと、検索は成功していても現在の表示範囲の外にマーカーが出て
  // 「アプリ内に何も表示されない」ように見えてしまう（実際に確認された不具合）。
  // 検索結果パネルが画面下部を覆うため、駅フォーカス同様に下側の余白を多くとって
  // マーカーがパネルの下に隠れない（=タップできない）ようにする。
  useEffect(() => {
    const map = mapRef.current;
    if (!map || poiResults.length === 0) return;
    const bounds = L.latLngBounds(poiResults.map((p) => [p.lat, p.lng] as [number, number]));
    map.fitBounds(bounds, { paddingTopLeft: [50, 50], paddingBottomRight: [50, 260], maxZoom: 16 });
    // 選択状態の変化だけでは再フィットしない（マーカーをタップするたびに地図が動くと操作しづらいため）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poiResults]);

  // 駅名表示モードのCSSクラス（自動/常に表示/非表示）
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    el.classList.remove('lm-auto', 'lm-always', 'lm-off');
    el.classList.add(`lm-${settings.labelMode}`);
  }, [settings.labelMode]);

  // 地域・都道府県フィルターで表示範囲を調整
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (selectedPrefectures.length === 0) {
      map.fitBounds(stationsBounds(stations), { padding: [4, 4] });
      return;
    }
    const pts = stations
      .filter((s) => matchesSelectedPrefectures(s, selectedPrefectures))
      .map((s) => [s.lat, s.lng] as [number, number]);
    if (pts.length > 0) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });
  }, [selectedPrefectures, stations]);

  // ルート線
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (lineRef.current) {
      lineRef.current.remove();
      lineRef.current = null;
    }
    if (routeLine && routeLine.length >= 2) {
      lineRef.current = L.polyline(
        routeLine.map((p) => [p.lat, p.lng]),
        { color: '#1565c0', weight: 4, dashArray: '8 6', opacity: 0.85 },
      ).addTo(map);
      map.fitBounds(lineRef.current.getBounds(), { padding: [40, 40] });
    }
  }, [routeLine]);

  // 訪問順の番号マーカー
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (orderLayerRef.current) {
      orderLayerRef.current.remove();
      orderLayerRef.current = null;
    }
    if (routeStops && routeStops.length > 0) {
      const layer = L.layerGroup(
        routeStops.map((s) =>
          L.marker([s.lat, s.lng], {
            icon: L.divIcon({
              html: `<div class="order-pin">${s.order}</div>`,
              className: '',
              iconSize: [26, 26],
              iconAnchor: [13, 13],
            }),
            interactive: false,
            zIndexOffset: 1000,
          }),
        ),
      );
      layer.addTo(map);
      orderLayerRef.current = layer;
    }
  }, [routeStops]);

  // 駅フォーカス: 詳細カードに隠れないよう、マーカーを画面上寄りに配置
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusStationId) return;
    const st = stations.find((s) => s.id === focusStationId);
    if (!st) return;
    const zoom = Math.max(map.getZoom(), 12);
    const target = map.project([st.lat, st.lng], zoom).add([0, sheetOpen ? 90 : 0]);
    // アニメーション中にマーカー再構築が走るとクラスタ判定が移動前のズームを
    // 参照して個別マーカーが出ないことがあるため、非アニメで確定させる
    map.setView(map.unproject(target, zoom), zoom, { animate: false });
  }, [focusStationId, stations, sheetOpen]);

  // 現在地表示
  const meMarkerRef = useRef<L.CircleMarker | null>(null);
  const [locMsg, setLocMsg] = useState<string | null>(null);
  const locate = () => {
    if (!('geolocation' in navigator)) {
      setLocMsg('この端末では位置情報を使えません');
      setTimeout(() => setLocMsg(null), 3000);
      return;
    }
    void getBestCurrentPosition().then(({ position, error }) => {
      if (position) {
        const map = mapRef.current;
        if (!map) return;
        const ll: [number, number] = [position.coords.latitude, position.coords.longitude];
        if (meMarkerRef.current) meMarkerRef.current.setLatLng(ll);
        else
          meMarkerRef.current = L.circleMarker(ll, {
            radius: 8,
            color: '#fff',
            weight: 2.5,
            fillColor: '#1565c0',
            fillOpacity: 1,
          }).addTo(map);
        map.setView(ll, Math.max(map.getZoom(), 12));
        return;
      }
      setLocMsg(describeGeolocationError(error ?? { code: 2 }));
      setTimeout(() => setLocMsg(null), 5000);
    });
  };
  const locateRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (locateRef.current) L.DomEvent.disableClickPropagation(locateRef.current);
  }, []);

  return (
    <div className="map-root" ref={rootRef} data-testid="map-root">
      {routeSelectMode && (
        <div className="route-select-banner" data-testid="route-select-banner">
          <b>回りたい道の駅を選んでください</b>
          <br />
          <span className="route-select-note">選択中は訪問記録の色は変わりません</span>
        </div>
      )}
      {pickMode && <div className="map-hint">地図をタップして出発地点を指定</div>}
      {locMsg && <div className="map-hint">{locMsg}</div>}
      <button
        ref={locateRef}
        className="locate-btn"
        onClick={locate}
        aria-label="現在地を表示"
        data-testid="locate-btn"
      >
        📍
      </button>
      <Legend settings={settings} onChangeSettings={onChangeSettings} />
    </div>
  );
}
