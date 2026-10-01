#!/usr/bin/env node
/**
 * 月額プラン（最初の2か月 250円/月 → 3か月目以降 500円/月）の契約に、Stripeの
 * Subscription Schedule を設定する（GitHub Actions の購入者ゲート同期ワークフローから実行）。
 * 判定はすべて scripts/introSchedulePlan.mjs（純関数・単体テスト済み）。ここはStripe呼び出しだけ。
 *
 * 認証: 環境変数 STRIPE_API_KEY（このステップでは GitHub Secret STRIPE_BILLING_WRITE_KEY を渡す）。
 *   必要な権限は Stripe の制限付きキーの「Subscriptions: Write」だけ（Subscriptionの一覧・取得と、
 *   Subscription Schedule の作成・取得・更新）。未設定なら何もせず正常終了する。
 *
 * 安全性:
 *  - 何度実行しても同じ結果（設定済みのスケジュールは metadata で判別して何もしない。作成は
 *    契約ごとに固定の冪等キーで行い、二重作成しない）。
 *  - 購入者ゲート（active.json）の生成とは独立したステップ。ここが失敗しても既存のアクセス判定には影響しない。
 *  - 失敗しても顧客に不利な変更は起きない（切替が設定されないだけ＝250円のまま）。次回の実行で再試行する。
 */
import { execFileSync } from 'node:child_process';
import { INTRO_PRICE, planForSchedule, planForSubscription } from './introSchedulePlan.mjs';

const mask = (s) => String(s).replace(/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9*]+/g, '[KEY]');
const short = (id) => `${String(id).slice(0, 12)}…`;

function stripe(args) {
  let out;
  try {
    out = execFileSync('stripe', [...args, '--live'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    // 権限不足のときは、Stripeのエラー本文に必要な権限が書かれている（キーの値は含めない）
    throw new Error(mask(`${err.stdout ?? ''} ${err.stderr ?? ''}`.trim() || err.message));
  }
  const json = JSON.parse(out.slice(out.indexOf('{')));
  if (json.error) throw new Error(mask(json.error.message ?? JSON.stringify(json.error)));
  return json;
}

function listIntroSubscriptions() {
  const subs = [];
  for (const status of ['active', 'past_due']) {
    let startingAfter;
    for (;;) {
      const args = ['subscriptions', 'list', '--price', INTRO_PRICE, '--status', status, '--limit', '100'];
      if (startingAfter) args.push('--starting-after', startingAfter);
      const page = stripe(args);
      subs.push(...page.data);
      if (!page.has_more || page.data.length === 0) break;
      startingAfter = page.data[page.data.length - 1].id;
    }
  }
  return subs;
}

function configure(sub, scheduleId) {
  const schedule = stripe(['subscription_schedules', 'retrieve', scheduleId]);
  const plan = planForSchedule(sub, schedule);
  if (plan.action !== 'configure') {
    console.log(`[intro-schedules] ${short(sub.id)}: skip (${plan.reason})`);
    return 'skipped';
  }
  stripe(['subscription_schedules', 'update', scheduleId, ...plan.params.flatMap((p) => ['-d', p])]);
  console.log(`[intro-schedules] ${short(sub.id)}: configured (250円をあと${plan.introMonthsRemaining}か月 → 500円/月)`);
  return 'configured';
}

function main() {
  if (!process.env.STRIPE_API_KEY) {
    console.log('[intro-schedules] STRIPE_BILLING_WRITE_KEY が未設定のため何もしません（月額プランの3か月目以降の切替は未設定のまま）。');
    return;
  }
  let subs;
  try {
    subs = listIntroSubscriptions();
  } catch (err) {
    console.error('[intro-schedules] 契約の取得に失敗しました（何も変更していません）:', err.message);
    process.exitCode = 1;
    return;
  }
  const counts = { configured: 0, skipped: 0, failed: 0 };
  for (const sub of subs) {
    try {
      const plan = planForSubscription(sub);
      if (plan.action === 'skip') {
        console.log(`[intro-schedules] ${short(sub.id)}: skip (${plan.reason})`);
        counts.skipped += 1;
        continue;
      }
      let scheduleId = plan.action === 'inspect_schedule' ? plan.scheduleId : null;
      if (plan.action === 'create') {
        // 契約ごとに固定の冪等キー: 同時実行・再実行でもスケジュールは1つだけ
        const created = stripe(['subscription_schedules', 'create', '-d', `from_subscription=${sub.id}`, '--idempotency', `michinoeki-intro-${sub.id}`]);
        scheduleId = created.id;
      }
      counts[configure(sub, scheduleId)] += 1;
    } catch (err) {
      counts.failed += 1;
      console.error(`[intro-schedules] ${short(sub.id)}: failed (次回の実行で再試行します):`, err.message);
    }
  }
  console.log(`[intro-schedules] intro subscriptions:${subs.length} configured:${counts.configured} skipped:${counts.skipped} failed:${counts.failed}`);
  if (counts.failed > 0) process.exitCode = 1;
}

main();
