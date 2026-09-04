/**
 * 製品版の未完成機能を安全に隠すためのフラグ。
 * すべてfalseがデフォルト（=見た目上は現行v1.0.3-namiと同じ）。
 * Phase2以降、機能が実際に使える状態になった時点で個別にtrueへ変更する。
 */

export interface FeatureFlags {
  cloudSyncEnabled: boolean;
  billingEnabled: boolean;
  nationwideEnabled: boolean;
  monetizationEnabled: boolean;
  advancedRouteEnabled: boolean;
}

export const DEFAULT_FLAGS: FeatureFlags = {
  cloudSyncEnabled: false,
  billingEnabled: false,
  nationwideEnabled: false,
  monetizationEnabled: false,
  advancedRouteEnabled: false,
};

export function resolveFeatureFlags(overrides?: Partial<FeatureFlags>): FeatureFlags {
  return { ...DEFAULT_FLAGS, ...overrides };
}
