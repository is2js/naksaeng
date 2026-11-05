import { describe, expect, it } from 'vitest';
import { countdownForDeadline, paymentDeadlineForDue, seoulDateKey, type BundangPaymentDeadlineV1 } from './bundang-payment-timeline';
import { BUNDANG_PAYMENT_PLAN_PRESETS_V1 } from './bundang-sale-finance';

const atSeoulNoon = (date: string) => new Date(`${date}T12:00:00+09:00`);

describe('Bundang payment timeline', () => {
  it('preserves official contract range, both interim dates, planned month and unspecified option installment', () => {
    expect(paymentDeadlineForDue('계약 시')).toMatchObject({ precision: 'range', startDate: '2026-11-04', endDate: '2026-11-13' });
    expect(paymentDeadlineForDue('2027-04-12')).toMatchObject({ precision: 'date', startDate: '2027-04-12' });
    expect(paymentDeadlineForDue('2028-02-14')).toMatchObject({ precision: 'date', startDate: '2028-02-14' });
    expect(paymentDeadlineForDue('입주 시')).toMatchObject({ precision: 'month', startDate: '2029-02-01', endDate: '2029-02-28' });
    expect(paymentDeadlineForDue('별도 안내')).toMatchObject({ precision: 'unknown', dateLabel: '계약 후 별도 안내' });
    expect(paymentDeadlineForDue('옵션Ⅲ 계약 시')).toMatchObject({ id: 'option-iii-contract', precision: 'unknown', dateLabel: '옵션 계약 시 · 일정 별도 안내' });
  });

  it('covers every actual installment due in both application payment plans without inventing dates for option III', () => {
    for (const plan of Object.values(BUNDANG_PAYMENT_PLAN_PRESETS_V1)) {
      for (const installments of Object.values(plan)) {
        for (const installment of installments) {
          const deadline = paymentDeadlineForDue(installment.due);
          expect(deadline.id, `Unmapped installment: ${installment.due}`).not.toBe('undetermined');
          expect(deadline.precision === 'unknown').toBe(['별도 안내', '옵션Ⅲ 계약 시'].includes(installment.due));
          if (/^\d{4}-\d{2}-\d{2}$/.test(installment.due)) {
            expect(deadline.startDate).toBe(installment.due);
            expect(deadline.endDate).toBe(installment.due);
          }
        }
      }
    }
  });

  it('uses Seoul day boundaries regardless of device time zone or UTC date', () => {
    expect(seoulDateKey(new Date('2026-10-22T14:59:59.999Z'))).toBe('2026-10-22');
    expect(seoulDateKey(new Date('2026-10-22T15:00:00.000Z'))).toBe('2026-10-23');
    expect(seoulDateKey(new Date('2026-12-31T15:00:00.000Z'))).toBe('2027-01-01');
    expect(seoulDateKey(new Date('2028-02-28T15:00:00.000Z'))).toBe('2028-02-29');
    expect(() => seoulDateKey(new Date(NaN))).toThrow(RangeError);
  });

  it('calculates both actual interim installments rather than a fixed generic deadline', () => {
    expect(countdownForDeadline(paymentDeadlineForDue('2027-04-12'), atSeoulNoon('2026-10-22'))).toMatchObject({ text: 'D-172', state: 'upcoming' });
    expect(countdownForDeadline(paymentDeadlineForDue('2028-02-14'), atSeoulNoon('2026-10-22'))).toMatchObject({ text: 'D-480', state: 'upcoming' });
  });

  it.each([
    ['2027-04-11', 'D-1', 'upcoming'],
    ['2027-04-12', 'D-day', 'today'],
    ['2027-04-13', '경과 D+1', 'elapsed'],
  ])('renders a dated installment on %s as %s without claiming payment completion', (date, text, state) => {
    const result = countdownForDeadline(paymentDeadlineForDue('2027-04-12'), atSeoulNoon(date));
    expect(result).toMatchObject({ text, state });
    if (state !== 'upcoming') expect(result.detail).toMatch(/납부 완료 여부/);
  });

  it('updates exactly at Seoul midnight rather than counting elapsed 24-hour durations', () => {
    const deadline = paymentDeadlineForDue('2027-04-12');
    expect(countdownForDeadline(deadline, new Date('2027-04-11T14:59:59.999Z')).text).toBe('D-1');
    expect(countdownForDeadline(deadline, new Date('2027-04-11T15:00:00.000Z')).text).toBe('D-day');
  });

  it.each([
    ['2026-10-22', '시작 D-13', 'upcoming'],
    ['2026-11-03', '시작 D-1', 'upcoming'],
    ['2026-11-04', '종료 D-9', 'active'],
    ['2026-11-07', '종료 D-6', 'active'],
    ['2026-11-12', '종료 D-1', 'active'],
    ['2026-11-13', '오늘 종료 · D-day', 'today'],
    ['2026-11-14', '종료 D+1', 'elapsed'],
  ])('respects both ends of the contract period on %s', (date, text, state) => {
    expect(countdownForDeadline(paymentDeadlineForDue('계약 시'), atSeoulNoon(date))).toMatchObject({ text, state });
  });

  it('labels the planned move-in month as an estimate, not a confirmed move-in date', () => {
    const result = countdownForDeadline(paymentDeadlineForDue('입주 시'), atSeoulNoon('2026-10-22'));
    expect(result).toMatchObject({ text: '예정월 D-833', state: 'upcoming' });
    expect(result.detail).toContain('2029.02.01 (예정월 첫날) 기준');
    expect(result.detail).toContain('확정 입주일이 아닙니다');
    for (const date of ['2029-02-01', '2029-02-14', '2029-02-28']) {
      expect(countdownForDeadline(paymentDeadlineForDue('입주 시'), atSeoulNoon(date))).toMatchObject({ text: '입주 예정월', state: 'active' });
    }
    expect(countdownForDeadline(paymentDeadlineForDue('입주 시'), atSeoulNoon('2029-03-01'))).toMatchObject({ text: '예정월 경과', state: 'elapsed' });
  });

  it('never fabricates a D-day for separately announced or unknown schedules', () => {
    for (const due of ['별도 안내', '옵션Ⅲ 계약 시', '', 'unrecognized', '2029-02-30', '2027-04-12T00:00:00Z']) {
      const deadline = paymentDeadlineForDue(due);
      expect(deadline.precision).toBe('unknown');
      expect(countdownForDeadline(deadline, atSeoulNoon('2026-10-22'))).toMatchObject({ text: '일정 미정', state: 'unknown' });
    }
  });

  it.each([
    { startDate: '2027-02-29', endDate: '2027-03-01' },
    { startDate: '2028-02-30', endDate: '2028-03-01' },
    { startDate: '2026-11-13', endDate: '2026-11-07' },
    { startDate: 'not-a-date' },
    {},
  ])('fails closed for malformed supplied deadline bounds %j', (bounds) => {
    const deadline: BundangPaymentDeadlineV1 = { id: 'test', label: 'Test', precision: 'range', dateLabel: 'Test', ...bounds };
    expect(countdownForDeadline(deadline, atSeoulNoon('2026-10-22'))).toMatchObject({ text: '일정 미정', state: 'unknown' });
  });

  it('does not mutate deadline definitions or current Date objects across repeated calculations', () => {
    const deadline = paymentDeadlineForDue('계약 시');
    const now = atSeoulNoon('2026-10-22');
    const before = JSON.stringify(deadline);
    const timeBefore = now.getTime();
    expect(countdownForDeadline(deadline, now)).toEqual(countdownForDeadline(deadline, now));
    expect(JSON.stringify(deadline)).toBe(before);
    expect(now.getTime()).toBe(timeBefore);
    deadline.startDate = '2030-01-01';
    expect(paymentDeadlineForDue('계약 시').startDate).toBe('2026-11-04');
  });
});
