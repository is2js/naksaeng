import { expect, test } from '@playwright/test';

test('laser point mode works with mouse and touch without blocking palette controls', async ({ page, context, browser }) => {
  await context.addInitScript(() => {
    sessionStorage.setItem('bunfirvil:household-verification:v1', JSON.stringify({
      schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(),
      role: 'operator', authRevision: 2, scope: 'playground', nickname: '테스트',
    }));
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./?map=bundang-first-village-55b-prototype&variant=A');
  const canvas = page.locator('#three-world-canvas');
  await expect(canvas).toBeVisible();
  await expect(page.locator('#inspection-laser-toggle')).toBeVisible();
  await page.locator('#inspection-laser-toggle').click();
  await page.locator('#inspection-laser-point-mode').click();
  const box = (await canvas.boundingBox())!;
  // Pick an actual rendered wall, not just an arbitrary point on the floor.
  let wallPoint: { x: number; y: number } | null = null;
  for (const y of [.3, .4, .5, .6, .7]) {
    for (const x of [.3, .4, .5, .6, .7]) {
      await page.mouse.move(box.x + box.width * x, box.y + box.height * y);
      await page.waitForTimeout(60);
      if (await canvas.getAttribute('data-inspection-laser-pointer-kind') === 'wall') {
        wallPoint = { x: box.x + box.width * x, y: box.y + box.height * y };
        break;
      }
    }
    if (wallPoint) break;
  }
  expect(wallPoint).not.toBeNull();
  await page.mouse.click(wallPoint!.x, wallPoint!.y);
  await expect(page.locator('#inspection-laser-phase')).toHaveText('끝점');
  const start = await canvas.getAttribute('data-inspection-laser-start-point');
  expect(start).toBeTruthy();
  let endPoint: { x: number; y: number } | null = null;
  for (const [x, y] of [[.5, .4], [.7, .6], [.4, .6], [.65, .35]]) {
    await page.mouse.move(box.x + box.width * x, box.y + box.height * y);
    await page.waitForTimeout(60);
    // Once chosen, the start does not drift as the pointer moves.
    expect(await canvas.getAttribute('data-inspection-laser-start-point')).toBe(start);
    if (await canvas.getAttribute('data-inspection-laser-phase') === 'point-pair-free') {
      endPoint = { x: box.x + box.width * x, y: box.y + box.height * y };
      break;
    }
  }
  expect(endPoint).not.toBeNull();
  await expect(canvas).toHaveAttribute('data-inspection-laser-phase', 'point-pair-free');
  const [selectedX, selectedY] = JSON.parse(start!);
  const [renderedX, renderedY] = JSON.parse((await canvas.getAttribute('data-inspection-laser-rendered-start'))!);
  expect(Math.hypot(renderedX - selectedX, renderedY - selectedY)).toBeLessThan(.001);
  await page.mouse.click(endPoint!.x, endPoint!.y);
  await expect(page.locator('#inspection-laser-phase')).toHaveText('완료');
  await expect(page.locator('#inspection-laser-value')).not.toHaveText('— mm');
  await page.keyboard.press('Escape');
  await expect(page.locator('#inspection-laser-hud')).toBeHidden();
  await page.locator('[data-palette-tab="furniture"]').click();
  await expect(page.locator('#furniture-palette-body')).toBeVisible();
  await page.locator('[data-palette-tab="options"]').click();
  await expect(page.locator('#option-palette-body')).toBeVisible();

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await mobileContext.addInitScript(() => {
    sessionStorage.setItem('bunfirvil:household-verification:v1', JSON.stringify({
      schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(),
      role: 'operator', authRevision: 2, scope: 'playground', nickname: '테스트',
    }));
  });
  const mobile = await mobileContext.newPage();
  await mobile.goto(page.url());
  await mobile.locator('#touch-laser-toggle').click();
  await mobile.locator('#inspection-laser-point-mode').click();
  const mobileBox = (await mobile.locator('#three-world-canvas').boundingBox())!;
  await mobile.touchscreen.tap(mobileBox.x + mobileBox.width * .48, mobileBox.y + mobileBox.height * .48);
  await expect(mobile.locator('#inspection-laser-phase')).toHaveText('끝점');
  await mobile.touchscreen.tap(mobileBox.x + mobileBox.width * .67, mobileBox.y + mobileBox.height * .55);
  await expect(mobile.locator('#inspection-laser-phase')).toHaveText('완료');
  await mobileContext.close();
});
