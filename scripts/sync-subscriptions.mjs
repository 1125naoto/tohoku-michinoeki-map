#!/usr/bin/env node
/**
 * 道の駅ナビ全国版の購入者ゲート同期スクリプト。GitHub Actions（推奨・スケジュール実行）と
 * ローカル実行の両方で動く、状態を持たない（stateless）設計。
 *
 * `stripe` CLIだけを使い、道の駅ナビの正式Payment Link（PAYMENT_LINK）に紐づく
 * Checkout Session／対象Price（PRICE_ID）のSubscriptionだけを読み取る
 * （他プロダクトのデータには一切アクセスしない）。
 *
 * 認証: GitHub Actions実行時は環境変数 STRIPE_API_KEY（GitHub Secretsに保存された、
 * Stripeダッシュボードで作成する読み取り専用の restricted key）を `stripe` CLIが自動的に
 * 使う。ローカル実行時は、このPCで既にログイン済みのCLIセッションがそのまま使われる
 * （どちらの場合も、このスクリプト自身は生のAPIキーを一切扱わない・保存しない）。
 * STRIPE_API_KEYが無く、かつローカルCLIログインも無い場合は何もせず終了する
 * （fail-closed: 前回公開済みのactive.jsonはそのまま。新しい有効化はできないが、
 * 既存の有効なアクセスを誤って剥奪することもない）。
 *
 * 毎回すべてのデータを再取得する（ボリュームが小さい前提。増えたら --created 絞り込みを
 * 検討する）。生のsession_id／subscription_idは一切公開せず、SHA-256ハッシュだけを
 * public/access-control/active.json へ書き出す。
 *
 * ナミちゃんの無料アクセス: 環境変数 NAMI_ACCESS_CODE（GitHub Secrets）、または
 * ローカルのdata/access-control/manual-grants.local.json（gitignore済み、コミットしない）
 * に書かれた招待コードのハッシュを、常に「有効」として同じ配列に加える。
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PAYMENT_LINK = 'plink_1UHH4SICXxuNXmZyihmdzOho';
const PRICE_ID = 'price_1UHH2vICXxuNXmZyr0tSquxk';
const MANUAL_GRANTS_PATH = join(ROOT, 'data/access-control/manual-grants.local.json');
const ACTIVE_JSON_PATH = join(ROOT, 'public/access-control/active.json');
const IN_CI = process.env.GITHUB_ACTIONS === 'true';

function hasStripeAuth() {
  if (process.env.STRIPE_API_KEY) return true;
  if (IN_CI) return false; // CIにはローカルCLIログインは存在しない
  try {
    execFileSync('stripe', ['config', '--list'], { encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

function stripe(args) {
  const out = execFileSync('stripe', [...args, '--live'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(out);
}

function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJsonPretty(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function listAll(fetchPage) {
  const items = [];
  let startingAfter;
  for (;;) {
    const page = fetchPage(startingAfter);
    items.push(...page.data);
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return items;
}

function fetchSessionToSubscriptionMap() {
  const sessions = listAll((startingAfter) => {
    const args = ['checkout', 'sessions', 'list', '--payment-link', PAYMENT_LINK, '--status', 'complete', '--limit', '100'];
    if (startingAfter) args.push('--starting-after', startingAfter);
    return stripe(args);
  });
  const map = {};
  for (const s of sessions) if (typeof s.subscription === 'string') map[s.id] = s.subscription;
  return map;
}

function fetchActiveSubscriptionIds() {
  const subs = listAll((startingAfter) => {
    const args = ['subscriptions', 'list', '--price', PRICE_ID, '--status', 'active', '--limit', '100'];
    if (startingAfter) args.push('--starting-after', startingAfter);
    return stripe(args);
  });
  return new Set(subs.map((s) => s.id));
}

function manualGrantSecrets() {
  const secrets = [];
  if (process.env.NAMI_ACCESS_CODE) secrets.push(process.env.NAMI_ACCESS_CODE);
  for (const grant of loadJson(MANUAL_GRANTS_PATH, [])) {
    if (typeof grant.secret === 'string' && grant.secret) secrets.push(grant.secret);
  }
  return secrets;
}

function main() {
  if (!hasStripeAuth()) {
    console.log('[sync-subscriptions] STRIPE_API_KEYが未設定・ローカルCLI未ログイン。何もせず終了します（fail-closed）。');
    return;
  }

  let sessionMap;
  let activeIds;
  try {
    sessionMap = fetchSessionToSubscriptionMap();
    activeIds = fetchActiveSubscriptionIds();
  } catch (err) {
    console.error('[sync-subscriptions] Stripe取得に失敗。active.jsonは変更しません（fail-closed）:', err.message);
    process.exitCode = 1;
    return;
  }

  const hashes = new Set();
  for (const [sessionId, subId] of Object.entries(sessionMap)) {
    if (activeIds.has(subId)) hashes.add(sha256Hex(sessionId));
  }
  for (const secret of manualGrantSecrets()) hashes.add(sha256Hex(secret));

  const nextActive = Array.from(hashes).sort();
  const prevActive = loadJson(ACTIVE_JSON_PATH, []);
  const changed = JSON.stringify(nextActive) !== JSON.stringify(prevActive);
  saveJsonPretty(ACTIVE_JSON_PATH, nextActive);

  console.log(
    `[sync-subscriptions] sessions:${Object.keys(sessionMap).length} active subscriptions:${activeIds.size} manual grants:${manualGrantSecrets().length} -> active.json entries:${nextActive.length} (${changed ? '更新あり' : '変更なし'})`,
  );

  if (!changed) return;

  const gitUser = IN_CI ? ['github-actions[bot]', 'github-actions[bot]@users.noreply.github.com'] : null;
  if (gitUser) {
    execFileSync('git', ['config', 'user.name', gitUser[0]], { cwd: ROOT, stdio: 'inherit' });
    execFileSync('git', ['config', 'user.email', gitUser[1]], { cwd: ROOT, stdio: 'inherit' });
  }
  execFileSync('git', ['add', 'public/access-control/active.json'], { cwd: ROOT, stdio: 'inherit' });
  execFileSync('git', ['commit', '-m', '購入者ゲート: 有効な契約者一覧を同期（自動生成）'], { cwd: ROOT, stdio: 'inherit' });
  execFileSync('git', ['push'], { cwd: ROOT, stdio: 'inherit' });
  // 既定のGITHUB_TOKENによるpushはdeploy.ymlのon:pushを起動しない（GitHub Actionsの仕様。
  // refresh-poi-cache.ymlと同じ既知の挙動）。CI/ローカルどちらでも明示的に起動する。
  execFileSync('gh', ['workflow', 'run', 'deploy.yml', '--ref', 'main'], { cwd: ROOT, stdio: 'inherit' });
}

main();
