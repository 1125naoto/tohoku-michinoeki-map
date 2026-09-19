/**
 * 「道の駅ナビ 先行モニター」販売サイトの設定（FIRST 10 PAID MONITORS / MANUAL FULFILMENT）。
 *
 * このファイルは**公開リポジトリ**にコミットされる。したがって:
 *  - 個人情報（氏名・住所・電話・メール等）はOwnerが確認・承認するまで一切入れない（null のまま）。
 *  - Stripeの秘密鍵・Webhook秘密は絶対に入れない。Payment Link / Customer Portal のURLは
 *    公開前提のURLで秘密ではない。
 *  - `owner` の必須項目と `live` のURLが揃うまで、販売サイトは「受付準備中」表示のままになり、
 *    申込ボタンは出ない（evaluateSalesGate）。テスト用URLが本番ビルドへ混入することもない。
 */

export interface OwnerLegalInfo {
  /** 特定商取引法の販売事業者名（個人の場合は氏名）。Owner確認が必要 */
  sellerName: string | null;
  /** 所在地の開示方法。'on_request' = 請求があれば遅滞なく開示（要件あり）、'published' = 掲載 */
  addressDisclosure: 'on_request' | 'published' | null;
  address: string | null;
  phoneDisclosure: 'on_request' | 'published' | null;
  phone: string | null;
  /** 購入者サポート・フィードバックの受付メール */
  supportEmail: string | null;
  /** 税の表示（例: 表示価格の税込/税別の別）。Owner確認が必要 */
  taxNote: string | null;
  /** 返金・キャンセル条件（特商法の必須記載）。Owner確認が必要 */
  refundPolicy: string | null;
  /** 制定・施行日 YYYY-MM-DD */
  effectiveDate: string | null;
  /** 任意: 利用案内メールをお送りするまでの目安など */
  responseTimeNote: string | null;
}

export interface StripeUrls {
  /** Stripe Payment Link（購入ページ） */
  paymentLink: string | null;
  /** Stripe Customer Portal のログインページ（解約・お支払い管理） */
  portalLoginUrl: string | null;
}

export interface MonitorConfig {
  appName: string;
  productName: string;
  /** 公開アプリ本体のURL（販売LPには載せず、決済後のご案内ページにのみ載せる） */
  appUrl: string;
  monitorPriceYen: number;
  plannedFullPriceYen: number;
  targetMonitors: number;
  owner: OwnerLegalInfo;
  /** Live（本番）のURL。Ownerが Stripe Live で作成後に設定する */
  live: StripeUrls;
  /** Test mode のURL。テスト用ビルド（MONITOR_MODE=test）専用で、本番ビルドには出力されない */
  test: StripeUrls;
}

export const MONITOR_CONFIG: MonitorConfig = {
  appName: '道の駅ナビ',
  productName: '道の駅ナビ 先行モニター',
  appUrl: 'https://1125naoto.github.io/tohoku-michinoeki-map/',
  monitorPriceYen: 250,
  plannedFullPriceYen: 500,
  targetMonitors: 10,
  owner: {
    sellerName: null,
    addressDisclosure: null,
    address: null,
    phoneDisclosure: null,
    phone: null,
    supportEmail: null,
    taxNote: null,
    refundPolicy: null,
    effectiveDate: null,
    responseTimeNote: null,
  },
  live: {
    paymentLink: null,
    portalLoginUrl: null,
  },
  test: {
    // Stripe Test mode（実課金は発生しない）: prod_VHnEmi8owLfA7e / price_1UHDe0EtgcvJ6JiZ0hg8uRsq /
    // plink_1UHDeEEtgcvJ6JiZDk1SLopC / bpc_1UHDeSEtgcvJ6JiZOBvG8giu
    paymentLink: 'https://buy.stripe.com/test_eVq7sL3sL2KKaq1f5n0RG00',
    portalLoginUrl: 'https://billing.stripe.com/p/login/test_eVq7sL3sL2KKaq1f5n0RG00',
  },
};

/** テスト用ビルド専用のダミー（実在しない値。本番ビルドでは絶対に使われない） */
export const TEST_OWNER_DUMMY: OwnerLegalInfo = {
  sellerName: '（テスト用ダミー事業者）',
  addressDisclosure: 'on_request',
  address: null,
  phoneDisclosure: 'on_request',
  phone: null,
  supportEmail: 'test-dummy@example.invalid',
  taxNote: '（テスト用ダミー）税の表示',
  refundPolicy: '（テスト用ダミー）返金条件',
  effectiveDate: '2000-01-01',
  responseTimeNote: null,
};
