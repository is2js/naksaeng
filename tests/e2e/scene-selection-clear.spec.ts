import { expect, test, type Page } from '@playwright/test';

const mapId = 'bundang-first-village-55a-prototype';
const pantryId = 'entry-pantry-system-shelf';
const floorId = 'wide-plank-floor-finish';
test.use({ hasTouch: true });

async function storedState(page: Page) {
  return page.evaluate(map => ({
    review: localStorage.getItem(`bunfirvil:review:v1:${map}`),
    optionIds: JSON.parse(localStorage.getItem(`bunfirvil:review:v1:${map}`) || '{}').selectedOptionIds,
    layout: localStorage.getItem(`bunfirvil:layout:v1:${map}`),
    quote: document.querySelector('#option-total')!.textContent,
    count: document.querySelector('#option-selected-count')!.textContent,
  }), mapId);
}

async function selectChip(page: Page, optionId: string, touch = false) {
  const chip = page.locator(`#stage-option-chips .stage-option-chip[data-stage-option-select="${optionId}"]`);
  const button = chip.locator('.stage-option-select');
  if (!(await chip.evaluate(element => element.classList.contains('is-world-selected')))) {
    if (touch) await button.tap(); else await button.click();
  }
  await expect(chip).toHaveClass(/is-world-selected/);
  await expect(page.locator('#three-world-canvas')).toHaveAttribute('data-selected-editor-prop-id', /.+/);
  await expect(page.locator('#three-world-canvas')).toHaveAttribute('data-selected-editor-mask', 'rpg-gold');
}

async function expectCleared(page: Page) {
  await expect(page.locator('#stage-option-chips .is-world-selected')).toHaveCount(0);
  await expect(page.locator('[data-option-card-id].is-world-linked')).toHaveCount(0);
  await expect(page.locator('#three-world-canvas')).toHaveAttribute('data-selected-editor-prop-id', '');
  await expect(page.locator('#three-world-canvas')).not.toHaveAttribute('data-selected-editor-mask', /.+/);
  await expect(page.locator('#furniture-selection-toolbar')).toBeHidden();
}

/** Use existing laser diagnostics, not an application test API. Floor candidates
 * need a valid automatic room span, not the unrelated 150mm start-face snap.
 * The laser is stopped before the actual click. */
async function scenePoint(page: Page, kind: 'wall' | 'plane') {
  const stage = page.locator('#game-stage'), canvas = page.locator('#three-world-canvas');
  await stage.focus();
  await page.keyboard.press('j');
  if (kind === 'wall') await page.locator('#inspection-laser-point-mode').click();
  await expect(page.locator('#inspection-laser-reference-notice')).toBeHidden();
  const bounds = (await canvas.boundingBox())!;
  let found: { x: number; y: number } | null = null;
  try {
    for (const fy of [.4, .5, .6, .3, .7]) {
      for (const fx of [.4, .5, .6, .3, .7]) {
        const point = { x: bounds.x + bounds.width * fx, y: bounds.y + bounds.height * fy };
        const blockedByUi = await page.evaluate(point => Boolean(document.elementFromPoint(point.x, point.y)?.closest(
          '.finish-theme-controls,.map-identity,.floorplan-minimap,.stage-option-quote,.mobile-stage-options,.stage-zoom,.combat-dock,.game-toast,.istarpark-laser-hud,.furniture-selection-toolbar',
        )), point);
        if (blockedByUi) continue;
        await canvas.evaluate(node => { delete node.dataset.inspectionLaserPointerKind; delete node.dataset.inspectionLaserPointerSurface; });
        await page.mouse.move(point.x, point.y);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const surface = await canvas.evaluate(node => ({
          kind: node.dataset.inspectionLaserPointerKind, owner: node.dataset.inspectionLaserPointerSurface,
          phase: node.dataset.inspectionLaserPhase,
        }));
        if (surface.kind === kind && (kind === 'wall' ? Boolean(surface.owner) : surface.phase === 'automatic')) {
          found = point; break;
        }
      }
      if (found) break;
    }
  } finally {
    await stage.focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('#inspection-laser-hud')).toBeHidden();
  }
  expect(found, `No actual ${kind} scene point was found`).not.toBeNull();
  return found!;
}

