#!/usr/bin/env node
/**
 * 「道の駅ナビ 先行モニター」用のStripeオブジェクト（Product / 月額250円Price / Payment Link /
 * Customer Portal）を、冪等に確認・作成する。Owner本人がCLIを使う必要はない（Claude Codeが実行する）。
 *
 * 使い方:
 *   node scripts/stripe-monitor-setup.mjs                      # Test mode・確認のみ（何も作らない）
 *   node scripts/stripe-monitor-setup.mjs --apply              # Test mode・不足分を作成
 *   node scripts/stripe-monitor-setup.mjs --live               # Live・確認のみ（読み取り）
 *   node scripts/stripe-monitor-setup.mjs --live --apply --confirm-live-create   # Live・作成（Owner承認後のみ）
 *
 * 安全策:
 *  - Liveで作成するには --apply と --confirm-live-create の両方が必須（片方だけなら拒否）。
 *  - 既存オブジェクト（metadata.app=michinoeki-navi）を検出して再利用するため、何度実行しても重複しない。
 *  - Live認証は、Ownerがブラウザで「承認」を1回押すだけ（`stripe login --non-interactive` → 承認 → `--complete`）。
 *    Liveは別プロファイル（STRIPE_PROJECT）に保存し、既存のSandbox認証と分離する。
 *  - 出力はID・公開URLのみ。APIキー等の秘密値は一切表示しない（CLIのローカル認証を使う）。
 */
import { execFileSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const LIVE = args.has('--live');
const APPLY = args.has('--apply');
if (LIVE && APPLY && !args.has('--confirm-live-create')) {
  console.error('拒否: Liveでオブジェクトを作成するには --apply と --confirm-live-create の両方が必要です（Owner承認後のみ）。');
  process.exit(2);
}

const STRIPE = process.env.STRIPE_CLI || 'stripe';
const BASE = 'https://1125naoto.github.io/tohoku-michinoeki-map/monitor';
const APP = 'michinoeki-navi';
const PRODUCT_NAME = '道の駅ナビ 先行モニター';
const DESCRIPTION = '道の駅ナビ 先行モニター（月額）。全国版の利用、先行モニターとしての参加、改善要望の送信。';
const STATEMENT = 'MICHINOEKI NAVI'; // カード明細（Latin・22文字以内）。アカウント共通の表記と区別するため商品側で指定
const LOOKUP_KEY = 'michinoeki_monitor_250_monthly';
const UNIT_AMOUNT = 250;
const CHECKOUT_NOTE =
  `お申込みにより、利用規約・プライバシーポリシー・特定商取引法に基づく表記（${BASE}/）に同意したものとみなします。` +
  '月額250円は毎月自動更新され、解約は決済後のページからいつでも手続きできます。';

const actions = [];
const log = (kind, what) => { actions.push(`[${kind}] ${what}`); };

// Live用に別プロファイルでログインしている場合（既存のSandbox認証を上書きしないため）: STRIPE_PROJECT=<name>
const PROJECT = process.env.STRIPE_PROJECT;

function stripe(...a) {
  const full = [...a, ...(LIVE ? ['--live'] : []), ...(PROJECT ? ['--project-name', PROJECT] : [])];
  try {
    const out = execFileSync(STRIPE, full, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
    return JSON.parse(out);
  } catch (e) {
    const msg = String(e.stderr || e.stdout || e.message || e).replace(/(sk|rk|pk)_[A-Za-z0-9_]+/g, '$1_<redacted>').slice(0, 400);
    console.error(`Stripe CLI error (${LIVE ? 'live' : 'test'}): ${msg}`);
    process.exit(3);
  }
}
const d = (k, v) => ['-d', `${k}=${v}`];

// ── 1) Product ──────────────────────────────────────────────────────
let product = stripe('products', 'list', '--limit', '100').data.find((p) => p.active && p.metadata?.app === APP && p.name === PRODUCT_NAME);
if (product) {
  log('exists', `product ${product.id}`);
  if (product.statement_descriptor !== STATEMENT) {
    if (APPLY) { product = stripe('products', 'update', product.id, ...d('statement_descriptor', STATEMENT)); log('update', `product ${product.id} statement_descriptor=${STATEMENT}`); }
    else log('would-update', `product ${product.id} statement_descriptor=${STATEMENT}`);
  }
} else if (APPLY) {
  product = stripe('products', 'create', '--name', PRODUCT_NAME, '--description', DESCRIPTION, ...d('statement_descriptor', STATEMENT), ...d('metadata[app]', APP), ...d('metadata[plan]', 'early-monitor'));
  log('create', `product ${product.id}`);
} else log('would-create', 'product');

// ── 2) Price（月額250円 JPY） ────────────────────────────────────────
let price = product && stripe('prices', 'list', '--limit', '100', ...d('product', product.id)).data.find(
  (p) => p.active && p.lookup_key === LOOKUP_KEY && p.currency === 'jpy' && p.unit_amount === UNIT_AMOUNT && p.recurring?.interval === 'month' && p.recurring?.interval_count === 1,
);
if (price) log('exists', `price ${price.id} (¥${price.unit_amount}/月)`);
else if (APPLY && product) {
  price = stripe('prices', 'create', '--product', product.id, '--currency', 'jpy', '--unit-amount', String(UNIT_AMOUNT), ...d('recurring[interval]', 'month'), '--lookup-key', LOOKUP_KEY, '--nickname', '先行モニター月額250円', ...d('metadata[app]', APP));
  log('create', `price ${price.id}`);
} else log('would-create', 'price ¥250/month');

// ── 3) Payment Link（決済後は /monitor/thanks/ へ） ──────────────────
let link;
if (price) {
  for (const l of stripe('payment_links', 'list', '--limit', '100').data) {
    if (!l.active || l.metadata?.app !== APP) continue;
    const items = stripe('get', `/v1/payment_links/${l.id}/line_items`).data;
    if (items.some((i) => i.price?.id === price.id) && l.after_completion?.redirect?.url === `${BASE}/thanks/`) { link = l; break; }
  }
}
if (link) log('exists', `payment_link ${link.id}`);
else if (APPLY && price) {
  link = stripe('payment_links', 'create',
    ...d('line_items[0][price]', price.id), ...d('line_items[0][quantity]', '1'),
    ...d('after_completion[type]', 'redirect'), ...d('after_completion[redirect][url]', `${BASE}/thanks/`),
    ...d('billing_address_collection', 'auto'), ...d('allow_promotion_codes', 'false'),
    ...d('custom_text[submit][message]', CHECKOUT_NOTE),
    ...d('subscription_data[description]', `${PRODUCT_NAME}（月額250円）`), ...d('subscription_data[metadata][app]', APP), ...d('metadata[app]', APP));
  log('create', `payment_link ${link.id}`);
} else log('would-create', 'payment_link');

// ── 4) Customer Portal（解約は請求期間の終了時・専用ログインページ） ───
let portal = stripe('billing_portal', 'configurations', 'list', '--limit', '100').data.find(
  (c) => c.active && c.metadata?.app === APP && c.features?.subscription_cancel?.enabled && c.features.subscription_cancel.mode === 'at_period_end' && c.login_page?.enabled && c.login_page?.url,
);
if (portal) log('exists', `portal_configuration ${portal.id}`);
else if (APPLY) {
  portal = stripe('billing_portal', 'configurations', 'create',
    ...d('name', '道の駅ナビ 先行モニター（解約・支払い管理）'),
    ...d('business_profile[headline]', '道の駅ナビ 先行モニターのお支払い管理・解約'),
    ...d('business_profile[privacy_policy_url]', `${BASE}/privacy/`), ...d('business_profile[terms_of_service_url]', `${BASE}/terms/`),
    ...d('default_return_url', `${BASE}/`),
    ...d('features[invoice_history][enabled]', 'true'), ...d('features[payment_method_update][enabled]', 'true'),
    ...d('features[customer_update][enabled]', 'true'), ...d('features[customer_update][allowed_updates][0]', 'email'),
    ...d('features[subscription_cancel][enabled]', 'true'), ...d('features[subscription_cancel][mode]', 'at_period_end'),
    ...d('features[subscription_cancel][proration_behavior]', 'none'),
    ...d('features[subscription_update][enabled]', 'false'), ...d('login_page[enabled]', 'true'), ...d('metadata[app]', APP));
  log('create', `portal_configuration ${portal.id}`);
} else log('would-create', 'portal_configuration');

console.log(JSON.stringify({
  mode: LIVE ? 'live' : 'test', apply: APPLY, actions,
  product: product?.id ?? null, price: price?.id ?? null,
  paymentLink: link ? { id: link.id, url: link.url } : null,
  portal: portal ? { id: portal.id, loginUrl: portal.login_page?.url ?? null } : null,
  complete: Boolean(product && price && link && portal),
}, null, 2));
