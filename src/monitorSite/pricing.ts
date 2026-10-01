/**
 * 販売サイト（/monitor/）・公式サイト・アプリのゲート画面で使う料金表示の文言を、
 * config.ts の構造化された料金（PricingConfig）だけから生成する（ページごとに数字を書かない）。
 *
 * 誤認を防ぐための方針:
 *  - 主表示は「月額プラン 最初の2か月 250円/月・3か月目以降 500円/月」「年間プラン 4,980円/年」だけ。
 *  - 「通常価格」「○%OFF」等の二重価格表示はしない。
 *  - 年間プランの比較を出すときは、比較の基準（500円/月×12か月）と、月額プランの初年度の実際の
 *    お支払い合計（250円×2か月＋500円×10か月）を必ず併記する。
 */
import type { PricingConfig } from './config';

/** 4980 → '4,980円' */
export const yenOf = (n: number): string => `${n.toLocaleString('en-US')}円`;

export interface PricingText {
  /** '（税込）' / '（税別）' / ''（未確認） */
  tax: string;
  /** '最初の2か月' */
  introPeriod: string;
  /** '3か月目以降' */
  regularPeriod: string;
  /** '250円/月' */
  introPerMonth: string;
  /** '500円/月' */
  regularPerMonth: string;
  /** '4,980円/年' */
  annualPerYear: string;
  /** '月額プラン：最初の2か月 250円/月、3か月目以降 500円/月（税込）' */
  monthlySummary: string;
  /** '年間プラン：4,980円/年（税込）' */
  annualSummary: string;
  /** 月額プランの切り替わりの説明（再申込み不要であること） */
  monthlyTransition: string;
  /** 年間プランの比較（基準と月額プランの初年度合計を併記） */
  annualComparison: string;
  /** 月額プランを12か月続けた場合の初年度のお支払い合計 */
  monthlyFirstYearTotalYen: number;
  /** 3か月目以降の月額×12か月 */
  regularTwelveMonthsYen: number;
  /** regularTwelveMonthsYen - 年額 */
  annualSavingVsRegularYen: number;
}

export function pricingText(p: PricingConfig, taxInclusive: boolean | null): PricingText {
  const tax = taxInclusive === null ? '' : taxInclusive ? '（税込）' : '（税別）';
  const { introPriceYen, introMonths, regularPriceYen } = p.monthly;
  const introPeriod = `最初の${introMonths}か月`;
  const regularPeriod = `${introMonths + 1}か月目以降`;
  const introPerMonth = `${yenOf(introPriceYen)}/月`;
  const regularPerMonth = `${yenOf(regularPriceYen)}/月`;
  const annualPerYear = `${yenOf(p.annual.priceYen)}/年`;
  const monthlyFirstYearTotalYen = introPriceYen * introMonths + regularPriceYen * (12 - introMonths);
  const regularTwelveMonthsYen = regularPriceYen * 12;
  const annualSavingVsRegularYen = regularTwelveMonthsYen - p.annual.priceYen;
  return {
    tax,
    introPeriod,
    regularPeriod,
    introPerMonth,
    regularPerMonth,
    annualPerYear,
    monthlySummary: `月額プラン：${introPeriod} ${introPerMonth}、${regularPeriod} ${regularPerMonth}${tax}`,
    annualSummary: `年間プラン：${annualPerYear}${tax}`,
    monthlyTransition: `月額プランは、${introPeriod}（${introMonths}回目のお支払いまで）が${introPerMonth}、${regularPeriod}（${introMonths + 1}回目のお支払いから）は自動で${regularPerMonth}になります。切り替えのための再度のお申込みは不要です。`,
    annualComparison: `年間プランは、${regularPerMonth}で12か月分（${yenOf(regularTwelveMonthsYen)}）と比べて${yenOf(annualSavingVsRegularYen)}お得です。なお、月額プランの初年度のお支払い合計は${yenOf(monthlyFirstYearTotalYen)}（${yenOf(introPriceYen)}×${introMonths}か月＋${yenOf(regularPriceYen)}×${12 - introMonths}か月）です。`,
    monthlyFirstYearTotalYen,
    regularTwelveMonthsYen,
    annualSavingVsRegularYen,
  };
}
