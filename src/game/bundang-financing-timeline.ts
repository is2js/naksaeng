import type { BundangPaymentScheduleV1 } from './bundang-sale-finance';

export interface BundangFinancingTimelineInputV1 {
  paymentSchedules: readonly BundangPaymentScheduleV1[];
  interimFunding: 'loan' | 'cash';
  /** Full estimated interest, deferred until move-in rather than paid per draw. */
  deferredInterestWon?: number;
  /** Already eligible mortgage amount; defensively capped at housing/balcony balances. */
  mortgageAppliedWon?: number;
}

export interface BundangFinancingTimelineRowV1 {
  /** Original due key, never an invented date for separately announced options. */
  dueKey: string;
  contractDueWon: number;
  groupLoanDrawWon: number;
  interimRepaymentWon: number;
  deferredInterestWon: number;
  mortgageAppliedWon: number;
  cashDueWon: number;
}

export interface BundangFinancingTimelineV1 {
  rows: BundangFinancingTimelineRowV1[];
  totalContractWon: number;
  totalGroupLoanDrawWon: number;
  totalInterimRepaymentWon: number;
  totalDeferredInterestWon: number;
  totalMortgageAppliedWon: number;
  totalCashDueWon: number;
}

function won(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label}은 0 이상의 안전한 원 단위 정수여야 합니다.`);
  }
  return value;
}

function sum(values: readonly number[], label: string): number {
  return won(values.reduce((total, value) => total + value, 0), label);
}

function emptyRow(dueKey: string): BundangFinancingTimelineRowV1 {
  return {
    dueKey, contractDueWon: 0, groupLoanDrawWon: 0, interimRepaymentWon: 0,
    deferredInterestWon: 0, mortgageAppliedWon: 0, cashDueWon: 0,
  };
}

const DUE_ORDER = new Map([
  ['계약 시', 0], ['옵션Ⅲ 계약 시', 0.5], ['2027-04-12', 1], ['2028-02-14', 2], ['별도 안내', 3], ['입주 시', 5],
]);

/**
 * Keep the executed contract schedule and its financing cash flow distinct.
 * Supply interim borrowing offsets cash only on its own execution date. The
 * same principal and all estimated deferred interest are paid once at move-in;
 * the final mortgage offsets only eligible housing/balcony balances, once.
 * Taxes and ancillary costs are deliberately outside this contract timeline.
 */
export function buildBundangFinancingTimeline(
  input: BundangFinancingTimelineInputV1,
): BundangFinancingTimelineV1 {
  if (input.interimFunding !== 'loan' && input.interimFunding !== 'cash') {
    throw new Error('중도금 자금 조달 방식이 올바르지 않습니다.');
  }
  const interest = won(input.deferredInterestWon ?? 0, '중도금 후불이자');
  const mortgage = won(input.mortgageAppliedWon ?? 0, '잔금 모기지');
  const rows = new Map<string, BundangFinancingTimelineRowV1>();
  const housingBalances: number[] = [];
  for (const schedule of input.paymentSchedules) {
    won(schedule.totalWon, '계약 항목 합계');
    const installments = schedule.installments.map((installment) =>
      won(installment.amountWon, '계약 납부 금액'));
    if (sum(installments, '계약 납부 합계') !== schedule.totalWon) {
      throw new Error('계약 항목 합계와 납부 회차 합계가 일치하지 않습니다.');
    }
    for (const installment of schedule.installments) {
      if (!installment.amountWon) continue;
      const row = rows.get(installment.due) ?? emptyRow(installment.due);
      row.contractDueWon = sum([row.contractDueWon, installment.amountWon], '회차 계약금');
      if (input.interimFunding === 'loan' && schedule.target === 'supply'
        && installment.id.startsWith('interim')) {
        row.groupLoanDrawWon = sum([row.groupLoanDrawWon, installment.amountWon], '회차 중도금 대출');
      }
      if (installment.id === 'balance'
        && (schedule.target === 'supply' || schedule.target === 'balcony')) {
        housingBalances.push(installment.amountWon);
      }
      rows.set(installment.due, row);
    }
  }
  const totalGroupLoanDrawWon = sum([...rows.values()].map((row) => row.groupLoanDrawWon), '중도금 대출 합계');
  const totalDeferredInterestWon = input.interimFunding === 'loan' ? interest : 0;
  const totalMortgageAppliedWon = Math.min(mortgage, sum(housingBalances, '주택·발코니 잔금 합계'));
  if (totalGroupLoanDrawWon || totalDeferredInterestWon || totalMortgageAppliedWon) {
    const balance = rows.get('입주 시') ?? emptyRow('입주 시');
    balance.interimRepaymentWon = totalGroupLoanDrawWon;
    balance.deferredInterestWon = totalDeferredInterestWon;
    balance.mortgageAppliedWon = totalMortgageAppliedWon;
    rows.set(balance.dueKey, balance);
  }
  const orderedRows = [...rows.values()].sort((left, right) =>
    (DUE_ORDER.get(left.dueKey) ?? 4) - (DUE_ORDER.get(right.dueKey) ?? 4)
    || left.dueKey.localeCompare(right.dueKey));
  for (const row of orderedRows) {
    row.cashDueWon = won(sum([
      row.contractDueWon, row.interimRepaymentWon, row.deferredInterestWon,
    ], '회차 자금 용도 합계') - row.groupLoanDrawWon - row.mortgageAppliedWon, '회차 필요 현금');
  }
  return {
    rows: orderedRows,
    totalContractWon: sum(orderedRows.map((row) => row.contractDueWon), '계약 합계'),
    totalGroupLoanDrawWon,
    totalInterimRepaymentWon: totalGroupLoanDrawWon,
    totalDeferredInterestWon,
    totalMortgageAppliedWon,
    totalCashDueWon: sum(orderedRows.map((row) => row.cashDueWon), '필요 현금 합계'),
  };
}
