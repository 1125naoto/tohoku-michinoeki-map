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
