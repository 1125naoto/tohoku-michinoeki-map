/**
 * 「道の駅ナビ 全国版」新リリース・モニター販売サイトの設定（月額250円・Stripe Payment Linkで決済）。
 *
 * このファイルは**公開リポジトリ**にコミットされる。したがって:
 *  - 事業者情報は、Ownerが既に公開している特商法表記と同一の事実だけを入れる（住所・電話は請求開示方式のため保持しない）。
 *    未確認の個人情報を推測で入れない。
 *  - Stripeの秘密鍵・Webhook秘密は絶対に入れない。Payment Link / Customer Portal のURLは
 *    公開前提のURLで秘密ではない。
 *  - `owner` の必須項目と `live.paymentLink` が揃うまで、販売サイトは「受付準備中」表示のままになり、
 *    申込ボタンは出ない（evaluateSalesGate）。テスト用URLが本番ビルドへ混入することもない。
 *    `live.portalLoginUrl`（解約・お支払い管理ページ）は任意。未設定の間は、解約はお問い合わせメールで受け付ける旨を表示する。
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
  /** 先行モニター価格（月額250円）が税込か。true=税込 / false=税別 / null=未確認。Owner確認が必要 */
  monitorPriceTaxInclusive: boolean | null;
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
  /** Stripe Customer Portal のログインページ（解約・お支払い管理）。任意（未設定なら、解約はメールで受け付ける表示になる） */
  portalLoginUrl: string | null;
}

export interface MonitorConfig {
  appName: string;
  /** 商品名（Stripe商品名・特商法のサービス名と一致させる） */
  productName: string;
  /** 月額250円のプランの呼称（「無料モニター」と誤認させない） */
  planName: string;
  /** 「全国○○施設を収録」の施設数。アプリのデータ件数と一致することをテストで保証する */
  stationCount: number;
  /** 公開アプリ本体のURL（販売LPには載せず、決済後のご案内ページにのみ載せる） */
  appUrl: string;
  monitorPriceYen: number;
  plannedFullPriceYen: number;
  owner: OwnerLegalInfo;
  /** Live（本番）のURL。Ownerが Stripe Live で作成後に設定する */
  live: StripeUrls;
  /** Test mode のURL。テスト用ビルド（MONITOR_MODE=test）専用で、本番ビルドには出力されない */
  test: StripeUrls;
}

export const MONITOR_CONFIG: MonitorConfig = {
  appName: '道の駅ナビ',
  productName: '道の駅ナビ 全国版',
  planName: '新リリース・モニター価格',
  stationCount: 1237,
  appUrl: 'https://1125naoto.github.io/tohoku-michinoeki-map/',
  monitorPriceYen: 250,
  plannedFullPriceYen: 500,
  //: Ownerが既に確認・公開している事業者情報（お宝ファインダーの特商法ページ／Business OSの
  //: LEGAL_* 設定と同一の事実）から再利用した共通の事業者情報。2026-09-19。
  //: 返金・解約・税・制定日は道の駅ナビ用にOwnerが指定した暫定方針（Owner review required）。
  owner: {
    sellerName: '奥山 直人',
    addressDisclosure: 'on_request',
    address: null,
    phoneDisclosure: 'on_request',
    phone: null,
    supportEmail: 'otakarafinder.info@gmail.com',
    monitorPriceTaxInclusive: true,
    refundPolicy: 'デジタルサービス（月額サービス）の性質上、お支払い済みの期間については、原則として返金いたしません。ただし、法令上必要な場合、重複してご請求した場合、運営者側の決済上の事故があった場合などは、この限りではありません。その場合は、お問い合わせください。',
    effectiveDate: '2026-09-19',
    responseTimeNote: null,
  },
  live: {
    // Ownerが本番（Live）で作成済みのPayment Link（商品「道の駅ナビ 全国版」・￥250/月）。公開URLで秘密ではない。
    paymentLink: 'https://buy.stripe.com/bJe5kE3eheQO8XYaa07Zu00',
    // 解約・お支払い管理のログインURL（Stripe Dashboard → 設定 → Billing → カスタマーポータル）。未提供のため未設定。
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
  monitorPriceTaxInclusive: true,
  refundPolicy: '（テスト用ダミー）返金条件',
  effectiveDate: '2000-01-01',
  responseTimeNote: null,
};
