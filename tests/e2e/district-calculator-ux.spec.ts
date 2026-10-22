import { expect, test } from '@playwright/test';

const CONTEXT_KEY = 'bunfirvil:sale-calculator:v1';
const PREFERENCES_KEY = 'bunfirvil:sale-calculator-preferences:v1';
const RETURN_URL = '/naksaeng/bunfirvil/?map=bundang-first-village-55a-prototype&actor=200&variant=A';

test('낙생지구 진입과 계산기 입력·복원·모바일·인쇄 동작을 유지한다', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('../');
  await expect(page.getByRole('heading', { name: '낙생지구', exact: true })).toBeVisible();
  await expect(page.getByText('성남낙생 공공주택지구', { exact: true }).first()).toBeVisible();
  const a1 = page.getByRole('link', { name: /A1.*e편한세상 분당퍼스트빌리지/u });
  await expect(a1).toHaveAttribute('href', /bunfirvil\/$/u);
  await expect(page.getByText('서비스 준비 중', { exact: true }).first()).toBeVisible();
  await expect(page.locator('a[href*="A2" i], a[href*="a2/"]')).toHaveCount(0);
  await page.locator('#district-app').screenshot({ path: testInfo.outputPath('district-1440.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.locator('#district-app').screenshot({ path: testInfo.outputPath('district-390.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await a1.click();
  await expect(page.getByRole('heading', { name: '분당퍼스트빌리지 동 선택' })).toBeVisible();

  // The migration stays on the same origin. Existing reviews/layouts must not be copied or erased.
  await page.evaluate(({ contextKey, returnUrl }) => {
    sessionStorage.clear();
    localStorage.setItem('bunfirvil:review:v1:bundang-first-village-55a-prototype', JSON.stringify({ notes: 'retained-review', selectedOptionIds: [] }));
    sessionStorage.setItem('bunfirvil:household-verification:v1', JSON.stringify({ schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(), role: 'verified' }));
    sessionStorage.setItem(contextKey, JSON.stringify({ schemaVersion: 1, unitType: '55A', priceFloorBand: '5+', applicantRoute: 'main-subscription', optionIds: ['system-ac-2-general', 'wide-plank-floor-finish'], returnUrl }));
  }, { contextKey: CONTEXT_KEY, returnUrl: RETURN_URL });
  await page.addInitScript(() => {
    window.print = () => { document.documentElement.dataset.printCalled = 'true'; };
  });
  await page.goto('calculator/');
  await expect(page.getByRole('heading', { name: '내 자금 계획', exact: true })).toBeVisible();
  await expect(page.locator('.topnav').getByRole('link', { name: '동·호 현황' })).toHaveCount(0);
  await expect(page.locator('.topbar .brand')).toHaveAttribute('href', RETURN_URL);
  await expect(page.locator('.topnav').getByRole('link', { name: '놀이터', exact: true })).toHaveAttribute('href', RETURN_URL);

  const rate = page.locator('#calculator-settlement-rate-input');
  const originalRate = (await rate.elementHandle())!;
  await rate.fill('4.8');
  await page.locator('#calculator-settlement-rate-up').click();
  await expect(rate).toHaveValue('4.9');
  expect(await originalRate.evaluate(node => node.isConnected)).toBe(true);
  await rate.fill('5.2');
  await page.locator('#calculator-print').click();
  await expect(page.locator('html')).toHaveAttribute('data-print-called', 'true');
  await expect(rate).toHaveValue('5.2');
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await rate.fill('4.6');
  await rate.press('Tab');
  await expect(page.locator('#calculator-settlement-rate-up')).toBeFocused();
  expect(await originalRate.evaluate(node => node.isConnected)).toBe(true);

  const savedValidPreferences = await page.evaluate(key => sessionStorage.getItem(key), PREFERENCES_KEY);
  await rate.fill('16');
  await page.locator('#calculator-print').evaluate(node => { document.documentElement.dataset.printCalled = 'false'; (node as HTMLButtonElement).click(); });
  await expect(rate).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-print-called', 'false');
  expect(await page.evaluate(key => sessionStorage.getItem(key), PREFERENCES_KEY)).toBe(savedValidPreferences);
  await rate.fill('4.7');
  await rate.press('Enter');
  await page.locator('.plan-switch label').filter({ hasText: '사전청약 당첨자' }).click();
  const tax = page.locator('#calculator-tax-details');
  await tax.locator('summary').click();
  await expect(tax.locator('summary')).toContainText('접기');
  await page.getByLabel('취득세 추정 활성화').check();
  await tax.locator('.relief-options label').filter({ hasText: '생애최초' }).click();
  await page.reload();
  await expect(rate).toHaveValue('4.7');
  await expect(page.getByLabel('사전청약 당첨자')).toBeChecked();
  await expect(page.getByLabel('취득세 추정 활성화')).toBeChecked();
  const preferences = await page.evaluate(key => sessionStorage.getItem(key), PREFERENCES_KEY);
  expect(preferences).not.toMatch(/building|household|nickname|operator|1903|피치/iu);
  expect(JSON.parse(preferences!).scope).toEqual({ unitType: '55A', floorBand: '5+' });

  // Option-only changes keep the tab's scenario, but always recalculate the fresh snapshot.
  await page.evaluate(key => {
    const context = JSON.parse(sessionStorage.getItem(key)!);
    context.optionIds = ['bundang-minus-option-package'];
    sessionStorage.setItem(key, JSON.stringify(context));
  }, CONTEXT_KEY);
  await page.reload();
  await expect(rate).toHaveValue('4.7');
  await expect(page.locator('.hero-total strong')).toHaveText('612,388,000원');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.schedule-scroll')).toBeHidden();
  const card = page.locator('.installment-card[data-mobile-finance-due="입주 시"]');
  await expect(card).toBeVisible();
  await expect(card.locator('summary')).toContainText('내 현금');
  await card.locator('summary').click();
  await expect(card).toHaveAttribute('open', '');
  await expect(card.locator('[data-mobile-flow="deferred-interest"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.locator('#calculator-payments').screenshot({ path: testInfo.outputPath('installment-cards-390.png') });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByRole('region', { name: '회차별 납부 일정과 자금 흐름' })).toHaveAttribute('tabindex', '0');
  await expect(page.locator('.schedule-cards')).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.schedule-scroll')).toBeVisible();
  await expect(page.locator('.schedule-cards')).toBeHidden();
  await expect(page.locator('#calculator-option-details')).toBeVisible();
  await expect(page.locator('.source-card')).toBeHidden();
  await expect(page.locator('.skip-link')).toBeHidden();
  await page.pdf({ path: testInfo.outputPath('funding-plan-a4.pdf'), format: 'A4', printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));

  await page.evaluate(key => {
    const context = JSON.parse(sessionStorage.getItem(key)!);
    context.priceFloorBand = '4';
    sessionStorage.setItem(key, JSON.stringify(context));
  }, CONTEXT_KEY);
  await page.reload();
  await expect(rate).toHaveValue('4.0');
  await expect(page.getByLabel('본청약(신규신청자)')).toBeChecked();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bunfirvil:review:v1:bundang-first-village-55a-prototype')!).notes)).toBe('retained-review');
  await expect(page.locator('body')).not.toContainText('1903호');
  expect(errors).toEqual([]);
});
