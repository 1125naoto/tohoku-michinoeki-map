/**
 * 製品版の各providerをまとめる合成ルート。
 * Phase1はすべてローカル/no-op実装。後続Phaseで実サービスへ差し替える際は
 * ここだけを変更すればよく、呼び出し側（画面・lib）はインターフェースにしか依存しない。
 */
import { LocalOnlyAuthProvider, type AuthProvider } from '../auth/authProvider';
import type { BillingProvider } from '../billing/billingProvider';
import { UnavailableBillingProvider } from '../billing/billingProvider';
import { LocalOnlyCloudSyncProvider, type CloudSyncProvider } from '../cloud/cloudSyncProvider';
import { NullAnalyticsProvider, type AnalyticsProvider } from '../analytics/analyticsProvider';
import { ConsoleErrorReportingProvider, type ErrorReportingProvider } from '../errors/errorReportingProvider';
import { NullMonetizationProvider, type MonetizationProvider } from '../monetization/monetization';
import { DEFAULT_FLAGS, type FeatureFlags } from '../featureFlags/featureFlags';

export interface ProductContext {
  auth: AuthProvider;
  billing: BillingProvider;
  cloudSync: CloudSyncProvider;
  analytics: AnalyticsProvider;
  errors: ErrorReportingProvider;
  monetization: MonetizationProvider;
  flags: FeatureFlags;
}

export function createProductContext(flagOverrides?: Partial<FeatureFlags>): ProductContext {
  return {
    auth: new LocalOnlyAuthProvider(),
    billing: new UnavailableBillingProvider(),
    cloudSync: new LocalOnlyCloudSyncProvider(),
    analytics: new NullAnalyticsProvider(),
    errors: new ConsoleErrorReportingProvider(),
    monetization: new NullMonetizationProvider(),
    flags: { ...DEFAULT_FLAGS, ...flagOverrides },
  };
}
