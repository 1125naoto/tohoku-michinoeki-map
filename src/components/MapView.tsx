import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import type { Prefecture, Station, StatusFilter, VisitMap } from '../types';
import { TOHOKU_BOUNDS } from '../data';
import type { LatLng } from '../lib/geo';

interface Props {
  stations: Station[];
  visits: VisitMap;
  prefFilter: Prefecture | null;
  statusFilter: StatusFilter;
  /**
   * マーカーのタップ/クリック。押すたびに即時に状態を1段階進める
   * （時間差判定・保留タイマーは存在しない。公式HPはトースト/詳細のボタンから開く）
   */
  onTapStation: (id: string) => void;
  /** マーカー以外の地図タップ（詳細カードを閉じる用） */
  onMapTap: () => void;
  /** 出発地点の地図指定モード */
  pickMode: boolean;
  onPick: (p: LatLng) => void;
  /** ルート表示（旅行中・結果プレビュー） */
  routeLine: LatLng[] | null;
  focusStationId: string | null;
  /** 詳細カード表示中か（フォーカス時に上へずらす量の判断用） */
  sheetOpen: boolean;
}

export type MarkerState = 'none' | 'want' | 'visited' | 'stamp' | 'pre';

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

/** 状態フィルター（相互排他: 各駅は必ずどれか1つの一覧にだけ現れる） */
export function matchesFilter(st: Station, visits: VisitMap, statusFilter: StatusFilter): boolean {
  const state = visits[st.id]?.state ?? 'unvisited';
  switch (statusFilter) {
    case 'all':
      return true;
    case 'none':
      return st.status === 'open' && state === 'unvisited';
    case 'want':
      return state === 'wishlist';
    case 'visited':
      return state === 'visited';
    case 'stamp':
      return state === 'stamped';
  }
}

/** 状態ごとのマーク背景色（白い図形は全状態で白のまま維持） */
export const STATE_COLOR: Record<MarkerState, string> = {
  none: '#1a4f9e', // 未訪問: 青
  want: '#d9640a', // 行きたい: 濃いオレンジ
  visited: '#d83a34', // 訪問済み: 赤
  stamp: '#6a3ab2', // スタンプ取得済み: 紫
  pre: '#8f959d', // 開業前: グレー
};

/**
 * 道の駅マーク（独自作成SVG）。
 * 公式シンボルマークは国土交通省の登録商標で利用申請が必要なため画像素材は使用せず、
 * 案内標識で一般的な意匠の特徴（角丸正方形・白い2本の木・丸窓と縦長入口のある
 * 白い家・下部の白い道路ライン）を独自に描画したベクターデータ。
 * 背景色は訪問状態で変わる（color引数）。外周に白い縁取りを持つ。
 */
const signSvg = (color: string) =>
  '<svg viewBox="0 0 60 60" aria-hidden="true">' +
  // 白い縁取り + 状態色の角丸正方形
  '<rect x="0" y="0" width="60" height="60" rx="12" fill="#ffffff"/>' +
  `<rect x="2.2" y="2.2" width="55.6" height="55.6" rx="10" fill="${color}"/>` +
  // 白い木（左奥・大）: 丸い樹冠 + 幹（2本が別々の木に見えるよう間隔を確保）
  '<circle cx="18.5" cy="17.5" r="5.6" fill="#fff"/>' +
  '<circle cx="15" cy="22.5" r="4.3" fill="#fff"/>' +
  '<circle cx="22" cy="22.5" r="4.3" fill="#fff"/>' +
  '<rect x="17" y="24" width="3.1" height="22.8" fill="#fff"/>' +
  // 白い木（左手前・小）
  '<circle cx="7" cy="29" r="3.9" fill="#fff"/>' +
  '<circle cx="4.7" cy="32.5" r="3" fill="#fff"/>' +
  '<circle cx="9.3" cy="32.5" r="3" fill="#fff"/>' +
  '<rect x="5.8" y="33.5" width="2.6" height="13.3" fill="#fff"/>' +
  // 白い家（右）: 切妻屋根の輪郭
  '<path d="M29 24.5 L41.5 12.5 L54 24.5 V43.5 H29 Z" fill="#fff"/>' +
  // 家の中の丸い窓（背景色で抜く）
  `<circle cx="41.5" cy="26.5" r="3.6" fill="${color}"/>` +
  // 家の中の縦長の入口（背景色で抜く）
  `<rect x="38.4" y="33.5" width="6.2" height="10" fill="${color}"/>` +
  // 下部の白い道路ライン
  '<rect x="5" y="46.5" width="50" height="5.2" rx="1.2" fill="#fff"/>' +
  '</svg>';

export const BADGE_SYMBOL: Record<MarkerState, string> = {
  none: '',
  want: '★',
  visited: '✓',
  stamp: '印',
  pre: '準',
};

export function markerHtml(state: MarkerState, stationId: string): string {
  const badge = state === 'none' ? '' : `<span class="rs-badge">${BADGE_SYMBOL[state]}</span>`;
  // マーク全体を状態色で塗り分け（色+バッジの二重符号化）。白い図形は常に白
  return `<div class="rs-marker ${state}" data-sid="${stationId}">${signSvg(STATE_COLOR[state])}${badge}</div>`;
}

