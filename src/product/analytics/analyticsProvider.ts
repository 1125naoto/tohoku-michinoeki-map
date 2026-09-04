/**
 * 利用状況計測の抽象化。個人が特定できる情報(PII)はtrack/identifyに渡さない前提
 * （プライバシー配慮。PRODUCT_ARCHITECTURE.md「Analytics/Error方針」参照）。
 */

export type AnalyticsPropValue = string | number | boolean;

export interface AnalyticsEvent {
  name: string;
  props?: Record<string, AnalyticsPropValue>;
}

export interface AnalyticsProvider {
  track(event: AnalyticsEvent): void;
  identify(userId: string, traits?: Record<string, AnalyticsPropValue>): void;
}

/** Phase1のデフォルト実装。何もしない（後続Phaseで実サービスへ差し替える） */
export class NullAnalyticsProvider implements AnalyticsProvider {
  track(): void {}
  identify(): void {}
}
