/**
 * 周辺スポット（飲食店・観光地・温泉）のデータモデルとカテゴリ分類。
 *
 * データ源はOpenStreetMap（Overpass API経由・APIキー不要）。OSMのタグから
 * 確実に読み取れる場合だけ分類し、タグが存在しない/曖昧な項目は「その他」に
 * 分類するか、そもそも取得対象に含めない（推測で断定しない）。
 * 評価・口コミはOSMに存在しないため、アプリ内で星評価等を捏造しない。
 */

export type PoiCategory = 'food' | 'tourism' | 'onsen' | 'lodging';

/**
 * Poiの形・分類ロジックのスキーマ版。
 * classify() の判定や Poi のフィールド構成を変えたら必ず上げること。
 * 端末に保存された過去の検索結果（localStorageの劣化フォールバック）は、
 * 書き込んだ時点のスキーマ版と一致する場合だけ再利用する。
 * （実機で、旧ビルドが保存した「subcategoriesの無い/旧分類の」結果が
 *   新ビルドでも優先的に表示され続け、静的キャッシュの正しい分類が使われず
 *   「ラーメン0件」になる不具合の根本原因だったため）
 *  v2: subcategories[] の追加、cuisine/店名による飲食ジャンル判定、温泉の多重所属
 */
export const POI_SCHEMA_VERSION = 2;

export type FoodSub =
  | 'ramen'
  | 'shokudo'
  | 'yoshoku'
  | 'sushi'
  | 'yakiniku'
  | 'italian'
  | 'izakaya'
  | 'cafe'
  | 'sweets'
  | 'fastfood'
  | 'food_other';

export type TourismSub =
  | 'meisho'
  | 'keishou'
  | 'jinja_tera'
  | 'koen'
  | 'hakubutsukan'
  | 'tenbo'
  | 'doubutsuen_suizokukan'
  | 'camp'
  | 'tourism_other';

export type OnsenSub = 'onsen' | 'higaeri_onsen' | 'onyoku_shisetsu' | 'ashiyu' | 'kyukei' | 'onsen_other';

export type LodgingSub = 'hotel' | 'guesthouse' | 'hostel' | 'lodging_other';

export type PoiSubcategory = FoodSub | TourismSub | OnsenSub | LodgingSub;

/** 混合ルートの立ち寄り先の内部種別（道の駅と同列で扱うための共通分類） */
export type StopType = 'station' | 'restaurant' | 'cafe' | 'onsen' | 'tourism' | 'lodging' | 'park' | 'other';

export interface Poi {
  /** `osm:<node|way|relation>/<id>` 形式の一意ID */
  id: string;
  category: PoiCategory;
  /** 表示・アイコン・滞在時間既定値に使う代表サブカテゴリ（従来通り単一） */
  subcategory: PoiSubcategory;
  /**
   * 絞り込み用の所属サブカテゴリ一覧（1件以上、必ずsubcategoryを含む）。
   * 例: 天然温泉の日帰り入浴施設は「日帰り温泉」を代表表示にしつつ、
   * 「温泉」細分類での絞り込みにも該当させたいため両方を持つ。
   * localStorageに保存された旧データ（このフィールドが無い）を読む箇所は、
   * 必ず `p.subcategories ?? [p.subcategory]` の形でフォールバックすること。
   */
  subcategories: PoiSubcategory[];
  /** OSMにname タグが無い場合は null（名称不明として扱い、断定表示しない） */
  name: string | null;
  lat: number;
  lng: number;
  /** 住所が組み立てられた場合のみ（addr:*タグが無ければnull） */
  address: string | null;
  /** OSMのopening_hours原文。無ければnull（推測で埋めない） */
  openingHoursRaw: string | null;
  /** phone/contact:phoneタグがある場合のみ */
  phone: string | null;
  /** website/contact:websiteタグがある場合のみ */
  website: string | null;
  /** 検索起点からの距離(m) */
  distanceM: number;
  source: 'overpass';
  /** OSM要素そのものへのリンク（出典明示用） */
  sourceUrl: string;
}

export const CATEGORY_LABEL: Record<PoiCategory, string> = {
  food: '食べる',
  tourism: '観光',
  onsen: '温泉・休憩',
  lodging: '宿泊',
};

