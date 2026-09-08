/**
 * 現在地取得（navigator.geolocation）のエラー種別を、ユーザーに実際に役立つ
 * 案内文へ変換する。従来はPERMISSION_DENIED/POSITION_UNAVAILABLE/TIMEOUT/
 * Secure Context制限のすべてが同一の「わかりませんでした」文言に潰れており、
 * 何をすればよいかユーザーが判断できなかった（実機テストで確認した不具合）。
 */

/**
 * 診断表示（Secure Context制限の技術的な説明等）を出してよい環境か。
 * 一般公開中のGitHub Pages本番URLでは絶対に出さない（ローカル/LAN/HTTPSトンネル/
 * 開発時のみ）。本番は常にHTTPS配信のためこの制限自体が実運用で問題にならない。
 */
export function isDiagnosticsHost(): boolean {
  if (typeof location === 'undefined') return false;
  return location.hostname !== '1125naoto.github.io';
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

/** 1回の取得試行の記録（動作診断パネルで確認できるように残す） */
export interface GeolocationAttemptLog {
  accuracy: 'high' | 'low';
  ok: boolean;
  code?: number;
  message?: string;
  elapsedMs: number;
}

export interface BestPositionResult {
  position: GeolocationPosition | null;
  error: GeolocationPositionError | null;
  attempts: GeolocationAttemptLog[];
}

function getPositionOnce(
  options: PositionOptions,
): Promise<{ position: GeolocationPosition | null; error: GeolocationPositionError | null; elapsedMs: number }> {
  return new Promise((resolve) => {
    const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const elapsed = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start;
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ position, error: null, elapsedMs: elapsed() }),
      (error) => resolve({ position: null, error, elapsedMs: elapsed() }),
      options,
    );
  });
}

/**
 * 現在地取得の共通関数。iOS Safariでは`navigator.permissions.query({name:'geolocation'})`
 * が実際の取得可否と食い違うことがある（実機で確認済み）ため、Permissions APIの
 * 状態では一切判断せず、必ずgetCurrentPosition()を直接呼び、その成功/失敗
 * コールバックだけを真実として扱う。
 *
 * 1回目: enableHighAccuracy=true, timeout=12000, maximumAge=0（最新の高精度位置を要求）。
 * 失敗理由がPOSITION_UNAVAILABLE(2)またはTIMEOUT(3)の場合のみ、
 * 2回目: enableHighAccuracy=false, timeout=15000, maximumAge=60000で再試行する
 * （屋内/電波不良でGPS高精度測位が返らない端末でも、基地局/Wi-Fiベースの
 * 低精度測位なら成功することがあるため）。PERMISSION_DENIED(1)の場合は
 * 再試行してもユーザーの許可状態が変わらないため再試行しない。
 * 各試行の結果はattemptsに記録し、動作診断パネルでそのまま確認できるようにする。
 */
export async function getBestCurrentPosition(): Promise<BestPositionResult> {
  const attempts: GeolocationAttemptLog[] = [];
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return { position: null, error: null, attempts };
  }

  const first = await getPositionOnce({ enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  attempts.push({
    accuracy: 'high',
    ok: !!first.position,
    code: first.error?.code,
    message: first.error?.message,
    elapsedMs: Math.round(first.elapsedMs),
  });
  if (first.position) return { position: first.position, error: null, attempts };
  if (first.error?.code === 1) return { position: null, error: first.error, attempts };

  const second = await getPositionOnce({ enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
  attempts.push({
    accuracy: 'low',
    ok: !!second.position,
    code: second.error?.code,
    message: second.error?.message,
    elapsedMs: Math.round(second.elapsedMs),
  });
  if (second.position) return { position: second.position, error: null, attempts };
  return { position: null, error: second.error, attempts };
}

/**
 * navigator.geolocationのエラーをユーザー向けメッセージへ変換する。
 * error.code (1=PERMISSION_DENIED, 2=POSITION_UNAVAILABLE, 3=TIMEOUT) を区別し、
 * 特にPERMISSION_DENIEDについては、実際にユーザーが拒否したのか、HTTP接続で
 * ブラウザがSecure Context制限により機能そのものを使えなかったのかを分けて案内する
 * （後者は診断表示可能な環境でのみ技術的な説明を追加し、本番では一般文言のみ）。
 */
export function describeGeolocationError(err: Pick<GeolocationPositionError, 'code'>): string {
  const isSecure = typeof window === 'undefined' || window.isSecureContext;
  if (err.code === 1) {
    if (!isSecure) {
      if (isDiagnosticsHost()) {
        return '位置情報を利用できませんでした。（開発/プレビュー環境のみ表示: HTTP接続のためブラウザの位置情報機能がSecure Context制限でブロックされています。HTTPSのURLでお試しください）';
      }
      return '位置情報を利用できませんでした。';
    }
    if (isIOS()) {
      return '位置情報の利用が許可されていません。iPhoneの位置情報設定で、このサイトの位置情報を許可してください。';
    }
    return '位置情報の利用が許可されていません。ブラウザやOSの設定から位置情報の利用を許可してください。';
  }
  if (err.code === 2) {
    return '現在地を取得できませんでした。電波状況の良い場所でもう一度お試しください。';
  }
  if (err.code === 3) {
    return '現在地の取得に時間がかかっています。屋外など電波の良い場所でもう一度お試しください。';
  }
  return '現在地がわかりませんでした。';
}
