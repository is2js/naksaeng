import { expect, test } from '@playwright/test';

test('확정일 옵션 자납과 미정 III 자납을 분리하고 집단대출은 주택만 차감한다', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    sessionStorage.clear();
    sessionStorage.setItem('bunfirvil:household-verification:v1', JSON.stringify({
      schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(), role: 'verified',
      authRevision: 2, scope: 'playground', nickname: '자금 확인',
    }));
    sessionStorage.setItem('bunfirvil:sale-calculator:v1', JSON.stringify({
      schemaVersion: 1, unitType: '55B', priceFloorBand: '5+', applicantRoute: 'main-subscription',
      optionIds: ['system-ac-3-premium', 'induction-cooktop-nz63b5056ak'],
      returnUrl: '/naksaeng/bunfirvil/?map=bundang-first-village-55b-prototype&variant=A',
    }));
  });
  await page.goto('calculator/');
  const row = (due: string) => page.locator(`.schedule-table [data-finance-due="${due}"]`);
  await expect(row('2027-04-12').locator('[data-flow="scheduled-cash"] b')).toHaveText('2,651,200원');
  await expect(row('2027-04-12').locator('[data-flow="undated-cash"] b')).toHaveText('285,000원');
  await expect(row('2027-04-12').locator('[data-flow="cash-due"] b')).toHaveText('2,936,200원');
  await expect(row('2027-04-12').locator('[data-flow="loan-draw"] b')).toHaveText('−63,629,000원');
  await expect(row('2028-02-14').locator('[data-flow="cash-due"] b')).toHaveText('0원');
  await expect(row('2027-04-12').locator('[data-option-iii-timing]')).toContainText('미정');
  await page.locator('.schedule-table [data-payment-stage-target="2027-04-12"]').click();
  const stage = page.locator('.payment-stage[data-payment-stage-due="2027-04-12"]');
  await expect(stage.locator('[data-stage-flow="scheduled-cash"] b')).toHaveText('2,651,200원');
  await expect(stage.locator('[data-stage-flow="undated-cash"] b')).toHaveText('285,000원');
  await stage.screenshot({ path: testInfo.outputPath('dated-and-undated-cash.png') });
  await page.locator('.plan-switch label').filter({ hasText: '사전청약 당첨자' }).click();
  await expect(row('2027-04-12')).toHaveCount(0);
  await expect(row('2028-02-14').locator('[data-flow="scheduled-cash"] b')).toHaveText('2,071,200원');
  await expect(row('2028-02-14').locator('[data-flow="undated-cash"] b')).toHaveText('190,000원');
  await expect(row('2028-02-14').locator('[data-flow="cash-due"] b')).toHaveText('2,261,200원');
  await expect(row('2028-02-14').locator('[data-flow="loan-draw"] b')).toHaveText('−127,258,000원');
  await expect(row('입주 시')).toContainText('입주지정기간');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-mobile-finance-due="2028-02-14"]').click();
  const mobileStage = page.locator('.payment-stage[data-payment-stage-due="2028-02-14"]');
  await expect(mobileStage.locator('[data-stage-flow="scheduled-cash"] b')).toHaveText('2,071,200원');
  await expect(mobileStage.locator('[data-stage-flow="undated-cash"] b')).toHaveText('190,000원');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
