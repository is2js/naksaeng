import { clearSaleCalculatorPreferences, readSaleCalculatorPreferences, writeSaleCalculatorPreferences } from './sale-calculator-preferences';

export const SALE_CALCULATOR_CONTEXT_SESSION_KEY = 'bunfirvil:sale-calculator:v1';

export type SaleCalculatorPriceFloorBand = '1' | '2' | '3' | '4' | '5+';
export type SaleCalculatorApplicantRoute = 'pre-subscription' | 'main-subscription';

const SALE_CALCULATOR_RETURN_MAP_IDS = new Set([
  'bundang-first-village-51a-prototype',
  'bundang-first-village-55a-prototype',
  'bundang-first-village-55b-prototype',
  'bundang-first-village-59a-prototype',
]);

/**
 * 세대 인증에서 계산기로 넘기는 최소 식별 정보입니다.
 * 실제 층·동·호·닉네임은 이 계약에 저장하지 않습니다.
 */
export interface SaleCalculatorContextV1 {
  schemaVersion: 1;
  unitType: string;
  priceFloorBand: SaleCalculatorPriceFloorBand;
  applicantRoute?: SaleCalculatorApplicantRoute;
  optionIds?: string[];
  returnUrl?: string;
}

type SessionStoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function browserSessionStorage(): SessionStoragePort | null {
  if (typeof window === 'undefined') return null;
  try { return window.sessionStorage; } catch { return null; }
}

export function saleCalculatorPriceFloorBand(floor: number): SaleCalculatorPriceFloorBand {
  if (!Number.isInteger(floor) || floor < 1) throw new Error('유효한 세대 층수가 필요합니다.');
  if (floor <= 1) return '1';
  if (floor === 2) return '2';
  if (floor === 3) return '3';
  if (floor === 4) return '4';
  return '5+';
}

function validUnitType(value: unknown): value is string {
  return value === '51A' || value === '55A' || value === '55B' || value === '59A';
}

function validFloorBand(value: unknown): value is SaleCalculatorPriceFloorBand {
  return value === '1' || value === '2' || value === '3' || value === '4' || value === '5+';
}

function validApplicantRoute(value: unknown): value is SaleCalculatorApplicantRoute {
  return value === 'pre-subscription' || value === 'main-subscription';
}

function safeOptionIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !/^(?=.*[a-z])[a-z0-9]+(?:-[a-z0-9]+)+$/u.test(id) || id.length > 160)) return null;
  return [...new Set(value)];
}

function sameOriginReturnUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const origin = typeof window === 'undefined' ? 'https://bunfirvil.invalid' : window.location.origin;
    const url = new URL(value, origin);
    if (url.origin !== origin) return null;
    const basePath = new URL(import.meta.env.BASE_URL, origin).pathname;
    // Existing sessions survive the same-origin Pages move. Only the old app
    // root is migrated; arbitrary project/subpage paths remain disallowed.
    if (url.pathname !== basePath && url.pathname !== '/bunfirvil/') return null;
    const safeQuery = new URLSearchParams();
    const map = url.searchParams.get('map');
    const actor = url.searchParams.get('actor');
    const variant = url.searchParams.get('variant');
    if (map !== null && !SALE_CALCULATOR_RETURN_MAP_IDS.has(map)) return null;
    if (map && SALE_CALCULATOR_RETURN_MAP_IDS.has(map)) safeQuery.set('map', map);
    if (actor === '100' || actor === '200') safeQuery.set('actor', actor);
    if (variant === 'A' || variant === 'B'
      || ((variant === 'C' || variant === 'D') && (map === 'bundang-first-village-51a-prototype' || map === 'bundang-first-village-55a-prototype'))) safeQuery.set('variant', variant);
    const query = safeQuery.toString();
    return `${basePath}${query ? `?${query}` : ''}`;
  } catch { return null; }
}

export function writeSaleCalculatorHouseholdContext(
  unitType: string,
  floor: number,
  storage: SessionStoragePort | null = browserSessionStorage(),
): SaleCalculatorContextV1 | null {
  if (!storage || !validUnitType(unitType) || !Number.isInteger(floor) || floor < 1) return null;
  const context: SaleCalculatorContextV1 = {
    schemaVersion: 1,
    unitType,
    priceFloorBand: saleCalculatorPriceFloorBand(Math.trunc(floor)),
  };
  // Drop a previous household's scenario, but retain choices within the same
  // type/price band (including changes to the selected option snapshot).
  readSaleCalculatorPreferences({ unitType: context.unitType, floorBand: context.priceFloorBand }, storage);
  storage.setItem(SALE_CALCULATOR_CONTEXT_SESSION_KEY, JSON.stringify(context));
  return context;
}

