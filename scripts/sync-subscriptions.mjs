#!/usr/bin/env node
/**
 * 道の駅ナビ全国版の購入者ゲート同期スクリプト。
 *
 * このPCに既存で認証済みの `stripe` CLIだけを使い、道の駅ナビの正式Payment Link
 * （PAYMENT_LINK）に紐づくCheckout Session／Subscriptionだけを読み取る（他プロダクトの
 * データには一切アクセスしない）。新しいAPIキーの発行・取得は行わない。
 *
 * 1. Payment Link経由で完了した Checkout Session を（前回実行以降の分だけ）取得し、
 *    ローカルのみのキャッシュ（data/access-control/session-cache.local.json、
 *    gitignore済み・コミットしない）に session_id -> subscription_id を積み上げる。
 * 2. 対象price（MICHINOEKI_PRICE_ID）で現在activeなSubscriptionのID集合を取得する。
 * 3. キャッシュ内のsession_idのうち、対応するsubscriptionが現在activeなものだけを
 *    「有効」と判定し、SHA-256ハッシュだけを public/access-control/active.json へ書き出す
 *    （生のsession_id・subscription_idは一切公開しない。ハッシュは256bitの高エントロピー値の
 *    一方向ハッシュなので、これを読んでも他人の資格情報は作れない）。
 * 4. data/access-control/manual-grants.local.json（gitignore済み。ナミちゃん等への
 *    個別の無料付与用。生の招待コードをOwnerがここに手で書く。Git管理・公開はしない）が
 *    あれば、そこに書かれた招待コードのハッシュも常に「有効」として同じ配列に加える。
 * 5. 差分があればコミット・push・`gh workflow run deploy.yml` まで実行する
 *    （scripts/refresh-poi-cache.ymlと同じ既存パターン）。
 *
 * fail-closed: Stripe側の一時的な取得失敗時は、既存の active.json を変更しない
 *  （新しい有効判定ができないだけで、既に発行済みのアクセスを誤って剥奪しない。
 *  ただし解約・失効の反映もその分だけ遅れる。次回実行時に取り戻す）。
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PAYMENT_LINK = 'plink_1UHH4SICXxuNXmZyihmdzOho';
const PRICE_ID = 'price_1UHH2vICXxuNXmZyr0tSquxk';
const SESSION_CACHE_PATH = join(ROOT, 'data/access-control/session-cache.local.json');
const MANUAL_GRANTS_PATH = join(ROOT, 'data/access-control/manual-grants.local.json');
const ACTIVE_JSON_PATH = join(ROOT, 'public/access-control/active.json');

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

function syncNewSessions(cache) {
  const createdAfter = cache.lastSyncedCreated ?? 0;
  const sessions = listAll((startingAfter) => {
    const args = ['checkout', 'sessions', 'list', '--payment-link', PAYMENT_LINK, '--status', 'complete', '--limit', '100'];
    if (createdAfter) args.push('--created', JSON.stringify({ gt: createdAfter }));
    if (startingAfter) args.push('--starting-after', startingAfter);
    return stripe(args);
  });
  let maxCreated = createdAfter;
  for (const s of sessions) {
    if (typeof s.subscription === 'string') cache.sessions[s.id] = s.subscription;
    if (s.created > maxCreated) maxCreated = s.created;
  }
  cache.lastSyncedCreated = maxCreated;
  return sessions.length;
}

function fetchActiveSubscriptionIds() {
  const subs = listAll((startingAfter) => {
    const args = ['subscriptions', 'list', '--price', PRICE_ID, '--status', 'active', '--limit', '100'];
    if (startingAfter) args.push('--starting-after', startingAfter);
    return stripe(args);
  });
  return new Set(subs.map((s) => s.id));
}

function main() {
  const cache = loadJson(SESSION_CACHE_PATH, { lastSyncedCreated: 0, sessions: {} });
  let newCount = 0;
  let activeIds;
  try {
    newCount = syncNewSessions(cache);
    activeIds = fetchActiveSubscriptionIds();
  } catch (err) {
    console.error('[sync-subscriptions] Stripe取得に失敗。active.jsonは変更しません（fail-closed）:', err.message);
    process.exitCode = 1;
    return;
  }
  saveJsonPretty(SESSION_CACHE_PATH, cache);

  const hashes = new Set();
  for (const [sessionId, subId] of Object.entries(cache.sessions)) {
    if (activeIds.has(subId)) hashes.add(sha256Hex(sessionId));
  }
  const manualGrants = loadJson(MANUAL_GRANTS_PATH, []);
  for (const grant of manualGrants) {
    if (typeof grant.secret === 'string' && grant.secret) hashes.add(sha256Hex(grant.secret));
  }

  const nextActive = Array.from(hashes).sort();
  const prevActive = loadJson(ACTIVE_JSON_PATH, []);
  const changed = JSON.stringify(nextActive) !== JSON.stringify(prevActive);
  saveJsonPretty(ACTIVE_JSON_PATH, nextActive);

  console.log(
    `[sync-subscriptions] 新規session:${newCount} active subscriptions:${activeIds.size} manual grants:${manualGrants.length} -> active.json entries:${nextActive.length} (${changed ? '更新あり' : '変更なし'})`,
  );

  if (!changed) return;

  execFileSync('git', ['add', 'public/access-control/active.json'], { cwd: ROOT, stdio: 'inherit' });
  execFileSync('git', ['commit', '-m', '購入者ゲート: 有効な契約者一覧を同期（自動生成）'], { cwd: ROOT, stdio: 'inherit' });
  execFileSync('git', ['push'], { cwd: ROOT, stdio: 'inherit' });
  execFileSync('gh', ['workflow', 'run', 'deploy.yml', '--ref', 'main'], { cwd: ROOT, stdio: 'inherit' });
}

main();
