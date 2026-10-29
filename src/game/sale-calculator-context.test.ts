import { describe, expect, it } from 'vitest';
import {
  SALE_CALCULATOR_CONTEXT_SESSION_KEY,
  clearSaleCalculatorContext,
  readSaleCalculatorHouseholdContext,
  readSaleCalculatorLaunchContext,
  saleCalculatorPriceFloorBand,
  writeSaleCalculatorHouseholdContext,
  writeSaleCalculatorLaunchContext,
} from './sale-calculator-context';
import { SALE_CALCULATOR_PREFERENCES_SESSION_KEY, readSaleCalculatorPreferences, writeSaleCalculatorPreferences } from './sale-calculator-preferences';

const appBase = import.meta.env.BASE_URL;

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

describe('분양가 계산기 세션 컨텍스트', () => {
  it.each(['51a', '55a'])('preserves all four %s variants on calculator return', (type) => {
    for (const variant of ['A', 'B', 'C', 'D']) {
      const storage = new MemoryStorage();
      writeSaleCalculatorHouseholdContext(type.toUpperCase(), 5, storage);
      const returnUrl = `/bunfirvil/?map=bundang-first-village-${type}-prototype&actor=200&variant=${variant}`;
      const canonicalReturnUrl = returnUrl.replace('/bunfirvil/', appBase);
      expect(writeSaleCalculatorLaunchContext({ schemaVersion: 1, applicantRoute: 'main-subscription', optionIds: ['design-wall'], returnUrl }, storage)?.returnUrl).toBe(canonicalReturnUrl);
      expect(readSaleCalculatorLaunchContext(storage)?.returnUrl).toBe(canonicalReturnUrl);
    }
  });
  it.each([
    [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5+'], [25, '5+'],
  ] as const)('실제 %s층은 가격 구간 %s으로 변환한다', (floor, expected) => {
    expect(saleCalculatorPriceFloorBand(floor)).toBe(expected);
  });

  it('0층·음수·소수 층은 가격 구간으로 변환하거나 저장하지 않는다', () => {
    const storage = new MemoryStorage();
    expect(() => saleCalculatorPriceFloorBand(0)).toThrow();
    expect(() => saleCalculatorPriceFloorBand(-1)).toThrow();
    expect(writeSaleCalculatorHouseholdContext('55A', 1.5, storage)).toBeNull();
    expect(storage.getItem(SALE_CALCULATOR_CONTEXT_SESSION_KEY)).toBeNull();
  });

  it('인증 세대에서는 타입과 가격 층 구간만 저장한다', () => {
    const storage = new MemoryStorage();
    writeSaleCalculatorHouseholdContext('55B', 19, storage);

    expect(readSaleCalculatorHouseholdContext(storage)).toEqual({ schemaVersion: 1, unitType: '55B', priceFloorBand: '5+' });
    const raw = storage.getItem(SALE_CALCULATOR_CONTEXT_SESSION_KEY) || '';
    expect(raw).not.toMatch(/105|1903|피치|19/);
    expect(raw).toBe('{"schemaVersion":1,"unitType":"55B","priceFloorBand":"5+"}');
  });

  it('옵션 스냅샷과 동일 출처 복귀 URL만 기록하고 외부 URL은 거부한다', () => {
    const storage = new MemoryStorage();
    writeSaleCalculatorHouseholdContext('55B', 5, storage);
    expect(writeSaleCalculatorLaunchContext({
      schemaVersion: 1,
      applicantRoute: 'pre-subscription',
      optionIds: ['design-wall', 'design-wall', 'minus-option'],
      returnUrl: `${appBase}?map=bundang-first-village-55b-prototype&variant=B`,
    }, storage)).toEqual({
      schemaVersion: 1,
      unitType: '55B',
      priceFloorBand: '5+',
      applicantRoute: 'pre-subscription',
      optionIds: ['design-wall', 'minus-option'],
      returnUrl: `${appBase}?map=bundang-first-village-55b-prototype&variant=B`,
    });
    expect(readSaleCalculatorLaunchContext(storage)?.optionIds).toEqual(['design-wall', 'minus-option']);
    expect(storage.getItem(SALE_CALCULATOR_CONTEXT_SESSION_KEY)).not.toMatch(/105|1903|피치/);
    expect(writeSaleCalculatorLaunchContext({
      schemaVersion: 1,
      applicantRoute: 'main-subscription',
      optionIds: ['design-wall'],
      returnUrl: 'https://example.test/',
    }, storage)).toBeNull();
    expect(writeSaleCalculatorLaunchContext({
      schemaVersion: 1,
      applicantRoute: 'main-subscription',
      optionIds: [],
      returnUrl: '/bunfirvil/',
    }, storage)?.optionIds).toEqual([]);
    expect(readSaleCalculatorLaunchContext(storage)?.optionIds).toEqual([]);
  });

  it('세대 다시 선택 시 계산기 세션 항목을 제거한다', () => {
    const storage = new MemoryStorage();
    writeSaleCalculatorHouseholdContext('51A', 4, storage);
    writeSaleCalculatorLaunchContext({
      schemaVersion: 1,
      applicantRoute: 'main-subscription',
      optionIds: ['floor-wide'],
      returnUrl: '/bunfirvil/',
    }, storage);
    storage.setItem(SALE_CALCULATOR_PREFERENCES_SESSION_KEY, 'previous-scenario');
    storage.setItem('unrelated:session', 'keep');
    clearSaleCalculatorContext(storage);
    expect(storage.getItem(SALE_CALCULATOR_CONTEXT_SESSION_KEY)).toBeNull();
    expect(storage.getItem(SALE_CALCULATOR_PREFERENCES_SESSION_KEY)).toBeNull();
    expect(storage.getItem('unrelated:session')).toBe('keep');
  });

  it('preserves scenario settings for the same price band and clears them for another type or band', () => {
    const storage = new MemoryStorage();
    const scope = { unitType: '55A', floorBand: '5+' as const };
    const preferences = {
      plan: 'main-subscription' as const, taxEnabled: false, taxReliefMode: 'none' as const, interimRatePercent: 4.8,
      mortgageEnabled: false, ltv: 70 as const, term: 30 as const, childCount: 0 as const, holdingYears: 24,
      interimFunding: 'cash' as const, assumedMoveInDate: '2029-02-01', costsEnabled: false,
      costs: { stamp: 0, bond: 0, registration: 0, guarantee: 0, management: 0, moving: 0 }, salePriceWon: null,
    };
    writeSaleCalculatorHouseholdContext('55A', 5, storage);
    writeSaleCalculatorPreferences(scope, preferences, storage);
    writeSaleCalculatorHouseholdContext('55A', 25, storage);
    expect(readSaleCalculatorPreferences(scope, storage)).toEqual(preferences);
    writeSaleCalculatorLaunchContext({ schemaVersion: 1, applicantRoute: 'main-subscription', optionIds: ['design-wall'], returnUrl: appBase }, storage);
    writeSaleCalculatorLaunchContext({ schemaVersion: 1, applicantRoute: 'main-subscription', optionIds: ['floor-wide'], returnUrl: appBase }, storage);
    expect(readSaleCalculatorPreferences(scope, storage)).toEqual(preferences);
    writeSaleCalculatorLaunchContext({ schemaVersion: 1, applicantRoute: 'pre-subscription', optionIds: ['floor-wide'], returnUrl: appBase }, storage);
    expect(readSaleCalculatorPreferences(scope, storage)).toEqual({ ...preferences, plan: 'pre-subscription' });
    // Reading/reloading the launch context must not reapply an old modal choice.
    writeSaleCalculatorPreferences(scope, preferences, storage);
    expect(readSaleCalculatorLaunchContext(storage)?.applicantRoute).toBe('pre-subscription');
    expect(readSaleCalculatorPreferences(scope, storage)).toEqual(preferences);
    writeSaleCalculatorHouseholdContext('55A', 4, storage);
    expect(storage.getItem(SALE_CALCULATOR_PREFERENCES_SESSION_KEY)).toBeNull();
    writeSaleCalculatorPreferences(scope, preferences, storage);
    writeSaleCalculatorHouseholdContext('55B', 5, storage);
    expect(storage.getItem(SALE_CALCULATOR_PREFERENCES_SESSION_KEY)).toBeNull();
  });

  it('지원하지 않는 타입과 개인정보가 섞인 컨텍스트를 거부한다', () => {
    const storage = new MemoryStorage();
    expect(writeSaleCalculatorHouseholdContext('84A', 5, storage)).toBeNull();
    storage.setItem(SALE_CALCULATOR_CONTEXT_SESSION_KEY, JSON.stringify({
      schemaVersion: 1, unitType: '55A', priceFloorBand: '5+', buildingId: '105', householdNumber: '1903', nickname: '피치',
    }));
    expect(readSaleCalculatorHouseholdContext(storage)).toEqual({ schemaVersion: 1, unitType: '55A', priceFloorBand: '5+' });
    expect(storage.getItem(SALE_CALCULATOR_CONTEXT_SESSION_KEY)).toBe('{"schemaVersion":1,"unitType":"55A","priceFloorBand":"5+"}');
  });

  it('복귀 URL은 쇼케이스 경로와 허용된 쿼리만 남긴다', () => {
    const storage = new MemoryStorage();
    writeSaleCalculatorHouseholdContext('55A', 5, storage);
    expect(writeSaleCalculatorLaunchContext({
      schemaVersion: 1,
      applicantRoute: 'main-subscription',
      optionIds: ['design-wall'],
      returnUrl: '/bunfirvil/?map=bundang-first-village-55a-prototype&actor=200&variant=A&nickname=피치#105-1903',
    }, storage)?.returnUrl).toBe(`${appBase}?map=bundang-first-village-55a-prototype&actor=200&variant=A`);
    expect(storage.getItem(SALE_CALCULATOR_CONTEXT_SESSION_KEY)).not.toMatch(/피치|105|1903/u);
  });

  it('개인정보처럼 보이는 옵션 ID와 알 수 없는 맵은 거부하고 원문을 제거한다', () => {
    const storage = new MemoryStorage();
    storage.setItem(SALE_CALCULATOR_CONTEXT_SESSION_KEY, JSON.stringify({
      schemaVersion: 1,
      unitType: '55A',
      priceFloorBand: '5+',
      applicantRoute: 'main-subscription',
      optionIds: ['피치'],
      returnUrl: '/bunfirvil/?map=105-1903',
    }));
    expect(readSaleCalculatorLaunchContext(storage)).toBeNull();
    expect(storage.getItem(SALE_CALCULATOR_CONTEXT_SESSION_KEY)).toBeNull();
  });

  it('normalizes stored legacy launch paths but refuses arbitrary subpages or external returns', () => {
    const storage = new MemoryStorage();
    const context = { schemaVersion: 1, unitType: '51A', priceFloorBand: '5+', applicantRoute: 'main-subscription', optionIds: ['design-wall'] };
    storage.setItem(SALE_CALCULATOR_CONTEXT_SESSION_KEY, JSON.stringify({ ...context, returnUrl: '/bunfirvil/?map=bundang-first-village-51a-prototype&variant=D&nickname=private#share=ignored' }));
    expect(readSaleCalculatorLaunchContext(storage)?.returnUrl).toBe(`${appBase}?map=bundang-first-village-51a-prototype&variant=D`);
    for (const returnUrl of ['/bunfirvil/calculator/', '/naksaeng/', '/other-project/', 'https://evil.example/bunfirvil/', '//evil.example/bunfirvil/', 'javascript:alert(1)', '/bunfirvil/%2f', '/bunfirvil/?map=unknown-map']) {
      storage.setItem(SALE_CALCULATOR_CONTEXT_SESSION_KEY, JSON.stringify({ ...context, returnUrl }));
      expect(readSaleCalculatorLaunchContext(storage)).toBeNull();
    }
  });
});
