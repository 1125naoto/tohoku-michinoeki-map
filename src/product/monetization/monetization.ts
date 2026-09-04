/**
 * 広告・スポンサー掲載（宿泊アフィリエイト、飲食予約、観光チケット、自治体タイアップ等）を
 * 中央管理する抽象化。個々の広告サービスSDK固有コードを画面側に散らばらせないための境界。
 *
 * kind:'ad'（広告）と kind:'sponsored'（PR/タイアップ掲載）は、ユーザーへ表示する際に
 * 明確に区別できるよう型レベルで分離してある（例: sponsored には必ず sponsorName を持たせる）。
 */
export const PLACEMENTS = ['MAP_BOTTOM', 'STATION_DETAIL', 'NEARBY_RESULTS', 'ROUTE_RESULT'] as const;
export type PlacementId = (typeof PLACEMENTS)[number];

export interface AdContent {
  kind: 'ad';
  id: string;
  networkName: string;
}

export interface SponsoredContent {
  kind: 'sponsored';
  id: string;
  sponsorName: string;
  title: string;
  body: string;
  url: string;
  /** 表示終了日 (YYYY-MM-DD)。過ぎたら出さない */
  expiresAt: string | null;
}

export type MonetizationContent = AdContent | SponsoredContent;

export interface MonetizationProvider {
  /**
   * この掲載枠に出す内容を返す。PREMIUM(AD_FREE)ユーザーの広告非表示判定は
   * プロバイダ実装ではなく呼び出し側がentitlement.hasFeature('AD_FREE')で行う
   * （収益化ロジックと課金ロジックを混在させないため）。
   */
  getContent(placement: PlacementId): MonetizationContent | null;
}

/** Phase1のデフォルト実装。実際の広告/タイアップ枠は後続Phaseで差し替える */
export class NullMonetizationProvider implements MonetizationProvider {
  getContent(): MonetizationContent | null {
    return null;
  }
}

/** 呼び出し側が使う唯一の判定関数。広告非表示(AD_FREE)ならプロバイダを呼ばずnullを返す */
export function resolveMonetizationContent(
  provider: MonetizationProvider,
  placement: PlacementId,
  hasAdFree: boolean,
): MonetizationContent | null {
  if (hasAdFree) return null;
  return provider.getContent(placement);
}
