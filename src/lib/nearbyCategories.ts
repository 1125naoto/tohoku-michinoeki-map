/**
 * 周辺スポットの「アイコン付きサブカテゴリ」→ Googleマップのカテゴリ検索。
 *
 * 位置づけ:
 * - アプリ内POI（OSM/Overpass・静的キャッシュ）＝道の駅を中心とした近場候補。ここは不変。
 * - このファイル＝Googleの店舗・施設情報からカテゴリで探すための外部導線。
 * 両者は共存させる（どちらも消さない）。
 *
 * 検索語の設計（Owner実機QA・道の駅あきた港の指摘）:
 * 「道の駅あきた港 ラーメン」のように道の駅名を混ぜると、カテゴリ検索ではなく
 * 道の駅そのもののPlace詳細へ寄ってしまう。そのため検索語には道の駅名を入れず、
 * 「カテゴリ語 + 市区町村」（例:「ラーメン 秋田市」）だけを渡す。
 *
 * URLはGoogle Maps URLsの公式Search action（api=1&query=）のみを使う。
 * 過去に検索地点が端末の現在地扱いになる不具合の原因となった、生の緯度経度の連結・
 * /@lat,lng・near・viewport hack 等の非公式な指定には戻さない。
 * https://developers.google.com/maps/documentation/urls
 */
import type { PoiCategory } from './poi';
import type { Station } from '../types';

export interface NearbyCategory {
  /** data-testid・Reactのkeyに使う安定した識別子 */
  key: string;
  icon: string;
  label: string;
  /** Googleマップへ渡すカテゴリ語（市区町村と組み合わせる） */
  query: string;
}

/** 大カテゴリの絵文字（表示のみ。CATEGORY_LABELや分類ロジックには手を入れない） */
export const CATEGORY_ICON: Record<PoiCategory, string> = {
  food: '🍴',
  tourism: '🗺️',
  onsen: '♨️',
  lodging: '🏨',
};

/** 大カテゴリごとのサブカテゴリ（アイコン付き・表示順） */
export const NEARBY_CATEGORIES: Record<PoiCategory, NearbyCategory[]> = {
  food: [
    { key: 'ramen', icon: '🍜', label: 'ラーメン', query: 'ラーメン' },
    { key: 'sushi', icon: '🍣', label: '寿司', query: '寿司' },
    { key: 'yakiniku', icon: '🍖', label: '焼肉', query: '焼肉' },
    { key: 'curry', icon: '🍛', label: 'カレー', query: 'カレー' },
    { key: 'pasta', icon: '🍝', label: '麺・パスタ', query: 'パスタ' },
    { key: 'cafe', icon: '☕', label: 'カフェ', query: 'カフェ' },
    { key: 'sweets', icon: '🍰', label: 'スイーツ', query: 'スイーツ' },
    { key: 'izakaya', icon: '🍺', label: '居酒屋', query: '居酒屋' },
    { key: 'food_other', icon: '🍽️', label: 'その他・飲食店', query: '飲食店' },
  ],
  tourism: [
    { key: 'jinja', icon: '⛩️', label: '神社', query: '神社' },
    { key: 'tera', icon: '🛕', label: '寺・仏閣', query: '寺' },
    { key: 'shiro', icon: '🏯', label: '城・史跡', query: '城' },
    { key: 'meisho', icon: '🌸', label: '名所・絶景', query: '観光名所' },
    { key: 'museum', icon: '🏛️', label: '博物館・美術館', query: '博物館' },
    { key: 'koen', icon: '🌳', label: '公園', query: '公園' },
    { key: 'leisure', icon: '🎡', label: 'レジャー', query: 'レジャー施設' },
  ],
  onsen: [
    { key: 'higaeri', icon: '♨️', label: '日帰り温泉', query: '日帰り温泉' },
    { key: 'sauna', icon: '🧖', label: 'サウナ・スーパー銭湯', query: 'サウナ' },
    { key: 'onsen_all', icon: '♨️', label: '温泉全般', query: '温泉' },
  ],
  lodging: [
    { key: 'hotel', icon: '🏨', label: 'ホテル', query: 'ホテル' },
    { key: 'ryokan', icon: '🏯', label: '旅館', query: '旅館' },
    { key: 'camp', icon: '⛺', label: 'キャンプ場', query: 'キャンプ場' },
    { key: 'rvpark', icon: '🚐', label: 'RVパーク', query: 'RVパーク' },
  ],
};

/**
 * 検索対象の地域名。道の駅データの市区町村（Station.city）をそのまま使う。
 * 市区町村が空のデータでは都道府県へ、それも空なら住所へ順に下げる。
 * いずれの場合も道の駅名は使わない（Place詳細へ寄ってしまうため）。
 */
export function municipalityFor(st: Station): string {
  const city = st.city?.trim();
  if (city) return city;
  const pref = st.pref?.trim();
  if (pref) return pref;
  return st.address?.trim() ?? '';
}

/** 例: 「ラーメン 秋田市」。地域名が取れない場合はカテゴリ語のみ */
export function nearbyCategoryQuery(st: Station, category: NearbyCategory): string {
  const area = municipalityFor(st);
  return area ? `${category.query} ${area}` : category.query;
}

/** Google Maps URLs の公式Search action。APIキー・課金は不要 */
export function nearbyCategorySearchUrl(st: Station, category: NearbyCategory): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(nearbyCategoryQuery(st, category))}`;
}
