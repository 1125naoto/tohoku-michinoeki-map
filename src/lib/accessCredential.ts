/**
 * 月額250円の有効な購入者だけが全国版アプリ本体を利用できるようにするゲートの資格情報。
 *
 * 資格情報は「StripeのCheckout Session ID（決済完了直後、Thanksページのみが受け取る、
 * 推測不可能な高エントロピーの文字列）」または「Ownerが個別に発行した1回限りの
 * 招待コード（ナミちゃん用）」。どちらも public/access-control/active.json に載る
 * SHA-256ハッシュとしてのみ公開され、資格情報の生の値そのものは一切公開しない
 * （逆算不可能なため、このファイルを誰が読んでも他人の資格情報は作れない）。
 *
 * キー名 'michinoeki_access_credential' は src/monitorSite/render.ts の
 * SESSION_CAPTURE_JS と一致させる必要がある（同一オリジンのThanksページが書き込む）。
 */
const STORAGE_KEY = 'michinoeki_access_credential';
const ACTIVATE_PARAM = 'activate';

export function readStoredCredential(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** URLに ?activate=<招待コード> があれば保存し、URLから消す（ナミちゃん用の1回限りリンク） */
export function captureActivationParam(): string | null {
  try {
    const url = new URL(location.href);
    const code = url.searchParams.get(ACTIVATE_PARAM);
    if (!code) return readStoredCredential();
    localStorage.setItem(STORAGE_KEY, code);
    url.searchParams.delete(ACTIVATE_PARAM);
    history.replaceState(null, '', url.toString());
    return code;
  } catch {
    return readStoredCredential();
  }
}

export function clearStoredCredential(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* no-op */
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export type EntitlementCheck = 'granted' | 'denied' | 'unavailable';

/**
 * public/access-control/active.json（購入者ゲート用に定期同期される、資格情報ハッシュの配列）
 * に対して、自分の資格情報のハッシュが含まれているか確認する。
 * 取得失敗・不正な形式は 'unavailable' とし、呼び出し側はこれを必ず「利用不可」として扱う
 * （fail-closed。認証基盤の障害時に無条件でアプリを見せてしまうfail-openは行わない）。
 */
export async function checkEntitlement(credential: string, basePath: string): Promise<EntitlementCheck> {
  let list: unknown;
  try {
    const res = await fetch(`${basePath}access-control/active.json`, { cache: 'no-store' });
    if (!res.ok) return 'unavailable';
    list = await res.json();
  } catch {
    return 'unavailable';
  }
  if (!Array.isArray(list) || !list.every((v) => typeof v === 'string')) return 'unavailable';
  const hash = await sha256Hex(credential);
  return list.includes(hash) ? 'granted' : 'denied';
}
