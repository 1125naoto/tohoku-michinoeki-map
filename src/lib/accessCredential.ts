/**
 * 月額250円の有効な購入者だけが全国版アプリ本体を利用できるようにするゲートの資格情報。
 *
 * 資格情報は「StripeのCheckout Session ID（決済完了直後、Thanksページのみが受け取る、
 * 推測不可能な高エントロピーの文字列）」または「Ownerが個別に発行した招待コード
 * （ナミちゃん用。リンクを知っていれば何度でも使えるため、本人にだけ個別に渡す）」。どちらも public/access-control/active.json に載る
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

/** LINEのトーク内リンクをLINE内ブラウザではなく既定のブラウザ（iPhoneならSafari）で開かせるLINE公式の指定 */
const LINE_EXTERNAL_BROWSER_PARAM = 'openExternalBrowser';

/** ホーム画面から起動したPWA（standalone表示）か */
export function isStandaloneDisplay(): boolean {
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

export interface CapturedCredential {
  credential: string | null;
  /** 今回のURLの ?activate= から取得したか（保存済みの資格情報なら false） */
  fromUrl: boolean;
}

/**
 * URLに ?activate=<招待コード> があれば保存する（ナミちゃん用の個別リンク）。
 *
 * - ホーム画面版（standalone）: 保存したらURLから消す。
 * - ブラウザのタブ: URLに残す。iOSのホーム画面版はSafariとlocalStorageを共有しないため、
 *   ホーム画面版の起動URL（= 招待コード付きの読み込みURL）に含めて引き継ぐ
 *   （manifestの選択は installManifestSelector.ts がHTML解析中に行う）。
 *   リンク自体に元々含まれている値なので、公開範囲は広がらない。
 *
 * LINEの openExternalBrowser=1 は常にURLから消す（ホーム画面の起動URLに残さない）。
 */
export function captureActivationParam(): CapturedCredential {
  try {
    const url = new URL(location.href);
    const code = url.searchParams.get(ACTIVATE_PARAM);
    const hadLineParam = url.searchParams.has(LINE_EXTERNAL_BROWSER_PARAM);
    url.searchParams.delete(LINE_EXTERNAL_BROWSER_PARAM);
    if (code) {
      localStorage.setItem(STORAGE_KEY, code);
      if (isStandaloneDisplay()) url.searchParams.delete(ACTIVATE_PARAM);
    }
    if (code || hadLineParam) history.replaceState(null, '', url.toString());
    return code ? { credential: code, fromUrl: true } : { credential: readStoredCredential(), fromUrl: false };
  } catch {
    return { credential: readStoredCredential(), fromUrl: false };
  }
}

/** ?activate= をURLから消す（拒否された招待コードをURLに残さない） */
function removeActivationParamFromUrl(): void {
  try {
    const url = new URL(location.href);
    if (!url.searchParams.has(ACTIVATE_PARAM)) return;
    url.searchParams.delete(ACTIVATE_PARAM);
    history.replaceState(null, '', url.toString());
  } catch {
    /* no-op */
  }
}

/** 確認結果に応じた後処理: 拒否された招待コードはURLから消す（URLに残さない） */
export function finishActivation(captured: CapturedCredential, result: EntitlementCheck): void {
  if (result === 'denied' && captured.fromUrl) removeActivationParamFromUrl();
}

/** Thanksページが資格情報と一緒に保存する、決済完了の時刻（ミリ秒）。render.ts の SESSION_CAPTURE_JS と一致させる */
const CAPTURED_AT_KEY = 'michinoeki_access_credential_at';
/** 決済完了からこの時間内は、一覧への反映待ち（確認中）として扱う。アクセスは許可しない */
export const PAYMENT_CONFIRMATION_WINDOW_MS = 30 * 60 * 1000;

/**
 * 決済直後で、購入者一覧への反映を待っている状態か。
 * StripeのCheckout Session ID（cs_）が、Thanksページで30分以内に保存されたものだけ。
 * この間は課金画面ではなく「確認中」を出して再確認するだけで、アプリは開かない（無料にはならない）。
 */
export function isAwaitingPaymentConfirmation(credential: string, now = Date.now()): boolean {
  if (!credential.startsWith('cs_')) return false;
  try {
    const at = Number(localStorage.getItem(CAPTURED_AT_KEY));
    return Number.isFinite(at) && at > 0 && now - at >= 0 && now - at < PAYMENT_CONFIRMATION_WINDOW_MS;
  } catch {
    return false;
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
    // GitHub Pages のCDNは10分キャッシュするため、毎回クエリを変えて最新の一覧を取る（決済直後の反映を待たせない）
    const res = await fetch(`${basePath}access-control/active.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return 'unavailable';
    list = await res.json();
  } catch {
    return 'unavailable';
  }
  if (!Array.isArray(list) || !list.every((v) => typeof v === 'string')) return 'unavailable';
  const hash = await sha256Hex(credential);
  return list.includes(hash) ? 'granted' : 'denied';
}
