import { expect, test } from '@playwright/test';

const CONTEXT_KEY = 'bunfirvil:sale-calculator:v1';
const PREFERENCES_KEY = 'bunfirvil:sale-calculator-preferences:v1';

test('모기지 감정가격·매각/전액상환 계획은 입력 포커스와 현재 납부액을 유지하며 복원된다', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(({ contextKey }) => {
    if (!sessionStorage.getItem(contextKey)) {
      sessionStorage.setItem('bunfirvil:household-verification:v1', JSON.stringify({ schemaVersion: 1,
        provider: 'google-apps-script', verifiedAt: Date.now(), role: 'verified' }));
      sessionStorage.setItem(contextKey, JSON.stringify({ schemaVersion: 1, unitType: '55A', priceFloorBand: '5+',
        applicantRoute: 'main-subscription', optionIds: ['system-ac-2-general'],
        returnUrl: '/naksaeng/bunfirvil/?map=bundang-first-village-55a-prototype&actor=200&variant=A' }));
    }
    window.print = () => { document.documentElement.dataset.printCalled = 'true'; };
  }, { contextKey: CONTEXT_KEY });
  await page.goto('calculator/');
  await expect(page.getByRole('heading', { name: '내 자금 계획', exact: true })).toBeVisible();
  const paymentSnapshot = async () => ({
    total: await page.locator('.hero-total strong').textContent(),
    contractCash: await page.locator('#calculator-contract-cash').textContent(),
    postContractCash: await page.locator('#calculator-post-contract-base-cash').textContent(),
    moveInCash: await page.locator('#calculator-required-cash').textContent(),
    mortgage: await page.locator('#calculator-balance-mortgage-principal').textContent(),
    schedule: await page.locator('.schedule-table .contract-due').allTextContents(),
  });
  const originalPayments = await paymentSnapshot();
  const details = page.locator('#calculator-resale-details');
  await details.locator('summary').click();
  const mode = page.locator('#calculator-settlement-kind');
  const appraisal = page.locator('#calculator-appraised-price');
  await expect(mode).toHaveValue('sale');
  await expect(details.locator('#calculator-resale-proceeds')).toHaveCount(0);
  const validPrefs = await page.evaluate(key => sessionStorage.getItem(key), PREFERENCES_KEY);
  await appraisal.fill('123.5');
  await appraisal.press('Enter');
  await expect(appraisal).toHaveAttribute('aria-invalid', 'true');
  expect(await page.evaluate(key => sessionStorage.getItem(key), PREFERENCES_KEY)).toBe(validPrefs);
  await appraisal.fill('');
  await appraisal.press('Enter');
  await expect(appraisal).not.toHaveAttribute('aria-invalid');

  const sale = page.locator('#calculator-sale-price');
  const originalSaleElement = (await sale.elementHandle())!;
  await sale.fill('900000000');
  await sale.press('Enter');
  await expect(sale).toBeFocused();
  expect(await originalSaleElement.evaluate(node => node.isConnected)).toBe(true);
  await expect(page.locator('#calculator-settlement-basis-note')).toContainText('단순 추정');
  const originalAppraisalElement = (await appraisal.elementHandle())!;
  await appraisal.fill('1000000000');
  await appraisal.press('Tab');
  await expect(page.locator('#calculator-sale-plan-notified')).toBeFocused();
  expect(await originalAppraisalElement.evaluate(node => node.isConnected)).toBe(true);
  await expect(page.locator('#calculator-settlement-basis')).toHaveText('1,000,000,000원');
  await expect(page.locator('#calculator-settlement-basis-note')).toContainText('10% 이상 낮아');

  await sale.fill('950000000');
  await sale.press('Enter');
  await expect(page.locator('#calculator-settlement-basis')).toHaveText('950,000,000원');
  await page.locator('#calculator-sale-plan-notified').uncheck();
  await expect(page.locator('#calculator-settlement-basis')).toHaveText('1,000,000,000원');
  await expect(page.locator('#calculator-settlement-basis-note')).toContainText('미통보');
  await expect(details).toHaveAttribute('open', '');

  await mode.selectOption('repayment');
  await appraisal.fill('');
  await appraisal.press('Enter');
  await expect(details.locator('#calculator-resale-proceeds,#calculator-full-repayment')).toHaveCount(0);
  await expect(page.locator('#calculator-settlement-waiting')).toContainText('시세감정가격을 입력하면');
  expect(await paymentSnapshot()).toEqual(originalPayments);
  await appraisal.fill('1100000000');
  await appraisal.press('Enter');
  await expect(page.locator('#calculator-full-repayment')).toBeVisible();
  await expect(details.locator('#calculator-resale-proceeds')).toHaveCount(0);
  await expect(page.locator('#calculator-settlement-basis')).toHaveText('1,100,000,000원');
  const fullRepayment = await page.locator('#calculator-full-repayment').textContent();
  await page.reload();
  await details.locator('summary').click();
  await expect(mode).toHaveValue('repayment');
  await expect(appraisal).toHaveValue('1100000000');
  await expect(page.locator('#calculator-full-repayment')).toHaveText(fullRepayment!);
  expect(await paymentSnapshot()).toEqual(originalPayments);
  await mode.selectOption('sale');
  await expect(sale).toHaveValue('950000000');
  await expect(page.locator('#calculator-sale-plan-notified')).not.toBeChecked();
  await expect(page.locator('#calculator-settlement-basis')).toHaveText('1,100,000,000원');

  await mode.selectOption('repayment');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await details.screenshot({ path: testInfo.outputPath('mortgage-repayment-390.png'), animations: 'disabled' });
  await page.locator('#calculator-print').click();
  await expect(page.locator('html')).toHaveAttribute('data-print-called', 'true');
  await expect(details).toHaveAttribute('open', '');
  await expect(page.locator('#calculator-full-repayment')).toHaveText(fullRepayment!);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  const raw = await page.evaluate(key => sessionStorage.getItem(key), PREFERENCES_KEY);
  expect(JSON.parse(raw!).scenario).toMatchObject({ settlementKind: 'repayment', appraisedPriceWon: 1_100_000_000, salePlanNotified: false });
  expect(raw).not.toMatch(/buildingId|householdNumber|nickname|verifiedAt|provider|role/u);
  expect(await paymentSnapshot()).toEqual(originalPayments);
  expect(errors).toEqual([]);
});
