/**
 * Google Web検索（https://www.google.com/search?q=）への「もっと探す」導線。
 * APIキー・課金は不要（検索エンジン結果ページへの単純なリンクのみ）。
 *
 * Fable 5.1 Root Cause Audit再監査の結論: Google Maps URLs公式仕様だけでは
 * 「指定した地点を検索中心に固定したままカテゴリ検索する」ことを保証できない
 * （座標連結・駅名連結いずれのquery調整でも同じ限界に突き当たる）。これ以上
 * Maps側のqueryを調整するのはやめ、外部探索の役割を3つに分離する：
 * (1) アプリ内POI＝道の駅周辺の候補をすぐ見る、(2) Google Web検索＝より詳しく・
 * 網羅的に探す、(3) Google Maps＝道の駅そのものの場所・口コミ・写真・営業時間・
 * ナビを見る。カテゴリ検索はGoogle Web検索（本ファイル）へ委ね、Google Mapsには
 * 「駅周辺のカテゴリ検索」をさせない。
 */
import type { PoiCategory } from './poi';
import type { Station } from '../types';

/** 検索語（自由テキスト）だけを渡す。座標・住所・near等は一切使わない */
export function googleWebSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

/** stationNearbySearchQuery用のカテゴリ語（検索クエリ内、「周辺」の直後に置く） */
const CATEGORY_QUERY_KEYWORD: Record<PoiCategory, string> = {
  food: '飲食店',
  tourism: '観光スポット',
  onsen: '温泉',
  lodging: 'ホテル 旅館',
};

/** CTA表示文言用のカテゴリ語（「Googleで◯◯をもっと探す」の◯◯部分） */
export const WEB_SEARCH_CATEGORY_LABEL: Record<PoiCategory, string> = {
  food: '周辺の飲食店',
  tourism: '周辺の観光スポット',
  onsen: '周辺の温泉',
  lodging: '周辺のホテル・旅館',
};

/**
 * 駅名に既に「道の駅」が含まれるデータ（例:「道の駅きたごう」）で
 * 「道の駅道の駅きたごう」にならないよう正規化する。
 */
function stationDisplayLabel(st: Station): string {
  return st.name.startsWith('道の駅') ? st.name : `道の駅${st.name}`;
}

/**
 * 道の駅を起点とした周辺カテゴリのGoogle Web検索クエリを組み立てる。
 * 住所・緯度経度・「near」等は一切使わない（一般的なWeb検索のテキストクエリとして
 * 自然な形にするだけであり、Maps側のquery調整とは異なりGoogle検索の検索精度・
 * 結果の妥当性はGoogle側の通常の自然文検索に委ねられるため、座標を混ぜる必要がない）。
 */
export function stationNearbySearchQuery(st: Station, category: PoiCategory | null): string {
  const label = stationDisplayLabel(st);
  const keyword = category ? CATEGORY_QUERY_KEYWORD[category] : '観光 グルメ 温泉 宿泊';
  return `${label} 周辺 ${keyword}`;
}
