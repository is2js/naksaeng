import { describe, expect, it } from 'vitest';
import { calculateBundangMoveInSettlement, type BundangMoveInSettlementInputV1 } from './bundang-move-in-finance';
import { calculateBundangSaleFinance, type BundangPaymentPlanKind } from './bundang-sale-finance';

function contract(plan: BundangPaymentPlanKind = 'main-subscription', minus = false) {
  return calculateBundangSaleFinance({
    household: { unitType: '55A', floorBand: 5 },
    paymentPlanKind: plan,
    selectMinusOption: minus,
    optionLines: [
      { id: 'system-ac', label: '시스템에어컨', tier: 'option-ii', priceWon: 3_600_000 },
      { id: 'wide-floor', label: '광폭 강마루', tier: 'option-iii', priceWon: 1_820_000 },
    ],
  });
}

describe('Bundang move-in settlement', () => {
  it.each(['main-subscription', 'pre-subscription'] as const)(
    'separates contract cash from the remaining purchase price excluding mortgage and extra costs for %s', (plan) => {
      for (const minus of [false, true]) {
        const quote = contract(plan, minus);
        const expectedContract = quote.paymentSchedules.flatMap((schedule) => schedule.installments)
          .filter((installment) => installment.id === 'contract')
          .reduce((sum, installment) => sum + installment.amountWon, 0);
        for (const interimFunding of ['cash', 'loan'] as const) {
          for (const mortgagePrincipalWon of [400_000_000, 900_000_000]) {
            const result = calculateBundangMoveInSettlement({
              paymentSchedules: quote.paymentSchedules, interimFunding, mortgagePrincipalWon,
              interimInterestWon: 5_000_000, acquisitionTaxWon: 7_000_000,
              additionalCosts: [{ id: 'moving', amountWon: 1_000_000 }],
            });
            expect(result.contractPaymentsWon).toBe(expectedContract);
            expect(result.postContractBaseCashWon).toBe(quote.contractTotalWon - expectedContract - result.mortgageAppliedWon);
            expect(result.contractPaymentsWon + result.postContractBaseCashWon + result.mortgageAppliedWon).toBe(quote.contractTotalWon);
            expect(result.mortgageAppliedWon).toBe(Math.min(mortgagePrincipalWon, result.housingBalanceWon));
            expect(result.totalOwnCashWon).toBe(result.contractPaymentsWon + result.postContractBaseCashWon
              + result.deferredInterestWon + result.acquisitionTaxWon + result.additionalCostsWon);
          }
        }
      }
    },
  );
  it.each(['main-subscription', 'pre-subscription'] as const)('accounts for both interim funding methods under %s without duplicating the mortgage', (plan) => {
    const quote = contract(plan);
    const common = {
      paymentSchedules: quote.paymentSchedules,
      mortgagePrincipalWon: 400_000_000,
      acquisitionTaxWon: 7_000_000,
      additionalCosts: [{ id: 'moving', amountWon: 1_000_000 }],
    };
    const cash = calculateBundangMoveInSettlement({ ...common, interimFunding: 'cash', interimInterestWon: 5_000_000 });
    const loan = calculateBundangMoveInSettlement({ ...common, interimFunding: 'loan', interimInterestWon: 5_000_000 });
    const interimPrincipal = quote.adjustedSupplyPriceWon * 0.2;
    expect(cash.interimLoanRepaymentWon).toBe(0);
    expect(cash.deferredInterestWon).toBe(0);
    expect(loan.interimLoanRepaymentWon).toBe(interimPrincipal);
    expect(loan.selfFundedBeforeMoveInWon).toBe(cash.selfFundedBeforeMoveInWon - interimPrincipal);
    expect(loan.requiredCashAtMoveInWon).toBe(cash.requiredCashAtMoveInWon + interimPrincipal + 5_000_000);
    expect(loan.totalAcquisitionBudgetWon).toBe(quote.contractTotalWon + 13_000_000);
    expect(cash.totalAcquisitionBudgetWon).toBe(quote.contractTotalWon + 8_000_000);
    for (const result of [cash, loan]) {
      expect(result.totalOwnCashWon).toBe(result.selfFundedBeforeMoveInWon + result.requiredCashAtMoveInWon);
      expect(result.totalOwnCashWon + result.mortgageAppliedWon).toBe(result.totalAcquisitionBudgetWon);
      expect(result.mortgageAppliedWon).toBe(400_000_000);
      expect(result.mortgageExcessWon).toBe(0);
      expect(result.housingBalanceWon + result.optionBalanceWon).toBe(result.balancePaymentsWon);
      expect(result.preMortgageRepaymentWon).toBe(result.interimLoanRepaymentWon + result.deferredInterestWon);
      expect(result.nonBalanceCostsWon).toBe(result.preMortgageRepaymentWon + 8_000_000);
      expect(result.balanceCashAfterMortgageWon).toBe(result.balancePaymentsWon - result.mortgageAppliedWon);
      expect(result.requiredCashAtMoveInWon).toBe(result.nonBalanceCostsWon + result.balanceCashAfterMortgageWon);
    }
  });

  it.each(['main-subscription', 'pre-subscription'] as const)('caps the mortgage at housing/balcony balances without funding interim debt, options or costs under %s', (plan) => {
    const quote = contract(plan);
    const result = calculateBundangMoveInSettlement({
      paymentSchedules: quote.paymentSchedules, interimFunding: 'loan', mortgagePrincipalWon: 900_000_000,
      interimInterestWon: 5_000_000, acquisitionTaxWon: 7_000_000,
      additionalCosts: [{ id: 'moving', amountWon: 1_000_000 }],
    });
    expect(result.housingBalanceWon).toBe(quote.paymentSchedules
      .filter((schedule) => schedule.target === 'supply' || schedule.target === 'balcony')
      .flatMap((schedule) => schedule.installments)
      .filter((installment) => installment.id === 'balance')
      .reduce((sum, installment) => sum + installment.amountWon, 0));
    expect(result.mortgageAppliedWon).toBe(result.housingBalanceWon);
    expect(result.mortgageExcessWon).toBe(900_000_000 - result.housingBalanceWon);
    expect(result.preMortgageRepaymentWon).toBe(quote.adjustedSupplyPriceWon * 0.2 + 5_000_000);
    expect(result.balanceCashAfterMortgageWon).toBe(result.optionBalanceWon);
    expect(result.requiredCashAtMoveInWon).toBe(result.preMortgageRepaymentWon + 8_000_000 + result.optionBalanceWon);
    expect(result.totalOwnCashWon + result.mortgageAppliedWon).toBe(result.totalAcquisitionBudgetWon);
  });

  it('still requires the option balance and ancillary costs when cash-paid interims leave excess mortgage capacity', () => {
    const quote = contract();
    const result = calculateBundangMoveInSettlement({
      paymentSchedules: quote.paymentSchedules, interimFunding: 'cash', mortgagePrincipalWon: 900_000_000,
      interimInterestWon: 5_000_000, acquisitionTaxWon: 7_000_000,
      additionalCosts: [{ id: 'moving', amountWon: 1_000_000 }],
    });
    expect(result.preMortgageRepaymentWon).toBe(0);
    expect(result.nonBalanceCostsWon).toBe(8_000_000);
    expect(result.balanceCashAfterMortgageWon).toBe(3_252_000);
    expect(result.requiredCashAtMoveInWon).toBe(11_252_000);
    expect(result.mortgageAppliedWon).toBe(result.housingBalanceWon);
    expect(result.totalOwnCashWon + result.mortgageAppliedWon).toBe(result.totalAcquisitionBudgetWon);
  });

  it.each(['main-subscription', 'pre-subscription'] as const)('derives discounted supply interim principal only under minus options for %s', (plan) => {
    const quote = contract(plan, true);
    const result = calculateBundangMoveInSettlement({ paymentSchedules: quote.paymentSchedules, interimFunding: 'loan' });
    expect(result.interimLoanRepaymentWon).toBe(quote.adjustedSupplyPriceWon * 0.2);
    expect(result.interimLoanRepaymentWon).not.toBe((quote.adjustedSupplyPriceWon + quote.adjustedBalconyExtensionWon) * 0.2);
    expect(result.totalAcquisitionBudgetWon).toBe(quote.contractTotalWon);
    expect(result.totalOwnCashWon).toBe(quote.contractTotalWon);
    expect(result.deferredInterestWon).toBe(0);
    expect(result.optionBalanceWon).toBe(0);
    expect(result.balancePaymentsWon).toBe(result.housingBalanceWon);
    expect(result.preMortgageRepaymentWon).toBe(result.interimLoanRepaymentWon);
    expect(result.nonBalanceCostsWon).toBe(result.interimLoanRepaymentWon);
  });

  it('keeps additional move-in costs separate from contract and option totals without mutating the schedule', () => {
    const quote = contract();
    const before = JSON.stringify(quote);
    const result = calculateBundangMoveInSettlement({
      paymentSchedules: quote.paymentSchedules, interimFunding: 'cash',
      additionalCosts: [{ id: 'registration', amountWon: 500_000 }, { id: 'moving', amountWon: 1_500_000 }],
    });
    expect(result.additionalCostsWon).toBe(2_000_000);
    expect(result.totalAcquisitionBudgetWon).toBe(quote.contractTotalWon + 2_000_000);
    expect(quote.optionIiSubtotalWon + quote.optionIiiSubtotalWon).toBe(5_420_000);
    expect(JSON.stringify(quote)).toBe(before);
  });

  it('uses zero for inactive estimates and consistently rounds accepted finite amounts to whole won', () => {
    const empty = calculateBundangMoveInSettlement({ paymentSchedules: [], interimFunding: 'cash' });
    expect(Object.values(empty).every((value) => value === 0)).toBe(true);
    const result = calculateBundangMoveInSettlement({
      paymentSchedules: [], interimFunding: 'loan', interimInterestWon: 1.4,
      acquisitionTaxWon: 2.6, additionalCosts: [{ id: 'other', amountWon: 3.5 }], mortgagePrincipalWon: 0.5,
    });
    expect(result).toMatchObject({
      deferredInterestWon: 1, acquisitionTaxWon: 3, additionalCostsWon: 4,
      preMortgageRepaymentWon: 1, nonBalanceCostsWon: 8, housingBalanceWon: 0, optionBalanceWon: 0,
      mortgageAppliedWon: 0, mortgageExcessWon: 1, balanceCashAfterMortgageWon: 0,
      requiredCashAtMoveInWon: 8,
    });
    expect(Object.values(result).every(Number.isInteger)).toBe(true);
  });

  it.each([NaN, Infinity, -Infinity, -1, Number.MAX_SAFE_INTEGER + 1])('rejects invalid monetary input %s in every new field', (value) => {
    const base: BundangMoveInSettlementInputV1 = { paymentSchedules: [], interimFunding: 'cash' };
    for (const key of ['interimInterestWon', 'mortgagePrincipalWon', 'acquisitionTaxWon'] as const) {
      expect(() => calculateBundangMoveInSettlement({ ...base, [key]: value })).toThrow();
    }
    expect(() => calculateBundangMoveInSettlement({ ...base, additionalCosts: [{ id: 'other', amountWon: value }] })).toThrow();
    const schedule = { target: 'supply' as const, totalWon: 1, installments: [{ id: 'balance', label: '잔금', due: '입주 시', rateBps: 10_000, amountWon: value }] };
    expect(() => calculateBundangMoveInSettlement({ ...base, paymentSchedules: [schedule] })).toThrow();
    expect(() => calculateBundangMoveInSettlement({ ...base, paymentSchedules: [{ ...schedule, totalWon: value, installments: [] }] })).toThrow();
  });
});
