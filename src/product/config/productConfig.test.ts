import { describe, expect, it } from 'vitest';
import { AuthNotAvailableError } from '../auth/authProvider';
import { BillingNotConfiguredError } from '../billing/billingProvider';
import { createProductContext } from './productConfig';

describe('createProductContext (Phase1のデフォルト構成)', () => {
  it('外部サービスなしで安全に生成できる', () => {
    expect(() => createProductContext()).not.toThrow();
  });

  it('auth: ローカル利用者は常に未サインイン、サインイン試行は明示的に例外', async () => {
    const ctx = createProductContext();
    expect(ctx.auth.getCurrentUser()).toBeNull();
    await expect(ctx.auth.signInWithGoogle()).rejects.toThrow(AuthNotAvailableError);
  });

  it('cloudSync: 未接続でpush/pullはno-op/null', async () => {
    const ctx = createProductContext();
    expect(ctx.cloudSync.isAvailable()).toBe(false);
    await expect(ctx.cloudSync.pullUserState('u1')).resolves.toBeNull();
    await expect(ctx.cloudSync.pushUserState('u1', {} as never)).resolves.toBeUndefined();
  });

  it('billing: 決済操作は明示的に「未設定」例外、購読状態照会は常にnone', async () => {
    const ctx = createProductContext();
    await expect(
      ctx.billing.createCheckoutSession({ userId: 'u1', planId: 'premium', interval: 'month' }),
    ).rejects.toThrow(BillingNotConfiguredError);
    const sub = await ctx.billing.getSubscription('u1');
    expect(sub.status).toBe('none');
    expect(sub.planId).toBe('free');
  });

  it('monetization: デフォルトは常にnull（掲載枠なし）', () => {
    const ctx = createProductContext();
    expect(ctx.monetization.getContent('MAP_BOTTOM')).toBeNull();
  });

  it('flags: overrideを反映する', () => {
    const ctx = createProductContext({ nationwideEnabled: true });
    expect(ctx.flags.nationwideEnabled).toBe(true);
    expect(ctx.flags.billingEnabled).toBe(false);
  });
});
