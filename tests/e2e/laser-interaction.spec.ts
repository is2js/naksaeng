import { expect, test, type Page } from '@playwright/test';

const mapId = 'bundang-first-village-55b-prototype';
const route = `./?map=${mapId}&variant=A`;
type ScreenPoint = { x: number; y: number; owner: string };

async function ready(page: Page): Promise<void> {
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 60_000 });
  await expect(page.locator('#three-world-canvas')).toBeVisible();
}

async function observeReferenceNotice(page: Page): Promise<void> {
  // Record the actual display transition, before a slow WebGL round trip.
  await page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>('#game-stage')!;
    const snapshots: unknown[] = [];
    (window as unknown as { laserReferenceSnapshots: unknown[] }).laserReferenceSnapshots = snapshots;
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement) || node.id !== 'inspection-laser-reference-notice') continue;
        const box = node.getBoundingClientRect(), parent = stage.getBoundingClientRect();
        const link = node.querySelector('a')!;
        snapshots.push({ text: node.textContent, visible: !node.hidden && getComputedStyle(node).display !== 'none' && box.height > 0,
          dx: Math.abs(box.x + box.width / 2 - parent.x - parent.width / 2),
          dy: Math.abs(box.y + box.height / 2 - parent.y - parent.height / 2), href: link.href, target: link.target, rel: link.rel });
      }
    }).observe(stage, { childList: true });
  });
}

async function referenceSnapshot(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as unknown as { laserReferenceSnapshots: unknown[] }).laserReferenceSnapshots.length)).toBe(1);
  return page.evaluate(() => (window as unknown as {
    laserReferenceSnapshots: Array<{ text: string; visible: boolean; dx: number; dy: number; href: string; target: string; rel: string }>;
  }).laserReferenceSnapshots[0]);
}

async function findSurface(page: Page, ownerPattern?: string, around?: { x: number; y: number }): Promise<ScreenPoint> {
  const canvas = page.locator('#three-world-canvas'), box = (await canvas.boundingBox())!;
  const candidates = around
    ? [-40, -70, -100, -130, -160].flatMap(dy => [-36, -18, 0, 18, 36].map(dx => ({ x: around.x + dx, y: around.y + dy })))
    : [.3, .4, .5, .6, .7].flatMap(fy => [.25, .35, .45, .55, .65, .75].map(fx => ({ x: box.x + box.width * fx, y: box.y + box.height * fy })));
  for (const point of candidates) {
    if (point.x <= box.x || point.x >= box.x + box.width || point.y <= box.y || point.y >= box.y + box.height) continue;
    await canvas.evaluate(node => { delete node.dataset.inspectionLaserPointerSurface; delete node.dataset.inspectionLaserPointerKind; });
    await page.mouse.move(point.x, point.y);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const owner = await canvas.getAttribute('data-inspection-laser-pointer-surface');
    const kind = await canvas.getAttribute('data-inspection-laser-pointer-kind');
    if (owner && (ownerPattern ? new RegExp(ownerPattern).test(owner) : kind === 'wall')) return { ...point, owner };
  }
  throw new Error(`Could not find a rendered measurement surface (${ownerPattern || 'wall'})`);
}

async function validEnd(page: Page): Promise<{ x: number; y: number }> {
  const canvas = page.locator('#three-world-canvas'), box = (await canvas.boundingBox())!;
  for (const [fx, fy] of [[.5, .4], [.7, .6], [.4, .6], [.65, .35]]) {
    const point = { x: box.x + box.width * fx, y: box.y + box.height * fy };
    await page.mouse.move(point.x, point.y);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (await canvas.getAttribute('data-inspection-laser-phase') === 'point-pair-free') return point;
  }
  throw new Error('No valid free endpoint was previewed');
}

async function expectLineAndValueAgree(page: Page): Promise<void> {
  const data = await page.locator('#three-world-canvas').evaluate(canvas => ({ ...canvas.dataset }));
  const start = JSON.parse(data.inspectionLaserRenderedStart!) as number[], end = JSON.parse(data.inspectionLaserRenderedEnd!) as number[];
  expect(Math.abs(Math.round(Math.hypot(end[0] - start[0], end[1] - start[1]) * 1000) - Number(data.inspectionLaserDistanceMm))).toBeLessThanOrEqual(1);
  expect(data.inspectionLaserPhase).toBe('point-pair-free');
}

