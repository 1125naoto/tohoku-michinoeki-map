import React, { useEffect, useState } from 'react';
import {
  captureActivationParam,
  checkEntitlement,
  clearStoredCredential,
  finishActivation,
  isAwaitingPaymentConfirmation,
  type EntitlementCheck,
} from '../lib/accessCredential';

import { MONITOR_CONFIG } from '../monitorSite/config';
import { pricingText } from '../monitorSite/pricing';

const OFFICIAL_SITE_URL = 'https://michinoekinavi.jp/';
/** 購入URL・料金は販売サイトと同じ設定から取る（公開URLで秘密ではない） */
const MONTHLY_PAYMENT_LINK_URL = MONITOR_CONFIG.live.monthlyPaymentLink ?? OFFICIAL_SITE_URL;
const ANNUAL_PAYMENT_LINK_URL = MONITOR_CONFIG.live.annualPaymentLink ?? OFFICIAL_SITE_URL;
const PRICE = pricingText(MONITOR_CONFIG.pricing, MONITOR_CONFIG.owner.priceTaxInclusive);

/**
 * 有効な契約者（月額プラン・年間プラン）と招待コードの持ち主だけが全国版アプリ本体を利用できるようにするゲート。
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

/**
 * このページ読み込みで、ホーム画面追加用の受け渡しmanifestが選ばれているか
 * （installManifestSelector.ts がHTML解析中に選ぶ。招待コード付きURLのSafariのタブだけtrue）。
 * 旧ビルドのService Workerが表示した画面ではfalseになり、自動更新後の再読み込みでtrueになる。
 */
function installHandoffReady(): boolean {
  try {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    return !!link && link.href.endsWith('/manifest-handoff.webmanifest');
  } catch {
    return false;
  }
}

/** 決済直後の「確認中」で、購入者一覧を再確認する間隔 */
const CONFIRMATION_RETRY_MS = 15 * 1000;

function LiveGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<EntitlementCheck | 'checking' | 'confirming'>('checking');
  const [bannerClosed, setBannerClosed] = useState(false);

  useEffect(() => {
    const captured = captureActivationParam();
    const credential = captured.credential;
    if (!credential) {
      setState('denied');
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const check = () => {
      checkEntitlement(credential, import.meta.env.BASE_URL).then((result) => {
        if (stopped) return;
        // 決済直後: 一覧への反映（通常1〜3分）を待つ間は、課金画面ではなく「確認中」にして自動で再確認する
        if (result !== 'granted' && isAwaitingPaymentConfirmation(credential)) {
          setState('confirming');
          timer = setTimeout(check, CONFIRMATION_RETRY_MS);
          return;
        }
        if (result === 'denied') clearStoredCredential();
        finishActivation(captured, result);
        setState(result);
      });
    };
    check();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (state === 'granted') {
    if (bannerClosed || !installHandoffReady()) return <>{children}</>;
    return (
      <>
        <div className="install-handoff-banner" role="status">
          <span>この画面のまま、共有ボタン →「ホーム画面に追加」で、ホーム画面からも使えます</span>
          <button type="button" aria-label="閉じる" onClick={() => setBannerClosed(true)}>
            ×
          </button>
        </div>
        {children}
      </>
    );
  }

  if (state === 'confirming') {
    return (
      <div className="access-gate">
        <h2>お支払いを確認しています</h2>
        <p>ご購入ありがとうございます。お支払いの反映を確認しています（通常1〜3分ほどです）。</p>
        <p>このままお待ちください。確認でき次第、自動で開きます。</p>
      </div>
    );
  }

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
      <p>ご契約中の方だけご利用いただけます。</p>
      <p className="access-gate-price">
        {PRICE.monthlySummary}
        <br />
        {PRICE.annualSummary}
      </p>
      <a className="btn-primary btn-link" href={MONTHLY_PAYMENT_LINK_URL} rel="noopener">
        月額プランで申し込む（{PRICE.introPeriod} {PRICE.introPerMonth}）
      </a>
      <a className="btn-link" href={ANNUAL_PAYMENT_LINK_URL} rel="noopener">
        年間プランで申し込む（{PRICE.annualPerYear}）
      </a>
      <a className="btn-link" href={OFFICIAL_SITE_URL}>
        公式サイトで詳しく見る
      </a>
    </div>
  );
}
