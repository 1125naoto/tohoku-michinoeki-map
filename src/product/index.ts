/**
 * 製品版基盤モジュールのバレル export。
 * 既存アプリ(App.tsx等)からは意図的にまだimportしない
 * （Phase1は「安全に実装できる土台」までが目的で、既存UIへの組み込みはPhase2以降）。
 */
export * from './schema/version';
export * from './region/regions';
export * from './station/nationwideStation';
export * from './user/userModels';
export * from './user/migration';
export * from './entitlement/entitlement';
export * from './monetization/monetization';
export * from './billing/billingProvider';
export * from './auth/authProvider';
export * from './cloud/cloudSyncProvider';
export * from './analytics/analyticsProvider';
export * from './errors/errorReportingProvider';
export * from './featureFlags/featureFlags';
export * from './config/productConfig';
