import { beforeEach, describe, expect, it } from 'vitest';
import {
  SALE_CALCULATOR_PREFERENCES_SESSION_KEY,
  clearSaleCalculatorPreferences,
  readSaleCalculatorPreferences,
  writeSaleCalculatorPreferences,
  type SaleCalculatorPreferenceScopeV1,
  type SaleCalculatorScenarioPreferencesV1,
} from './sale-calculator-preferences';

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

const scope: SaleCalculatorPreferenceScopeV1 = { unitType: '55A', floorBand: '5+' };
const scenario = (): SaleCalculatorScenarioPreferencesV1 => ({
  plan: 'pre-subscription', taxEnabled: true, taxReliefMode: 'first-home', interimRatePercent: 4.8,
  mortgageEnabled: true, ltv: 60, term: 30, childCount: 2, holdingYears: 12,
  interimFunding: 'loan', assumedMoveInDate: '2029-03-01', costsEnabled: true,
  costs: { stamp: 150_000, bond: 200_000, registration: 300_000, guarantee: 50_000, management: 1_000_000, moving: 5_000_000 },
  salePriceWon: 900_000_000,
});

describe('current-tab calculator scenario preferences', () => {
  beforeEach(() => clearSaleCalculatorPreferences(null));

  it('restores the complete scenario without option amounts or address/authentication data', () => {
    const storage = new MemoryStorage();
    const values = { ...scenario(), buildingId: '105', householdNumber: '1903', nickname: '피치', role: 'operator', optionIds: ['design-wall'], contractTotal: 123 };
    expect(writeSaleCalculatorPreferences(scope, values, storage)).toEqual(scenario());
    expect(readSaleCalculatorPreferences(scope, storage)).toEqual(scenario());
    const raw = storage.getItem(SALE_CALCULATOR_PREFERENCES_SESSION_KEY)!;
    expect(raw).not.toMatch(/105|1903|피치|building|household|nickname|role|optionIds|contractTotal/u);
    expect(JSON.parse(raw)).toEqual({ schemaVersion: 1, scope, scenario: scenario() });
  });

  it('retains settings within the same scope but drops them when type or floor-price band changes', () => {
    const storage = new MemoryStorage();
    writeSaleCalculatorPreferences(scope, scenario(), storage);
    expect(readSaleCalculatorPreferences({ ...scope }, storage)).toEqual(scenario());
    expect(readSaleCalculatorPreferences({ ...scope, unitType: '55B' }, storage)).toBeNull();
    expect(storage.getItem(SALE_CALCULATOR_PREFERENCES_SESSION_KEY)).toBeNull();
    writeSaleCalculatorPreferences(scope, scenario(), storage);
    expect(readSaleCalculatorPreferences({ ...scope, floorBand: '4' }, storage)).toBeNull();
  });

  it.each([
    '{broken', 'null', '{}',
    JSON.stringify({ schemaVersion: 2, scope, scenario: scenario() }),
    JSON.stringify({ schemaVersion: 1, scope: { unitType: '55A', floorBand: 1 }, scenario: scenario() }),
    JSON.stringify({ schemaVersion: 1, scope, scenario: { ...scenario(), interimRatePercent: 4.85 } }),
    JSON.stringify({ schemaVersion: 1, scope, scenario: { ...scenario(), assumedMoveInDate: '2029-02-30' } }),
    JSON.stringify({ schemaVersion: 1, scope, scenario: { ...scenario(), holdingYears: 31 } }),
    JSON.stringify({ schemaVersion: 1, scope, scenario: { ...scenario(), ltv: '70' } }),
    JSON.stringify({ schemaVersion: 1, scope, scenario: { ...scenario(), costs: { ...scenario().costs, moving: -1 } } }),
  ])('discards invalid stored preferences instead of calculating or saving them (%s)', (raw) => {
    const storage = new MemoryStorage();
    storage.setItem(SALE_CALCULATOR_PREFERENCES_SESSION_KEY, raw);
    expect(readSaleCalculatorPreferences(scope, storage)).toBeNull();
    expect(storage.getItem(SALE_CALCULATOR_PREFERENCES_SESSION_KEY)).toBeNull();
  });

  it('sanitizes externally inserted fields when restoring valid preferences', () => {
    const storage = new MemoryStorage();
    storage.setItem(SALE_CALCULATOR_PREFERENCES_SESSION_KEY, JSON.stringify({ schemaVersion: 1, scope: { ...scope, householdNumber: '1903' }, scenario: { ...scenario(), nickname: '피치' }, auth: 'secret' }));
    expect(readSaleCalculatorPreferences(scope, storage)).toEqual(scenario());
    expect(storage.getItem(SALE_CALCULATOR_PREFERENCES_SESSION_KEY)).not.toMatch(/1903|피치|auth/u);
  });

  it('does not replace the last valid scenario with invalid edits', () => {
    const storage = new MemoryStorage();
    writeSaleCalculatorPreferences(scope, scenario(), storage);
    expect(writeSaleCalculatorPreferences(scope, { ...scenario(), interimRatePercent: Number.NaN }, storage)).toBeNull();
    expect(readSaleCalculatorPreferences(scope, storage)).toEqual(scenario());
  });

  it('keeps valid preferences in memory if sessionStorage is unavailable or quota-limited', () => {
    const unavailable = {
      getItem(): never { throw new Error('blocked'); },
      setItem(): never { throw new Error('quota'); },
      removeItem(): never { throw new Error('blocked'); },
    };
    expect(() => writeSaleCalculatorPreferences(scope, scenario(), unavailable)).not.toThrow();
    expect(readSaleCalculatorPreferences(scope, unavailable)).toEqual(scenario());
    expect(() => clearSaleCalculatorPreferences(unavailable)).not.toThrow();
    expect(readSaleCalculatorPreferences(scope, unavailable)).toBeNull();
    writeSaleCalculatorPreferences(scope, scenario(), null);
    expect(readSaleCalculatorPreferences(scope, null)).toEqual(scenario());
    clearSaleCalculatorPreferences(null);
    expect(readSaleCalculatorPreferences(scope, null)).toBeNull();
  });
});
