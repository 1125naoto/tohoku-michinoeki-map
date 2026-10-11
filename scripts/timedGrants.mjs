/**
 * 期限つきの一時アクセス（検証専用の招待コード）を、購入者ゲートの有効一覧（active.json）へ
 * 反映するための「判定だけ」を行う純関数（副作用なし・単体テスト対象）。
 * 実際の読み書き・git操作は scripts/sync-subscriptions.mjs が行う。
 *
 * 目的: 公開環境のゲート内側（アプリ本体）を、顧客・招待者の資格情報を使わずに正規の認証で確認する。
 * 既存の同期（1分ごとの再生成）の中に統合するため、同期のたびに消えることがない。
 *
 * 安全のための方針:
 *  - 台帳（data/access-control/timed-grants.json）にはSHA-256ハッシュだけを置く。コードの平文は
 *    どこにも保存しない（台帳・ログ・報告書・git履歴のいずれにも残らない）。
 *  - 必ず期限（expiresAt）と発行時刻（issuedAt）を持つ。期限なし・形式不正・有効期間が
 *    MAX_TTL_MS（24時間）を超えるもの・期限切れは無視する（恒久的な管理者アクセスは作れない）。
 *  - ゲートの認証方式は変えない（active.json のハッシュ照合のまま）。
 *  - 追加するだけで、Stripeの購入者・NAMIの招待コードのハッシュには一切触れない。
 */
export const MAX_TTL_MS = 24 * 60 * 60 * 1000;
/** 発行時刻が未来すぎるものは台帳の誤り・改ざんとして無視する（時計のずれの許容） */
export const CLOCK_SKEW_MS = 5 * 60 * 1000;

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** 台帳の1件が、いま有効か。理由を返す（ログには件数と理由だけを出し、ハッシュ自体は出さない） */
export function judgeTimedGrant(grant, now) {
  if (!grant || typeof grant !== 'object') return { valid: false, reason: 'malformed' };
  if (typeof grant.sha256 !== 'string' || !SHA256_HEX.test(grant.sha256)) return { valid: false, reason: 'bad_hash' };
  const issued = typeof grant.issuedAt === 'string' ? Date.parse(grant.issuedAt) : NaN;
  const expires = typeof grant.expiresAt === 'string' ? Date.parse(grant.expiresAt) : NaN;
  if (!Number.isFinite(issued) || !Number.isFinite(expires)) return { valid: false, reason: 'no_expiry' };
  if (expires <= issued) return { valid: false, reason: 'bad_window' };
  if (expires - issued > MAX_TTL_MS) return { valid: false, reason: 'ttl_too_long' };
  if (issued > now + CLOCK_SKEW_MS) return { valid: false, reason: 'issued_in_future' };
  if (expires <= now) return { valid: false, reason: 'expired' };
  return { valid: true, reason: 'ok' };
}

/** いま有効な一時アクセスのハッシュ一覧 */
export function activeTimedGrantHashes(grants, now = Date.now()) {
  if (!Array.isArray(grants)) return [];
  return grants.filter((g) => judgeTimedGrant(g, now).valid).map((g) => g.sha256);
}

/** 有効な件数と、無効になった理由ごとの件数（ログ用。秘密値・ハッシュは含めない） */
export function summarizeTimedGrants(grants, now = Date.now()) {
  const summary = { active: 0, rejected: {} };
  if (!Array.isArray(grants)) return summary;
  for (const g of grants) {
    const j = judgeTimedGrant(g, now);
    if (j.valid) summary.active += 1;
    else summary.rejected[j.reason] = (summary.rejected[j.reason] ?? 0) + 1;
  }
  return summary;
}

/**
 * 新しい有効一覧 = Stripeの有効な契約のハッシュ + 手動の招待コードのハッシュ + 有効な一時アクセスのハッシュ。
 * 重複は1つにまとめ、並びは昇順（active.json の差分を安定させる）。
 */
export function composeActiveHashes({ stripeHashes = [], manualHashes = [], timedGrants = [], now = Date.now() }) {
  const set = new Set([...stripeHashes, ...manualHashes, ...activeTimedGrantHashes(timedGrants, now)]);
  return Array.from(set).sort();
}

/**
 * Stripeに接続できない同期（fail-closed で一覧を再生成しない場合）でも、期限切れの一時アクセスだけは
 * 一覧から外す（除去のみ。何も追加しない）。Stripe・NAMI由来のハッシュには触れない。
 */
export function pruneExpiredTimedHashes(prevActive, timedGrants, now = Date.now()) {
  if (!Array.isArray(prevActive)) return prevActive;
  const stillValid = new Set(activeTimedGrantHashes(timedGrants, now));
  const expired = new Set(
    (Array.isArray(timedGrants) ? timedGrants : [])
      .filter((g) => g && typeof g.sha256 === 'string' && !stillValid.has(g.sha256))
      .map((g) => g.sha256),
  );
  return prevActive.filter((h) => !expired.has(h));
}
