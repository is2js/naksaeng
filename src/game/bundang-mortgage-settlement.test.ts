import { describe, expect, it } from 'vitest';
import {
  BUNDANG_MORTGAGE_SETTLEMENT_SOURCE_V1,
  calculateBundangMortgageSettlement,
  type BundangMortgageSettlementInputV1,
} from './bundang-mortgage-settlement';

const scenario: BundangMortgageSettlementInputV1 = {
  loanBaseWon: 500_000_000,
  principalWon: 350_000_000,
  annualRateBps: 130,
  termYears: 30,
  holdingYears: 10,
  childCount: 0,
  salePriceWon: 800_000_000,
};

describe('dedicated mortgage sale/appraisal scenario', () => {
  it('uses the actual agreement year rows, not interpolation between summary rows', () => {
    const years = [3, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 30];
    const expected70 = [50, 50, 48, 46, 44, 42, 40, 38, 36, 34, 32, 30, 28, 26, 24, 22, 20, 20];
    expect(years.map((holdingYears) => calculateBundangMortgageSettlement({ ...scenario, holdingYears }).fundSharePercent)).toEqual(expected70);
    // Floors of 15% and 10% are discrete table entries, not summary interpolation.
    expect(calculateBundangMortgageSettlement({ ...scenario, principalWon: 150_000_000, holdingYears: 11, childCount: 1 }).fundSharePercent).toBe(15);
    expect(calculateBundangMortgageSettlement({ ...scenario, principalWon: 200_000_000, holdingYears: 11, childCount: 2 }).fundSharePercent).toBe(10);
    expect(calculateBundangMortgageSettlement({ ...scenario, principalWon: 300_000_000, holdingYears: 21 }).fundSharePercent).toBe(20);
    expect(calculateBundangMortgageSettlement({ ...scenario, holdingYears: 21, childCount: 1 }).fundSharePercent).toBe(15);
  });

  it('matches all five official LTV and three child columns at the 10-year row', () => {
    const expected = [
      [70, [48, 38, 28]], [60, [43, 33, 23]], [50, [38, 28, 18]],
      [40, [33, 23, 13]], [30, [28, 18, 10]],
    ] as const;
    for (const [ltv, shares] of expected) {
      shares.forEach((share, childCount) => {
        const result = calculateBundangMortgageSettlement({ ...scenario, principalWon: scenario.loanBaseWon * ltv / 100, childCount });
        expect(result.effectiveLtvPercent).toBe(ltv);
        expect(result.fundSharePercent).toBe(share);
      });
    }
    expect(calculateBundangMortgageSettlement({ ...scenario, childCount: 3 }).fundSharePercent).toBe(28);
  });

  it('truncates actual LTV only for a capped loan and then interpolates the correct row', () => {
    const result = calculateBundangMortgageSettlement({ ...scenario, loanBaseWon: 645_000_000, principalWon: 400_000_000 });
    expect(result.effectiveLtvPercent).toBe(62);
    expect(result.fundSharePercent).toBe(44);
    expect(result.fundSettlementWon).toBe(68_200_000);
    const bucketRounding = calculateBundangMortgageSettlement({ ...scenario, loanBaseWon: 500_000_001, principalWon: 350_000_001 });
    expect(bucketRounding.effectiveLtvPercent).toBe(70);
  });

  it.each([
    [570_000_000, 399_000_000, 70, 38, 163_400_000],
    [700_000_000, 400_000_000, 57, 31.5, 94_500_000],
    [572_000_000, 400_000_000, 69, 37.5, 160_500_000],
  ])('matches the supplied product explanation example for a %i won acquisition', (loanBaseWon, principalWon, effectiveLtvPercent, fundSharePercent, fundSettlementWon) => {
    const result = calculateBundangMortgageSettlement({ ...scenario, loanBaseWon, principalWon,
      termYears: 20, holdingYears: 10, childCount: 1, salePriceWon: 1_000_000_000 });
    expect(result).toMatchObject({ effectiveLtvPercent, fundSharePercent, fundSettlementWon });
  });

  it('matches every column and yearly row in the supplied product settlement table', () => {
    const rows = [
      [9,  [50,40,30,45,35,25,40,30,20,35,25,15,30,20,10]],
      [10, [48,38,28,43,33,23,38,28,18,33,23,13,28,18,10]],
      [11, [46,36,26,41,31,21,36,26,16,31,21,10,26,15,10]],
      [12, [44,34,24,39,29,19,34,24,14,29,19,10,24,15,10]],
      [13, [42,32,22,37,27,17,32,22,12,27,17,10,22,15,10]],
      [14, [40,30,20,35,25,15,30,20,10,25,15,10,20,15,10]],
      [15, [38,28,18,33,23,13,28,18,10,23,15,10,20,15,10]],
      [16, [36,26,16,31,21,10,26,15,10,20,15,10,20,15,10]],
      [17, [34,24,14,29,19,10,24,15,10,20,15,10,20,15,10]],
      [18, [32,22,12,27,17,10,22,15,10,20,15,10,20,15,10]],
      [19, [30,20,10,25,15,10,20,15,10,20,15,10,20,15,10]],
      [20, [28,18,10,23,15,10,20,15,10,20,15,10,20,15,10]],
      [21, [26,15,10,20,15,10,20,15,10,20,15,10,20,15,10]],
      [22, [24,15,10,20,15,10,20,15,10,20,15,10,20,15,10]],
      [23, [22,15,10,20,15,10,20,15,10,20,15,10,20,15,10]],
      [24, [20,15,10,20,15,10,20,15,10,20,15,10,20,15,10]],
    ] as const;
    for (const [holdingYears, shares] of rows) {
      for (const [column, expected] of shares.entries()) {
        const ltv = [70, 60, 50, 40, 30][Math.floor(column / 3)]!;
        const result = calculateBundangMortgageSettlement({ ...scenario, holdingYears,
          principalWon: scenario.loanBaseWon * ltv / 100, childCount: column % 3 });
        expect(result.fundSharePercent, `${holdingYears} years / ${ltv}% / ${column % 3} children`).toBe(expected);
      }
    }
    for (const holdingYears of [25, 26, 27, 28, 29, 30]) {
      expect(calculateBundangMortgageSettlement({ ...scenario, holdingYears, childCount: 1 }).fundSharePercent).toBe(15);
    }
  });

  it.each([
    [899_999_999, 1_000_000_000, 'below-appraisal-threshold'],
    [900_000_000, 1_000_000_000, 'below-appraisal-threshold'],
    [900_000_001, 900_000_001, 'sale-price'],
    [1_100_000_000, 1_100_000_000, 'sale-price'],
  ])('uses the exact ten-percent appraisal safeguard for a notified %i won sale', (salePriceWon, settlementBasisWon, settlementBasisReason) => {
    const result = calculateBundangMortgageSettlement({ ...scenario, salePriceWon, appraisedPriceWon: 1_000_000_000 });
    expect(result).toMatchObject({ settlementKind: 'sale', settlementBasisWon, settlementBasisReason, appraisalRequired: false });
    expect(result.appreciationWon).toBe(settlementBasisWon - scenario.loanBaseWon);
    expect(result.netSaleProceedsWon).toBe(salePriceWon - result.remainingPrincipalWon - result.fundSettlementWon);
  });

  it.each([
    [950_000_000, 1_000_000_000],
    [1_100_000_000, 1_100_000_000],
  ])('uses the higher sale/appraisal value for an unnotified %i won sale', (salePriceWon, settlementBasisWon) => {
    const result = calculateBundangMortgageSettlement({ ...scenario, salePriceWon,
      appraisedPriceWon: 1_000_000_000, salePlanNotified: false });
    expect(result).toMatchObject({ settlementBasisWon, settlementBasisReason: 'unnotified-sale-or-appraisal', appraisalRequired: false });
    expect(result.netSaleProceedsWon).toBe(salePriceWon - result.remainingPrincipalWon - result.fundSettlementWon);
  });

  it('keeps legacy sale estimates but flags missing appraisal instead of implying a verified settlement', () => {
    const result = calculateBundangMortgageSettlement(scenario);
    expect(result).toMatchObject({ settlementKind: 'sale', settlementBasisWon: scenario.salePriceWon,
      settlementBasisReason: 'sale-estimate', appraisalRequired: true });
    expect(result.totalLoanSettlementWon).toBe(result.remainingPrincipalWon + result.fundSettlementWon);
    expect(calculateBundangMortgageSettlement({ ...scenario, salePlanNotified: false }).appraisalRequired).toBe(true);
  });

  it('values full repayment without sale using appraisal and does not invent sale cash', () => {
    const result = calculateBundangMortgageSettlement({ ...scenario, settlementKind: 'repayment',
      appraisedPriceWon: 800_000_000, salePriceWon: 0 });
    expect(result).toMatchObject({ settlementKind: 'repayment', settlementBasisWon: 800_000_000,
      settlementBasisReason: 'repayment-appraisal', appraisalRequired: false,
      appreciationWon: 300_000_000, fundSettlementWon: 144_000_000, netSaleProceedsWon: 0 });
    expect(result.totalLoanSettlementWon).toBe(result.remainingPrincipalWon + 144_000_000);
    expect(() => calculateBundangMortgageSettlement({ ...scenario, settlementKind: 'repayment' })).toThrow('시세감정가격');
  });

  it('uses supply plus balcony as acquisition base, with zero sharing on losses', () => {
    const result = calculateBundangMortgageSettlement(scenario);
    expect(result.appreciationWon).toBe(300_000_000);
    expect(result.fundSettlementWon).toBe(144_000_000);
    expect(result.netSaleProceedsWon).toBe(800_000_000 - result.remainingPrincipalWon - 144_000_000);
    const loss = calculateBundangMortgageSettlement({ ...scenario, salePriceWon: 400_000_000 });
    expect(loss.appreciationWon).toBe(0);
    expect(loss.fundSettlementWon).toBe(0);
    const gap = calculateBundangMortgageSettlement({ ...scenario, salePriceWon: 0 });
    expect(gap.netSaleProceedsWon).toBe(-gap.remainingPrincipalWon);
  });

  it('includes one interest-only year and amortizes the remaining 19/29 years', () => {
    const principalWon = 350_000_000;
    for (const termYears of [20, 30] as const) {
      const interestFree = calculateBundangMortgageSettlement({ ...scenario, termYears, holdingYears: 3, annualRateBps: 0 });
      expect(interestFree.remainingPrincipalWon).toBe(Math.round(principalWon * (1 - 24 / ((termYears - 1) * 12))));
      expect(interestFree.paidInterestWon).toBe(0);
      const result = calculateBundangMortgageSettlement({ ...scenario, termYears, holdingYears: 3 });
      const monthlyRate = 0.013 / 12;
      const count = (termYears - 1) * 12;
      const payment = principalWon * monthlyRate / (1 - (1 + monthlyRate) ** -count);
      const balance = principalWon * (1 + monthlyRate) ** 24 - payment * ((1 + monthlyRate) ** 24 - 1) / monthlyRate;
      expect(result.remainingPrincipalWon).toBe(Math.round(balance));
      expect(result.repaidPrincipalWon + result.remainingPrincipalWon).toBe(principalWon);
      expect(result.paidInterestWon).toBe(Math.round(principalWon * 0.013 + payment * 24 - (principalWon - balance)));
      const maturity = calculateBundangMortgageSettlement({ ...scenario, termYears, holdingYears: termYears });
      expect(maturity.remainingPrincipalWon).toBe(0);
      expect(maturity.repaidPrincipalWon).toBe(principalWon);
      expect(maturity.paidInterestWon).toBeGreaterThan(result.paidInterestWon);
    }
  });

  it('retains official provenance and rejects impossible or nonfinite scenarios', () => {
    expect(BUNDANG_MORTGAGE_SETTLEMENT_SOURCE_V1.agreementRevisedAt).toBe('2025-12-01');
    expect(BUNDANG_MORTGAGE_SETTLEMENT_SOURCE_V1.checkedAt).toBe('2026-11-07');
    expect(BUNDANG_MORTGAGE_SETTLEMENT_SOURCE_V1.productExplanationUrl).toBe('documents/shinhui-mortgage-product-20261107.pdf');
    const invalid: Partial<BundangMortgageSettlementInputV1>[] = [
      { loanBaseWon: 0 }, { loanBaseWon: NaN }, { principalWon: -1 }, { principalWon: 0 },
      { principalWon: 149_000_000 }, { principalWon: 351_000_000 }, { principalWon: 401_000_000, loanBaseWon: 700_000_000 },
      { principalWon: 310_000_000 }, { holdingYears: 2 }, { holdingYears: 31 }, { holdingYears: 3.5 },
      { annualRateBps: -1 }, { annualRateBps: NaN }, { childCount: -1 }, { childCount: 1.5 },
      { salePriceWon: -1 }, { salePriceWon: Infinity }, { salePriceWon: 10.5 },
      { appraisedPriceWon: -1 }, { appraisedPriceWon: NaN }, { appraisedPriceWon: Infinity }, { appraisedPriceWon: 0.5 },
      { appraisedPriceWon: Number.MAX_SAFE_INTEGER + 1 },
      { settlementKind: 'gift' as BundangMortgageSettlementInputV1['settlementKind'] },
      { salePlanNotified: 'false' as unknown as boolean },
    ];
    for (const input of invalid) expect(() => calculateBundangMortgageSettlement({ ...scenario, ...input })).toThrow();
    expect(() => calculateBundangMortgageSettlement({ ...scenario, termYears: 25 as 20 })).toThrow();
  });
});
