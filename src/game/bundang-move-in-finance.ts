import type { BundangPaymentScheduleV1 } from './bundang-sale-finance';

export interface BundangMoveInAdditionalCostV1 {
  id: string;
  amountWon: number;
}

export interface BundangMoveInSettlementInputV1 {
  paymentSchedules: readonly BundangPaymentScheduleV1[];
  interimFunding: 'cash' | 'loan';
  interimInterestWon?: number;
  mortgagePrincipalWon?: number;
  acquisitionTaxWon?: number;
  additionalCosts?: readonly BundangMoveInAdditionalCostV1[];
}

export interface BundangMoveInSettlementV1 {
  /** All contract installments; separate contracts may have different due dates. */
  contractPaymentsWon: number;
  /** Contract total less contract payments and the mortgage actually applied. Excludes interest, tax and other costs. */
  postContractBaseCashWon: number;
  balancePaymentsWon: number;
  /** Only the housing and balcony balances are eligible for the final mortgage. */
  housingBalanceWon: number;
  optionBalanceWon: number;
  interimLoanRepaymentWon: number;
  deferredInterestWon: number;
  /** Must be arranged before executing the final housing mortgage. */
  preMortgageRepaymentWon: number;
  acquisitionTaxWon: number;
  additionalCostsWon: number;
  /** Interim repayment, deferred interest, enabled taxes and ancillary costs. */
  nonBalanceCostsWon: number;
  usesAtMoveInWon: number;
  mortgageAppliedWon: number;
  /** Unused borrowing capacity, never available cash in this estimate. */
  mortgageExcessWon: number;
  balanceCashAfterMortgageWon: number;
  requiredCashAtMoveInWon: number;
  selfFundedBeforeMoveInWon: number;
  totalOwnCashWon: number;
  totalAcquisitionBudgetWon: number;
}

/** Reject invalid money rather than silently turning an invalid scenario into zero. */
function checkedWon(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.round(value))) {
    throw new Error(`${label}은 0 이상의 유한한 원화 금액이어야 합니다.`);
  }
  return Math.round(value);
}

function sumWon(values: readonly number[], label: string): number {
  return checkedWon(values.reduce((sum, value) => sum + value, 0), label);
}

/**
 * Separate contract payments from financing and move-in-only costs. A supply
 * interim loan defers that principal until move-in; it is not a second grant.
 * The final mortgage is applied only once to housing and balcony balances, not
 * to existing interim debt, option balances, taxes or ancillary costs. Interim
 * debt and deferred interest are disclosed as a preceding repayment stage.
 * Excess mortgage capacity is disclosed, not treated as available cash.
 * Does not mutate the official payment schedules or persist household details.
 */
export function calculateBundangMoveInSettlement(
  input: BundangMoveInSettlementInputV1,
): BundangMoveInSettlementV1 {
  if (input.interimFunding !== 'cash' && input.interimFunding !== 'loan') {
    throw new Error('중도금 자금 조달 방식이 올바르지 않습니다.');
  }
  const interest = checkedWon(input.interimInterestWon ?? 0, '중도금 후불이자');
  const mortgage = checkedWon(input.mortgagePrincipalWon ?? 0, '잔금 대출금');
  const acquisitionTaxWon = checkedWon(input.acquisitionTaxWon ?? 0, '취득 관련 세금');
  const additionalCostsWon = sumWon((input.additionalCosts ?? []).map((cost) =>
    checkedWon(cost.amountWon, '입주 부대비용')), '입주 부대비용 합계');
  const housingBalances: number[] = [];
  const optionBalances: number[] = [];
  const beforeMoveIn: number[] = [];
  const contractPayments: number[] = [];
  const supplyInterims: number[] = [];
  for (const schedule of input.paymentSchedules) {
    checkedWon(schedule.totalWon, '계약 항목 합계');
    for (const installment of schedule.installments) {
      const amount = checkedWon(installment.amountWon, '납부 회차 금액');
      if (installment.id === 'contract') contractPayments.push(amount);
      if (installment.id === 'balance') {
        (schedule.target === 'supply' || schedule.target === 'balcony'
          ? housingBalances : optionBalances).push(amount);
      } else {
        beforeMoveIn.push(amount);
      }
      if (schedule.target === 'supply' && installment.id.startsWith('interim')) {
        supplyInterims.push(amount);
      }
    }
  }
  const housingBalanceWon = sumWon(housingBalances, '주택·발코니 잔금');
  const optionBalanceWon = sumWon(optionBalances, '선택 옵션 잔금');
  const balancePaymentsWon = sumWon([housingBalanceWon, optionBalanceWon], '잔금 합계');
  const beforeMoveInWon = sumWon(beforeMoveIn, '입주 전 납부 합계');
  const interimLoanRepaymentWon = input.interimFunding === 'loan'
    ? sumWon(supplyInterims, '중도금 대출 상환원금') : 0;
  const deferredInterestWon = input.interimFunding === 'loan' ? interest : 0;
  const preMortgageRepaymentWon = sumWon([
    interimLoanRepaymentWon, deferredInterestWon,
  ], '잔금 대출 전 중도금 정산');
  const nonBalanceCostsWon = sumWon([
    preMortgageRepaymentWon, acquisitionTaxWon, additionalCostsWon,
  ], '잔금 외 준비자금');
  const usesAtMoveInWon = sumWon([
    balancePaymentsWon, nonBalanceCostsWon,
  ], '입주 시 필요금액');
  const mortgageAppliedWon = Math.min(mortgage, housingBalanceWon);
  const mortgageExcessWon = mortgage - mortgageAppliedWon;
  const contractPaymentsWon = sumWon(contractPayments, '계약금 합계');
  const postContractBaseCashWon = sumWon([beforeMoveInWon, balancePaymentsWon], '계약 총액') - contractPaymentsWon - mortgageAppliedWon;
  const balanceCashAfterMortgageWon = balancePaymentsWon - mortgageAppliedWon;
  const requiredCashAtMoveInWon = sumWon([
    nonBalanceCostsWon, balanceCashAfterMortgageWon,
  ], '입주 시 필요 자기자금');
  const selfFundedBeforeMoveInWon = beforeMoveInWon - interimLoanRepaymentWon;
  return {
    contractPaymentsWon,
    postContractBaseCashWon,
    balancePaymentsWon,
    housingBalanceWon,
    optionBalanceWon,
    interimLoanRepaymentWon,
    deferredInterestWon,
    preMortgageRepaymentWon,
    acquisitionTaxWon,
    additionalCostsWon,
    nonBalanceCostsWon,
    usesAtMoveInWon,
    mortgageAppliedWon,
    mortgageExcessWon,
    balanceCashAfterMortgageWon,
    requiredCashAtMoveInWon,
    selfFundedBeforeMoveInWon,
    totalOwnCashWon: sumWon([selfFundedBeforeMoveInWon, requiredCashAtMoveInWon], '전체 자기자금'),
    totalAcquisitionBudgetWon: sumWon([
      beforeMoveInWon, balancePaymentsWon, deferredInterestWon,
      acquisitionTaxWon, additionalCostsWon,
    ], '총 취득 예산'),
  };
}
