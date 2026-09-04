import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, isSupportedSchemaVersion, runMigrations, type Migration } from './version';

describe('isSupportedSchemaVersion', () => {
  it('1以上CURRENT_SCHEMA_VERSION以下を許可する', () => {
    expect(isSupportedSchemaVersion(1)).toBe(true);
    expect(isSupportedSchemaVersion(CURRENT_SCHEMA_VERSION)).toBe(true);
  });
  it('0以下・整数でない値・未来のバージョンを拒否する', () => {
    expect(isSupportedSchemaVersion(0)).toBe(false);
    expect(isSupportedSchemaVersion(-1)).toBe(false);
    expect(isSupportedSchemaVersion(1.5)).toBe(false);
    expect(isSupportedSchemaVersion(CURRENT_SCHEMA_VERSION + 1)).toBe(false);
  });
});

describe('runMigrations', () => {
  interface V1 {
    name: string;
  }
  interface V2 {
    name: string;
    greeting: string;
  }
  interface V3 {
    name: string;
    greeting: string;
    version: number;
  }

  const migrations: Migration[] = [
    { from: 1, to: 2, migrate: (d) => ({ ...(d as V1), greeting: 'hello' }) },
    { from: 2, to: 3, migrate: (d) => ({ ...(d as V2), version: 3 }) },
  ];

  it('複数ステップを順番に適用する', () => {
    const result = runMigrations<V3>({ name: 'a' }, 1, migrations, 3);
    expect(result).toEqual({ name: 'a', greeting: 'hello', version: 3 });
  });

  it('すでに目標バージョンならそのまま返す', () => {
    const result = runMigrations<V1>({ name: 'a' }, 1, migrations, 1);
    expect(result).toEqual({ name: 'a' });
  });

  it('移行経路が無い場合は例外を投げる（サイレントなデータ欠損を防ぐ）', () => {
    expect(() => runMigrations({ name: 'a' }, 5, migrations, 6)).toThrow(/移行経路/);
  });
});