export const SUBCATEGORY_LABEL: Record<PoiSubcategory, string> = {
  ramen: 'ラーメン',
  shokudo: '食堂',
  yoshoku: '洋食',
  sushi: '寿司',
  yakiniku: '焼肉',
  italian: 'イタリアン',
  izakaya: '居酒屋',
  cafe: 'カフェ',
  sweets: 'スイーツ',
  fastfood: 'ファストフード',
  food_other: 'その他の飲食店',
  meisho: '観光名所',
  keishou: '景勝地',
  jinja_tera: '神社・寺',
  koen: '公園',
  hakubutsukan: '博物館・資料館',
  tenbo: '展望スポット',
  doubutsuen_suizokukan: '動物園・水族館',
  camp: 'キャンプ',
  tourism_other: 'その他',
  onsen: '温泉',
  higaeri_onsen: '日帰り温泉',
  onyoku_shisetsu: '温浴施設',
  ashiyu: '足湯',
  kyukei: '休憩スポット',
  onsen_other: 'その他',
  hotel: 'ホテル',
  guesthouse: '旅館・民宿',
  hostel: 'ゲストハウス・ホステル',
  lodging_other: 'その他の宿泊施設',
};

export const CATEGORY_SUBCATEGORIES: Record<PoiCategory, PoiSubcategory[]> = {
  food: ['ramen', 'shokudo', 'yoshoku', 'sushi', 'yakiniku', 'italian', 'izakaya', 'cafe', 'sweets', 'fastfood', 'food_other'],
  tourism: ['meisho', 'keishou', 'jinja_tera', 'koen', 'hakubutsukan', 'tenbo', 'doubutsuen_suizokukan', 'camp', 'tourism_other'],
  onsen: ['onsen', 'higaeri_onsen', 'onyoku_shisetsu', 'ashiyu', 'kyukei', 'onsen_other'],
  lodging: ['hotel', 'guesthouse', 'hostel', 'lodging_other'],
};

/**
 * 「雨の日向け」は独自のOSMタグが存在しないため、既に分類済みの屋内系
 * サブカテゴリだけを横断的に絞り込むクライアント側の便宜フィルタとする
 * （新しいカテゴリをでっち上げるのではなく、既存の正確な分類を再利用する）。
 */
export const RAINY_DAY_SUBCATEGORIES: PoiSubcategory[] = [
  'hakubutsukan',
  'doubutsuen_suizokukan',
  'onsen',
  'higaeri_onsen',
  'onyoku_shisetsu',
];

/** 立ち寄り先の内部種別ごとの初期滞在時間（分）。ユーザーが変更可能な既定値 */
export const DEFAULT_STAY_MIN: Record<'station' | PoiSubcategory, number> = {
  station: 30,
  ramen: 45,
  shokudo: 45,
  yoshoku: 60,
  sushi: 60,
  yakiniku: 60,
  italian: 60,
  izakaya: 60,
  cafe: 45,
  sweets: 45,
  fastfood: 45,
  food_other: 45,
  meisho: 60,
  keishou: 45,
  jinja_tera: 45,
  koen: 45,
  hakubutsukan: 60,
  tenbo: 45,
  doubutsuen_suizokukan: 60,
  camp: 60,
  tourism_other: 45,
  onsen: 90,
  higaeri_onsen: 90,
  onyoku_shisetsu: 90,
  ashiyu: 30,
  kyukei: 30,
  onsen_other: 45,
  hotel: 480,
  guesthouse: 480,
  hostel: 480,
  lodging_other: 480,
};

/** 滞在時間の選択肢（任意入力は15分単位に丸める） */
export const STAY_MIN_OPTIONS = [15, 30, 45, 60, 90, 120];

export function roundStayMin(raw: number): number {
  if (!Number.isFinite(raw)) return 30;
  return Math.max(15, Math.min(240, Math.round(raw / 15) * 15));
}

/** サブカテゴリ → 混合ルートの内部種別 */
export function stopTypeOf(sub: PoiSubcategory): StopType {
  if (sub === 'cafe') return 'cafe';
  if (
    sub === 'ramen' ||
    sub === 'shokudo' ||
    sub === 'yoshoku' ||
    sub === 'sushi' ||
    sub === 'yakiniku' ||
    sub === 'italian' ||
    sub === 'izakaya' ||
    sub === 'fastfood' ||
    sub === 'food_other'
  ) {
    return 'restaurant';
  }
  if (
    sub === 'onsen' ||
    sub === 'higaeri_onsen' ||
    sub === 'onyoku_shisetsu' ||
    sub === 'ashiyu' ||
    sub === 'kyukei' ||
    sub === 'onsen_other'
  ) {
    return 'onsen';
  }
  if (sub === 'koen' || sub === 'keishou') return 'park';
  if (
    sub === 'meisho' ||
    sub === 'jinja_tera' ||
    sub === 'hakubutsukan' ||
    sub === 'tenbo' ||
    sub === 'doubutsuen_suizokukan' ||
    sub === 'camp' ||
    sub === 'tourism_other'
  ) {
    return 'tourism';
  }
  if (sub === 'hotel' || sub === 'guesthouse' || sub === 'hostel' || sub === 'lodging_other') return 'lodging';
  return 'other';
}

