import { describe, expect, it } from 'vitest';
import { buildBundangFinancingTimeline } from './bundang-financing-timeline';
import { calculateBundangMoveInSettlement } from './bundang-move-in-finance';
import { calculateBundangSaleFinance, type BundangPaymentPlanKind } from './bundang-sale-finance';

const plans = ['main-subscription', 'pre-subscription'] as const;
const cases = ['separate-option-contract', 'no-separate-option-contract', 'minus-option'] as const;

function contract(plan: BundangPaymentPlanKind, scenario: typeof cases[number]) {
  return calculateBundangSaleFinance({
    household: { unitType: '55A', floorBand: 5 }, paymentPlanKind: plan,
    selectMinusOption: scenario === 'minus-option',
    optionLines: [
      { id: 'system-ac', label: '시스템에어컨', tier: 'option-ii', priceWon: 3_600_000 },
      ...(scenario !== 'no-separate-option-contract' ? [{
        id: 'wide-floor', label: '광폭 강마루', tier: 'option-iii' as const, priceWon: 1_820_000,
      }] : []),
    ],
  });
}

describe('Bundang contract and financing timeline', () => {
  it.each([
    { plan: 'main-subscription', first: '2027-04-12', housingLoan: 63_651_000, balcony: 1_027_600, aircon: 1_080_000, other: 546_000 },
    { plan: 'pre-subscription', first: '2028-02-14', housingLoan: 127_302_000, balcony: 1_027_600, aircon: 720_000, other: 364_000 },
  ] as const)('$plan lends only housing and leaves each option interim for direct payment', ({ plan, first, housingLoan, balcony, aircon, other }) => {
    const quote = contract(plan, 'separate-option-contract');
    const result = buildBundangFinancingTimeline({ paymentSchedules: quote.paymentSchedules, interimFunding: 'loan' });
    const amountOn = (target: string, due: string) => quote.paymentSchedules
      .filter((schedule) => schedule.target === target)
      .flatMap((schedule) => schedule.installments)
      .filter((installment) => installment.due === due)
      .reduce((sum, installment) => sum + installment.amountWon, 0);
    const firstRow = result.rows.find((row) => row.dueKey === first)!;
    expect(amountOn('supply', first)).toBe(housingLoan);
    expect(amountOn('balcony', first)).toBe(balcony);
    expect(amountOn('option-ii', first)).toBe(aircon);
    expect(firstRow.groupLoanDrawWon).toBe(housingLoan);
    expect(firstRow.cashDueWon).toBe(balcony + aircon);
    expect(amountOn('option-iii', '별도 안내')).toBe(other);
    const otherRow = result.rows.find((row) => row.dueKey === '별도 안내')!;
    expect(otherRow.groupLoanDrawWon).toBe(0);
    expect(otherRow.cashDueWon).toBe(other);
    if (plan === 'main-subscription') {
      const second = result.rows.find((row) => row.dueKey === '2028-02-14')!;
      expect(second.groupLoanDrawWon).toBe(63_651_000);
      expect(second.cashDueWon).toBe(0);
    }
  });

  for (const plan of plans) for (const scenario of cases) {
    it(`${plan}: ${scenario} borrows on each supply interim date and settles interest only at move-in`, () => {
      const quote = contract(plan, scenario);
      const before = JSON.stringify(quote.paymentSchedules);
      const result = buildBundangFinancingTimeline({
        paymentSchedules: quote.paymentSchedules, interimFunding: 'loan',
        deferredInterestWon: 5_432_100, mortgageAppliedWon: 400_000_000,
      });
      expect(JSON.stringify(quote.paymentSchedules)).toBe(before);
      expect(result.totalContractWon).toBe(quote.contractTotalWon);
      const dates = plan === 'main-subscription' ? ['2027-04-12', '2028-02-14'] : ['2028-02-14'];
      for (const date of dates) {
        const row = result.rows.find((candidate) => candidate.dueKey === date)!;
        expect(row.groupLoanDrawWon).toBe(quote.adjustedSupplyPriceWon * (plan === 'main-subscription' ? 0.1 : 0.2));
        expect(row.cashDueWon).toBe(row.contractDueWon - row.groupLoanDrawWon);
        expect(row.interimRepaymentWon).toBe(0);
        expect(row.deferredInterestWon).toBe(0);
        expect(row.mortgageAppliedWon).toBe(0);
      }
      expect(result.rows.filter((row) => row.deferredInterestWon)).toHaveLength(1);
      const balance = result.rows.at(-1)!;
      expect(balance.dueKey).toBe('입주 시');
      expect(balance.interimRepaymentWon).toBe(quote.adjustedSupplyPriceWon * 0.2);
      expect(balance.deferredInterestWon).toBe(5_432_100);
      expect(balance.mortgageAppliedWon).toBe(400_000_000);
      expect(balance.cashDueWon).toBe(balance.contractDueWon + balance.interimRepaymentWon + 5_432_100 - 400_000_000);
      expect(result.totalGroupLoanDrawWon).toBe(result.totalInterimRepaymentWon);
      expect(result.totalCashDueWon).toBe(quote.contractTotalWon + 5_432_100 - 400_000_000);
      expect(result.rows.some((row) => row.dueKey === '별도 안내')).toBe(scenario === 'separate-option-contract');
      expect(result.rows.some((row) => row.dueKey === '옵션Ⅲ 계약 시')).toBe(scenario === 'separate-option-contract');
      if (scenario === 'separate-option-contract') {
        const initialContract = result.rows.find((row) => row.dueKey === '계약 시')!;
        const laterContract = result.rows.find((row) => row.dueKey === '옵션Ⅲ 계약 시')!;
        const initialExpected = quote.paymentSchedules.filter(schedule => schedule.target !== 'option-iii')
          .flatMap(schedule => schedule.installments).filter(item => item.id === 'contract')
          .reduce((total, item) => total + item.amountWon, 0);
        expect(initialContract.contractDueWon).toBe(initialExpected);
        expect(laterContract.contractDueWon).toBe(1_820_000 * (plan === 'main-subscription' ? 0.1 : 0.05));
        expect(laterContract.cashDueWon).toBe(laterContract.contractDueWon);
        const separate = result.rows.find((row) => row.dueKey === '별도 안내')!;
        expect(separate.contractDueWon).toBe(1_820_000 * (plan === 'main-subscription' ? 0.3 : 0.2));
        expect(separate.cashDueWon).toBe(separate.contractDueWon);
        expect(separate.groupLoanDrawWon).toBe(0);
      }
      const settlement = calculateBundangMoveInSettlement({
        paymentSchedules: quote.paymentSchedules, interimFunding: 'loan',
        interimInterestWon: 5_432_100, mortgagePrincipalWon: 400_000_000,
      });
      expect(balance.cashDueWon).toBe(settlement.requiredCashAtMoveInWon);
      expect(result.totalCashDueWon).toBe(settlement.totalOwnCashWon);
    });

    it(`${plan}: ${scenario} preserves normal installment cash under self-funding`, () => {
      const quote = contract(plan, scenario);
      const result = buildBundangFinancingTimeline({
        paymentSchedules: quote.paymentSchedules, interimFunding: 'cash', deferredInterestWon: 5_432_100,
      });
      expect(result.totalContractWon).toBe(quote.contractTotalWon);
      expect(result.totalCashDueWon).toBe(quote.contractTotalWon);
      expect(result.totalGroupLoanDrawWon).toBe(0);
      expect(result.totalInterimRepaymentWon).toBe(0);
      expect(result.totalDeferredInterestWon).toBe(0);
      for (const row of result.rows) expect(row.cashDueWon).toBe(row.contractDueWon);
    });
  }

  it('caps the mortgage at housing and balcony balances without funding other options or debt', () => {
    const quote = contract('main-subscription', 'separate-option-contract');
    const result = buildBundangFinancingTimeline({
      paymentSchedules: quote.paymentSchedules, interimFunding: 'loan',
      deferredInterestWon: 1_000_000, mortgageAppliedWon: 900_000_000,
    });
    const eligibleBalance = quote.paymentSchedules.filter((schedule) => schedule.target === 'supply' || schedule.target === 'balcony')
      .flatMap((schedule) => schedule.installments).filter((installment) => installment.id === 'balance')
      .reduce((total, installment) => total + installment.amountWon, 0);
    expect(result.totalMortgageAppliedWon).toBe(eligibleBalance);
    expect(result.totalCashDueWon).toBe(quote.contractTotalWon + 1_000_000 - eligibleBalance);
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid integer money %s', (invalid) => {
    const paymentSchedules = contract('main-subscription', 'minus-option').paymentSchedules;
    expect(() => buildBundangFinancingTimeline({ paymentSchedules, interimFunding: 'loan', deferredInterestWon: invalid })).toThrow();
    expect(() => buildBundangFinancingTimeline({ paymentSchedules, interimFunding: 'loan', mortgageAppliedWon: invalid })).toThrow();
  });

  it('rejects inconsistent contract totals rather than silently changing the official schedule', () => {
    const quote = contract('main-subscription', 'minus-option');
    const paymentSchedules = quote.paymentSchedules.map((schedule, index) => index === 0
      ? { ...schedule, totalWon: schedule.totalWon + 1 } : schedule);
    expect(() => buildBundangFinancingTimeline({ paymentSchedules, interimFunding: 'loan' })).toThrow('일치하지 않습니다');
  });
});
