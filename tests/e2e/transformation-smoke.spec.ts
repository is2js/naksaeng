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
  await expect(actor).toHaveAttribute('data-transformation', /^(pigmy|hooded-brute|mummy-king|iron-golem|leopard)$/);
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
  await expect(actor).toHaveAttribute('data-transformation', /^(pigmy|hooded-brute|mummy-king|iron-golem|leopard)$/);
  await expect(actor).not.toHaveClass(/is-transforming/);
});

test('each loaded species can be selected and returns to the same actor', async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await enterPlayground(page);
  const actor = page.locator('.rpg-actor--100');
  const toggle = page.locator('[data-hotbar-action="showcase-pigmy-toggle"]');
  const expected = ['pigmy', 'hooded-brute', 'mummy-king', 'iron-golem', 'leopard'];
  await expect.poll(async () => (await actor.getAttribute('data-transformation-candidates') ?? '').split(',').filter(Boolean).sort(), { timeout: 45_000 }).toEqual([...expected].sort());
  for (let index = 0; index < expected.length; index += 1) {
    // Override random only for the synchronous click handler, never for app startup.
    await toggle.evaluate((button, random) => {
      const original = Math.random;
      try { Math.random = () => random; (button as HTMLButtonElement).click(); }
      finally { Math.random = original; }
    }, (index + 0.5) / expected.length);
    await expect(actor).toHaveAttribute('data-transformation', expected[index]);
    await expect(actor.locator('.actor-sprite')).toHaveCSS('background-image', /transformations/);
    if (expected[index] === 'leopard') {
      const top = await actor.locator('.actor-sprite').evaluate(element => parseFloat((element as HTMLElement).style.top));
      expect(top).toBeCloseTo(-25 + (122 - 92) * 102 / 128, 3);
    }
    await toggle.click();
    await expect(actor).toHaveAttribute('data-transformation', '');
    await expect.poll(() => actor.locator('.actor-sprite').evaluate(element => (element as HTMLElement).style.top)).toBe('');
  }
});

test('a missing walk atlas is not offered for random transformation', async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/assets/transformations/M034-R3/sheets/walk/normal.png', route => route.abort());
  await enterPlayground(page);
  const actor = page.locator('.rpg-actor--100');
  const toggle = page.locator('[data-hotbar-action="showcase-pigmy-toggle"]');
  const expected = ['pigmy', 'hooded-brute', 'mummy-king', 'leopard'];
  await expect.poll(async () => (await actor.getAttribute('data-transformation-candidates') ?? '').split(',').filter(Boolean).sort(), { timeout: 45_000 }).toEqual([...expected].sort());
  // The fourth interval maps to leopard after the failed iron golem is removed.
  await toggle.evaluate((button) => {
    const original = Math.random;
    try { Math.random = () => 0.875; (button as HTMLButtonElement).click(); }
    finally { Math.random = original; }
  });
  await expect(actor).toHaveAttribute('data-transformation', 'leopard');
});
