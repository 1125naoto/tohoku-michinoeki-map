#!/usr/bin/env node
/**
 * 月額プラン（最初の2か月 250円/月 → 3か月目以降 500円/月）の契約に、Stripeの
 * Subscription Schedule を設定する（GitHub Actions の購入者ゲート同期ワークフローから実行）。
 * 判定はすべて scripts/introSchedulePlan.mjs（純関数・単体テスト済み）。ここはStripe呼び出しだけ。
 *
 * 認証（どちらか）:
 *  - 環境変数 STRIPE_CLI_PROJECT=<プロファイル名>: このPCでログイン済みのStripe CLIの認証（OSの資格情報ストアに
 *    保存され自動更新される）を使う。Ownerのローカル実行（scripts/local-billing-runner/）はこちら。
 *  - 環境変数 STRIPE_API_KEY: 制限付きキー（必要な権限は「Subscriptions: Write」だけ）。
 *  どちらも無ければ何もせず正常終了する。
 *
 * 安全性:
 *  - 何度実行しても同じ結果（設定済みのスケジュールは metadata で判別して何もしない。作成は
 *    契約ごとに固定の冪等キーで行い、二重作成しない）。
 *  - 購入者ゲート（active.json）の生成とは独立したステップ。ここが失敗しても既存のアクセス判定には影響しない。
 *  - 失敗しても顧客に不利な変更は起きない（切替が設定されないだけ＝250円のまま）。次回の実行で再試行する。
 */
import { execFileSync } from 'node:child_process';
import { INTRO_PRICE, planForSchedule, planForSubscription } from './introSchedulePlan.mjs';

// GitHub Secret への登録時にクリップボード由来の改行・空白・BOMが混ざっても動くように、前後を除去する
if (process.env.STRIPE_API_KEY) process.env.STRIPE_API_KEY = process.env.STRIPE_API_KEY.replace(/^[\s﻿]+|[\s﻿]+$/g, '');

const CLI_PROJECT = process.env.STRIPE_CLI_PROJECT || '';

const mask = (s) => String(s).replace(/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9*]+/g, '[KEY]');
const short = (id) => `${String(id).slice(0, 12)}…`;

function stripe(args) {
  let out;
  try {
    const profile = CLI_PROJECT ? ['--project-name', CLI_PROJECT] : [];
    out = execFileSync('stripe', [...profile, ...args, '--live'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
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

/**
 * 権限の自己診断（INTRO_SCHEDULE_PROBE=1 のときだけ。ワークフローの各実行の最初に1回）。
 * 存在しない契約IDでスケジュール作成を呼ぶ: 何も作られない。「No such subscription」なら書き込み権限あり、
 * 権限不足ならStripeのエラー本文に必要な権限名が出る（キーの値は出さない）。
 */
function probe() {
  try {
    stripe(['subscription_schedules', 'create', '-d', 'from_subscription=sub_permissionprobe000']);
    console.log('[intro-schedules] probe: unexpected success');
  } catch (err) {
    if (/No such subscription/.test(err.message)) console.log('[intro-schedules] probe: OK（Subscription Schedule の書き込み権限あり）');
    else {
      console.error('[intro-schedules] probe: NG:', err.message);
      process.exitCode = 1;
    }
  }
}

function main() {
  if (!process.env.STRIPE_API_KEY && !CLI_PROJECT) {
    console.log('[intro-schedules] 認証（STRIPE_CLI_PROJECT または STRIPE_API_KEY）が無いため何もしません。');
    return;
  }
  if (process.env.INTRO_SCHEDULE_PROBE === '1') {
    probe();
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
