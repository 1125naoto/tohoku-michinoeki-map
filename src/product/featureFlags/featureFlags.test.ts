import { describe, expect, it } from 'vitest';
import { DEFAULT_FLAGS, resolveFeatureFlags } from './featureFlags';

describe('DEFAULT_FLAGS', () => {
  it('すべてfalse（現行v1.0.3-namiと見た目上同じ挙動になる）', () => {
    for (const v of Object.values(DEFAULT_FLAGS)) {
      expect(v).toBe(false);
    }
  });
});

describe('resolveFeatureFlags', () => {
  it('overrideなしはDEFAULT_FLAGSと同じ', () => {
    expect(resolveFeatureFlags()).toEqual(DEFAULT_FLAGS);
  });
  it('指定したフラグだけを上書きする', () => {
    const flags = resolveFeatureFlags({ cloudSyncEnabled: true });
    expect(flags.cloudSyncEnabled).toBe(true);
    expect(flags.billingEnabled).toBe(false);
  });
});
