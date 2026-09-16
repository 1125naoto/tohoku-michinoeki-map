/**
 * 「どこを旅しますか？」で選んだ地域（都道府県の集合）の保存。
 *
 * 全国1,237施設を初回から地図に出すと初見では情報量が多すぎるため、初回だけ
 * 地域選択を入口にする。一度選んだら次回起動時は前回の状態から再開できるよう、
 * ここに保存する。
 *
 * 重要: 既存キー（visits/routes/trip/map-settings）には一切触れない新規キーのみを使う。
 * 既存ユーザーの訪問済み・行きたい・スタンプ・保存ルート・設定は本モジュールの
 * 読み書きでは変化しない。保存に失敗しても「地図の初期表示範囲を覚えられない」だけで、
 * 記録側には影響しないため、例外は握りつぶして既定動作（全国）へフォールバックする。
 */
import { PREFECTURES, type Prefecture } from '../types';
import { nsKey } from './storageNamespace';

export const AREA_SELECTION_KEY = nsKey('tohoku-me:area-selection:v1');

export interface AreaSelection {
  /** 選択中の都道府県。空配列＝「全国を見る」を選んだ状態（絞り込みなし） */
  prefectures: Prefecture[];
}

const KNOWN_PREFECTURES = new Set<string>(PREFECTURES);

/**
 * 保存済みの選択を読む。
 * null は「まだ一度も選んでいない（初回起動）」を意味し、地域選択画面を出す条件になる。
 * 壊れた値・未知の県名が入っていた場合も落とさず、既知の県名だけを残す。
 */
export function loadAreaSelection(): AreaSelection | null {
  try {
    const raw = localStorage.getItem(AREA_SELECTION_KEY);
    if (raw == null) return null;
    const parsed = JSON.parse(raw) as Partial<AreaSelection> | null;
    if (!parsed || !Array.isArray(parsed.prefectures)) return null;
    return {
      prefectures: parsed.prefectures.filter(
        (v): v is Prefecture => typeof v === 'string' && KNOWN_PREFECTURES.has(v),
      ),
    };
  } catch {
    return null;
  }
}

/** 選択を保存する（空配列＝全国もひとつの選択として保存し、次回は地域選択画面を出さない） */
export function saveAreaSelection(prefectures: Prefecture[]): void {
  try {
    localStorage.setItem(AREA_SELECTION_KEY, JSON.stringify({ prefectures } satisfies AreaSelection));
  } catch {
    /* noop（訪問記録等には影響しない） */
  }
}
