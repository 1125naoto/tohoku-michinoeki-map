import { describe, expect, it } from 'vitest';
import {
  INTRO_PRICE,
  INTRO_SCHEDULE_MARK,
  REGULAR_PRICE,
  monthsBetweenUtc,
  needsScheduleAlert,
  planForSchedule,
  planForSubscription,
} from '../../scripts/introSchedulePlan.mjs';

const ts = (iso: string) => Date.parse(iso) / 1000;
const ANCHOR = ts('2026-10-05T03:00:00Z');

function sub(over: Record<string, unknown> = {}) {
  return {
    object: 'subscription',
    id: 'sub_test',
    status: 'active',
    cancel_at_period_end: false,
    schedule: null,
    start_date: ANCHOR,
    billing_cycle_anchor: ANCHOR,
    items: { data: [{ price: { id: INTRO_PRICE }, quantity: 1 }] },
    ...over,
  };
}

function freshSchedule(phaseStart = ANCHOR, over: Record<string, unknown> = {}) {
  return {
    object: 'subscription_schedule',
    id: 'sub_sched_test',
    status: 'active',
    metadata: {},
    phases: [{ start_date: phaseStart, end_date: phaseStart + 30 * 86400, items: [{ price: INTRO_PRICE, quantity: 1 }] }],
    ...over,
  };
}

const param = (params: string[], key: string) => params.find((p) => p.startsWith(`${key}=`))?.split('=')[1];

describe('planForSubscription（どの契約を対象にするか）', () => {
  it('月額プランの導入価格で、スケジュール未設定なら作成する', () => {
    expect(planForSubscription(sub())).toEqual({ action: 'create' });
  });

  it('既にスケジュールがあれば作成せず、中身を確認する（二重作成しない）', () => {
    expect(planForSubscription(sub({ schedule: 'sub_sched_x' }))).toEqual({ action: 'inspect_schedule', scheduleId: 'sub_sched_x' });
  });

  it('年間プラン・500円の月額・旧250円固定の契約は対象外', () => {
    for (const price of ['price_1ULkA7ICXxuNXmZybRGXYs1h', REGULAR_PRICE, 'price_1UHH2vICXxuNXmZyr0tSquxk']) {
      expect(planForSubscription(sub({ items: { data: [{ price: { id: price }, quantity: 1 }] } })).action).toBe('skip');
    }
  });

  it('解約予約済み・解約済み・品目が複数・数量が1以外は対象外', () => {
    expect(planForSubscription(sub({ cancel_at_period_end: true })).action).toBe('skip');
    expect(planForSubscription(sub({ status: 'canceled' })).action).toBe('skip');
    expect(planForSubscription(sub({ items: { data: [{ price: { id: INTRO_PRICE } }, { price: { id: INTRO_PRICE } }] } })).action).toBe('skip');
    expect(planForSubscription(sub({ items: { data: [{ price: { id: INTRO_PRICE }, quantity: 2 }] } })).action).toBe('skip');
  });

  it('支払い遅延中（past_due）は対象（切替の設定は顧客に不利な変更ではない）', () => {
    expect(planForSubscription(sub({ status: 'past_due' })).action).toBe('create');
  });
});