/** 立ち寄り先アイコン（道の駅とは明確に形を分ける） */
export const STOP_TYPE_GLYPH: Record<StopType, string> = {
  station: '', // 道の駅は既存の専用SVGを使用（ここでは使わない）
  restaurant: '🍴',
  cafe: '☕',
  onsen: '♨️',
  tourism: '📷',
  lodging: '🏨',
  park: '🌳',
  other: '📍',
};

/** マーカー背景色（道の駅の訪問状態色とは別系統の配色にして混同を防ぐ） */
export const STOP_TYPE_COLOR: Record<StopType, string> = {
  station: '#1a4f9e',
  restaurant: '#e8734a',
  cafe: '#b07a3e',
  onsen: '#c0397a',
  tourism: '#2f8f6e',
  lodging: '#7a55c2',
  park: '#4a9e3e',
  other: '#6a6f78',
};

const OSM_ELEMENT_TYPE: Record<string, string> = { node: 'node', way: 'way', relation: 'relation' };

export interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/**
 * 飲食のジャンル細分類。cuisineタグを最優先し、cuisineが無い/どれにも
 * 一致しない場合のみ、店名の高精度なキーワード（ラーメン/寿司/焼肉。誤検出が
 * ほぼ無い語だけに限定）で補う。日本のOSMデータはcuisineタグが付いていない
 * 飲食店が非常に多く、cuisineだけに頼ると実在するラーメン店・寿司店等が
 * 軒並み「その他の飲食店」に埋もれてしまうため（実データ監査で確認済み）。
 */
function classifyFoodGenre(cuisine: string, name: string): FoodSub | null {
  if (cuisine.includes('ramen')) return 'ramen';
  if (cuisine.includes('sushi')) return 'sushi';
  if (cuisine.includes('yakiniku') || cuisine.includes('korean')) return 'yakiniku';
  if (cuisine.includes('italian')) return 'italian';
  if (cuisine.includes('izakaya')) return 'izakaya';
  if (cuisine.includes('western')) return 'yoshoku';
  if (cuisine.includes('japanese')) return 'shokudo';
  if (cuisine.includes('dessert') || cuisine.includes('cake')) return 'sweets';
  if (/ラーメン|らーめん|らあめん|中華そば/.test(name)) return 'ramen';
  if (/寿司|すし|鮨/.test(name)) return 'sushi';
  if (/焼肉|焼き肉/.test(name)) return 'yakiniku';
  return null;
}

/**
 * public_bath/spaが実際に温泉由来かどうかの判定。bath:typeタグが最も確実だが、
 * 実データ（ライブAPIで確認）では大半の温泉施設にbath:typeが付いていないため、
 * 「amenity=public_bath等の入浴施設と既に確定した上で」店名に「温泉」を含む、
 * という高精度な補助シグナルも使う（ホテル等の名前判定とは違い、対象が
 * 既に入浴施設と確定しているため誤って無関係なカテゴリを増やす心配が無い）。
 */
function isOnsenFacility(tags: Record<string, string>, name: string): boolean {
  return tags['bath:type'] === 'onsen' || name.includes('温泉');
}