export function readSaleCalculatorHouseholdContext(
  storage: SessionStoragePort | null = browserSessionStorage(),
): SaleCalculatorContextV1 | null {
  if (!storage) return null;
  try {
    const value = JSON.parse(storage.getItem(SALE_CALCULATOR_CONTEXT_SESSION_KEY) || 'null') as Partial<SaleCalculatorContextV1> | null;
    const reject = (): null => {
      storage.removeItem(SALE_CALCULATOR_CONTEXT_SESSION_KEY);
      return null;
    };
    if (!value || value.schemaVersion !== 1 || !validUnitType(value.unitType) || !validFloorBand(value.priceFloorBand)) return reject();
    const hasLaunchFields = value.applicantRoute !== undefined || value.optionIds !== undefined || value.returnUrl !== undefined;
    if (!hasLaunchFields) {
      const sanitized = { schemaVersion: 1 as const, unitType: value.unitType, priceFloorBand: value.priceFloorBand };
      storage.setItem(SALE_CALCULATOR_CONTEXT_SESSION_KEY, JSON.stringify(sanitized));
      return sanitized;
    }
    if (!validApplicantRoute(value.applicantRoute)) return reject();
    const optionIds = safeOptionIds(value.optionIds);
    const returnUrl = sameOriginReturnUrl(value.returnUrl);
    if (!optionIds?.length || !returnUrl) return reject();
    const sanitized = { schemaVersion: 1 as const, unitType: value.unitType, priceFloorBand: value.priceFloorBand, applicantRoute: value.applicantRoute, optionIds, returnUrl };
    storage.setItem(SALE_CALCULATOR_CONTEXT_SESSION_KEY, JSON.stringify(sanitized));
    return sanitized;
  } catch {
    storage.removeItem(SALE_CALCULATOR_CONTEXT_SESSION_KEY);
    return null;
  }
}

export function writeSaleCalculatorLaunchContext(
  value: Omit<SaleCalculatorContextV1, 'unitType' | 'priceFloorBand'> & { applicantRoute: SaleCalculatorApplicantRoute; optionIds: string[]; returnUrl: string },
  storage: SessionStoragePort | null = browserSessionStorage(),
): SaleCalculatorContextV1 | null {
  if (!storage || value.schemaVersion !== 1 || !validApplicantRoute(value.applicantRoute)) return null;
  const household = readSaleCalculatorHouseholdContext(storage);
  if (!household) return null;
  const optionIds = safeOptionIds(value.optionIds);
  const returnUrl = sameOriginReturnUrl(value.returnUrl);
  if (!optionIds || optionIds.length === 0 || !returnUrl) return null;
  const context: SaleCalculatorContextV1 = {
    schemaVersion: 1,
    unitType: household.unitType,
    priceFloorBand: household.priceFloorBand,
    applicantRoute: value.applicantRoute,
    optionIds,
    returnUrl,
  };
  storage.setItem(SALE_CALCULATOR_CONTEXT_SESSION_KEY, JSON.stringify(context));
  // A new launch is an explicit choice in the playground modal. Honor it
  // without discarding any other saved scenario controls; reloads do not run
  // this writer and therefore still restore the last calculator plan.
  const scope = { unitType: context.unitType, floorBand: context.priceFloorBand };
  const preferences = readSaleCalculatorPreferences(scope, storage);
  if (preferences) writeSaleCalculatorPreferences(scope, { ...preferences, plan: value.applicantRoute }, storage);
  return context;
}

export function readSaleCalculatorLaunchContext(
  storage: SessionStoragePort | null = browserSessionStorage(),
): SaleCalculatorContextV1 | null {
  const context = readSaleCalculatorHouseholdContext(storage);
  return context?.applicantRoute && context.optionIds && context.returnUrl ? context : null;
}

export function clearSaleCalculatorContext(storage: SessionStoragePort | null = browserSessionStorage()): void {
  clearSaleCalculatorPreferences(storage);
  try { storage?.removeItem(SALE_CALCULATOR_CONTEXT_SESSION_KEY); } catch { /* Storage can be disabled. */ }
}
