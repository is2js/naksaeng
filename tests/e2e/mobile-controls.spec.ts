import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('compact joystick, map, laser, zoom and furniture preview work without keyboard', async ({ page, context }) => {
  test.setTimeout(240_000);
  await context.addInitScript(() => {
    sessionStorage.setItem('bunfirvil:household-verification:v1', JSON.stringify({
      schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(),
      role: 'verified', authRevision: 2, scope: 'playground', nickname: '테스트',
    }));
  });
  await page.goto('./?map=bundang-first-village-55a-prototype&variant=A');
  const stage = page.locator('#game-stage');
  const pad = page.locator('.touch-move-pad');
  const actor = page.locator('.rpg-actor--100');
  await expect(pad).toBeVisible();
  await expect(actor).toHaveClass(/has-sprite/);
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/);
  expect(await page.evaluate(() => scrollY)).toBeLessThanOrEqual(1);
  const expectCentered = async (): Promise<void> => {
    await expect.poll(() => page.evaluate(() => {
      const stage = document.querySelector<HTMLElement>('#game-stage')!;
      const actor = document.querySelector<HTMLElement>('.rpg-actor--100')!;
      const matrix = new DOMMatrixReadOnly(getComputedStyle(actor).transform);
      return Math.abs(matrix.m41 - stage.clientWidth / 2) < 24 && Math.abs(matrix.m42 - stage.clientHeight / 2) < 65;
    }), { timeout: 10_000 }).toBe(true);
  };
  await expectCentered();
  await expect(page.locator('.map-identity')).toBeHidden();
  await expect(page.locator('.minimap-title')).toBeHidden();
  await expect(page.locator('.minimap-legend')).toBeHidden();
  await expect(page.locator('#touch-attack, #touch-cancel')).toHaveCount(0);
  expect((await pad.boundingBox())!.width).toBe(110);
  expect((await page.locator('.stage-zoom').boundingBox())!.width).toBeLessThanOrEqual(108);
  expect((await pad.evaluate(el => getComputedStyle(el).borderRadius))).toBe('50%');
  await expect(page.locator('#mobile-stage-summary .stage-option-quote')).toBeVisible();
  await expect(page.locator('#stage-option-chips')).toBeHidden();
  await expect(page.locator('#open-sale-calculator')).toBeVisible();
  await pad.scrollIntoViewIfNeeded();
  const client = await context.newCDPSession(page);
  const box = (await pad.boundingBox())!;
  const start = await actor.getAttribute('data-world-x');
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width - 20, y: box.y + box.height / 2 }] });
  await expect(actor).toHaveAttribute('data-motion', 'walk');
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(actor).toHaveAttribute('data-travel-state', 'settled');
  expect(await actor.getAttribute('data-world-x')).not.toBe(start);
  const stopped = await actor.getAttribute('data-world-x');
  await page.waitForTimeout(600);
  expect(await actor.getAttribute('data-world-x')).toBe(stopped);
  // Explicit pointer cancellation must release a held direction too.
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 20, y: box.y + box.height / 2 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(pad).not.toHaveAttribute('data-direction', /.+/);
  await expect(pad).not.toHaveAttribute('style', /--stick-x/);
  await page.locator('#zoom-in').tap();
  await expect(page.locator('#zoom-value')).not.toHaveText('100%');
  await stage.scrollIntoViewIfNeeded();
  const rect = (await stage.boundingBox())!;
  const x = rect.x + 60, y = Math.max(200, rect.y + 260);
  const beforeScroll = await page.evaluate(() => scrollY);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let delta = 20; delta <= 100; delta += 20) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - delta }] });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(stage).toHaveAttribute('data-camera-tracking', 'follow');
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(beforeScroll);
  await stage.scrollIntoViewIfNeeded();
  const panRect = (await stage.boundingBox())!;
  const px = panRect.x + 70, py = Math.max(160, panRect.y + 210);
  const beforePanScroll = await page.evaluate(() => scrollY);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: px, y: py }, { id: 2, x: px + 100, y: py }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: px + 65, y: py + 30 }, { id: 2, x: px + 165, y: py + 30 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(stage).toHaveAttribute('data-camera-tracking', 'free');
  expect(await page.evaluate(() => scrollY)).toBe(beforePanScroll);
  const resumeWithTouch = async (): Promise<void> => {
    await pad.scrollIntoViewIfNeeded();
    const bounds = (await pad.boundingBox())!;
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bounds.x + bounds.width - 20, y: bounds.y + bounds.height / 2 }] });
    await expect(stage).toHaveAttribute('data-camera-tracking', 'follow');
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expectCentered();
  };
  await resumeWithTouch();
  // A selected fixed option must no longer suppress mobile camera following.
  await page.locator('input[data-option-id="electric-cooktop-erh-3903"]').check({ force: true });
  await expect(page.locator('#stage-option-count')).toHaveText('1개');
  await page.locator('#mobile-options-toggle').tap();
  await expect(page.locator('#stage-option-chips')).toBeVisible();
  await page.locator('button[data-stage-option-select="electric-cooktop-erh-3903"]').tap();
  await expect(page.locator('.stage-option-chip')).toHaveClass(/is-world-selected/);
  await resumeWithTouch();
  await page.locator('#mobile-options-toggle').tap();
  await expect(page.locator('#stage-option-chips')).toBeHidden();
  const total = await page.locator('#stage-option-total').textContent();
  await page.locator('#touch-laser-toggle').tap();
  await expect(page.locator('#inspection-laser-hud')).toBeVisible();
  await expect(page.locator('#touch-laser-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#touch-laser-toggle').tap();
  await expect(page.locator('#inspection-laser-hud')).toBeHidden();
  await page.locator('[data-palette-tab="furniture"]').tap();
  const beforeEdit = await actor.getAttribute('data-world-x');
  await pad.scrollIntoViewIfNeeded();
  const editPad = (await pad.boundingBox())!;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: editPad.x + editPad.width - 20, y: editPad.y + editPad.height / 2 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(await actor.getAttribute('data-world-x')).toBe(beforeEdit);
  await page.locator('[data-furniture-asset]').first().tap();
  await expect(stage).toHaveClass(/has-interior-ghost/);
  await page.locator('[data-touch-ghost="rotate-right"]').tap();
  await page.locator('[data-touch-ghost="snap"]').tap();
  await stage.scrollIntoViewIfNeeded();
  const ghostRect = (await stage.boundingBox())!;
  await page.touchscreen.tap(ghostRect.x + 100, Math.max(30, ghostRect.y + 260));
  await expect(stage).toHaveClass(/has-interior-ghost/);
  await page.locator('[data-touch-ghost="cancel"]').tap();
  await expect(stage).not.toHaveClass(/has-interior-ghost/);
  await page.locator('[data-palette-tab="options"]').tap();
  await expectCentered();
  await page.locator('[data-hotbar-action="common-teleport"]').tap();
  await expectCentered();
  await page.locator('[data-hotbar-action="showcase-plan-toggle"]').tap();
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/);
  await expectCentered();
  const quote = (await page.locator('.stage-option-quote').boundingBox())!;
  const stageBounds = (await stage.boundingBox())!;
  expect(quote.y).toBeGreaterThanOrEqual(stageBounds.y + stageBounds.height);
  await page.locator('#stage-option-chips').evaluate(el => { (el as HTMLElement).dataset.identityToken = 'same-node'; });
  // Disable coarse input while resizing to exercise both branches on the same DOM.
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator('#game-stage .stage-option-quote')).toBeVisible();
  await expect(page.locator('#stage-option-chips')).toBeVisible();
  await expect(page.locator('#stage-option-chips')).toHaveAttribute('data-identity-token', 'same-node');
  await expect(page.locator('#stage-option-total')).toHaveText(total!);
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#mobile-stage-summary .stage-option-quote')).toBeVisible();
  await expect(page.locator('#stage-option-chips')).toBeHidden();
  await expect(page.locator('#stage-option-chips')).toHaveCount(1);
  await page.locator('#mobile-options-toggle').tap();
  await page.locator('button[data-stage-option-remove="electric-cooktop-erh-3903"]').tap();
  await expect(page.locator('#stage-option-count')).toHaveText('0개');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-controls.png', fullPage: true });
});
