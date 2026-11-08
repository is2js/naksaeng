import type { BundangFinancingTimelineRowV1 } from './bundang-financing-timeline';
import { paymentDeadlineForDue } from './bundang-payment-timeline';
import type { BundangPaymentPlanKind, BundangPaymentScheduleV1 } from './bundang-sale-finance';

export interface BundangOptionIiiStagePaymentV1 {
  installmentId: string;
  sourceDueKey: string;
  amountWon: number;
  rateBps: number;
  /** A grouped stage is not evidence that this separately contracted amount shares its date. */
  dateLabel: string;
  datePrecision: 'date' | 'range' | 'month' | 'unknown';
}

export interface BundangPaymentStageGroupV1 {
  label: string;
  due: string;
  dueKey: string;
  supply: number;
  balcony: number;
  systemAc: number;
  other: number;
  financing: BundangFinancingTimelineRowV1;
  /** Original account due keys, kept even when the UI groups several dates under one stage. */
  sourceDueKeys: string[];
  optionIiiPayments: BundangOptionIiiStagePaymentV1[];
  hasSeparateOptionDate: boolean;
}

export interface BundangPaymentStageGroupsInputV1 {
  paymentSchedules: readonly BundangPaymentScheduleV1[];
  financingRows: readonly BundangFinancingTimelineRowV1[];
  paymentPlanKind: BundangPaymentPlanKind;
}

const FINANCING_AMOUNT_KEYS = [
  'contractDueWon', 'groupLoanDrawWon', 'interimRepaymentWon', 'deferredInterestWon',
  'mortgageAppliedWon', 'cashDueWon',
] as const;
const STAGE_ORDER = new Map([['계약 시', 0], ['2027-04-12', 1], ['2028-02-14', 2], ['입주 시', 4]]);

function amount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('회차 금액은 0 이상의 안전한 원 단위 정수여야 합니다.');
  return value;
}

function stageKey(sourceDue: string, plan: BundangPaymentPlanKind): string {
  if (sourceDue === '옵션Ⅲ 계약 시') return '계약 시';
  if (sourceDue === '별도 안내') return plan === 'main-subscription' ? '2027-04-12' : '2028-02-14';
  return sourceDue;
}

function stageLabel(due: string, plan: BundangPaymentPlanKind): string {
  if (due === '계약 시') return '계약금';
  if (due === '2027-04-12') return '중도금 1차';
  if (due === '2028-02-14') return plan === 'pre-subscription' ? '중도금' : '중도금 2차';
  if (due === '입주 시') return '잔금';
  return '납부 일정';
}

/**
 * Presentation projection only. Additional items III remain separately contracted,
 * self-funded and undated in the authoritative schedules and financing timeline.
 * Their full interim amount is shown in the first applicable interim stage as a
 * planning envelope, never split into invented first/second installments.
 */
export function buildBundangPaymentStageGroups(input: BundangPaymentStageGroupsInputV1): BundangPaymentStageGroupV1[] {
  if (input.paymentPlanKind !== 'main-subscription' && input.paymentPlanKind !== 'pre-subscription') {
    throw new Error('청약 구분이 올바르지 않습니다.');
  }
  const groups = new Map<string, BundangPaymentStageGroupV1>();
  const sourceTotals = new Map<string, number>();
  const getGroup = (sourceDue: string): BundangPaymentStageGroupV1 => {
    const key = stageKey(sourceDue, input.paymentPlanKind);
    let row = groups.get(key);
    if (!row) {
      row = {
        label: stageLabel(key, input.paymentPlanKind), due: paymentDeadlineForDue(key).dateLabel, dueKey: key,
        supply: 0, balcony: 0, systemAc: 0, other: 0,
        financing: {
          dueKey: key, contractDueWon: 0, groupLoanDrawWon: 0, interimRepaymentWon: 0,
          deferredInterestWon: 0, mortgageAppliedWon: 0, cashDueWon: 0,
        },
        sourceDueKeys: [], optionIiiPayments: [], hasSeparateOptionDate: false,
      };
      groups.set(key, row);
    }
    if (!row.sourceDueKeys.includes(sourceDue)) row.sourceDueKeys.push(sourceDue);
    return row;
  };

  for (const schedule of input.paymentSchedules) for (const installment of schedule.installments) {
    amount(installment.amountWon);
    if (!installment.amountWon) continue;
    // Only the legacy III sentinel keys are presentation aliases. No other
    // target can accidentally acquire an invented shared stage date.
    if (schedule.target !== 'option-iii' && (installment.due === '옵션Ⅲ 계약 시' || installment.due === '별도 안내')) {
      throw new Error('추가선택품목 Ⅲ 이외의 미정 회차는 자동으로 묶을 수 없습니다.');
    }
    const row = getGroup(installment.due);
    const field = schedule.target === 'supply' ? 'supply' : schedule.target === 'balcony' ? 'balcony'
      : schedule.target === 'option-ii' ? 'systemAc' : 'other';
    row[field] = amount(row[field] + installment.amountWon);
    sourceTotals.set(installment.due, amount((sourceTotals.get(installment.due) ?? 0) + installment.amountWon));
    if (schedule.target === 'option-iii') {
      const deadline = paymentDeadlineForDue(installment.due);
      const unknown = installment.due === '옵션Ⅲ 계약 시' || installment.due === '별도 안내';
      row.optionIiiPayments.push({
        installmentId: installment.id, sourceDueKey: installment.due, amountWon: installment.amountWon,
        rateBps: installment.rateBps,
        dateLabel: unknown ? '별도 안내 · 납부일 미정' : deadline.dateLabel,
        datePrecision: unknown ? 'unknown' : deadline.precision,
      });
      row.hasSeparateOptionDate ||= unknown;
    }
  }

  const seen = new Set<string>();
  for (const funding of input.financingRows) {
    if (seen.has(funding.dueKey)) throw new Error('중복된 자금 흐름 회차입니다.');
    seen.add(funding.dueKey);
    if (amount(funding.contractDueWon) !== (sourceTotals.get(funding.dueKey) ?? 0)) {
      throw new Error('납부 일정과 자금 흐름 금액이 일치하지 않습니다.');
    }
    const row = getGroup(funding.dueKey);
    for (const key of FINANCING_AMOUNT_KEYS) row.financing[key] = amount(row.financing[key] + amount(funding[key]));
  }
  for (const sourceDue of sourceTotals.keys()) {
    if (!seen.has(sourceDue)) throw new Error('납부 일정에 대응하는 자금 흐름이 없습니다.');
  }
  return [...groups.values()].sort((left, right) =>
    (STAGE_ORDER.get(left.dueKey) ?? 3) - (STAGE_ORDER.get(right.dueKey) ?? 3)
    || left.dueKey.localeCompare(right.dueKey));
}
