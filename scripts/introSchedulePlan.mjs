/**
 * 月額プラン（最初の2か月 250円/月 → 3か月目以降 500円/月）の切替を、Stripeの
 * Subscription Schedule で設定するための「判定だけ」を行う純関数（副作用なし・単体テスト対象）。
 * 実際のStripe呼び出しは scripts/apply-intro-schedules.mjs が行う。
 *
 * 安全のための方針:
 *  - 対象は「月額プランの導入価格（INTRO_PRICE）1品目だけ」の有効な契約だけ。
 *    年間プラン・旧250円固定・その他の契約、NAMI の招待コード（Stripeの契約ではない）は一切触らない。
 *  - 解約予約済み（cancel_at_period_end）の契約は触らない（期間終了で終わるため）。
 *  - 既に別の仕組みで作られたスケジュールは触らない（自分が作った形と一致するときだけ設定する）。
 *  - 設定済み（metadata[INTRO_SCHEDULE_MARK] = 'configured'）なら何もしない → 何度実行しても同じ結果。
 */
export const INTRO_PRICE = 'price_1ULl7FICXxuNXmZymoNS8hQH'; // 月額プラン 最初の2か月 250円/月
export const REGULAR_PRICE = 'price_1ULkA5ICXxuNXmZyTAcQqpvZ'; // 月額プラン 3か月目以降 500円/月
export const INTRO_MONTHS = 2;
export const INTRO_SCHEDULE_MARK = 'michinoeki_intro_schedule';

const ACTIVE_STATUSES = new Set(['active', 'past_due']);

/** 契約の唯一の品目（2品目以上・品目なしは null） */
function singleItem(sub) {
  const items = sub?.items?.data ?? [];
  return items.length === 1 ? items[0] : null;
}

/**
 * UNIX秒 a（契約開始=請求サイクルの起点）から b（ある請求期間の開始）までの経過月数。
 * Stripeの月次請求は起点の「日」に揃う（月末は短い月で切り詰め: 1/31 → 2/28 → 3/31）ため、その切り詰めを考慮する。
 */
export function monthsBetweenUtc(a, b) {
  const da = new Date(a * 1000);
  const db = new Date(b * 1000);
  let months = (db.getUTCFullYear() - da.getUTCFullYear()) * 12 + (db.getUTCMonth() - da.getUTCMonth());
  const lastDayOfB = new Date(Date.UTC(db.getUTCFullYear(), db.getUTCMonth() + 1, 0)).getUTCDate();
  const clamped = db.getUTCDate() === lastDayOfB && da.getUTCDate() > lastDayOfB;
  if (db.getUTCDate() < da.getUTCDate() && !clamped) months -= 1;
  return Math.max(0, months);
}

/**
 * 契約を見て、スケジュールの作成が必要か判定する。
 * @returns {{ action: 'skip', reason: string } | { action: 'create' } | { action: 'inspect_schedule', scheduleId: string }}
 */
export function planForSubscription(sub) {
  if (!sub || sub.object !== 'subscription') return { action: 'skip', reason: 'not a subscription' };
  if (!ACTIVE_STATUSES.has(sub.status)) return { action: 'skip', reason: `status ${sub.status}` };
  const item = singleItem(sub);
  if (!item || item.price?.id !== INTRO_PRICE) return { action: 'skip', reason: 'not the monthly intro price' };
  if ((item.quantity ?? 1) !== 1) return { action: 'skip', reason: 'quantity is not 1' };
  if (sub.cancel_at_period_end) return { action: 'skip', reason: 'cancel_at_period_end' };
  const scheduleId = typeof sub.schedule === 'string' ? sub.schedule : sub.schedule?.id ?? null;
  if (scheduleId) return { action: 'inspect_schedule', scheduleId };
  return { action: 'create' };
}

/**
 * スケジュールを見て、500円への切替を設定すべきか判定し、設定する場合は更新パラメーター（stripe CLIの -d 形式）を返す。
 * @returns {{ action: 'skip', reason: string } | { action: 'configure', introMonthsRemaining: number, params: string[] }}
 */
export function planForSchedule(sub, schedule) {
  if (!schedule || schedule.object !== 'subscription_schedule') return { action: 'skip', reason: 'not a schedule' };
  if (schedule.metadata?.[INTRO_SCHEDULE_MARK] === 'configured') return { action: 'skip', reason: 'already configured' };
  if (schedule.status !== 'active') return { action: 'skip', reason: `schedule status ${schedule.status}` };
  // from_subscription で作った直後の形（現在の請求期間の1フェーズ・導入価格1品目）と一致するときだけ設定する
  const phases = schedule.phases ?? [];
  const items = phases[0]?.items ?? [];
  const phasePrice = typeof items[0]?.price === 'string' ? items[0].price : items[0]?.price?.id;
  if (phases.length !== 1 || items.length !== 1 || phasePrice !== INTRO_PRICE) {
    return { action: 'skip', reason: 'schedule was not created by this job (left untouched)' };
  }
  const phaseStart = phases[0].start_date;
  const anchor = sub.billing_cycle_anchor ?? sub.start_date;
  if (typeof phaseStart !== 'number' || typeof anchor !== 'number') return { action: 'skip', reason: 'missing dates' };
  // 現在の請求期間が何か月目か（0始まり）。導入価格は INTRO_MONTHS 回まで。
  // 万一遅れて3回目以降に入っていたら、現在の期間の終わりで切り替える（顧客に不利な変更はしない）
  const elapsed = monthsBetweenUtc(anchor, phaseStart);
  const introMonthsRemaining = Math.max(1, INTRO_MONTHS - elapsed);
  return {
    action: 'configure',
    introMonthsRemaining,
    params: [
      'end_behavior=release',
      'proration_behavior=none',
      `phases[0][start_date]=${phaseStart}`,
      `phases[0][items][0][price]=${INTRO_PRICE}`,
      'phases[0][items][0][quantity]=1',
      'phases[0][duration][interval]=month',
      `phases[0][duration][interval_count]=${introMonthsRemaining}`,
      'phases[0][proration_behavior]=none',
      `phases[1][items][0][price]=${REGULAR_PRICE}`,
      'phases[1][items][0][quantity]=1',
      'phases[1][duration][interval]=month',
      'phases[1][duration][interval_count]=1',
      'phases[1][proration_behavior]=none',
      `metadata[${INTRO_SCHEDULE_MARK}]=configured`,
    ],
  };
}

/** 切替（スケジュール）が未設定のまま、この日数を過ぎた月額プランの契約を警告する（3回目の請求は約60日後） */
export const ALERT_GRACE_DAYS = 3;

/**
 * 見守り用: 月額プランの導入価格の契約で、スケジュールが無いまま ALERT_GRACE_DAYS を過ぎているか。
 * （このPCのタスクが長期間止まっている・Stripe CLIのログインが切れている等の検知に使う）
 */
export function needsScheduleAlert(sub, nowSec, graceDays = ALERT_GRACE_DAYS) {
  if (planForSubscription(sub).action !== 'create') return false;
  const started = sub.start_date ?? sub.created;
  return typeof started === 'number' && nowSec - started > graceDays * 86400;
}
