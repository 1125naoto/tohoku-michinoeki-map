/**
 * 決済（Stripe想定、月額300円程度）の抽象化。
 *
 * 重要: この層はフロントエンドから直接Stripe秘密鍵を扱わない。
 * createCheckoutSession/createPortalSession/webhook処理は将来サーバー（Cloudflare Workers/
 * Vercel Functions等）が担当し、フロントはそのHTTPSエンドポイントを呼ぶだけになる想定
 * （PRODUCT_ARCHITECTURE.md「決済アーキテクチャ」参照）。
 * Phase1では実サーバーが存在しないため、UnavailableBillingProviderが常に
 * 「未設定」エラーを返す（ユーザーに実アカウント操作を要求しない）。
 */
import type { PlanId } from '../entitlement/entitlement';

export type BillingInterval = 'month' | 'year';

export type SubscriptionStatus =
  | 'none'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete';

export interface Subscription {
  planId: PlanId;
  status: SubscriptionStatus;
  interval: BillingInterval | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export const NO_SUBSCRIPTION: Subscription = {
  planId: 'free',
  status: 'none',
  interval: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

export interface BillingProvider {
  createCheckoutSession(params: {
    userId: string;
    planId: Extract<PlanId, 'premium'>;
    interval: BillingInterval;
  }): Promise<{ url: string }>;
  createPortalSession(params: { userId: string }): Promise<{ url: string }>;
  getSubscription(userId: string): Promise<Subscription>;
}

export class BillingNotConfiguredError extends Error {
  constructor() {
    super('決済機能はこのビルドでは未設定です（Phase1: サーバー未構築）');
    this.name = 'BillingNotConfiguredError';
  }
}

/** Phase1のデフォルト実装。全員 'none'（無料）扱いで、操作しようとすると明示的に例外を返す */
export class UnavailableBillingProvider implements BillingProvider {
  async createCheckoutSession(): Promise<never> {
    throw new BillingNotConfiguredError();
  }
  async createPortalSession(): Promise<never> {
    throw new BillingNotConfiguredError();
  }
  async getSubscription(): Promise<Subscription> {
    return NO_SUBSCRIPTION;
  }
}
