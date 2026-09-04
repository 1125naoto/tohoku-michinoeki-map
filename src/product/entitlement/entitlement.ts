/**
 * FREE/PREMIUM の機能出し分けを中央集約する。
 * 画面側に if (isPremium) を散らばらせず、必ずここを経由して判定する。
 * プラン内容・価格が変わっても、この表を更新するだけでアプリ全体に反映される設計。
 */

export const FEATURES = [
  'MAP',
  'VISIT_TRACKING',
  'STAMP_TRACKING',
  'BASIC_NEARBY',
  'ADVANCED_ROUTE',
  'CLOUD_SYNC',
  'UNLIMITED_SAVED_ROUTES',
  'NATIONWIDE',
  'PHOTO_LOG',
  'MEMO',
  'AD_FREE',
  'SHARING',
] as const;
export type FeatureId = (typeof FEATURES)[number];

export type PlanId = 'free' | 'premium';

const FREE_FEATURES: FeatureId[] = ['MAP', 'VISIT_TRACKING', 'STAMP_TRACKING', 'BASIC_NEARBY'];

export const PLAN_FEATURES: Record<PlanId, ReadonlySet<FeatureId>> = {
  free: new Set(FREE_FEATURES),
  premium: new Set(FEATURES),
};

export function hasFeature(plan: PlanId, feature: FeatureId): boolean {
  return PLAN_FEATURES[plan].has(feature);
}

export function entitlementsFor(plan: PlanId): ReadonlySet<FeatureId> {
  return PLAN_FEATURES[plan];
}

/** 無料プランでの保存ルート数の上限（PREMIUMは無制限）。UNLIMITED_SAVED_ROUTESの実際の運用値 */
export const FREE_SAVED_ROUTE_LIMIT = 3;

export function canSaveMoreRoutes(plan: PlanId, currentCount: number): boolean {
  if (hasFeature(plan, 'UNLIMITED_SAVED_ROUTES')) return true;
  return currentCount < FREE_SAVED_ROUTE_LIMIT;
}
