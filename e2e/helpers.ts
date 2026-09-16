import type { Page } from '@playwright/test';

/** 地域選択（「どこを旅しますか？」）の保存キー。src/lib/areaSelection.ts と一致させる */
export const AREA_SELECTION_KEY = 'tohoku-me:area-selection:v1';

/**
 * 初回起動の地域選択画面（「どこを旅しますか？」）を出さない状態にする。
 *
 * 既存シナリオは「起動したら全国の地図」を前提にしているため、テスト側で
 * 「全国を見る」を選択済み（空配列＝絞り込みなし）として扱う。
 * 地域選択画面そのものの挙動は e2e/region-landing.spec.ts で検証する。
 * 訪問記録・保存ルート等の既存キーには一切触れない。
 */
export async function useNationwideSelection(page: Page) {
  await page.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* noop */
      }
    },
    [AREA_SELECTION_KEY, JSON.stringify({ prefectures: [] })] as const,
  );
}
