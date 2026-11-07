import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BUNDANG_EXECUTED_CONTRACT_REVIEW_V1,
  BUNDANG_PAYMENT_ITEM_LABELS,
  contractSupplyBalanceBreakdown,
} from './bundang-executed-contract';
import {
  BUNDANG_SALE_FINANCE_CATALOG_V1,
  calculateBundangPaymentSchedule,
  calculateBundangSaleFinance,
  type BundangPaymentPlanKind,
  type BundangSaleUnitType,
} from './bundang-sale-finance';
import { resolveSaleCalculatorOptionLines } from './sale-calculator-options';
import type { ShowcaseCatalog } from './types';

describe('executed apartment and additional-item contracts', () => {
  it('records the executed-contract review and meaningful names for all payment items', () => {
    expect(BUNDANG_EXECUTED_CONTRACT_REVIEW_V1.reviewedAt).toBe('2026-11-07');
    expect(Object.keys(BUNDANG_PAYMENT_ITEM_LABELS).sort()).toEqual(['balcony', 'option-ii', 'option-iii', 'supply']);
    expect(BUNDANG_PAYMENT_ITEM_LABELS.supply).toContain('공급');
    expect(BUNDANG_PAYMENT_ITEM_LABELS.balcony).toContain('발코니');
    expect(BUNDANG_PAYMENT_ITEM_LABELS['option-ii']).toContain('시스템에어컨');
    expect(BUNDANG_PAYMENT_ITEM_LABELS['option-iii']).toContain('추가선택품목');
  });

  it('matches the reviewed new-applicant housing installments without adding fund metadata twice', () => {
    const quote = calculateBundangSaleFinance({
      household: { unitType: '55B', floorBand: 5 },
      paymentPlanKind: 'main-subscription',
    });
    const supply = quote.paymentSchedules.find((line) => line.target === 'supply')!;
    expect(supply.totalWon).toBe(636_290_000);
    expect(supply.installments.map(({ due, amountWon }) => [due, amountWon])).toEqual([
      ['계약 시', 63_629_000],
      ['2027-04-12', 63_629_000],
      ['2028-02-14', 63_629_000],
      ['입주 시', 445_403_000],
    ]);
    expect(contractSupplyBalanceBreakdown(445_403_000, 55_000_000)).toEqual({
      totalBalanceWon: 445_403_000,
      contractBalanceWon: 390_403_000,
      housingCityFundWon: 55_000_000,
    });
  });

  it('matches the reviewed balcony and system-air-conditioner amounts and actual catalog price', () => {
    const catalog = JSON.parse(readFileSync(new URL('../../public/generated/catalog.v1.json', import.meta.url), 'utf8')) as ShowcaseCatalog;
    const selected = resolveSaleCalculatorOptionLines(catalog.bOptions, ['system-ac-4-general'], '55B');
    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({ id: 'system-ac-4-general', tier: 'option-ii', priceWon: 6_600_000 });
    const quote = calculateBundangSaleFinance({
      household: { unitType: '55B', floorBand: 5 },
      paymentPlanKind: 'main-subscription',
      optionLines: selected,
    });
    const balcony = quote.paymentSchedules.find((line) => line.target === 'balcony')!;
    expect(balcony.totalWon).toBe(4_556_000);
    expect(balcony.installments.map(({ due, amountWon }) => [due, amountWon])).toEqual([
      ['계약 시', 455_600], ['2027-04-12', 911_200], ['입주 시', 3_189_200],
    ]);
    const airConditioner = quote.paymentSchedules.find((line) => line.target === 'option-ii')!;
    expect(airConditioner.installments.map(({ due, amountWon }) => [due, amountWon])).toEqual([
      ['계약 시', 660_000], ['2027-04-12', 1_980_000], ['입주 시', 3_960_000],
    ]);
  });

  it.each([
    [0, 55_000_000, 0, 0],
    [10_000_000, 55_000_000, 0, 10_000_000],
    [55_000_000, 55_000_000, 0, 55_000_000],
    [100_000_000, 55_000_000, 45_000_000, 55_000_000],
    [100_000_000, 0, 100_000_000, 0],
  ])('keeps balance %i and fund %i as one unchanged total', (balance, fund, contractPart, fundPart) => {
    expect(contractSupplyBalanceBreakdown(balance, fund)).toEqual({
      totalBalanceWon: balance, contractBalanceWon: contractPart, housingCityFundWon: fundPart,
    });
  });

  it.each([-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid monetary input %s in either argument', (invalid) => {
    expect(() => contractSupplyBalanceBreakdown(invalid, 55_000_000)).toThrow();
    expect(() => contractSupplyBalanceBreakdown(445_403_000, invalid)).toThrow();
  });

  const cases = (['51A', '55A', '55B', '59A'] as BundangSaleUnitType[]).flatMap(unitType =>
    (['pre-subscription', 'main-subscription'] as BundangPaymentPlanKind[]).flatMap(paymentPlanKind =>
      [false, true].map(selectMinusOption => ({ unitType, paymentPlanKind, selectMinusOption }))));
  it.each(cases)('is display-only for $unitType / $paymentPlanKind / minus=$selectMinusOption', ({ unitType, paymentPlanKind, selectMinusOption }) => {
    const quote = calculateBundangSaleFinance({
      household: { unitType, floorBand: 5 }, paymentPlanKind, selectMinusOption,
      mortgage: { termYears: 30, ltvBps: 7_000 },
      optionLines: [{ id: 'example-system-ac', label: '시스템에어컨', tier: 'option-ii', priceWon: 6_600_000 }],
    });
    const before = JSON.stringify(quote);
    const supply = quote.paymentSchedules.find((line) => line.target === 'supply')!;
    const balance = supply.installments.find((line) => line.id === 'balance')!.amountWon;
    const parts = contractSupplyBalanceBreakdown(balance, BUNDANG_SALE_FINANCE_CATALOG_V1.housingCityFundWon);
    expect(parts.totalBalanceWon).toBe(balance);
    expect(parts.contractBalanceWon + parts.housingCityFundWon).toBe(balance);
    expect(JSON.stringify(quote)).toBe(before);
    expect(supply).toEqual(calculateBundangPaymentSchedule(quote.adjustedSupplyPriceWon, paymentPlanKind, 'supply'));
    expect(quote.paymentSchedules.reduce((sum, line) => sum + line.installments.reduce((subtotal, item) => subtotal + item.amountWon, 0), 0)).toBe(quote.contractTotalWon);
    expect(quote.mortgage!.loanBaseWon).toBe(quote.adjustedSupplyPriceWon + quote.adjustedBalconyExtensionWon);
    expect(quote.mortgage!.principalWon).toBe(Math.min(Math.round(quote.mortgage!.loanBaseWon * 0.7), 400_000_000));
    expect(quote.optionIiSubtotalWon).toBe(selectMinusOption ? 0 : 6_600_000);
  });
});
