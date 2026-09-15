/**
 * 地図表示設定（マーカー表示・駅名表示）。
 * localStorageへ保存し再読み込み後も維持する。訪問記録(v2)とはキーを分離。
 */

import { nsKey } from './storageNamespace';

export type MarkerMode = 'all' | 'cluster';
export type LabelMode = 'auto' | 'always' | 'off';

export interface MapSettings {
  /** 全駅表示（初期値・推奨） / まとめて表示（従来クラスタ） */
  markerMode: MarkerMode;
  /** 駅名表示: 自動（ズーム連動・初期値） / 常に表示 / 非表示 */
  labelMode: LabelMode;
}

export const MAP_SETTINGS_KEY = nsKey('tohoku-me:map-settings:v1');

export const DEFAULT_MAP_SETTINGS: MapSettings = {
  markerMode: 'all',
  labelMode: 'auto',
};

export function loadMapSettings(): MapSettings {
  try {
    const raw = localStorage.getItem(MAP_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_MAP_SETTINGS };
    const p = JSON.parse(raw) as Partial<MapSettings>;
    return {
      markerMode: p.markerMode === 'cluster' ? 'cluster' : 'all',
      labelMode: p.labelMode === 'always' || p.labelMode === 'off' ? p.labelMode : 'auto',
    };
  } catch {
    return { ...DEFAULT_MAP_SETTINGS };
  }
}

export function saveMapSettings(s: MapSettings): void {
  try {
    localStorage.setItem(MAP_SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* noop */
  }
}

// ---- ズーム閾値・サイズ（実測して決定した定数）----
/** アイコン: 東北全体(小) → 県単位(中) → 市町村単位(通常) */
export const MARKER_ZOOM_MEDIUM = 9; // これ未満は小サイズ
export const MARKER_ZOOM_DETAIL = 11; // これ以上は通常サイズ
export const MARKER_SIZE_WIDE = 0.5; // scale係数
export const MARKER_SIZE_MEDIUM = 0.72;
export const MARKER_SIZE_DETAIL = 1;

/** 駅名ラベル: 広域=非表示 → 中間=1行省略表示 → 詳細=最大2行 */
export const LABEL_ZOOM_HIDDEN = 10; // これ未満は非表示（選択中を除く）
export const LABEL_ZOOM_PARTIAL = 10; // 1行・省略表示
export const LABEL_ZOOM_ALL = 12; // 全表示・最大2行

/** ズーム値 → 地図コンテナへ付与するクラス（CSSでサイズ/ラベルを制御） */
export function zoomClasses(zoom: number): string[] {
  const size =
    zoom < MARKER_ZOOM_MEDIUM ? 'mz-wide' : zoom < MARKER_ZOOM_DETAIL ? 'mz-medium' : 'mz-detail';
  const label = zoom < LABEL_ZOOM_PARTIAL ? 'lz-hidden' : zoom < LABEL_ZOOM_ALL ? 'lz-partial' : 'lz-all';
  return [size, label];
}
