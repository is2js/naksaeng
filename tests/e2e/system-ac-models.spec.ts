import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`55B 시스템에어컨 모델 정보는 선택을 변경하지 않는다 (${viewport.width}px)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      sessionStorage.setItem('bunfirvil:household-verification:v1', JSON.stringify({
        schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(), role: 'verified',
      }));
    });
    await page.goto('./?map=bundang-first-village-55b-prototype&actor=200&variant=A');
    await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 60_000 });
    const category = page.locator('#option-categories button', { hasText: '시스템에어컨' });
    if (!(await category.isVisible())) await page.getByRole('button', { name: '옵션', exact: true }).click();
    await category.click();

    const premium = page.locator('.system-ac-card[data-system-ac-tier="premium"]');
    const increase = premium.getByRole('button', { name: '설치 대수 1 증가' });
    await increase.click(); await increase.click(); await increase.click();
    await expect(premium.locator('output')).toHaveText('4대');
    const totalBefore = await page.locator('#option-total').innerText();
    await premium.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(premium.locator('details')).toHaveAttribute('open', '');
    await expect(premium).toContainText('RNQ0521C2SP');
    await expect(premium).toContainText('RNQ0231C2SP');
    await expect(premium).toContainText('RNQ0161K2SP');
    await expect(premium).toContainText('RPUQ0405B2R');
    await expect(page.locator('#option-total')).toHaveText(totalBefore);
    expect(await premium.locator('figure img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    expect(await premium.locator('details').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    const general = page.locator('.system-ac-card[data-system-ac-tier="general"]');
    const generalTotal = await page.locator('#option-total').innerText();
    await general.locator('summary').click();
    await expect(general).toContainText('AJ052BN1PBC1');
    await expect(general).toContainText('RNQ0520C2WP');
    await expect(page.locator('#option-total')).toHaveText(generalTotal);
    expect(await general.locator('figure img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  });
}
