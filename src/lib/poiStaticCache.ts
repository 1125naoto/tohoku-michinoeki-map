/**
 * 道の駅ごとに事前生成された周辺スポットの静的キャッシュ（public/data/poi/<stationId>.json）。
 * scripts/fetch_poi_cache.py がOverpassから事前取得し、GitHub Pagesの一部として同梱・配信される。
 *
 * ユーザーのスマホが毎回Overpass公開APIの生死に依存する構造を避けるため、
 * 道の駅起点の検索ではこれを最優先で即時表示し、裏でOverpassへの再検証（より新しい
 * データへの更新）を試みる。静的ファイルはGitHub Pages自体から配信されるため、
 * Overpass公開ミラーの瞬間的な不調とは無関係に、常に同程度の可用性で読み込める。
 */
import type { Poi } from './poi';

export interface StaticPoiCacheFile {
  stationId: string;
  lat: number;
  lng: number;
  radiusM: number;
  /** scripts/fetch_poi_cache.py が生成した日時（ISO文字列） */
  generatedAt: string;
  pois: Poi[];
}

/**
 * 指定駅の静的POIキャッシュを読み込む。未生成（404）・形式不正・通信不可はすべてnull
 * （呼び出し側でOverpass検索やフォールバックに進めるよう、例外は投げない）。
 */
export async function loadStaticPoiCache(stationId: string): Promise<StaticPoiCacheFile | null> {
  try {
    const base = import.meta.env.BASE_URL;
    const res = await fetch(`${base}data/poi/${stationId}.json`);
    if (!res.ok) return null;
    const data = (await res.json()) as StaticPoiCacheFile;
    if (!data || !Array.isArray(data.pois)) return null;
    return data;
  } catch {
    return null;
  }
}
