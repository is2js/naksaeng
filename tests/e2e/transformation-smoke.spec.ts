import { expect, test } from '@playwright/test';

async function enterPlayground(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => sessionStorage.setItem('bunfirvil:household-verification:v1', JSON.stringify({
    schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(),
    role: 'verified', authRevision: 2, scope: 'playground', nickname: '연기 검수',
  })));
  await page.goto('./?map=bundang-first-village-55a-prototype&variant=A');
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 45_000 });
}

test('transformation smoke follows the actor, switches at the covered frame, and cleans up', async ({ page }) => {
  test.setTimeout(120_000);
  await enterPlayground(page);
  const actor = page.locator('.rpg-actor--100');
  const smoke = actor.locator('.actor-transformation-effect');
  const toggle = page.locator('[data-hotbar-action="showcase-pigmy-toggle"]');
  await expect.poll(() => smoke.evaluate((element) => (element as HTMLElement).style.backgroundImage)).toContain('transform-violet-r1.png');
  await toggle.click();
  await expect(actor).toHaveClass(/is-transforming/);
  await expect(smoke).toBeVisible();
  await expect(actor).toHaveAttribute('data-transformation', 'pigmy');
  await expect(smoke).toBeHidden({ timeout: 4_000 });
  // A rapid reversal and actor switch cannot leave an old pending swap behind.
  await toggle.click();
  await page.locator('[data-hotbar-action="showcase-gender-toggle"]').click();
  await expect(actor).toHaveAttribute('data-transformation', '');
  await expect(page.locator('.rpg-actor--200')).toBeVisible();
  await expect(actor).not.toHaveClass(/is-transforming/);
});

test('transformation still works when the effect cannot load', async ({ page }) => {
  test.setTimeout(120_000);
  await page.route('**/assets/effects/transformation/transform-violet-r1.png', (route) => route.abort());
  await enterPlayground(page);
  const actor = page.locator('.rpg-actor--100');
  await page.locator('[data-hotbar-action="showcase-pigmy-toggle"]').click();
  await expect(actor).toHaveAttribute('data-transformation', 'pigmy');
  await expect(actor).not.toHaveClass(/is-transforming/);
});
