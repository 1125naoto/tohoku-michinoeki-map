/**
 * QA/staging環境を本番/NAMIと同一origin（*.github.io）上で区別するための
 * localStorageキー接尾辞。
 *
 * GitHub Pagesはユーザーごとに1つのoriginを共有し、リポジトリごとの違いは
 * パスだけになる（例: https://1125naoto.github.io/tohoku-michinoeki-map/ と
 * https://1125naoto.github.io/tohoku-michinoeki-map-qa/ は別リポジトリだが
 * 同一origin）。localStorageはoriginごと（パスは区別しない）に共有されるため、
 * 同じブラウザで本番/NAMIとQAの両方を開くと、対策なしではvisits/routes/trip等の
 * 記録が混ざってしまう。
 *
 * 本番/NAMIビルドではVITE_STORAGE_NSを設定しないため、既存キー名は一切変更されない
 * （互換性維持・データ移行不要）。QAビルドのみビルド時に'qa'等を注入する。
 */
const NS = (import.meta.env.VITE_STORAGE_NS as string | undefined) || '';

export function nsKey(key: string): string {
  return NS ? `${key}:ns-${NS}` : key;
}
