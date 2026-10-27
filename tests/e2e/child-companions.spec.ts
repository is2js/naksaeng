import { expect, test } from '@playwright/test';

test('fifth slot summons configured children using PVP doll walk and idle sheets', async ({ page, context }) => {
  test.setTimeout(120_000);
  await context.addInitScript(() => {
    sessionStorage.setItem('bunfirvil:household-verification:v1', JSON.stringify({
      schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(),
      role: 'operator', authRevision: 2, scope: 'playground', nickname: '테스트',
    }));
  });
  await page.goto('./?map=bundang-first-village-55a-prototype&variant=A');
  await expect(page.locator('#hotbar .hotbar-slot')).toHaveCount(5);
  const optionBox = await page.locator('.stage-option-quote').boundingBox();
  const hotbarBox = await page.locator('#hotbar').boundingBox();
  expect(optionBox).not.toBeNull();
  expect(hotbarBox).not.toBeNull();
  expect(optionBox!.x + optionBox!.width).toBeLessThan(hotbarBox!.x);
  await expect.poll(() => page.locator('.rpg-actor--100 .actor-sprite').evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('/showcase-characters/100/sheets/idle/normal.webp');
  await page.locator('[data-hotbar-action="showcase-children"]').click();
  const dialog = page.locator('.child-companion-dialog');
  await expect(dialog.getByRole('heading', { name: '자녀수 선택' })).toBeVisible();
  await dialog.getByRole('button', { name: '자녀수 늘리기' }).click();
  await expect(dialog.locator('.child-count-control strong')).toHaveText('2');
  await dialog.getByRole('button', { name: '다음', exact: true }).click();
  await dialog.getByRole('button', { name: '다음 자녀' }).click();
  await dialog.getByRole('radio', { name: '초등학생' }).check();
  await dialog.getByRole('radio', { name: '녀' }).check();
  await dialog.getByRole('button', { name: '소환', exact: true }).click();
  await expect(page.locator('.child-companion')).toHaveCount(2);
  await expect(page.locator('.child-companion').nth(1)).toHaveAttribute('data-gender', 'girl');
  await expect.poll(() => page.locator('.child-companion').nth(1).locator('.child-companion-sprite').evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('/dolls/lk-3d-r3/magic-doll-growth-n030/sheets/idle/');
  await page.keyboard.down('ArrowRight');
  await expect.poll(() => page.locator('.child-companion').first().getAttribute('data-motion'), { timeout: 5_000 }).toBe('walk');
  await expect.poll(() => page.locator('.child-companion').first().locator('.child-companion-sprite').evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('/dolls/lk-3d-r3/magic-doll-baby-boy/sheets/walk/');
  await page.keyboard.up('ArrowRight');
  await expect(page.locator('.rpg-actor--100')).toHaveAttribute('data-motion', 'idle');
  await expect(page.locator('.child-companion').first()).toHaveAttribute('data-motion', 'idle', { timeout: 8_000 });
  await expect(page.locator('.child-companion').nth(1)).toHaveAttribute('data-motion', 'idle', { timeout: 8_000 });
  const distances = await page.evaluate(() => {
    const actor = document.querySelector<HTMLElement>('.rpg-actor--100')!;
    return [...document.querySelectorAll<HTMLElement>('.child-companion')].map((child) => Math.max(
      Math.abs(Number(child.dataset.worldX) - Number(actor.dataset.worldX)),
      Math.abs(Number(child.dataset.worldY) - Number(actor.dataset.worldY)),
    ));
  });
  expect(distances.every((distance) => distance <= 2.001)).toBe(true);
  await page.locator('[data-hotbar-action="showcase-children"]').click();
  await dialog.getByRole('button', { name: '소환 해제' }).click();
  await expect(page.locator('.child-companion')).toHaveCount(0);
});
