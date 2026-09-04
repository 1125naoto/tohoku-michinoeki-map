import { describe, expect, it } from 'vitest';
import { canSaveMoreRoutes, entitlementsFor, FEATURES, FREE_SAVED_ROUTE_LIMIT, hasFeature } from './entitlement';

describe('hasFeature', () => {
  it('無料プランは基本機能のみ', () => {
    expect(hasFeature('free', 'MAP')).toBe(true);
    expect(hasFeature('free', 'VISIT_TRACKING')).toBe(true);
    expect(hasFeature('free', 'STAMP_TRACKING')).toBe(true);
    expect(hasFeature('free', 'BASIC_NEARBY')).toBe(true);
  });
  it('無料プランは有料限定機能を持たない', () => {
    expect(hasFeature('free', 'CLOUD_SYNC')).toBe(false);
    expect(hasFeature('free', 'NATIONWIDE')).toBe(false);
    expect(hasFeature('free', 'ADVANCED_ROUTE')).toBe(false);
    expect(hasFeature('free', 'AD_FREE')).toBe(false);
  });
  it('有料プランは全機能を持つ', () => {
    for (const f of FEATURES) {
      expect(hasFeature('premium', f)).toBe(true);
    }
  });
});

describe('entitlementsFor', () => {
  it('プランごとの機能集合を返す', () => {
    expect(entitlementsFor('free').size).toBeLessThan(entitlementsFor('premium').size);
    expect(entitlementsFor('premium').size).toBe(FEATURES.length);
  });
});

describe('canSaveMoreRoutes', () => {
  it('無料プランは上限未満のみ保存できる', () => {
    expect(canSaveMoreRoutes('free', 0)).toBe(true);
    expect(canSaveMoreRoutes('free', FREE_SAVED_ROUTE_LIMIT - 1)).toBe(true);
    expect(canSaveMoreRoutes('free', FREE_SAVED_ROUTE_LIMIT)).toBe(false);
  });
  it('有料プランは常に保存できる（無制限）', () => {
    expect(canSaveMoreRoutes('premium', 9999)).toBe(true);
  });
});
