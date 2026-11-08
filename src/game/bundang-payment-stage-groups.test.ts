import { describe, expect, it } from 'vitest';
import { buildBundangFinancingTimeline } from './bundang-financing-timeline';
import { buildBundangPaymentStageGroups } from './bundang-payment-stage-groups';
import { calculateBundangSaleFinance } from './bundang-sale-finance';

const plans = ['main-subscription', 'pre-subscription'] as const;
const scenarios = ['with-iii', 'without-iii', 'minus'] as const;
const fundingModes = ['loan', 'cash'] as const;

describe('grouped payment stages keep additional items III separate inside shared stages', () => {
  for (const plan of plans) for (const scenario of scenarios) for (const fundingMode of fundingModes) {
    it(`${plan}/${scenario}/${fundingMode} conserves authoritative amounts and unknown dates`, () => {
      const quote = calculateBundangSaleFinance({
        household: { unitType: '55B', floorBand: 5 }, paymentPlanKind: plan,
        selectMinusOption: scenario === 'minus',
        optionLines: [
          { id: 'air', label: '시스템에어컨', tier: 'option-ii', priceWon: 6_600_000 },
          ...(scenario !== 'without-iii' ? [{ id: 'floor', label: '광폭 강마루', tier: 'option-iii' as const, priceWon: 1_820_003 }] : []),
        ],
      });
      const financing = buildBundangFinancingTimeline({
        paymentSchedules: quote.paymentSchedules, interimFunding: fundingMode,
        deferredInterestWon: 3_456_789, mortgageAppliedWon: 400_000_000,
      });
      const before = JSON.stringify({ schedules: quote.paymentSchedules, financing });
      const groups = buildBundangPaymentStageGroups({
        paymentSchedules: quote.paymentSchedules, financingRows: financing.rows, paymentPlanKind: plan,
      });
      expect(JSON.stringify({ schedules: quote.paymentSchedules, financing })).toBe(before);
      expect(groups.map(row => row.dueKey)).toEqual(plan === 'main-subscription'
        ? ['계약 시', '2027-04-12', '2028-02-14', '입주 시'] : ['계약 시', '2028-02-14', '입주 시']);
      expect(groups.reduce((total, row) => total + row.supply + row.balcony + row.systemAc + row.other, 0)).toBe(quote.contractTotalWon);
      for (const key of ['contractDueWon', 'groupLoanDrawWon', 'interimRepaymentWon', 'deferredInterestWon', 'mortgageAppliedWon', 'cashDueWon'] as const) {
        expect(groups.reduce((sum, row) => sum + row.financing[key], 0)).toBe(financing.rows.reduce((sum, row) => sum + row[key], 0));
      }
      for (const row of groups) {
        expect(row.financing.contractDueWon).toBe(row.supply + row.balcony + row.systemAc + row.other);
        expect(row.financing.cashDueWon).toBe(row.financing.contractDueWon + row.financing.interimRepaymentWon
          + row.financing.deferredInterestWon - row.financing.groupLoanDrawWon - row.financing.mortgageAppliedWon);
        if (row.financing.groupLoanDrawWon) expect(row.financing.groupLoanDrawWon).toBe(row.supply);
      }
      const iii = quote.paymentSchedules.find(schedule => schedule.target === 'option-iii');
      if (iii) {
        const contract = groups[0];
        const interim = groups.find(row => row.dueKey === (plan === 'main-subscription' ? '2027-04-12' : '2028-02-14'))!;
        expect(contract.other).toBe(iii.installments[0].amountWon);
        expect(contract.sourceDueKeys).toContain('옵션Ⅲ 계약 시');
        expect(interim.other).toBe(iii.installments[1].amountWon);
        expect(interim.sourceDueKeys).toContain('별도 안내');
        for (const row of [contract, interim]) {
          expect(row.hasSeparateOptionDate).toBe(true);
          expect(row.optionIiiPayments).toHaveLength(1);
          expect(row.optionIiiPayments[0].datePrecision).toBe('unknown');
          expect(row.optionIiiPayments[0].dateLabel).toBe('별도 안내 · 납부일 미정');
        }
        if (plan === 'main-subscription') expect(groups.find(row => row.dueKey === '2028-02-14')!.other).toBe(0);
        expect(groups.at(-1)!.optionIiiPayments[0].datePrecision).toBe('month');
      } else {
        expect(groups.every(row => row.other === 0 && !row.optionIiiPayments.length && !row.hasSeparateOptionDate)).toBe(true);
      }
    });
  }

  it('rejects a missing funding row instead of losing its cash payment', () => {
    const quote = calculateBundangSaleFinance({ household: { unitType: '51A', floorBand: 5 }, paymentPlanKind: 'main-subscription' });
    expect(() => buildBundangPaymentStageGroups({ paymentSchedules: quote.paymentSchedules, financingRows: [], paymentPlanKind: 'main-subscription' })).toThrow('자금 흐름');
  });
});