describe('planForSchedule（250円×2回 → 500円の設定内容）', () => {
  it('1か月目に設定: 導入価格のフェーズを2か月、その後500円、終了後は契約をそのまま継続（release）', () => {
    const plan = planForSchedule(sub(), freshSchedule());
    expect(plan.action).toBe('configure');
    if (plan.action !== 'configure') return;
    expect(plan.introMonthsRemaining).toBe(2);
    expect(param(plan.params, 'phases[0][start_date]')).toBe(String(ANCHOR));
    expect(param(plan.params, 'phases[0][items][0][price]')).toBe(INTRO_PRICE);
    expect(param(plan.params, 'phases[0][duration][interval]')).toBe('month');
    expect(param(plan.params, 'phases[0][duration][interval_count]')).toBe('2');
    expect(param(plan.params, 'phases[1][items][0][price]')).toBe(REGULAR_PRICE);
    expect(param(plan.params, 'end_behavior')).toBe('release');
    expect(param(plan.params, 'proration_behavior')).toBe('none');
    expect(param(plan.params, `metadata[${INTRO_SCHEDULE_MARK}]`)).toBe('configured');
    expect(plan.params.some((p) => p.startsWith('phases[2]'))).toBe(false);
  });

  it('遅れて2か月目に設定された場合は、導入価格はあと1か月だけ（合計2回を超えない）', () => {
    const plan = planForSchedule(sub(), freshSchedule(ts('2026-11-05T03:00:00Z')));
    expect(plan.action === 'configure' && plan.introMonthsRemaining).toBe(1);
  });

  it('万一3か月目以降に入っていても、現在の期間の終わりで500円に切り替える', () => {
    const plan = planForSchedule(sub(), freshSchedule(ts('2026-12-05T03:00:00Z')));
    expect(plan.action === 'configure' && plan.introMonthsRemaining).toBe(1);
  });

  it('設定済み（metadataあり）なら何もしない＝何度実行しても同じ結果', () => {
    expect(planForSchedule(sub(), freshSchedule(ANCHOR, { metadata: { [INTRO_SCHEDULE_MARK]: 'configured' } })).action).toBe('skip');
  });

  it('このジョブが作った形でないスケジュール（複数フェーズ・別価格・終了済み）は触らない', () => {
    const two = freshSchedule();
    two.phases = [...two.phases, { start_date: ANCHOR + 1, end_date: ANCHOR + 2, items: [{ price: REGULAR_PRICE, quantity: 1 }] }];
    expect(planForSchedule(sub(), two).action).toBe('skip');
    expect(planForSchedule(sub(), freshSchedule(ANCHOR, { phases: [{ start_date: ANCHOR, items: [{ price: REGULAR_PRICE }] }] })).action).toBe('skip');
    expect(planForSchedule(sub(), freshSchedule(ANCHOR, { status: 'released' })).action).toBe('skip');
  });
});

describe('monthsBetweenUtc（Stripeの月次請求日との対応）', () => {
  it('同じ日なら0、翌月の同じ日なら1', () => {
    expect(monthsBetweenUtc(ANCHOR, ANCHOR)).toBe(0);
    expect(monthsBetweenUtc(ANCHOR, ts('2026-11-05T03:00:00Z'))).toBe(1);
    expect(monthsBetweenUtc(ANCHOR, ts('2027-01-05T03:00:00Z'))).toBe(3);
  });

  it('月末起点は短い月で切り詰められる（1/31 → 2/28 は1か月、3/31 は2か月）', () => {
    const jan31 = ts('2027-01-31T00:00:00Z');
    expect(monthsBetweenUtc(jan31, ts('2027-02-28T00:00:00Z'))).toBe(1);
    expect(monthsBetweenUtc(jan31, ts('2027-03-31T00:00:00Z'))).toBe(2);
  });
});

describe('needsScheduleAlert（PCのタスクが止まっている等の見守り）', () => {
  const day = 86400;
  it('切替が未設定のまま3日を過ぎた導入価格の契約だけを警告する', () => {
    expect(needsScheduleAlert(sub(), ANCHOR + 4 * day)).toBe(true);
    expect(needsScheduleAlert(sub(), ANCHOR + 2 * day)).toBe(false); // まだ猶予内
  });
  it('スケジュール設定済み・年間プラン・解約予約済みは警告しない', () => {
    expect(needsScheduleAlert(sub({ schedule: 'sub_sched_x' }), ANCHOR + 30 * day)).toBe(false);
    expect(needsScheduleAlert(sub({ items: { data: [{ price: { id: 'price_1ULkA7ICXxuNXmZybRGXYs1h' }, quantity: 1 }] } }), ANCHOR + 30 * day)).toBe(false);
    expect(needsScheduleAlert(sub({ cancel_at_period_end: true }), ANCHOR + 30 * day)).toBe(false);
  });
});
