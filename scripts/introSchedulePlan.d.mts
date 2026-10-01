// 型定義（src/lib/introSchedulePlan.test.ts から scripts/introSchedulePlan.mjs を読むため）
export const INTRO_PRICE: string;
export const REGULAR_PRICE: string;
export const INTRO_MONTHS: number;
export const INTRO_SCHEDULE_MARK: string;
export function monthsBetweenUtc(a: number, b: number): number;
export type SubscriptionPlan = { action: 'skip'; reason: string } | { action: 'create' } | { action: 'inspect_schedule'; scheduleId: string };
export type SchedulePlan = { action: 'skip'; reason: string } | { action: 'configure'; introMonthsRemaining: number; params: string[] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function planForSubscription(sub: any): SubscriptionPlan;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function planForSchedule(sub: any, schedule: any): SchedulePlan;
