import { useEffect, useRef } from 'react';
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
  onSelect: (id: string) => void;
  /** 出発地点の地図指定モード */
  pickMode: boolean;
  onPick: (p: LatLng) => void;
  /** ルート表示（旅行中・結果プレビュー） */
  routeLine: LatLng[] | null;
  focusStationId: string | null;
}

function pinHtml(state: 'none' | 'want' | 'visited' | 'pre', stamp: boolean): string {
  const symbol = state === 'want' ? '★' : state === 'visited' ? '✓' : state === 'pre' ? '準' : '●';
  const badge = stamp ? '<span class="stamp-badge">印</span>' : '';
  return `<div class="pin ${state}"><span>${symbol}</span>${badge}</div>`;
}

export function visitState(st: Station, visits: VisitMap): 'none' | 'want' | 'visited' | 'pre' {
  if (st.status !== 'open') return 'pre';
  const rec = visits[st.id];
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

export default function MapView({
  stations,
  visits,
  prefFilter,
  statusFilter,
  onSelect,
  pickMode,
  onPick,
  routeLine,
  focusStationId,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);
  const pickRef = useRef(pickMode);
  const onPickRef = useRef(onPick);
  const onSelectRef = useRef(onSelect);
  pickRef.current = pickMode;
  onPickRef.current = onPick;
  onSelectRef.current = onSelect;

  // 初期化
  useEffect(() => {
    if (!rootRef.current || mapRef.current) return;
    const map = L.map(rootRef.current, { zoomControl: false, attributionControl: true });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    map.fitBounds(TOHOKU_BOUNDS, { padding: [10, 10] });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    const cluster = L.markerClusterGroup({
      maxClusterRadius: 44,
      disableClusteringAtZoom: 11,
      showCoverageOnHover: false,
      iconCreateFunction: (c) => {
        const n = c.getChildCount();
        const size = n >= 50 ? 44 : n >= 10 ? 38 : 32;
        return L.divIcon({
          html: `<div class="cluster-icon" style="width:${size}px;height:${size}px">${n}</div>`,
          className: '',
          iconSize: [size, size],
        });
      },
    });
    map.addLayer(cluster);
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (pickRef.current) onPickRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
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
      const stamp = visits[st.id]?.stamp === true;
      const marker = L.marker([st.lat, st.lng], {
        icon: L.divIcon({ html: pinHtml(state, stamp), className: '', iconSize: [30, 30], iconAnchor: [15, 28] }),
        alt: `道の駅${st.name}`,
        keyboard: true,
      });
      marker.on('click', () => onSelectRef.current(st.id));
      cluster.addLayer(marker);
    }
  }, [stations, visits, prefFilter, statusFilter]);

  // 県フィルターで表示範囲を調整
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!prefFilter) {
      map.fitBounds(TOHOKU_BOUNDS, { padding: [10, 10] });
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

  // 駅フォーカス（詳細カードを開いたとき）
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusStationId) return;
    const st = stations.find((s) => s.id === focusStationId);
    if (st) map.setView([st.lat, st.lng], Math.max(map.getZoom(), 12), { animate: true });
  }, [focusStationId, stations]);

  return (
    <div className="map-root" ref={rootRef} data-testid="map-root">
      {pickMode && <div className="map-hint">地図をタップして出発地点を指定</div>}
    </div>
  );
}