const LEGEND_SEEN_KEY = 'tohoku-me:legend-seen:v1';

// 地図上とまったく同じマークHTMLを凡例でも使用（見た目の不一致を避ける）
function LegendSample({ state }: { state: MarkerState }) {
  return (
    <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: markerHtml(state, `legend-${state}`) }} />
  );
}

function Legend() {
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
          <h4>アイコンの見方</h4>
          <div className="legend-item">
            <LegendSample state="none" />
            <span>道の駅（未訪問）</span>
          </div>
          <div className="legend-item">
            <LegendSample state="want" />
            <span>★ 行きたい</span>
          </div>
          <div className="legend-item">
            <LegendSample state="visited" />
            <span>✓ 訪問済み</span>
          </div>
          <div className="legend-item">
            <LegendSample state="stamp" />
            <span>印 スタンプ取得済み</span>
          </div>
          <div className="legend-item">
            <LegendSample state="pre" />
            <span>準 開業前</span>
          </div>
          <div className="legend-item">
            <span className="cluster-pill">3駅</span>
            <span>近くにある道の駅の件数</span>
          </div>
          <div className="legend-hint">
            道の駅マークを押すたびに、未訪問→訪問済み→行きたい→スタンプ取得済み→未訪問の順で切り替わります。
            <br />
            公式HP・詳細は、押した後に出るボタンから開けます。
            {!isTouch && (
              <>
                <br />
                カーソルを合わせると駅名を表示します。
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MapView({
  stations,
  visits,
  prefFilter,
  statusFilter,
  onTapStation,
  onMapTap,
  pickMode,
  onPick,
  routeLine,
  focusStationId,
  sheetOpen,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);
  const pickRef = useRef(pickMode);
  const onPickRef = useRef(onPick);
  const onTapRef = useRef(onTapStation);
  const onMapTapRef = useRef(onMapTap);
  pickRef.current = pickMode;
  onPickRef.current = onPick;
  onTapRef.current = onTapStation;
  onMapTapRef.current = onMapTap;

  // 1回の物理タップから touchend と click が二重発火しても「1タップ=1段階」を守るための
  // デデュープ（80ms未満の同一ID再入は同じ物理タップとみなす）。
  // 履歴はマーカー再構築やReact再描画の影響を受けないコンポーネントレベルのrefで保持する。
  const lastTapRef = useRef<{ id: string; at: number } | null>(null);
  const handleMarkerTap = (id: string) => {
    const now = Date.now();
    const lastTap = lastTapRef.current;
    lastTapRef.current = { id, at: now };
    if (lastTap && lastTap.id === id && now - lastTap.at < 80) return;
    // タップ間隔に関係なく、押した瞬間に状態を1段階だけ進める（保留・時間差判定なし）
    onTapRef.current(id);
  };

  // 初期化
  useEffect(() => {
    if (!rootRef.current || mapRef.current) return;
    const map = L.map(rootRef.current, { zoomControl: false, attributionControl: true });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    map.fitBounds(TOHOKU_BOUNDS, { padding: [4, 4] });
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
    map.addLayer(cluster);
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (pickRef.current) onPickRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
      else onMapTapRef.current();
    });
    mapRef.current = map;
    clusterRef.current = cluster;
    return () => {
      map.remove();
      mapRef.current = null;
      clusterRef.current = null;
    };
  }, []);

  // マーカー更新
  useEffect(() => {
    const cluster = clusterRef.current;
    if (!cluster) return;
    cluster.clearLayers();
    const shown = stations.filter(
      (st) => (!prefFilter || st.pref === prefFilter) && matchesFilter(st, visits, statusFilter),
    );
    for (const st of shown) {
      const state = visitState(st, visits);
      const marker = L.marker([st.lat, st.lng], {
        icon: L.divIcon({
          html: markerHtml(state, st.id),
          className: '',
          iconSize: [38, 38],
          iconAnchor: [19, 19],
          tooltipAnchor: [0, -24],
        }),
        alt: `道の駅${st.name}`,
        keyboard: true,
      });
      // PC: ホバーで駅名ツールチップ
      marker.bindTooltip(`道の駅 ${st.name}`, {
        direction: 'top',
        className: 'rs-tooltip',
        opacity: 1,
      });
      marker.on('click', () => handleMarkerTap(st.id));
      // マーカー連打が地図のダブルクリックズームを発火させないよう伝播だけ止める
      // （dblclickに機能は割り当てない。各clickが既に1段階ずつ進めている）
      marker.on('dblclick', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stop(e.originalEvent);
      });
      cluster.addLayer(marker);
    }
  }, [stations, visits, prefFilter, statusFilter]);

  // 県フィルターで表示範囲を調整
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!prefFilter) {
      map.fitBounds(TOHOKU_BOUNDS, { padding: [4, 4] });
      return;
    }
    const pts = stations.filter((s) => s.pref === prefFilter).map((s) => [s.lat, s.lng] as [number, number]);
    if (pts.length > 0) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });
  }, [prefFilter, stations]);

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

  return (
    <div className="map-root" ref={rootRef} data-testid="map-root">
      {pickMode && <div className="map-hint">地図をタップして出発地点を指定</div>}
      <Legend />
    </div>
  );
}