test('옵션 활성 표시만 이동·공격·스킬·배경 클릭으로 해제되고 저장값은 유지된다', async ({ page, context }, testInfo) => {
  test.setTimeout(process.env.CI ? 360_000 : 180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://script.google.com/**', route => route.abort());
  await page.addInitScript(map => {
    sessionStorage.setItem('bunfirvil:household-verification:v1', JSON.stringify({
      schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(), role: 'verified',
      authRevision: 2, scope: 'playground', nickname: '선택 해제 확인',
    }));
    localStorage.setItem(`bunfirvil:layout:v1:${map}`, JSON.stringify({
      schemaVersion: 1, mapId: map, updatedAt: '2026-11-16T00:00:00.000Z', props: [{
        id: 'local-bed-single-selection-check', assetId: 'bed-single', positionMeters: [8.5, 6.7],
        dimensionsMeters: [1, 2, .55], yawDeg: 0, mirrored: false, materialVariantId: 'warm-oak-ivory',
      }],
    }));
  }, mapId);
  const client = await context.newCDPSession(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`./?map=${mapId}&variant=A`);
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 60_000 });
  const stage = page.locator('#game-stage'), canvas = page.locator('#three-world-canvas');
  await page.locator(`input[data-option-id="${floorId}"]`).check({ force: true });
  await page.locator(`input[data-option-id="${pantryId}"]`).check({ force: true });
  await expect(page.locator('#option-selected-count')).toHaveText('2개');
  const baseline = await storedState(page);
  expect([...baseline.optionIds].sort()).toEqual([floorId, pantryId].sort());
  expect(JSON.parse(baseline.layout!).props).toHaveLength(1);

  for (const key of ['w', 'a', 's', 'd', 'Space']) {
    await selectChip(page, pantryId);
    await stage.focus();
    await page.keyboard.press(key);
    await expectCleared(page);
    expect(await storedState(page)).toEqual(baseline);
  }
  await selectChip(page, pantryId);
  await page.locator('[data-hotbar-action="showcase-gender-toggle"]').click();
  await expectCleared(page);
  expect(await storedState(page)).toEqual(baseline);

  await page.locator('[data-palette-tab="furniture"]').click();
  await page.locator('#palette-applied-only').click();
  await page.locator('[data-furniture-prop-id="local-bed-single-selection-check"]').click();
  await expect(canvas).toHaveAttribute('data-selected-editor-prop-id', 'local-bed-single-selection-check');
  await expect(page.locator('[data-palette-tab="furniture"]')).toHaveClass(/is-active/);
  await stage.focus();
  await page.keyboard.press('w');
  await expectCleared(page);
  await expect(page.locator('[data-palette-tab="options"]')).toHaveClass(/is-active/);
  await expect(page.locator('#furniture-palette-body')).toBeHidden();
  expect(await storedState(page)).toEqual(baseline);

  // Form and native modal keys are not actor navigation/skills.
  await selectChip(page, pantryId);
  const selected = (await canvas.getAttribute('data-selected-editor-prop-id'))!;
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'selection-clear-external-input';
    input.style.cssText = 'position:fixed;top:4px;left:4px;z-index:10000;width:180px';
    document.body.append(input);
  });
  try {
    const input = page.locator('#selection-clear-external-input');
    await input.fill('입력');
    await input.press('w'); await input.press('Space'); await input.press('2');
    await expect(canvas).toHaveAttribute('data-selected-editor-prop-id', selected);
    await expect(page.locator(`#stage-option-chips [data-stage-option-select="${pantryId}"]`).first()).toHaveClass(/is-world-selected/);
  } finally { await page.locator('#selection-clear-external-input').evaluate(input => input.remove()); }
  await page.locator('#open-help:visible, #viewer-open-help:visible').click();
  const help = page.locator('#help-dialog');
  await expect(help).toBeVisible();
  await expect(help.locator('article')).toBeVisible();
  await help.locator('article').focus();
  await page.keyboard.press('w');
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  await expect(canvas).toHaveAttribute('data-selected-editor-prop-id', selected);
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();
  expect(await storedState(page)).toEqual(baseline);

  for (const surface of ['wall', 'plane'] as const) {
    await selectChip(page, pantryId);
    const point = await scenePoint(page, surface);
    await selectChip(page, pantryId);
    await page.mouse.click(point.x, point.y);
    await expectCleared(page);
    expect(await storedState(page)).toEqual(baseline);
  }
  // Explicit chip selection is still available for the full floor group, but
  // clicking the visible floor itself is a background action, not reselection.
  await selectChip(page, floorId);
  const floor = await scenePoint(page, 'plane');
  await selectChip(page, floorId);
  await page.mouse.click(floor.x, floor.y);
  await expectCleared(page);
  expect(await storedState(page)).toEqual(baseline);
  await stage.screenshot({ path: testInfo.outputPath('scene-selection-cleared-desktop.png') });

  await client.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await selectChip(page, pantryId, true);
  const pad = page.locator('.touch-move-pad');
  await pad.scrollIntoViewIfNeeded();
  const padBox = (await pad.boundingBox())!;
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{
    x: padBox.x + padBox.width - 15, y: padBox.y + padBox.height / 2,
  }] });
  try { await expectCleared(page); }
  finally { await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
  expect(await storedState(page)).toEqual(baseline);
  await expect(page.locator('#stage-option-chips .stage-option-chip')).toHaveCount(2);
  await stage.screenshot({ path: testInfo.outputPath('scene-selection-cleared-mobile.png') });
  expect(errors).toEqual([]);
});
