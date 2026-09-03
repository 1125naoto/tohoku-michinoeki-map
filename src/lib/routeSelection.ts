/**
 * 「地図から選ぶ」の選択状態（順序つきID配列）に対する純粋関数群。
 * 番号は配列内の位置（index+1）でその都度決まるため、削除時の振り直しは
 * 配列から取り除くだけで自動的に成立する。React state からもテストからも
 * 同じロジックを使うためコンポーネントから切り離してある。
 */
import { MAX_MANUAL_STATIONS } from './manualRoute';

export type ToggleResult = 'added' | 'removed' | 'max-reached';

/**
 * 選択のトグル: 既に選択済みなら解除、未選択なら追加（上限到達時は追加せず理由を返す）。
 * 呼び出し側は候補を黙って捨てず、'max-reached' のときはユーザーへ上限を明示すること。
 */
export function toggleSelection(
  ids: string[],
  id: string,
  max: number = MAX_MANUAL_STATIONS,
): { ids: string[]; result: ToggleResult } {
  if (ids.includes(id)) {
    return { ids: ids.filter((x) => x !== id), result: 'removed' };
  }
  if (ids.length >= max) {
    return { ids, result: 'max-reached' };
  }
  return { ids: [...ids, id], result: 'added' };
}

export function removeSelection(ids: string[], id: string): string[] {
  return ids.filter((x) => x !== id);
}

export function clearSelection(): string[] {
  return [];
}

/** 上下ボタンによる並び替え（範囲外は何もしない） */
export function moveSelection(ids: string[], index: number, direction: -1 | 1): string[] {
  const target = index + direction;
  if (index < 0 || index >= ids.length || target < 0 || target >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
