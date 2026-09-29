import React, { useEffect, useState } from 'react';
import {
  captureActivationParam,
  checkEntitlement,
  clearStoredCredential,
  type EntitlementCheck,
} from '../lib/accessCredential';

const OFFICIAL_SITE_URL = 'https://michinoekinavi.jp/';
/** src/monitorSite/config.ts の live.paymentLink と一致させること（render.test.tsで検証済み） */
const PAYMENT_LINK_URL = 'https://buy.stripe.com/bJe5kE3eheQO8XYaa07Zu00';

/**
 * 月額250円の有効な購入者だけが全国版アプリ本体を利用できるようにするゲート。
 * fail-closed: 資格情報が無い／確認できない場合は必ず非表示側に倒す。
 *
 * VITE_ACCESS_GATE_ENABLED='true' が注入されたビルドでのみ有効になる。
 * 未設定（ローカル開発・単体テスト・既存E2E・本番切替前）は素通し
 * （既存の回帰基準を壊さない。本番投入はGolden Path確認後にこのフラグをtrueにする）。
 */
export default function AccessGate({ children }: { children: React.ReactNode }) {
  if (import.meta.env.VITE_ACCESS_GATE_ENABLED !== 'true') return <>{children}</>;
  return <LiveGate>{children}</LiveGate>;
}

function LiveGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<EntitlementCheck | 'checking'>('checking');

  useEffect(() => {
    const credential = captureActivationParam();
    if (!credential) {
      setState('denied');
      return;
    }
    checkEntitlement(credential, import.meta.env.BASE_URL).then((result) => {
      if (result === 'denied') clearStoredCredential();
      setState(result);
    });
  }, []);

  if (state === 'granted') return <>{children}</>;

  if (state === 'checking') {
    return (
      <div className="access-gate">
        <p>確認中です…</p>
      </div>
    );
  }

  if (state === 'unavailable') {
    return (
      <div className="access-gate">
        <h2>確認できませんでした</h2>
        <p>通信状況をご確認のうえ、再読み込みしてください。</p>
        <button className="btn-primary" onClick={() => location.reload()}>
          再読み込み
        </button>
      </div>
    );
  }

  return (
    <div className="access-gate">
      <h2>道の駅ナビ 全国版</h2>
      <p>月額250円のご契約中の方だけご利用いただけます。</p>
      <a className="btn-primary btn-link" href={PAYMENT_LINK_URL} rel="noopener">
        月額250円で申し込む
      </a>
      <a className="btn-link" href={OFFICIAL_SITE_URL}>
        公式サイトで詳しく見る
      </a>
    </div>
  );
}
