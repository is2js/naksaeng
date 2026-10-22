import type { SaleCalculatorApplicantRoute, SaleCalculatorPriceFloorBand } from './sale-calculator-context';

export const SALE_CALCULATOR_PREFERENCES_SESSION_KEY = 'bunfirvil:sale-calculator-preferences:v1';

export interface SaleCalculatorPreferenceScopeV1 {
  unitType: string;
  floorBand: SaleCalculatorPriceFloorBand;
}

export interface SaleCalculatorScenarioPreferencesV1 {
  plan: SaleCalculatorApplicantRoute;
  taxEnabled: boolean;
  taxReliefMode: 'none' | 'first-home' | 'birth-care';
  interimRatePercent: number;
  mortgageEnabled: boolean;
  ltv: 30 | 40 | 50 | 60 | 70;
  term: 20 | 30;
  childCount: 0 | 1 | 2;
  holdingYears: number;
  interimFunding: 'cash' | 'loan';
  assumedMoveInDate: string;
  costsEnabled: boolean;
  costs: { stamp: number; bond: number; registration: number; guarantee: number; management: number; moving: number };
  salePriceWon: number | null;
}

type SessionStoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const memoryFallback = new WeakMap<SessionStoragePort, string | null>();
const memoryOnlyStores = new WeakSet<SessionStoragePort>();
let unavailableStorageFallback: string | null = null;
const COST_IDS = ['stamp', 'bond', 'registration', 'guarantee', 'management', 'moving'] as const;

function browserSessionStorage(): SessionStoragePort | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validScope(value: unknown): value is SaleCalculatorPreferenceScopeV1 {
  return record(value)
    && typeof value.unitType === 'string' && ['51A', '55A', '55B', '59A'].includes(value.unitType)
    && typeof value.floorBand === 'string' && ['1', '2', '3', '4', '5+'].includes(value.floorBand);
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value) || value < '2028-02-15' || value > '2099-12-31') return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function integerBetween(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function normalizedScenario(value: unknown): SaleCalculatorScenarioPreferencesV1 | null {
  if (!record(value)
    || (value.plan !== 'pre-subscription' && value.plan !== 'main-subscription')
    || typeof value.taxEnabled !== 'boolean' || typeof value.taxReliefMode !== 'string' || !['none', 'first-home', 'birth-care'].includes(value.taxReliefMode)
    || typeof value.interimRatePercent !== 'number' || !Number.isFinite(value.interimRatePercent)
    || value.interimRatePercent < 0 || value.interimRatePercent > 15
    || Math.abs(value.interimRatePercent * 10 - Math.round(value.interimRatePercent * 10)) > 1e-7
    || typeof value.mortgageEnabled !== 'boolean' || typeof value.ltv !== 'number' || ![30, 40, 50, 60, 70].includes(value.ltv)
    || (value.term !== 20 && value.term !== 30) || !integerBetween(value.childCount, 0, 2)
    || !integerBetween(value.holdingYears, 3, value.term)
    || (value.interimFunding !== 'cash' && value.interimFunding !== 'loan')
    || !validDate(value.assumedMoveInDate) || typeof value.costsEnabled !== 'boolean' || !record(value.costs)
    || COST_IDS.some((id) => !integerBetween((value.costs as Record<string, unknown>)[id], 0, 10_000_000_000))
    || (value.salePriceWon !== null && !integerBetween(value.salePriceWon, 1, 100_000_000_000))) return null;
  // Copy the exact preference whitelist. Caller/context/address fields never enter this record.
  return {
    plan: value.plan,
    taxEnabled: value.taxEnabled,
    taxReliefMode: value.taxReliefMode as SaleCalculatorScenarioPreferencesV1['taxReliefMode'],
    interimRatePercent: Math.round(value.interimRatePercent * 10) / 10,
    mortgageEnabled: value.mortgageEnabled,
    ltv: value.ltv as SaleCalculatorScenarioPreferencesV1['ltv'],
    term: value.term,
    childCount: value.childCount as 0 | 1 | 2,
    holdingYears: value.holdingYears,
    interimFunding: value.interimFunding,
    assumedMoveInDate: value.assumedMoveInDate,
    costsEnabled: value.costsEnabled,
    costs: Object.fromEntries(COST_IDS.map((id) => [id, (value.costs as Record<string, number>)[id]])) as SaleCalculatorScenarioPreferencesV1['costs'],
    salePriceWon: value.salePriceWon as number | null,
  };
}

function readRaw(storage: SessionStoragePort | null): string | null {
  if (!storage) return unavailableStorageFallback;
  if (memoryOnlyStores.has(storage)) return memoryFallback.get(storage) ?? null;
  try { return storage.getItem(SALE_CALCULATOR_PREFERENCES_SESSION_KEY); }
  catch { return memoryFallback.get(storage) ?? null; }
}

function writeRaw(raw: string, storage: SessionStoragePort | null): void {
  if (!storage) { unavailableStorageFallback = raw; return; }
  memoryFallback.set(storage, raw);
  try {
    storage.setItem(SALE_CALCULATOR_PREFERENCES_SESSION_KEY, raw);
    memoryOnlyStores.delete(storage);
  } catch { memoryOnlyStores.add(storage); }
}

export function clearSaleCalculatorPreferences(storage: SessionStoragePort | null = browserSessionStorage()): void {
  if (!storage) { unavailableStorageFallback = null; return; }
  memoryFallback.set(storage, null);
  try { storage.removeItem(SALE_CALCULATOR_PREFERENCES_SESSION_KEY); memoryOnlyStores.delete(storage); }
  catch { memoryOnlyStores.add(storage); }
}

/** Same type/price band only; options and calculated amounts are intentionally not saved. */
export function readSaleCalculatorPreferences(
  scope: SaleCalculatorPreferenceScopeV1,
  storage: SessionStoragePort | null = browserSessionStorage(),
): SaleCalculatorScenarioPreferencesV1 | null {
  try {
    const raw = readRaw(storage);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (!validScope(scope) || !record(value) || value.schemaVersion !== 1 || !validScope(value.scope)
      || value.scope.unitType !== scope.unitType || value.scope.floorBand !== scope.floorBand) {
      clearSaleCalculatorPreferences(storage);
      return null;
    }
    const scenario = normalizedScenario(value.scenario);
    if (!scenario) { clearSaleCalculatorPreferences(storage); return null; }
    // Sanitize any externally inserted fields when a stored record is restored.
    writeRaw(JSON.stringify({ schemaVersion: 1, scope: { unitType: scope.unitType, floorBand: scope.floorBand }, scenario }), storage);
    return scenario;
  } catch { clearSaleCalculatorPreferences(storage); return null; }
}

export function writeSaleCalculatorPreferences(
  scope: SaleCalculatorPreferenceScopeV1,
  values: SaleCalculatorScenarioPreferencesV1,
  storage: SessionStoragePort | null = browserSessionStorage(),
): SaleCalculatorScenarioPreferencesV1 | null {
  const scenario = normalizedScenario(values);
  if (!validScope(scope) || !scenario) return null;
  writeRaw(JSON.stringify({ schemaVersion: 1, scope: { unitType: scope.unitType, floorBand: scope.floorBand }, scenario }), storage);
  return scenario;
}
