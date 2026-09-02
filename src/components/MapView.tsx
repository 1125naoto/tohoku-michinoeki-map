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
 * 道の駅サインボード型ピクトグラム（独自SVG）。
 * 公式「道の駅」ロゴは全国「道の駅」連絡会の商標のため使用せず、
 * 標識風の看板 + 緑屋根の施設 + 道路 で「道の駅」を表す独自デザイン。
 */
const SIGN_SVG =
  '<svg viewBox="0 0 24 19" width="23" height="18" aria-hidden="true">' +
  '<rect x="0" y="13.5" width="24" height="5.5" rx="1" fill="#8f98a3"/>' +
  '<rect x="2" y="15.7" width="4" height="1.3" fill="#fff"/>' +
  '<rect x="10" y="15.7" width="4" height="1.3" fill="#fff"/>' +
  '<rect x="18" y="15.7" width="4" height="1.3" fill="#fff"/>' +
  '<path d="M12 0.5 L19.5 7 L4.5 7 Z" fill="#2e7d32"/>' +
  '<rect x="6.2" y="7" width="11.6" height="6.5" rx="0.8" fill="#57a05b"/>' +
  '<rect x="10.6" y="9.2" width="2.8" height="4.3" fill="#fff"/>' +
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
  return (
    `<div class="rs-marker ${state}" data-sid="${stationId}">` +
    `<div class="rs-sign">${SIGN_SVG}</div><div class="rs-post"></div>${badge}</div>`
  );
}

const LEGEND_SEEN_KEY = 'tohoku-me:legend-seen:v1';

function LegendSample({ state }: { state: MarkerState }) {
  const badge = state === 'none' ? null : <span className="rs-badge">{BADGE_SYMBOL[state]}</span>;
  return (
    <span className={`rs-marker ${state}`} aria-hidden="true">
      <span className="rs-sign" dangerouslySetInnerHTML={{ __html: SIGN_SVG }} />
      <span className="rs-post" style={{ display: 'block' }} />
      {badge}
    </span>
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
          iconSize: [34, 41],
          iconAnchor: [17, 41],
          tooltipAnchor: [0, -42],
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
