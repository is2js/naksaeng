import { expect, test } from '@playwright/test';

test.use({ hasTouch: true });

test('모바일 이름 칩은 맵 선택과 연결되고 계산기는 팔레트 합계 아래에만 남는다', async ({ page, context }) => {
  test.setTimeout(process.env.CI ? 300_000 : 180_000);
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
  const mobileOptions = page.locator('#mobile-stage-options');
  const chips = page.locator('#stage-option-chips');
  await chips.evaluate(element => { (element as HTMLElement).dataset.identityToken = 'same-chips'; });
  await expect(page.locator('.stage-option-quote')).toBeHidden();
  await expect(mobileOptions).toBeHidden();
  expect((await page.locator('#game-stage').boundingBox())!.height).toBeGreaterThanOrEqual(600);
  await expect(page.locator('#mobile-palette-calculator #open-sale-calculator')).toHaveCount(1);
  await expect(button).toBeEnabled(); // Basic finish still supports calculating.
  expect((await page.locator('#option-list').boundingBox())!.height).toBeGreaterThanOrEqual(350);
  expect((await page.locator('.option-storage-note').innerText()).trim()).toBe('가상 공간의 옵션 디자인·색상·배치는 실제 시공과 다를 수 있습니다.');
  await expect(page.locator('.option-storage-description')).toBeHidden();
  await expect(page.locator('.option-design-reference')).toBeHidden();
  await page.locator('input[data-option-id="wide-plank-floor-finish"]').check({ force: true });
  await expect(page.locator('#option-selected-count')).toHaveText('1개');
  await expect(page.locator('#option-total')).toContainText('1,820,000');
  await page.locator('[data-option-category="전체"]').click();
  await page.locator('input[data-option-id="entry-pantry-system-shelf"]').check({ force: true });
  await expect(mobileOptions).toBeVisible();
  await expect(page.locator('#mobile-stage-options #stage-option-chips')).toHaveAttribute('data-identity-token', 'same-chips');
  await expect(mobileOptions.locator('.stage-option-chip')).toHaveCount(2);
  expect(await mobileOptions.innerText()).not.toMatch(/원|감액|×/);
  await expect(mobileOptions.locator('em').first()).toBeHidden();
  await expect(mobileOptions.locator('.stage-option-remove').first()).toBeHidden();
  expect(await mobileOptions.locator('.stage-option-chip').nth(1).evaluate(element => getComputedStyle(element, '::before').content)).toContain('+');
  const pantry = mobileOptions.locator('button[data-stage-option-select="entry-pantry-system-shelf"]');
  await pantry.tap();
  await expect(mobileOptions.locator('.stage-option-chip[data-stage-option-select="entry-pantry-system-shelf"]')).toHaveClass(/is-world-selected/);
  await expect(page.locator('[data-option-card-id="entry-pantry-system-shelf"]')).toHaveClass(/is-world-linked/);
  await expect(page.locator('#three-world-canvas')).toHaveAttribute('data-selected-editor-mask', 'rpg-gold');
  const label = (await page.locator('#furniture-selection-toolbar').boundingBox())!;
  const mapBounds = (await page.locator('#game-stage').boundingBox())!;
  expect(label.x).toBeGreaterThanOrEqual(mapBounds.x);
  expect(label.x + label.width).toBeLessThanOrEqual(mapBounds.x + mapBounds.width);
  expect((await mobileOptions.boundingBox())!.y + (await mobileOptions.boundingBox())!.height)
    .toBeLessThan((await page.locator('.touch-move-pad').boundingBox())!.y);
  await page.locator('#touch-laser-toggle').tap();
  await page.locator('#inspection-laser-point-mode').tap();
  await pantry.tap();
  await expect(page.locator('#inspection-laser-phase')).toHaveText('시작점');
  await expect(page.locator('#three-world-canvas')).not.toHaveAttribute('data-inspection-laser-start-point', /.+/);
  await page.locator('#touch-laser-toggle').tap();
  await page.locator('#game-stage').screenshot({ path: 'test-results/mobile-option-names.png' });
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
  await expect(mobileOptions).toBeHidden();
  await expect(page.locator('.stage-option-content #stage-option-chips')).toHaveAttribute('data-identity-token', 'same-chips');
  await expect(chips.locator('em').first()).toBeVisible();
  await expect(page.locator('.stage-option-footer #open-sale-calculator')).toHaveAttribute('data-identity-token', 'same-cta');
  await expect(page.locator('#mobile-palette-calculator')).toBeHidden();
  await expect(page.locator('.option-storage-description')).toBeVisible();
  await expect(page.locator('.option-design-reference')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.stage-option-quote')).toBeHidden();
  await expect(mobileOptions).toBeVisible();
  await expect(page.locator('#mobile-stage-options #stage-option-chips')).toHaveAttribute('data-identity-token', 'same-chips');
  await expect(page.locator('#mobile-palette-calculator #open-sale-calculator')).toHaveAttribute('data-identity-token', 'same-cta');
  await expect(button).toHaveCount(1);
  await button.click();
  await expect(page.locator('#sale-calculator-dialog')).toBeVisible();
  await expect(page.locator('input[name="sale-calculator-route"][value="main-subscription"]')).toBeChecked();
  await page.locator('input[name="sale-calculator-route"][value="pre-subscription"]').check();
  await page.locator('#sale-calculator-dialog button[value="confirm"]').click();
  await expect(page).toHaveURL(/\/calculator\/$/);
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('bunfirvil:sale-calculator:v1') || '{}'));
  expect(saved.optionIds.sort()).toEqual(['wide-plank-floor-finish', 'entry-pantry-system-shelf'].sort());
  expect(saved.applicantRoute).toBe('pre-subscription');
  expect(errors).toEqual([]);
});
