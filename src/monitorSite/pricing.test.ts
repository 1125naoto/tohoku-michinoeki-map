import { describe, expect, it } from 'vitest';
import { MONITOR_CONFIG } from './config';
import { pricingText, yenOf } from './pricing';

describe('料金表示（新料金体系）', () => {
  const t = pricingText(MONITOR_CONFIG.pricing, true);

  it('主表示: 月額プラン 最初の2か月 250円/月・3か月目以降 500円/月、年間プラン 4,980円/年（税込）', () => {
    expect(t.monthlySummary).toBe('月額プラン：最初の2か月 250円/月、3か月目以降 500円/月（税込）');
    expect(t.annualSummary).toBe('年間プラン：4,980円/年（税込）');
  });

  it('年間プランの比較は基準（500円/月×12か月=6,000円）と月額プランの初年度実額（5,500円）を併記する', () => {
    expect(t.regularTwelveMonthsYen).toBe(6000);
    expect(t.annualSavingVsRegularYen).toBe(1020);
    expect(t.monthlyFirstYearTotalYen).toBe(5500);
    expect(t.annualComparison).toContain('500円/月で12か月分（6,000円）と比べて1,020円お得');
    expect(t.annualComparison).toContain('月額プランの初年度のお支払い合計は5,500円（250円×2か月＋500円×10か月）');
  });

  it('切替は自動で、再申込み不要と明記する', () => {
    expect(t.monthlyTransition).toContain('3回目のお支払いから）は自動で500円/月');
    expect(t.monthlyTransition).toContain('再度のお申込みは不要');
  });

  it('税込・税別が未確認なら税表示を付けない（推測で書かない）', () => {
    expect(pricingText(MONITOR_CONFIG.pricing, null).tax).toBe('');
    expect(pricingText(MONITOR_CONFIG.pricing, false).tax).toBe('（税別）');
  });

  it('金額は3桁区切り', () => {
    expect(yenOf(4980)).toBe('4,980円');
  });
});
