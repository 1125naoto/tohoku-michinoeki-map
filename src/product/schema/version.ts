/**
 * 製品版データ層のスキーマバージョン管理。
 * 既存アプリの BACKUP_SCHEMA_VERSION（lib/backup.ts, localStorage用）とは別レイヤー。
 * 将来クラウド同期するUser/UserStationState/SavedRouteRef等はこちらを使う。
 */

export const CURRENT_SCHEMA_VERSION = 1;

export interface Versioned {
  schemaVersion: number;
}

export function isSupportedSchemaVersion(v: number): boolean {
  return Number.isInteger(v) && v >= 1 && v <= CURRENT_SCHEMA_VERSION;
}

/**
 * 各ステップは中間形状を型付けしない（バージョン間で形が変わるため）。
 * 最終形状の型付けは runMigrations<T>() の戻り値でのみ行う。
 */
export interface Migration {
  /** この移行が適用されるスキーマバージョン */
  from: number;
  to: number;
  migrate: (data: unknown) => unknown;
}

/**
 * dataのschemaVersionから target まで、登録されたmigrationsを順番に適用する。
 * 対応するmigrationが無い場合は例外を投げる（サイレントなデータ欠損を防ぐ）。
 */
export function runMigrations<T>(
  data: unknown,
  fromVersion: number,
  migrations: Migration[],
  target: number = CURRENT_SCHEMA_VERSION,
): T {
  let current: unknown = data;
  let version = fromVersion;
  while (version < target) {
    const step = migrations.find((m) => m.from === version);
    if (!step) {
      throw new Error(`schemaVersion ${version} → ${target} への移行経路が見つかりません`);
    }
    current = step.migrate(current);
    version = step.to;
  }
  return current as T;
}
