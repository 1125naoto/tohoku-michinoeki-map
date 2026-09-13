import type { AreaName, Prefecture, StatusFilter, Station, VisitMap } from '../types';
import { AREA_BY_PREFECTURE, PREFECTURES } from '../types';

/**
 * 「都道府県」フィルターの値。複数選択可能（OR条件）。空配列は「全国（絞り込みなし）」を表す。
 * 単一選択だった旧仕様（実機フィードバックで「県境をまたぐ旅程で使いにくい」と指摘された）から
 * 複数選択へ変更した。
 */
export type SelectedPrefectures = Prefecture[];

/** 指定の地方に属する都道府県一覧（表示順はPREFECTURESの並びに従う） */
export function prefecturesInArea(area: AreaName): Prefecture[] {
  return PREFECTURES.filter((p) => AREA_BY_PREFECTURE[p] === area);
}

/** 指定の駅が、選択中の都道府県フィルターに合致するか（未選択=空配列なら常にtrue＝全国扱い） */
export function matchesSelectedPrefectures(st: Station, selected: SelectedPrefectures): boolean {
  if (selected.length === 0) return true;
  return selected.includes(st.pref);
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

/** 絞り込みを閉じているときの1行サマリー（例: 「絞り込み：全国・すべて」「絞り込み：青森県+秋田県・すべて」） */
export function filterSummary(
  selectedPrefectures: SelectedPrefectures,
  status: StatusFilter,
  query = '',
  facility: FacilityFilter = NO_FACILITY_FILTER,
): string {
  const q = query.trim();
  const facilityLabels = [facility.rvPark && 'RVパーク', facility.onsen && '温泉'].filter(
    (v): v is string => typeof v === 'string',
  );
  const facilityText = facilityLabels.length > 0 ? `・${facilityLabels.join('+')}あり` : '';
  const prefText = selectedPrefectures.length === 0 ? '全国' : selectedPrefectures.join('+');
  return `絞り込み：${prefText}・${STATUS_FILTER_LABEL[status]}${facilityText}${q ? `・「${q}」` : ''}`;
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
 * 都道府県・表示状態・テキスト検索の複合絞り込み（一覧タップで数秒で選べるようにするための中心関数）。
 * 各条件はAND結合。県未選択(空配列)・状態'all'・テキスト空はそれぞれ「絞り込みなし」を表す。
 * 都道府県は複数選択でき、選択中の都道府県どうしはOR（いずれかに該当すれば表示）。
 */
export function filterStations(
  stations: Station[],
  visits: VisitMap,
  selectedPrefectures: SelectedPrefectures,
  statusFilter: StatusFilter,
  query: string,
  facilityFilter: FacilityFilter = NO_FACILITY_FILTER,
): Station[] {
  return stations.filter(
    (s) =>
      matchesSelectedPrefectures(s, selectedPrefectures) &&
      matchesFilter(s, visits, statusFilter) &&
      matchesFacilityFilter(s, facilityFilter) &&
      stationMatchesQuery(s, query),
  );
}
