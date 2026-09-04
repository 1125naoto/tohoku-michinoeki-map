import type { Prefecture, StatusFilter, Station, VisitMap } from '../types';

export const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  all: 'すべて',
  none: '未訪問',
  want: '行きたい',
  visited: '訪問済み',
  stamp: 'スタンプ済み',
};

/** 絞り込みを閉じているときの1行サマリー（例: 「絞り込み：東北全体・すべて」） */
export function filterSummary(pref: Prefecture | null, status: StatusFilter, query = ''): string {
  const q = query.trim();
  return `絞り込み：${pref ?? '東北全体'}・${STATUS_FILTER_LABEL[status]}${q ? `・「${q}」` : ''}`;
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
  prefFilter: Prefecture | null,
  statusFilter: StatusFilter,
  query: string,
): Station[] {
  return stations.filter(
    (s) =>
      (!prefFilter || s.pref === prefFilter) &&
      matchesFilter(s, visits, statusFilter) &&
      stationMatchesQuery(s, query),
  );
}
