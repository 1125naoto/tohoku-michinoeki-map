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
  /** 1回目のタップ/クリック: 選択して詳細表示（Appが同一駅の2回目を公式HPに振り分ける） */
  onSelect: (id: string) => void;
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

export function visitState(st: Station, visits: VisitMap): MarkerState {
  if (st.status !== 'open') return 'pre';
  const rec = visits[st.id];
  if (rec?.stamp) return 'stamp';
  if (rec?.status === 'visited') return 'visited';
  if (rec?.status === 'want') return 'want';
  return 'none';
}

export function matchesFilter(st: Station, visits: VisitMap, statusFilter: StatusFilter): boolean {
  const rec = visits[st.id];
  switch (statusFilter) {
    case 'all':
      return true;
    case 'none':
      return st.status === 'open' && (!rec || rec.status === 'none');
    case 'want':
      return rec?.status === 'want';
    case 'visited':
      return rec?.status === 'visited';
    case 'stamp':
      return rec?.stamp === true;
  }
}

/**
 * 道の駅マーク（独自作成SVG）。
 * 公式シンボルマークは国土交通省の登録商標で利用申請が必要なため画像素材は使用せず、
 * 案内標識で一般的な意匠の特徴（濃い青の角丸正方形・白い2本の木・丸窓と縦長入口のある
 * 白い家・下部の白い道路ライン）を独自に描画したベクターデータ。
 * 外周に白い縁取りを持ち、地図上で背景に埋もれない。
 */
const SIGN_SVG =
  '<svg viewBox="0 0 60 60" aria-hidden="true">' +
  // 白い縁取り + 濃い青の角丸正方形
  '<rect x="0" y="0" width="60" height="60" rx="12" fill="#ffffff"/>' +
  '<rect x="2.2" y="2.2" width="55.6" height="55.6" rx="10" fill="#1a4f9e"/>' +
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
  // 家の中の丸い窓（青抜き）
  '<circle cx="41.5" cy="26.5" r="3.6" fill="#1a4f9e"/>' +
  // 家の中の縦長の入口（青抜き）
  '<rect x="38.4" y="33.5" width="6.2" height="10" fill="#1a4f9e"/>' +
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
  // マーク本体は全状態で青白のまま（開業前のみCSSでグレー表示）。状態は右上バッジで区別
  return `<div class="rs-marker ${state}" data-sid="${stationId}">${SIGN_SVG}${badge}</div>`;
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
            {isTouch
              ? '1回タップで詳細・同じ駅をもう一度タップで公式HP'
              : 'カーソルで駅名・クリックで詳細・ダブルクリックで公式HP'}
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
  onSelect,
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
  const onSelectRef = useRef(onSelect);
  const onMapTapRef = useRef(onMapTap);
  pickRef.current = pickMode;
  onPickRef.current = onPick;
  onSelectRef.current = onSelect;
  onMapTapRef.current = onMapTap;

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
      marker.on('click', () => onSelectRef.current(st.id));
      // マーカー連打で地図のダブルクリックズームを発火させない
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
    map.setView(map.unproject(target, zoom), zoom, { animate: true });
  }, [focusStationId, stations, sheetOpen]);

  return (
    <div className="map-root" ref={rootRef} data-testid="map-root">
      {pickMode && <div className="map-hint">地図をタップして出発地点を指定</div>}
      <Legend />
    </div>
  );
}