/** OSMタグから分類する。判定できない要素は null（呼び出し側で除外する） */
export function classify(
  tags: Record<string, string>,
): { category: PoiCategory; subcategory: PoiSubcategory; subcategories: PoiSubcategory[] } | null {
  const amenity = tags.amenity;
  const tourism = tags.tourism;
  const leisure = tags.leisure;
  const natural = tags.natural;
  const shop = tags.shop;
  const highway = tags.highway;
  const cuisine = (tags.cuisine ?? '').toLowerCase();
  const religion = tags.religion;
  const name = tags['name:ja'] ?? tags.name ?? '';

  const single = (category: PoiCategory, subcategory: PoiSubcategory) => ({ category, subcategory, subcategories: [subcategory] });

  // ---- 温泉・休憩 ----
  if (natural === 'hot_spring') return single('onsen', 'onsen');
  if (amenity === 'public_bath') {
    return isOnsenFacility(tags, name)
      ? { category: 'onsen', subcategory: 'higaeri_onsen', subcategories: ['higaeri_onsen', 'onsen'] }
      : single('onsen', 'higaeri_onsen');
  }
  if (leisure === 'spa') {
    return isOnsenFacility(tags, name)
      ? { category: 'onsen', subcategory: 'onyoku_shisetsu', subcategories: ['onyoku_shisetsu', 'onsen'] }
      : single('onsen', 'onyoku_shisetsu');
  }
  if (amenity === 'foot_bath') return single('onsen', 'ashiyu');
  if (highway === 'rest_area' || tourism === 'picnic_site' || amenity === 'shelter') {
    return single('onsen', 'kyukei');
  }

  // ---- 食べる ----
  if (amenity === 'cafe') return single('food', 'cafe');
  if (shop === 'confectionery' || shop === 'pastry') return single('food', 'sweets');
  if (amenity === 'fast_food' || amenity === 'restaurant' || amenity === 'bar' || amenity === 'pub') {
    const genre = classifyFoodGenre(cuisine, name);
    if (genre) return single('food', genre);
    return single('food', amenity === 'fast_food' ? 'fastfood' : 'food_other');
  }

  // ---- 観光 ----
  if (amenity === 'place_of_worship' && (religion === 'shinto' || religion === 'buddhist')) {
    return single('tourism', 'jinja_tera');
  }
  if (leisure === 'park') return single('tourism', 'koen');
  if (tourism === 'museum') return single('tourism', 'hakubutsukan');
  if (tourism === 'viewpoint') return single('tourism', 'tenbo');
  if (tourism === 'zoo' || tourism === 'aquarium') return single('tourism', 'doubutsuen_suizokukan');
  if (tourism === 'camp_site') return single('tourism', 'camp');
  if (natural === 'beach' || natural === 'waterfall' || natural === 'peak' || natural === 'cliff') {
    return single('tourism', 'keishou');
  }
  if (tourism === 'attraction') return single('tourism', 'meisho');
  if (tourism === 'artwork' || tourism === 'gallery') return single('tourism', 'tourism_other');

  // ---- 宿泊 ----
  if (tourism === 'hotel' || tourism === 'motel') return single('lodging', 'hotel');
  if (tourism === 'guest_house') return single('lodging', 'guesthouse');
  if (tourism === 'hostel') return single('lodging', 'hostel');

  return null;
}

function buildAddress(tags: Record<string, string>): string | null {
  const pref = tags['addr:province'] ?? tags['addr:state'];
  const city = tags['addr:city'] ?? tags['addr:town'] ?? tags['addr:village'];
  const suburb = tags['addr:suburb'];
  const street = tags['addr:street'];
  const houseNumber = tags['addr:housenumber'];
  const parts = [pref, city, suburb, street, houseNumber].filter((x): x is string => !!x);
  return parts.length > 0 ? parts.join('') : null;
}

/** OSM要素 → Poi へ正規化する（分類できない/座標が無い要素はnull） */
export function normalizeOsmElement(el: OsmElement, origin: { lat: number; lng: number }): Poi | null {
  const tags = el.tags ?? {};
  const cls = classify(tags);
  if (!cls) return null;
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (lat == null || lng == null) return null;
  const typeKey = OSM_ELEMENT_TYPE[el.type] ?? 'node';
  return {
    id: `osm:${typeKey}/${el.id}`,
    category: cls.category,
    subcategory: cls.subcategory,
    subcategories: cls.subcategories,
    // 日本語名（name:ja / name:ja-Hira等）があれば優先し、無ければ汎用のnameを使う
    name: tags['name:ja'] ?? tags.name ?? null,
    lat,
    lng,
    address: buildAddress(tags),
    openingHoursRaw: tags.opening_hours ?? null,
    phone: tags.phone ?? tags['contact:phone'] ?? null,
    website: tags.website ?? tags['contact:website'] ?? null,
    distanceM: Math.round(haversineM(origin, { lat, lng })),
    source: 'overpass',
    sourceUrl: `https://www.openstreetmap.org/${typeKey}/${el.id}`,
  };
}

/**
 * ほぼ同一施設の重複除去（同一OSM IDは元々起きないが、同じ場所が別要素種別
 * （例: 建物way＋施設node）で二重に取得されることがあるため、座標＋名称で判定する）。
 */
export function dedupePois(pois: Poi[]): Poi[] {
  const seen = new Map<string, Poi>();
  for (const p of pois) {
    // 約11m精度に丸めて近接判定（GPS/タグ付けの微小なズレを吸収）
    const key = `${p.name ?? ''}:${p.lat.toFixed(4)}:${p.lng.toFixed(4)}`;
    const existing = seen.get(key);
    if (!existing || p.distanceM < existing.distanceM) seen.set(key, p);
  }
  return [...seen.values()];
}

function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** POIの表示名（名称不明の場合は分類名を代わりに使うが、実在の固有名として断定しない） */
export function poiDisplayName(p: Poi): string {
  return p.name ?? `名称不明の${SUBCATEGORY_LABEL[p.subcategory]}`;
}

/** GoogleマップでPOIの評価・口コミを見るための検索URL（座標+分かる範囲の名称/住所） */
export function poiGoogleSearchUrl(p: Poi): string {
  const q = p.name ? `${p.name} ${p.address ?? ''}`.trim() : `${p.lat},${p.lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
