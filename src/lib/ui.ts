import type { AreaName, Prefecture, StatusFilter, Station, VisitMap } from '../types';
import { AREA_BY_PREFECTURE } from '../types';

/** 「地域」フィルターの値。都道府県単体、または地方全体（例: '東北'）のどちらか。 */
export type PrefOrAreaFilter = Prefecture | AreaName | null;

/** 指定の駅が、選択中の都道府県/地方フィルターに合致するか（未選択なら常にtrue） */
export function matchesPrefOrArea(st: Station, filter: PrefOrAreaFilter): boolean {
  if (!filter) return true;
  return st.pref === filter || AREA_BY_PREFECTURE[st.pref] === filter;
}

export const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  all: 'すべて',
  none: '未訪問',
  want: '行きたい',
  visited: '訪問済み',
  stamp: 'スタンプ済み',
};

/** 道の駅自体の施設条件フィルター。両方ONの場合はAND（両方ある駅のみ）。 */
export interface FacilityFilter {
  rvPark: boolean;
  onsen: boolean;
}

export const NO_FACILITY_FILTER: FacilityFilter = { rvPark: false, onsen: false };

export function isFacilityFilterActive(f: FacilityFilter): boolean {
  return f.rvPark || f.onsen;
}

/**
 * 施設フィルター判定。unknownは「ある」とはみなさない（ユーザーが「温泉あり」を選んだ場合、
 * 情報未確認の駅を誤って含めない）。フィルター自体を使わない場合（両方false）は常にtrue。
 */
export function matchesFacilityFilter(st: Station, filter: FacilityFilter): boolean {
  if (filter.rvPark && st.facilities?.rvPark !== 'yes') return false;
  if (filter.onsen && st.facilities?.onsen !== 'yes') return false;
  return true;
}

/** 絞り込みを閉じているときの1行サマリー（例: 「絞り込み：すべて・すべて」） */
export function filterSummary(
  pref: PrefOrAreaFilter,
  status: StatusFilter,
  query = '',
  facility: FacilityFilter = NO_FACILITY_FILTER,
): string {
  const q = query.trim();
  const facilityLabels = [facility.rvPark && 'RVパーク', facility.onsen && '温泉'].filter(
    (v): v is string => typeof v === 'string',
  );
  const facilityText = facilityLabels.length > 0 ? `・${facilityLabels.join('+')}あり` : '';
  return `絞り込み：${pref ?? 'すべて'}・${STATUS_FILTER_LABEL[status]}${facilityText}${q ? `・「${q}」` : ''}`;
}

/**
 * 駅名・読み・市町村名でのテキスト検索。全角/半角スペースは除去し、大文字小文字を無視する。
 * 空文字は「絞り込みなし」として常にtrueを返す。
 */
export function stationMatchesQuery(s: Station, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/[\s　]+/g, '');
  if (!q) return true;
  const haystacks = [s.name, s.kana ?? '', s.city].map((v) => v.toLowerCase().replace(/[\s　]+/g, ''));
  return haystacks.some((h) => h.includes(q));
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

/**
 * 地域・表示状態・テキスト検索の複合絞り込み（一覧タップで数秒で選べるようにするための中心関数）。
 * 各条件はAND結合。県未選択(null)・状態'all'・テキスト空はそれぞれ「絞り込みなし」を表す。
 */
export function filterStations(
  stations: Station[],
  visits: VisitMap,
  prefFilter: PrefOrAreaFilter,
  statusFilter: StatusFilter,
  query: string,
  facilityFilter: FacilityFilter = NO_FACILITY_FILTER,
): Station[] {
  return stations.filter(
    (s) =>
      matchesPrefOrArea(s, prefFilter) &&
      matchesFilter(s, visits, statusFilter) &&
      matchesFacilityFilter(s, facilityFilter) &&
      stationMatchesQuery(s, query),
  );
}
