/**
 * 「道の駅ナビ 全国版」公式ホームページ＋販売LP の設定。
 *
 * このサイトは、独自ドメインの直下（https://michinavi.jp/ を想定）に置く「正式URL（SOURCE OF TRUTH）」用。
 * ドメインが確定・稼働するまでは、プレビュー（noindex・canonicalはプレビューURL）として動く。
 * 公開URLを切り替えるときに変えるのは、このファイルの `live` だけ（ビルド時は OFFICIAL_LIVE=1 でも上書きできる）。
 *
 * 公開リポジトリなので、秘密値は入れない（LINEの友だち追加URL・Search Consoleの確認トークンは公開されるURL/値）。
 */
import { MONITOR_CONFIG } from '../monitorSite/config';

export interface OfficialConfig {
  /** 商品名（Stripe商品名・特商法のサービス名と一致） */
  productName: string;
  /** 略称（検索で使われる呼び方）。本文には自然な形で1〜2回だけ出す */
  nickname: string;
  /** 「全国○○施設を収録」（アプリのデータ件数と一致することをテストで保証） */
  stationCount: number;
  /** 公式ドメイン（末尾に / を付ける）。SOURCE OF TRUTH */
  siteOrigin: string;
  /**
   * 公式ドメインが本物として稼働し、検索エンジンへ出してよいか。
   * false=プレビュー（noindex、canonical/OGPはプレビューURL、robots.txtは全拒否）。
   * ドメインを実際に保有・接続できたことを確認してからtrueにする。
   */
  live: boolean;
  /**
   * LINE公式アカウントの友だち追加URL（https://lin.ee/… 等）。未確定の間は null のまま
   * （nullの間、LINEのCTAはページに一切出ない）。設定すると、ページ内のすべてのLINE CTAに反映される。
   */
  lineUrl: string | null;
  /** Google Search Console の「HTMLタグ」確認用トークン（meta google-site-verification）。未取得なら null */
  googleSiteVerification: string | null;
  /** 短い流入元パラメータ（?s=t など）と、Stripeの購入記録へ渡す名前 */
  sources: Record<string, string>;
}

export const OFFICIAL_CONFIG: OfficialConfig = {
  productName: MONITOR_CONFIG.productName, // 道の駅ナビ 全国版
  nickname: '道ナビ',
  stationCount: MONITOR_CONFIG.stationCount,
  siteOrigin: 'https://michinavi.jp/',
  live: false,
  lineUrl: null,
  googleSiteVerification: null,
  sources: { t: 'tiktok', l: 'line', x: 'x', y: 'youtube' },
};

/** LINE公式アカウントの友だち追加URLとして受け付ける形式（架空・仮のURLを公開しないための検証） */
const LINE_URL_RE = /^https:\/\/(lin\.ee\/[A-Za-z0-9_-]+|line\.me\/R\/ti\/p\/@?[A-Za-z0-9._-]+|page\.line\.me\/[A-Za-z0-9@._-]+)$/;
export function isValidLineUrl(u: string | null | undefined): u is string {
  return typeof u === 'string' && LINE_URL_RE.test(u);
}
