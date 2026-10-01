/**
 * 「道の駅ナビ 全国版」販売サイトの設定（月額プラン・年間プラン。Stripe Payment Linkで決済）。
 *
 * このファイルは**公開リポジトリ**にコミットされる。したがって:
 *  - 事業者情報は、Ownerが既に公開している特商法表記と同一の事実だけを入れる（住所・電話は請求開示方式のため保持しない）。
 *    未確認の個人情報を推測で入れない。
 *  - Stripeの秘密鍵・Webhook秘密は絶対に入れない。Payment Link / Customer Portal のURLは
 *    公開前提のURLで秘密ではない。
 *  - `owner` の必須項目と `live` の購入URL（月額・年間のPayment Link）が揃うまで、販売サイトは「受付準備中」表示のままになり、
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
  /** 販売価格（月額プラン・年間プランとも）が税込か。true=税込 / false=税別 / null=未確認。Owner確認が必要 */
  priceTaxInclusive: boolean | null;
  /** 返金・キャンセル条件（特商法の必須記載）。Owner確認が必要 */
  refundPolicy: string | null;
  /** 制定・施行日 YYYY-MM-DD */
  effectiveDate: string | null;
  /** 任意: 利用案内メールをお送りするまでの目安など */
  responseTimeNote: string | null;
}

export interface StripeUrls {
  /** 月額プランのStripe Payment Link（導入価格のPrice。3か月目からの切替は scripts/apply-intro-schedules.mjs） */
  monthlyPaymentLink: string | null;
  /** 年間プランのStripe Payment Link */
  annualPaymentLink: string | null;
  /** Stripe Customer Portal のログインページ（解約・お支払い管理）。任意（未設定なら、解約はメールで受け付ける表示になる） */
  portalLoginUrl: string | null;
}

export interface PricingConfig {
  monthly: {
    /** 最初の introMonths か月（= 最初の introMonths 回のお支払い）の月額 */
    introPriceYen: number;
    introMonths: number;
    /** introMonths+1 か月目以降の月額（Stripeのサブスクリプションスケジュールで自動的に切り替わる） */
    regularPriceYen: number;
  };
  annual: {
    priceYen: number;
  };
}

export interface MonitorConfig {
  appName: string;
  /** 商品名（Stripe商品名・特商法のサービス名と一致させる） */
  productName: string;
  /** 「全国○○施設を収録」の施設数。アプリのデータ件数と一致することをテストで保証する */
  stationCount: number;
  /** 公開アプリ本体のURL（販売LPには載せず、決済後のご案内ページにのみ載せる） */
  appUrl: string;
  /** 料金（税込/税別は owner.priceTaxInclusive）。文言はすべて pricing.ts がここから生成する */
  pricing: PricingConfig;
  /**
   * Ownerが「販売開始」を承認したか。falseの間は、Live URLや事業者情報が揃っていても購入ボタンを出さず
   * 「受付準備中」のまま（誤って実課金の導線を公開しないための最後のスイッチ）。
   */
  salesLaunchApproved: boolean;
  owner: OwnerLegalInfo;
  /** Live（本番）のURL。Ownerが Stripe Live で作成後に設定する */
  live: StripeUrls;
  /** Test mode のURL。テスト用ビルド（MONITOR_MODE=test）専用で、本番ビルドには出力されない */
  test: StripeUrls;
}

export const MONITOR_CONFIG: MonitorConfig = {
  appName: '道の駅ナビ',
  productName: '道の駅ナビ 全国版',
  stationCount: 1237,
  appUrl: 'https://1125naoto.github.io/tohoku-michinoeki-map/',
  //: 2026-10-01 Owner決定の料金体系（「先行モニター／正式版予定価格」方式は終了）
  pricing: {
    monthly: { introPriceYen: 250, introMonths: 2, regularPriceYen: 500 },
    annual: { priceYen: 4980 },
  },
  //: 2026-09-20: Ownerの本番公開指示（Production公開→Payment CTA・Customer Portal CTAの本番確認→Stripe「リンクを更新する」）
  //: をもって販売開始を承認。誤って戻したい場合はfalseにする（購入ボタンとStripeへのリンクが全ページから消え、noindexの受付準備中に戻る）。
  salesLaunchApproved: true,
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
    priceTaxInclusive: true,
    refundPolicy: 'デジタルサービス（月額サービス）の性質上、お支払い済みの期間については、原則として返金いたしません。ただし、法令上必要な場合、重複してご請求した場合、運営者側の決済上の事故があった場合などは、この限りではありません。その場合は、お問い合わせください。',
    effectiveDate: '2026-09-19',
    responseTimeNote: null,
  },
  //: Stripe Live（商品「道の駅ナビ 全国版」prod_VHqkd8f4kNSm2y）。公開URLで秘密ではない。
  //: 月額: plink_1ULl7HICXxuNXmZyoI24UDAL（price_1ULl7FICXxuNXmZymoNS8hQH ¥250/月。3か月目から
  //:   price_1ULkA5ICXxuNXmZyTAcQqpvZ ¥500/月へ scripts/apply-intro-schedules.mjs が自動で切り替える）
  //: 年間: plink_1ULkBFICXxuNXmZyW4nGOkkm（price_1ULkA7ICXxuNXmZybRGXYs1h ¥4,980/年）
  //: 旧・月額250円固定のPayment Link（plink_1UHH4S…, https://buy.stripe.com/bJe5kE3eheQO8XYaa07Zu00）は新規販売に使わない。
  live: {
    monthlyPaymentLink: 'https://buy.stripe.com/bJe00kbKNgYW6PQ95W7Zu09',
    annualPaymentLink: 'https://buy.stripe.com/9B6fZi5mp9wu7TU4PG7Zu08',
    // 同じStripe Live上のCustomer Portal公開ログインURL（購入者が契約内容・お支払い方法の確認と解約を行う）。公開URLで秘密ではない。
    portalLoginUrl: 'https://billing.stripe.com/p/login/bJe5kE3eheQO8XYaa07Zu00',
  },
  test: {
    // Stripe Test mode（実課金は発生しない）: prod_VHnEmi8owLfA7e / price_1UHDe0EtgcvJ6JiZ0hg8uRsq /
    // plink_1UHDeEEtgcvJ6JiZDk1SLopC / bpc_1UHDeSEtgcvJ6JiZOBvG8giu
    // 新料金のTest mode用オブジェクトは無い（Live CLIにTest modeの権限が無い）ため、QAビルドでは両プランとも既存のTest用リンクを使う。
    monthlyPaymentLink: 'https://buy.stripe.com/test_eVq7sL3sL2KKaq1f5n0RG00',
    annualPaymentLink: 'https://buy.stripe.com/test_eVq7sL3sL2KKaq1f5n0RG00',
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
  priceTaxInclusive: true,
  refundPolicy: '（テスト用ダミー）返金条件',
  effectiveDate: '2000-01-01',
  responseTimeNote: null,
};