test('laser release/cancel, owned surfaces, camera changes and reference notice work on PC/mobile', async ({ page, context, browser }, testInfo) => {
  test.setTimeout(process.env.CI ? 420_000 : 240_000);
  const errors: string[] = [];
  const seed = () => sessionStorage.setItem('bunfirvil:household-verification:v1', JSON.stringify({
    schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(), role: 'operator', authRevision: 2, scope: 'playground', nickname: '실측 검수',
  }));
  await context.addInitScript(seed);
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(route);
  await ready(page);
  await observeReferenceNotice(page);
  const stage = page.locator('#game-stage'), canvas = page.locator('#three-world-canvas');
  await stage.focus();
  await page.keyboard.press('j');
  const desktopNotice = await referenceSnapshot(page);
  expect(desktopNotice.visible).toBe(true);
  expect(desktopNotice.dx).toBeLessThan(3);
  expect(desktopNotice.dy).toBeLessThan(3);
  expect(desktopNotice.text).toContain('실제와 일치하지 않을 수');
  expect(desktopNotice.href).toContain('blogId=sale_news');
  expect(desktopNotice.target).toBe('_blank');
  expect(desktopNotice.rel).toContain('noopener');
  await page.mouse.move(2, 2);
  await expect(page.locator('#inspection-laser-reference-notice')).toBeHidden({ timeout: 9_000 });
  await page.keyboard.press('j');
  await expect(page.locator('#inspection-laser-phase')).toHaveText('시작점');
  let wall = await findSurface(page);
  await page.mouse.move(wall.x, wall.y);
  await page.mouse.down();
  await expect(page.locator('#inspection-laser-phase')).toHaveText('시작점');
  await page.mouse.move(wall.x + 24, wall.y + 16, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator('#inspection-laser-phase')).toHaveText('시작점');
  await expect(canvas).not.toHaveAttribute('data-inspection-laser-start-point', /.+/);
  wall = await findSurface(page);
  await page.mouse.click(wall.x, wall.y);
  await expect(page.locator('#inspection-laser-phase')).toHaveText('끝점');
  const start = await canvas.getAttribute('data-inspection-laser-start-point');
  await expect(canvas).toHaveAttribute('data-inspection-laser-start-owner', wall.owner);
  await page.locator('#zoom-in').click();
  expect(await canvas.getAttribute('data-inspection-laser-start-point')).toBe(start);
  const end = await validEnd(page);
  await expectLineAndValueAgree(page);
  const previewEnd = await canvas.getAttribute('data-inspection-laser-rendered-end');
  await page.mouse.click(end.x, end.y);
  await expect(page.locator('#inspection-laser-phase')).toHaveText('완료');
  expect(await canvas.getAttribute('data-inspection-laser-rendered-end')).toBe(previewEnd);
  await expectLineAndValueAgree(page);
  await stage.screenshot({ path: testInfo.outputPath('laser-desktop.png') });
  await stage.focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('j');
  await expect(page.locator('#inspection-laser-reference-notice')).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { laserReferenceSnapshots: unknown[] }).laserReferenceSnapshots.length)).toBe(1);
  await page.keyboard.press('Escape');

  const fridge = page.locator('input[data-option-id="refrigerator-cabinet-pet-basic"]');
  await page.locator('[data-option-card-id="refrigerator-cabinet-pet-basic"] .option-copy').click();
  await expect(fridge).toBeChecked();
  await page.locator('#stage-option-chips button[data-stage-option-select="refrigerator-cabinet-pet-basic"]').click();
  await expect(page.locator('#furniture-selection-toolbar')).toBeVisible();
  const around = await page.locator('#furniture-selection-toolbar').evaluate(toolbar => {
    const stage = document.querySelector('#game-stage')!.getBoundingClientRect();
    return { x: stage.x + parseFloat(toolbar.style.left), y: stage.y + parseFloat(toolbar.style.top) + 20 };
  });
  await stage.focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  const cabinet = await findSurface(page, 'refrigerator', around);
  await page.mouse.click(cabinet.x, cabinet.y);
  await expect(page.locator('#inspection-laser-phase')).toHaveText('끝점');
  await expect(canvas).toHaveAttribute('data-inspection-laser-start-owner', cabinet.owner);
  await page.locator('#stage-option-chips button[data-stage-option-remove="refrigerator-cabinet-pet-basic"]').click();
  await expect(fridge).not.toBeChecked();
  await expect(page.locator('#inspection-laser-phase')).toHaveText('시작점');
  await expect(canvas).not.toHaveAttribute('data-inspection-laser-start-point', /.+/);

  await page.reload();
  await ready(page);
  await observeReferenceNotice(page);
  await stage.focus();
  await page.keyboard.press('j');
  expect((await referenceSnapshot(page)).visible).toBe(true);
  // Release the desktop WebGL context before the mobile half, particularly on
  // the software-rendered Pages runner. All desktop assertions are complete.
  await page.close();

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    await mobileContext.addInitScript(seed);
    const mobile = await mobileContext.newPage();
    mobile.on('pageerror', error => errors.push(error.message));
    await mobile.goto(route);
    await ready(mobile);
    await observeReferenceNotice(mobile);
    await mobile.locator('#touch-laser-toggle').tap();
    const mobileNotice = await referenceSnapshot(mobile);
    expect(mobileNotice.visible).toBe(true);
    expect(mobileNotice.text.length).toBeLessThan(desktopNotice.text.length);
    expect(mobileNotice.dx).toBeLessThan(3);
    expect(mobileNotice.dy).toBeLessThan(3);
    await expect(mobile.locator('#inspection-laser-reference-notice')).toBeHidden({ timeout: 7_000 });
    await mobile.locator('#inspection-laser-point-mode').tap();
    const mobileCanvas = mobile.locator('#three-world-canvas'), touchWall = await findSurface(mobile);
    const client = await mobileContext.newCDPSession(mobile);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchWall.x, y: touchWall.y }] });
    await expect(mobile.locator('#inspection-laser-phase')).toHaveText('시작점');
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchWall.x + 30, y: touchWall.y + 22 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(mobile.locator('#inspection-laser-phase')).toHaveText('시작점');
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchWall.x, y: touchWall.y }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await expect(mobile.locator('#inspection-laser-phase')).toHaveText('시작점');
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: touchWall.x, y: touchWall.y }, { id: 2, x: touchWall.x + 30, y: touchWall.y }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(mobile.locator('#inspection-laser-phase')).toHaveText('시작점');
    await mobile.touchscreen.tap(touchWall.x, touchWall.y);
    await expect(mobile.locator('#inspection-laser-phase')).toHaveText('끝점');
    const mobileStart = await mobileCanvas.getAttribute('data-inspection-laser-start-point');
    await expect(mobileCanvas).toHaveAttribute('data-inspection-laser-start-owner', touchWall.owner);
    for (let index = 0; index < 5; index++) await mobile.locator('#zoom-out').tap();
    await expect(mobile.locator('#zoom-value')).toHaveText('40%');
    expect(await mobileCanvas.getAttribute('data-inspection-laser-start-point')).toBe(mobileStart);
    const mobileEnd = await validEnd(mobile);
    await mobile.touchscreen.tap(mobileEnd.x, mobileEnd.y);
    await expect(mobile.locator('#inspection-laser-phase')).toHaveText('완료');
    await expectLineAndValueAgree(mobile);
    const hud = await mobile.locator('#inspection-laser-hud').boundingBox(), mobileStage = await mobile.locator('#game-stage').boundingBox();
    expect(hud!.y - mobileStage!.y).toBeLessThanOrEqual(12);
    await mobile.locator('#game-stage').screenshot({ path: testInfo.outputPath('laser-mobile.png') });
    await mobile.locator('#touch-laser-toggle').tap();
    await mobile.locator('#touch-laser-toggle').tap();
    await expect(mobile.locator('#inspection-laser-reference-notice')).toBeHidden();
  } finally { await mobileContext.close(); }
  expect(errors).toEqual([]);
});
