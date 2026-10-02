#!/usr/bin/env node
/**
 * 見守り: 月額プラン（最初の2か月 250円/月）の契約で、3か月目からの500円への切替（Subscription Schedule）が
 * 未設定のまま ALERT_GRACE_DAYS 日を過ぎたものがあれば、GitHub の Issue を1つ開いて Owner に通知する
 * （GitHubからメール通知が届く）。解消したら Issue を自動で閉じる。
 *
 * 切替の設定自体は、OwnerのPCのタスク（scripts/local-billing-runner/）が Stripe CLI のログインで行う。
 * このスクリプトは、そのタスクが長期間止まっている・ログインが切れている等を検知するためのもの。
 *
 * 認証: 購入者ゲート同期と同じ読み取り専用キー（STRIPE_API_KEY。Subscriptions: Read）と GH_TOKEN（issues: write）。
 * 公開リポジトリのIssueなので、契約ID・顧客情報は書かない（件数と経過日数だけ）。
 */
import { execFileSync } from 'node:child_process';
import { ALERT_GRACE_DAYS, INTRO_PRICE, needsScheduleAlert } from './introSchedulePlan.mjs';

const TITLE = '【要確認】月額プランの3か月目からの料金切替が未設定の契約があります';
const mask = (s) => String(s).replace(/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9*]+/g, '[KEY]');

function stripe(args) {
  const out = execFileSync('stripe', [...args, '--live'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out.slice(out.indexOf('{')));
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function main() {
  if (!process.env.STRIPE_API_KEY) {
    console.log('[intro-watch] STRIPE_API_KEY が無いため確認しません。');
    return;
  }
  const subs = [];
  for (const status of ['active', 'past_due']) {
    let after;
    for (;;) {
      const args = ['subscriptions', 'list', '--price', INTRO_PRICE, '--status', status, '--limit', '100'];
      if (after) args.push('--starting-after', after);
      const page = stripe(args);
      subs.push(...page.data);
      if (!page.has_more || page.data.length === 0) break;
      after = page.data[page.data.length - 1].id;
    }
  }
  const now = Math.floor(Date.now() / 1000);
  const late = subs.filter((s) => needsScheduleAlert(s, now));
  const oldestDays = late.length ? Math.floor(Math.max(...late.map((s) => now - (s.start_date ?? s.created))) / 86400) : 0;
  console.log(`[intro-watch] intro subscriptions:${subs.length} without switch after ${ALERT_GRACE_DAYS} days:${late.length}`);

  const open = JSON.parse(gh(['issue', 'list', '--state', 'open', '--search', `${TITLE} in:title`, '--json', 'number,title']) || '[]').filter((i) => i.title === TITLE);
  if (late.length > 0 && open.length === 0) {
    const body = [
      `月額プラン（最初の2か月 250円/月）の契約のうち **${late.length}件** で、3か月目から500円/月へ切り替える設定（Stripe Subscription Schedule）が、購入から${ALERT_GRACE_DAYS}日以上たっても未設定です（最も古いもので購入から${oldestDays}日）。`,
      '',
      '切替の設定は、OwnerのPCのタスク「MichinoekiNavi Billing Runner」が Stripe CLI のログインで行います。PCが長く起動していない、または Stripe CLI のログインが切れている可能性があります。',
      '',
      '- 3回目の請求（購入から約60日後）までに設定されれば、料金は予定どおり切り替わります（それまで顧客は250円/月のまま＝顧客に不利な変更は起きません）。',
      '- 対応: Claude Code に「料金切替の見守りIssueが来た」と伝えてください。',
      '',
      'このIssueは、未設定の契約がなくなると自動で閉じます。',
    ].join('\n');
    console.log('[intro-watch] opened issue:', gh(['issue', 'create', '--title', TITLE, '--body', body]));
  } else if (late.length === 0 && open.length > 0) {
    for (const i of open) gh(['issue', 'close', String(i.number), '--comment', '未設定の契約がなくなったため、自動で閉じます。']);
    console.log('[intro-watch] closed resolved issue(s):', open.map((i) => i.number).join(','));
  }
}

try {
  main();
} catch (err) {
  console.error('[intro-watch] failed (次の実行で再試行):', mask(`${err.stdout ?? ''} ${err.stderr ?? ''} ${err.message}`).slice(0, 500));
  process.exitCode = 1;
}
