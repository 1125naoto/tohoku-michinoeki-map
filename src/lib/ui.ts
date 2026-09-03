import type { Prefecture, StatusFilter } from '../types';

export const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  all: 'すべて',
  none: '未訪問',
  want: '行きたい',
  visited: '訪問済み',
  stamp: 'スタンプ済み',
};

/** 絞り込みを閉じているときの1行サマリー（例: 「絞り込み：東北全体・すべて」） */
export function filterSummary(pref: Prefecture | null, status: StatusFilter): string {
  return `絞り込み：${pref ?? '東北全体'}・${STATUS_FILTER_LABEL[status]}`;
}
