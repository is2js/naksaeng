import { expect, test } from '@playwright/test';

test('operator code, cross-type share membership and modal keyboard regression smoke', async ({ page, context }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  const endpoint = 'https://script.google.com/macros/s/mock-review-auth/exec';
  const testCode = 'synthetic-test-code-123';
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.route('**/config/household-verification.v1.json', route => route.fulfill({ json: { schemaVersion: 1, enabled: true, provider: 'google-apps-script', endpoint, timeoutMs: 8000 } }));
  await page.route(endpoint, async route => {
    const input = route.request().postDataJSON();
    const operator = input.nickname === '운영테스트' && input.operatorCode === testCode;
    const member = input.nickname === '일반테스트' && input.buildingId === '105' && (input.action === 'verifyShareViewer' || input.unitType === '55A');
    if (input.action === 'verifyShareViewer') expect(input.unitType).toBe('');
    await route.fulfill({ json: { schemaVersion: 1, authRevision: 2, ok: true, verified: operator || member, operator, operatorVerified: operator,
      status: operator ? 'operator' : member ? 'verified' : 'not_found', scope: input.action === 'verifyShareViewer' ? 'share' : 'playground',
      code: input.nickname === '운영테스트' && !operator ? 'operator_code_required' : undefined } });
  });
  await page.goto('./?map=bundang-first-village-51a-prototype&variant=D');
  await page.locator('[data-choose-building="105"]').click();
  await page.locator('[data-floor="25"][data-line="1"]').click();
  await page.locator('#household-nickname').fill('운영테스트');
  await page.locator('#household-nickname').press('Enter');
  await expect(page.locator('#household-operator-code-group')).toBeVisible();
  await expect(page.locator('#household-enter')).toBeDisabled();
  await page.locator('#household-operator-code').fill(testCode);
  await page.locator('#household-operator-code').press('Enter');
  await expect(page.locator('#household-enter')).toBeEnabled();
  await expect(page.locator('#household-operator-code')).toHaveValue('');
  await page.locator('#household-enter').click();
  await expect(page).toHaveURL(/variant=D/);
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 45_000 });
  expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain(testCode);

  await page.locator('#open-help').click();
  const close = page.locator('#help-dialog .dialog-close');
  await close.focus();
  await page.keyboard.press('4');
  await expect(page.locator('.hotbar-slot').nth(3)).not.toHaveClass(/is-transformed/);
  await close.press('Space');
  await expect(page.locator('#help-dialog')).not.toBeVisible();
  await expect(page.locator('.rpg-actor[data-motion="attack"]')).toHaveCount(0);
  await page.locator('#share-showcase').click();
  await page.locator('#share-link-copy').click();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toContain('#share=v1.');
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(url);
  await page.locator('[data-choose-building="105"]').click();
  await expect(page.locator('#household-step-unit')).toHaveCount(0);
  await expect(page.locator('#household-request-verification')).not.toBeVisible();
  await page.locator('#household-nickname').fill('일반테스트'); // A 55A member views a 51A share.
  await page.locator('#household-nickname').press('Enter');
  await expect(page.locator('#household-enter')).toBeEnabled();
  await page.locator('#household-enter').click();
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 45_000 });
  await expect(page.locator('#map-title')).toHaveText('운영테스트님의 51A타입 공유 놀이터');
  await expect(page.locator('.share-readonly-banner')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('bunfirvil:household-verification:v1') || '{}').scope)).toBe('share');
  await page.goto('./?map=bundang-first-village-51a-prototype&variant=D');
  await expect(page.locator('[data-choose-building="105"]')).toBeVisible();
  expect(errors).toEqual([]);
});
