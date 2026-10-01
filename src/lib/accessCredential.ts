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
/** vite.config.ts の installHandoffManifestPlugin が出力する、start_urlを持たないmanifest */
const INSTALL_HANDOFF_MANIFEST = 'manifest-handoff.webmanifest';

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
 * - ブラウザのタブ: 確認が済むまでURLに残す。iOSのホーム画面版はSafariとlocalStorageを
 *   共有しないため、このタブからホーム画面に追加したときの起動URLに招待コードを
 *   含める必要がある（finishActivation と manifest-handoff.webmanifest を参照）。
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

/**
 * ブラウザのタブで ?activate= の資格情報が有効と確認できたときだけ、manifestのリンクを
 * start_urlを持たない受け渡し用manifestへ差し替える。仕様上start_urlは「ホーム画面追加時の
 * ページURL（?activate=付き）」になり、ホーム画面版の初回起動時に captureActivationParam が
 * 自分専用のlocalStorageへ保存する（以後の起動も同じURLから始まるため保持され続ける）。
 * 一般ユーザー・有料契約者（?activate= なし）のmanifestは一切変わらない。
 */
export function finishActivation(captured: CapturedCredential, result: EntitlementCheck, basePath: string): void {
  if (!captured.fromUrl) return;
  if (result === 'denied') {
    removeActivationParamFromUrl();
    return;
  }
  if (result !== 'granted' || isStandaloneDisplay()) return;
  try {
    let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'manifest';
      document.head.appendChild(link);
    }
    link.href = `${basePath}${INSTALL_HANDOFF_MANIFEST}`;
  } catch {
    /* no-op */
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
