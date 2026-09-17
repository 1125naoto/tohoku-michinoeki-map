import type { Page } from '@playwright/test';

/** 地域選択（「どこを旅しますか？」）の保存キー。src/lib/areaSelection.ts と一致させる */
export const AREA_SELECTION_KEY = 'tohoku-me:area-selection:v1';

/** 同一セッション内で地域選択を通過した印。src/lib/areaSelection.ts と一致させる */
export const AREA_SESSION_KEY = 'tohoku-me:area-session:v1';

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
    ([key, value, sessionKey]) => {
      try {
        localStorage.setItem(key, value);
        // このセッションでは地域選択を通過済み扱いにする（COLD STARTの入口画面を出さない）
        sessionStorage.setItem(sessionKey, '1');
      } catch {
        /* noop */
      }
    },
    [AREA_SELECTION_KEY, JSON.stringify({ prefectures: [] }), AREA_SESSION_KEY] as const,
  );
}

/**
 * 指定した都道府県を表示中の状態から始める。
 *
 * 地図選択のシナリオは全国1,237件のマーカーを描画したまま何度も地図を動かすため、
 * テスト1件あたりの描画コストが大きく、実行環境が混むと60秒のテスト予算を
 * 使い切って別々の箇所でタイムアウトしていた（製品側の不具合ではない）。
 * 対象駅が属する県だけを表示すれば、検証内容を変えずにマーカー数を大幅に減らせる。
 */
export async function useSelectedPrefectures(page: Page, prefectures: string[]) {
  await page.addInitScript(
    ([key, value, sessionKey]) => {
      try {
        localStorage.setItem(key, value);
        sessionStorage.setItem(sessionKey, '1');
      } catch {
        /* noop */
      }
    },
    [AREA_SELECTION_KEY, JSON.stringify({ prefectures }), AREA_SESSION_KEY] as const,
  );
}
