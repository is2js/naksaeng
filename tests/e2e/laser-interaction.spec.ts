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
          top: box.y - parent.y, href: link.href, target: link.target, rel: link.rel });
      }
    }).observe(stage, { childList: true });
  });
}

async function referenceSnapshot(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as unknown as { laserReferenceSnapshots: unknown[] }).laserReferenceSnapshots.length)).toBe(1);
  return page.evaluate(() => (window as unknown as {
    laserReferenceSnapshots: Array<{ text: string; visible: boolean; dx: number; top: number; href: string; target: string; rel: string }>;
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
  test.setTimeout(process.env.CI ? 480_000 : 300_000);
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
  await expect(stage).toHaveAttribute('data-geometry-revision', 'bundang-55b-geometry-v2');
  await stage.screenshot({ path: testInfo.outputPath('55b-v2-base-desktop.png') });
  await stage.focus();
  await page.keyboard.press('j');
  const desktopNotice = await referenceSnapshot(page);
  expect(desktopNotice.visible).toBe(true);
  expect(desktopNotice.dx).toBeLessThan(3);
  expect(desktopNotice.top).toBeGreaterThanOrEqual(0);
  expect(desktopNotice.top).toBeLessThanOrEqual(12);
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
  const confirmedEnd = await canvas.getAttribute('data-inspection-laser-rendered-end');
  // A camera zoom can finish its subpixel interpolation between preview and
  // pointerup. Compare physical points at the displayed 1 mm resolution, not
  // JSON decimal bytes; the rendered line/value contract below remains exact.
  const previewPoint = JSON.parse(previewEnd!) as number[], confirmedPoint = JSON.parse(confirmedEnd!) as number[];
  expect(Math.hypot(previewPoint[0] - confirmedPoint[0], previewPoint[1] - confirmedPoint[1])).toBeLessThanOrEqual(.001);
  await expectLineAndValueAgree(page);
  await test.step('도면 모달은 게임 입력과 확정 실측을 변경하지 않는다', async () => {
    const actor = page.locator('.rpg-actor--100');
    const actorCell = await actor.evaluate(node => [node.dataset.cellX, node.dataset.cellY]);
    await page.locator('.floorplan-minimap').focus();
    await page.keyboard.press('Enter');
    const dialog = page.locator('#floorplan-reference-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('data-unit-type', '55B');
    await expect(dialog).toHaveAttribute('data-image-state', 'ready');
    await expect(dialog.locator('img')).toHaveAttribute('src', /55b-dimensions-v1\.png$/);
    await page.keyboard.press('ArrowUp');
    expect(await actor.evaluate(node => [node.dataset.cellX, node.dataset.cellY])).toEqual(actorCell);
    const behindScroll = await page.evaluate(() => scrollY);
    const header = (await dialog.locator('.floorplan-reference-header').boundingBox())!;
    await page.mouse.move(header.x + 20, header.y + 20);
    await page.mouse.wheel(0, 150);
    expect(await page.evaluate(() => scrollY)).toBe(behindScroll);
    await dialog.locator('[data-floorplan-action="zoom-in"]').click();
    await expect(dialog).toHaveAttribute('data-zoom', '1.25');
    const viewport = (await dialog.locator('.floorplan-reference-viewport').boundingBox())!;
    await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
    await page.mouse.wheel(0, -180);
    await expect.poll(() => dialog.getAttribute('data-zoom').then(Number)).toBeGreaterThan(1.25);
    await page.mouse.down();
    await page.mouse.move(viewport.x + viewport.width / 2 + 55, viewport.y + viewport.height / 2 + 25, { steps: 3 });
    await page.mouse.up();
    await expect(dialog).toBeVisible();
    await dialog.locator('[data-floorplan-action="fit"]').click();
    await expect(dialog).toHaveAttribute('data-zoom', '1');
    const download = page.waitForEvent('download');
    await dialog.locator('[data-floorplan-action="download"]').click();
    expect((await download).suggestedFilename()).toContain('55B');
    await dialog.screenshot({ path: testInfo.outputPath('floorplan-desktop.png') });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(await canvas.getAttribute('data-inspection-laser-start-point')).toBe(start);
    expect(await canvas.getAttribute('data-inspection-laser-rendered-end')).toBe(confirmedEnd);
    await page.locator('.floorplan-minimap').click();
    await page.mouse.click(2, 2);
    await expect(dialog).toBeHidden();
  });
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

  // Selecting a scene prop intentionally focuses its palette category. Return
  // to all items before looking for the unrelated wall/door options.
  await page.locator('[data-option-category="전체"]').click();
  await page.locator('[data-option-card-id="living-design-wall-panel"] .option-copy').click();
  await expect(page.locator('input[data-option-id="living-design-wall-panel"]')).toBeChecked();
  await page.locator('[data-option-card-id="infinity-door-all-bedrooms"] .option-copy').click();
  await expect(page.locator('input[data-option-id="infinity-door-all-bedrooms"]')).toBeChecked();
  await expect(canvas).toHaveAttribute('data-wall-finish-texture-maps', 'shared-albedo-bump-roughness');
  await expect.poll(() => canvas.getAttribute('data-infinity-door-a042-face-count').then(Number)).toBeGreaterThan(0);
  await stage.screenshot({ path: testInfo.outputPath('55b-v2-design-wall-door-desktop.png') });
  for (const id of ['entry-open-premium-shoe-cabinet', 'entry-pantry-system-shelf', 'entry-sliding-partition-door']) {
    await page.locator('[data-option-category="전체"]').click();
    await page.locator(`[data-option-card-id="${id}"] .option-copy`).click({ timeout: 30_000 });
    await expect(page.locator(`input[data-option-id="${id}"]`)).toBeChecked();
  }
  await page.locator('#zoom-out').click();
  await page.locator('#zoom-out').click();
  await stage.screenshot({ path: testInfo.outputPath('55b-v2-entry-and-wall-desktop.png') });
  await page.locator('#open-help').click();
  await expect(page.locator('#help-dialog option[value="laser-dimensions"]')).toHaveCount(1);
  await page.locator('#help-dialog .dialog-close').click();

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
    await mobileContext.addInitScript(() => sessionStorage.setItem('bunfirvil:household-verification:v1', JSON.stringify({
      schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(), role: 'verified', authRevision: 2, scope: 'playground', nickname: '모바일 검수',
    })));
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
    expect(mobileNotice.top).toBeGreaterThanOrEqual(0);
    expect(mobileNotice.top).toBeLessThanOrEqual(12);
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
    await test.step('모바일 도면 pinch·드래그·닫기 후 확정한 실측을 유지한다', async () => {
      await mobile.locator('.floorplan-minimap').tap();
      const dialog = mobile.locator('#floorplan-reference-dialog');
      await expect(dialog).toHaveAttribute('data-image-state', 'ready');
      const viewport = (await dialog.locator('.floorplan-reference-viewport').boundingBox())!;
      const cx = viewport.x + viewport.width / 2, cy = viewport.y + viewport.height / 2;
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: cx - 35, y: cy }, { id: 2, x: cx + 35, y: cy }] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: cx - 70, y: cy }, { id: 2, x: cx + 70, y: cy }] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect.poll(() => dialog.getAttribute('data-zoom').then(Number)).toBeGreaterThan(1.5);
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: cx, y: cy }] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: cx + 40, y: cy + 20 }] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(dialog).toBeVisible();
      await dialog.screenshot({ path: testInfo.outputPath('floorplan-mobile.png') });
      await dialog.locator('[data-floorplan-action="close"]').tap();
      await expect(dialog).toBeHidden();
      expect(await mobileCanvas.getAttribute('data-inspection-laser-start-point')).toBe(mobileStart);
      await expect(mobile.locator('#inspection-laser-phase')).toHaveText('완료');
      await mobile.locator('#viewer-open-help').tap();
      await expect(mobile.locator('#help-dialog option[value="laser-dimensions"]')).toHaveCount(0);
      await mobile.locator('#help-dialog .dialog-close').tap();
      expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    });
    const hud = await mobile.locator('#inspection-laser-hud').boundingBox(), mobileStage = await mobile.locator('#game-stage').boundingBox();
    expect(hud!.y - mobileStage!.y).toBeLessThanOrEqual(12);
    await mobile.locator('#game-stage').screenshot({ path: testInfo.outputPath('laser-mobile.png') });
    await mobile.locator('#touch-laser-toggle').tap();
    await mobile.locator('#touch-laser-toggle').tap();
    await expect(mobile.locator('#inspection-laser-reference-notice')).toBeHidden();
  } finally { await mobileContext.close(); }
  expect(errors).toEqual([]);
});
