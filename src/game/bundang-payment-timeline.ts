import { BUNDANG_EXECUTED_CONTRACT_REVIEW_V1 } from './bundang-executed-contract';

export interface BundangPaymentDeadlineV1 {
  id: string;
  label: string;
  precision: 'date' | 'range' | 'month' | 'unknown';
  startDate?: string;
  endDate?: string;
  dateLabel: string;
}

export interface BundangPaymentCountdownV1 {
  text: string;
  detail: string;
  state: 'upcoming' | 'today' | 'active' | 'elapsed' | 'unknown';
}

const DAY_MS = 86_400_000;
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1_000;
export const BUNDANG_PAYMENT_SCHEDULE_SOURCE = {
  revision: '2026-07-02',
  url: 'https://www.elife.co.kr/jsp/front/po/210114/static/pdf/210114_notice_260702.pdf',
  contractPages: [1, 3, 25],
  executedContractReview: BUNDANG_EXECUTED_CONTRACT_REVIEW_V1,
} as const;

/** A Seoul calendar day, independent of the visitor's device time zone. */
export function seoulDateKey(now: Date = new Date()): string {
  if (!Number.isFinite(now.getTime())) throw new RangeError('A valid current date is required.');
  return new Date(now.getTime() + SEOUL_OFFSET_MS).toISOString().slice(0, 10);
}

function calendarDay(date: string | undefined): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const value = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) return null;
  return value / DAY_MS;
}

/** Official schedule precision must not be replaced by a user-entered financing assumption. */
export function paymentDeadlineForDue(due: string): BundangPaymentDeadlineV1 {
  if (due === '계약 시') return {
    id: 'contract', label: '계약금', precision: 'range',
    startDate: '2026-11-04', endDate: '2026-11-13', dateLabel: '2026.11.04~11.13',
  };
  if (due === '옵션Ⅲ 계약 시') return {
    id: 'option-iii-contract', label: '기타 옵션 계약금', precision: 'unknown', dateLabel: '옵션 계약 시 · 일정 별도 안내',
  };
  if (due === '2027-04-12') return {
    id: 'interim-1', label: '중도금 1차', precision: 'date',
    startDate: due, endDate: due, dateLabel: due,
  };
  if (due === '2028-02-14') return {
    id: 'interim-2', label: '중도금 2차', precision: 'date',
    startDate: due, endDate: due, dateLabel: due,
  };
  if (due === '입주 시') return {
    id: 'balance', label: '잔금', precision: 'month',
    startDate: '2029-02-01', endDate: '2029-02-28', dateLabel: '입주지정기간 · 2029.02 예정',
  };
  if (due === '별도 안내') return {
    id: 'option-iii-interim', label: '기타 옵션 중도금', precision: 'unknown', dateLabel: '계약 후 별도 안내',
  };
  return { id: 'undetermined', label: '납부 일정', precision: 'unknown', dateLabel: '일정 미정' };
}

/** Choose one useful disclosure, never treating an unknown option date as a deadline. */
export function recommendedPaymentDue(rows: readonly { dueKey: string }[], now: Date = new Date()): string | null {
  const today = calendarDay(seoulDateKey(now))!;
  const known = rows.flatMap((row) => {
    const deadline = paymentDeadlineForDue(row.dueKey);
    const start = calendarDay(deadline.startDate);
    const end = calendarDay(deadline.endDate ?? deadline.startDate);
    return deadline.precision !== 'unknown' && start !== null && end !== null && end >= start
      ? [{ dueKey: row.dueKey, start, end, estimated: deadline.precision === 'month' }] : [];
  });
  const current = (estimated: boolean) => known.find((row) => row.estimated === estimated && row.start <= today && row.end >= today);
  const next = (estimated: boolean) => known.filter((row) => row.estimated === estimated && row.start > today).sort((a, b) => a.start - b.start)[0];
  return (current(false) ?? next(false) ?? current(true) ?? next(true)
    ?? known.sort((a, b) => b.end - a.end)[0])?.dueKey ?? null;
}

const unknownCountdown = (): BundangPaymentCountdownV1 => ({
  text: '일정 미정', state: 'unknown',
  detail: '확정 납부일이 별도 안내되기 전에는 D-day를 계산하지 않습니다.',
});

/** Calendar countdown only: elapsed days never imply that an installment has been paid. */
export function countdownForDeadline(
  deadline: BundangPaymentDeadlineV1,
  now: Date = new Date(),
): BundangPaymentCountdownV1 {
  if (deadline.precision === 'unknown') return unknownCountdown();
  const start = calendarDay(deadline.startDate);
  const end = calendarDay(deadline.endDate ?? deadline.startDate);
  if (start === null || end === null || end < start) return unknownCountdown();
  const today = calendarDay(seoulDateKey(now))!;
  const untilStart = start - today;
  const untilEnd = end - today;

  if (deadline.precision === 'month') {
    const month = deadline.startDate!.slice(0, 7).replace('-', '.');
    if (untilStart > 0) return {
      text: `예정월 D-${untilStart}`, state: 'upcoming',
      detail: `${deadline.startDate!.replaceAll('-', '.')} (예정월 첫날) 기준이며 확정 입주일이 아닙니다. 입주지정기간은 별도 안내됩니다.`,
    };
    if (untilEnd >= 0) return {
      text: '입주 예정월', state: 'active',
      detail: `${month} 입주 예정이며 확정 입주일과 입주지정기간은 별도 확인해야 합니다.`,
    };
    return {
      text: '예정월 경과', state: 'elapsed',
      detail: `${month} 예정월이 지난 상태이며 실제 입주지정기간이나 납부 완료 여부를 뜻하지 않습니다.`,
    };
  }

  if (deadline.precision === 'range') {
    if (untilStart > 0) return {
      text: `시작 D-${untilStart}`, state: 'upcoming',
      detail: `${deadline.dateLabel} 계약 기간의 시작일까지 남은 일수입니다. 한국시간 날짜를 기준으로 합니다.`,
    };
    if (untilEnd > 0) return {
      text: `종료 D-${untilEnd}`, state: 'active',
      detail: `현재 계약 기간이며 종료일까지 남은 일수입니다. 납부 완료 여부와는 무관합니다.`,
    };
    if (untilEnd === 0) return {
      text: '오늘 종료 · D-day', state: 'today',
      detail: '오늘은 공고상 계약 기간 마지막 날입니다. 실제 접수 마감 시각은 별도 확인해 주세요.',
    };
    return {
      text: `종료 D+${-untilEnd}`, state: 'elapsed',
      detail: '공고상 계약 기간 종료 후 경과 일수이며 납부 완료 여부를 뜻하지 않습니다.',
    };
  }

  if (untilStart > 0) return {
    text: `D-${untilStart}`, state: 'upcoming',
    detail: `${deadline.dateLabel} 납부일까지 남은 일수입니다. 한국시간 날짜를 기준으로 합니다.`,
  };
  if (untilStart === 0) return {
    text: 'D-day', state: 'today', detail: '오늘은 공고상 납부일입니다. 납부 완료 여부와는 무관합니다.',
  };
  return {
    text: `경과 D+${-untilStart}`, state: 'elapsed',
    detail: '공고상 납부일 이후 경과 일수이며 납부 완료 여부를 뜻하지 않습니다.',
  };
}
