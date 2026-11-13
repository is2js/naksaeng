import { expect, test } from '@playwright/test';

test('모바일 계산기는 팔레트 고정 합계 아래에만 있고 기존 모달로 진입한다', async ({ page, context }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    sessionStorage.setItem('bunfirvil:household-verification:v1', JSON.stringify({
      schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(), role: 'verified',
      authRevision: 2, scope: 'playground', nickname: '모바일 확인',
    }));
    if (!sessionStorage.getItem('bunfirvil:sale-calculator:v1')) sessionStorage.setItem('bunfirvil:sale-calculator:v1', JSON.stringify({
      schemaVersion: 1, unitType: '55A', priceFloorBand: '5+',
    }));
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./?map=bundang-first-village-55a-prototype&variant=A');
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 45_000 });
  const button = page.locator('#open-sale-calculator');
  await expect(page.locator('.stage-option-quote')).toBeHidden();
  await expect(page.locator('#mobile-palette-calculator #open-sale-calculator')).toHaveCount(1);
  await expect(button).toBeEnabled(); // Basic finish still supports calculating.
  await page.locator('input[data-option-id="wide-plank-floor-finish"]').check({ force: true });
  await expect(page.locator('#option-selected-count')).toHaveText('1개');
  await expect(page.locator('#option-total')).toContainText('1,820,000');
  await page.locator('.option-panel').scrollIntoViewIfNeeded();
  const price = (await page.locator('.option-summary .quote-row').boundingBox())!;
  const cta = (await button.boundingBox())!;
  expect(cta.y).toBeGreaterThanOrEqual(price.y + price.height);
  expect(cta.height).toBeGreaterThanOrEqual(54);
  expect(await button.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  const footerBottom = (await page.locator('.option-summary').boundingBox())!;
  await page.locator('#option-list').evaluate(element => { element.scrollTop = element.scrollHeight; });
  expect((await page.locator('.option-summary').boundingBox())!.y).toBeCloseTo(footerBottom.y, 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-palette-calculator.png', fullPage: false });

  await button.evaluate(element => { (element as HTMLElement).dataset.identityToken = 'same-cta'; });
  const client = await context.newCDPSession(page);
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator('.stage-option-quote')).toBeVisible();
  await expect(page.locator('.stage-option-footer #open-sale-calculator')).toHaveAttribute('data-identity-token', 'same-cta');
  await expect(page.locator('#mobile-palette-calculator')).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.stage-option-quote')).toBeHidden();
  await expect(page.locator('#mobile-palette-calculator #open-sale-calculator')).toHaveAttribute('data-identity-token', 'same-cta');
  await expect(button).toHaveCount(1);
  await button.click();
  await expect(page.locator('#sale-calculator-dialog')).toBeVisible();
  await expect(page.locator('input[name="sale-calculator-route"][value="main-subscription"]')).toBeChecked();
  await page.locator('input[name="sale-calculator-route"][value="pre-subscription"]').check();
  await page.locator('#sale-calculator-dialog button[value="confirm"]').click();
  await expect(page).toHaveURL(/\/calculator\/$/);
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('bunfirvil:sale-calculator:v1') || '{}'));
  expect(saved.optionIds).toEqual(['wide-plank-floor-finish']);
  expect(saved.applicantRoute).toBe('pre-subscription');
  expect(errors).toEqual([]);
});
