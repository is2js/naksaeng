import { expect, test } from '@playwright/test';

test.use({ isMobile: true, hasTouch: true });

for (const width of [320, 390]) {
  test(`mobile household picker remains readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('./');
    await page.locator('[data-choose-building="105"]').tap();
    const household = page.locator('.household-cell[data-building="105"][data-floor="25"][data-line="1"]');
    await expect(household).toBeVisible();
    const box = (await household.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(40);
    expect(box.width).toBeGreaterThanOrEqual(32);
    expect(await household.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(12);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    const lowestUnit = (await page.locator('.household-cell[data-building="105"][data-floor="1"][data-line="4"]').boundingBox())!;
    const detailDock = (await page.locator('#household-selection-dock').boundingBox())!;
    expect(lowestUnit.y + lowestUnit.height).toBeLessThanOrEqual(detailDock.y);
    await household.tap();
    const input = page.locator('#household-nickname');
    await expect(input).toBeVisible();
    expect(await input.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
    expect((await page.locator('#household-verify-nickname').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await page.locator('#household-request-verification').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    const request = (await page.locator('#household-request-verification').boundingBox())!;
    const nicknameDock = (await page.locator('#household-selection-dock').boundingBox())!;
    expect(request.y + request.height).toBeLessThanOrEqual(nicknameDock.y);
  });
}

test('mobile options show full labels and descriptions with larger controls', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.addInitScript(() => sessionStorage.setItem('bunfirvil:household-verification:v1', JSON.stringify({
    schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(), role: 'verified',
    authRevision: 2, scope: 'playground', nickname: '테스트',
  })));
  await page.goto('./?map=bundang-first-village-55a-prototype&variant=A');
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 90_000 });
  const titles = page.locator('.option-copy b');
  const descriptions = page.locator('.option-copy > small');
  await expect(titles.first()).toBeVisible();
  for (const row of await titles.evaluateAll((elements) => elements.map((element) => {
    const style = getComputedStyle(element);
    return { size: parseFloat(style.fontSize), clipped: element.scrollHeight > element.clientHeight + 1,
      ellipsis: style.textOverflow === 'ellipsis' && style.whiteSpace === 'nowrap' };
  }))) {
    expect(row.size).toBeGreaterThanOrEqual(13);
    expect(row.ellipsis || row.clipped).toBe(false);
  }
  for (const row of await descriptions.evaluateAll((elements) => elements.map((element) => {
    const style = getComputedStyle(element);
    return { size: parseFloat(style.fontSize), clipped: element.scrollHeight > element.clientHeight + 1, clamp: style.webkitLineClamp };
  }))) {
    expect(row.size).toBeGreaterThanOrEqual(12);
    expect(row.clipped).toBe(false);
    expect(row.clamp === 'none' || row.clamp === '').toBe(true);
  }
  expect((await page.locator('.palette-tabs button').first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await page.locator('.option-categories button').first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
