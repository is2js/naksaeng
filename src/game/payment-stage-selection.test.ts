import { describe, expect, it } from 'vitest';
import { recommendedPaymentDue } from './bundang-payment-timeline';

const main = ['계약 시', '옵션Ⅲ 계약 시', '2027-04-12', '2028-02-14', '별도 안내', '입주 시'].map(dueKey => ({ dueKey }));
const noon = (date: string) => new Date(`${date}T12:00:00+09:00`);

describe('one recommended payment disclosure', () => {
  it.each([
    ['2026-10-22', '계약 시'], ['2026-11-04', '계약 시'], ['2026-11-07', '계약 시'],
    ['2026-11-13', '계약 시'], ['2026-11-14', '2027-04-12'],
    ['2027-04-12', '2027-04-12'], ['2027-04-13', '2028-02-14'],
    ['2028-02-14', '2028-02-14'], ['2028-02-15', '입주 시'],
    ['2029-02-28', '입주 시'], ['2029-03-01', '입주 시'],
  ])('selects the active or next phase on %s', (date, due) => {
    expect(recommendedPaymentDue(main, noon(date))).toBe(due);
  });

  it('uses actual pre-subscription rows rather than inventing a first installment', () => {
    const pre = main.filter(row => row.dueKey !== '2027-04-12');
    expect(recommendedPaymentDue(pre, noon('2026-11-14'))).toBe('2028-02-14');
  });

  it('switches at Seoul midnight without marking an installment as paid', () => {
    expect(recommendedPaymentDue(main, new Date('2026-11-13T14:59:59Z'))).toBe('계약 시');
    expect(recommendedPaymentDue(main, new Date('2026-11-13T15:00:00Z'))).toBe('2027-04-12');
  });

  it('excludes unknown dates and keeps the supplied data unchanged', () => {
    const before = JSON.stringify(main);
    expect(recommendedPaymentDue([...main].reverse(), noon('2026-11-14'))).toBe('2027-04-12');
    expect(recommendedPaymentDue([{ dueKey: '별도 안내' }, { dueKey: '옵션Ⅲ 계약 시' }], noon('2026-11-07'))).toBeNull();
    expect(recommendedPaymentDue([], noon('2026-11-07'))).toBeNull();
    expect(JSON.stringify(main)).toBe(before);
  });
});
