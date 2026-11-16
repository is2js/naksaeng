import { expect, test, type CDPSession, type Page } from '@playwright/test';

const sessionKey = 'bunfirvil:household-verification:v1';
const route = './?map=bundang-first-village-55a-prototype&variant=A';
const themeIds = ['stone-greige', 'warm-taupe', 'neutral-ash', 'soft-ivory', 'deep-greige'];

test.use({ hasTouch: true });

async function ready(page: Page) {
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 60_000 });
  await expect(page.locator('#three-world-canvas')).toBeVisible();
  await expect(page.locator('.finish-theme-legend')).toBeVisible();
  await expect(page.locator('.finish-theme-legend .finish-theme-materials > li > span')).toHaveText(['벽', '벽 단면', '마루']);
}

async function changeRole(page: Page, client: CDPSession, role: 'verified' | 'operator') {
  await page.evaluate(({ key, role }) => sessionStorage.setItem(key, JSON.stringify({
    schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(), role,
    authRevision: 2, scope: 'playground', nickname: '색감 확인',
  })), { key: sessionKey, role });
  await page.goto(route);
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await ready(page);
}

test('색감 선택은 회원만 가능하고 범례·입력·공유 열람은 PC와 모바일에서 안전하다', async ({ page, context }, testInfo) => {
  test.setTimeout(process.env.CI ? 360_000 : 180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Synthetic sessions only: this smoke must never consult a real Sheet.
  await page.route('https://script.google.com/**', route => route.abort());
  await page.addInitScript(key => {
    if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify({
      schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(), role: 'public',
      authRevision: 2, scope: 'playground', nickname: '색감 확인',
    }));
  }, sessionKey);
  const client = await context.newCDPSession(page);
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(route);
  // Context hasTouch is reapplied on navigation; opt this desktop leg back out.
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await ready(page);
  const canvas = page.locator('#three-world-canvas');
  const stage = page.locator('#game-stage');
  const controls = page.locator('.finish-theme-controls');
  const legend = page.locator('.finish-theme-legend');
  const themeSelect = page.locator('#finish-theme-select');
  const picker = page.locator('#finish-theme-open');
  const dialog = page.locator('#finish-theme-dialog');
  const radio = (id: string) => dialog.locator(`input[name="finish-theme"][value="${id}"]`);

  await expect(stage).toHaveAttribute('data-access-role', 'public');
  await expect(canvas).toHaveAttribute('data-finish-theme', 'stone-greige');
  await expect(legend.locator('.finish-theme-swatch')).toHaveCount(3);
  await expect(legend.locator('svg')).toHaveCount(0);
  for (const swatch of await legend.locator('.finish-theme-swatch').all()) {
    await expect(swatch).toBeVisible();
    await expect(swatch).toHaveCSS('width', '13px');
    await expect(swatch).toHaveCSS('height', '13px');
  }
  await expect(legend.locator('[data-finish-material="wall"]')).not.toHaveCSS('background-image', 'none');
  await expect(legend.locator('[data-finish-material="cap"]')).toHaveCSS('background-image', 'none');
  await expect(legend.locator('[data-finish-material="floor"]')).not.toHaveCSS('background-image', 'none');
  await expect(picker).toHaveCount(0);
  await expect(themeSelect).toHaveCount(0);
  await expect(dialog).toHaveCount(0);

  await changeRole(page, client, 'verified');
  await expect(themeSelect).toBeVisible();
  await expect(picker).toBeHidden();
  expect(await themeSelect.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(themeIds);
  await expect(themeSelect).toHaveValue('stone-greige');
  await themeSelect.selectOption('warm-taupe');
  await expect(themeSelect).toHaveValue('warm-taupe');
  await expect(canvas).toHaveAttribute('data-finish-theme', 'warm-taupe');
  await expect(dialog).toBeHidden();
  await page.locator('input[data-option-id="wide-plank-floor-finish"]').check({ force: true });
  await expect(page.locator('#option-selected-count')).toHaveText('1개');
  await expect(canvas).toHaveAttribute('data-finish-theme', 'warm-taupe');
  await page.locator('[data-hotbar-action="showcase-plan-toggle"]').click();
  await expect(stage).toHaveAttribute('data-plan-variant', 'B');
  await ready(page);
  await expect(canvas).toHaveAttribute('data-finish-theme', 'warm-taupe');
  await expect(controls).toHaveAttribute('data-theme-id', 'warm-taupe');
  await stage.screenshot({ path: testInfo.outputPath('finish-theme-desktop.png') });

  await client.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(legend).toBeVisible();
  await expect(themeSelect).toBeHidden();
  await expect(picker).toBeVisible();
  await expect(legend.locator('svg')).toHaveCount(0);
  for (const swatch of await legend.locator('.finish-theme-swatch').all()) {
    await expect(swatch).toBeVisible();
    await expect(swatch).toHaveCSS('width', '10px');
    await expect(swatch).toHaveCSS('height', '10px');
    await expect(swatch).toHaveCSS('filter', 'grayscale(1)');
  }
  expect(await legend.innerText()).not.toMatch(/#[0-9a-f]{6}|rgb\s*\(/i);
  const stageBox = (await stage.boundingBox())!;
  const controlsBox = (await controls.boundingBox())!;
  const minimapBox = (await page.locator('.floorplan-minimap').boundingBox())!;
  expect(controlsBox.x - stageBox.x).toBeGreaterThanOrEqual(0);
  expect(controlsBox.x - stageBox.x).toBeLessThanOrEqual(12);
  expect(controlsBox.y - stageBox.y).toBeGreaterThanOrEqual(0);
  expect(controlsBox.y - stageBox.y).toBeLessThanOrEqual(12);
  expect(controlsBox.x + controlsBox.width).toBeLessThanOrEqual(minimapBox.x);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.locator('#touch-laser-toggle').tap();
  await page.locator('#inspection-laser-point-mode').tap();
  await expect(page.locator('#inspection-laser-reference-notice')).toBeHidden();
  await expect(page.locator('#inspection-laser-phase')).toHaveText('시작점');
  const hudBox = (await page.locator('#inspection-laser-hud').boundingBox())!;
  const activeControlsBox = (await controls.boundingBox())!;
  expect(activeControlsBox.y).toBeGreaterThanOrEqual(hudBox.y + hudBox.height);
  await legend.tap({ position: { x: 4, y: 4 } });
  await expect(canvas).not.toHaveAttribute('data-inspection-laser-start-point', /.+/);
  const zoom = await page.locator('#zoom-value').innerText();
  const tracking = await stage.getAttribute('data-camera-tracking');
  const legendBox = (await legend.boundingBox())!;
  await page.mouse.move(legendBox.x + 5, legendBox.y + 5);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  await expect(page.locator('#zoom-value')).toHaveText(zoom);
  await expect(stage).toHaveAttribute('data-camera-tracking', tracking!);

  await picker.tap();
  await expect(dialog).toBeVisible();
  await expect(radio('warm-taupe')).toBeChecked();
  await radio('neutral-ash').tap();
  await expect(canvas).toHaveAttribute('data-finish-theme', 'neutral-ash');
  const actor = page.locator('.rpg-actor--100');
  await expect(actor).toHaveAttribute('data-travel-state', 'settled');
  const position = [await actor.getAttribute('data-world-x'), await actor.getAttribute('data-world-y')];
  await radio('neutral-ash').press('Space');
  await radio('neutral-ash').press('w');
  await radio('neutral-ash').press('ArrowRight');
  await expect(radio('soft-ivory')).toBeChecked();
  await expect(dialog.locator('input:checked')).toHaveCount(1);
  await expect(canvas).toHaveAttribute('data-finish-theme', 'soft-ivory');
  expect([await actor.getAttribute('data-world-x'), await actor.getAttribute('data-world-y')]).toEqual(position);
  await expect(actor).not.toHaveAttribute('data-motion', 'attack');
  await expect(canvas).not.toHaveAttribute('data-inspection-laser-start-point', /.+/);
  await expect(page.locator('#inspection-laser-phase')).toHaveText('시작점');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(picker).toBeFocused();
  await expect(canvas).not.toHaveAttribute('data-inspection-laser-start-point', /.+/);
  await stage.screenshot({ path: testInfo.outputPath('finish-theme-mobile-laser.png') });
  await page.locator('#touch-laser-toggle').tap();

  // An input outside the modal must retain native typing, not character skills.
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'finish-theme-external-input';
    input.setAttribute('aria-label', '외부 입력 확인');
    input.style.cssText = 'position:fixed;top:4px;left:4px;width:180px;z-index:10000';
    document.body.append(input);
  });
  try {
    const input = page.locator('#finish-theme-external-input');
    await input.fill('입력');
    await input.press('w');
    await input.press('Space');
    await input.press('2');
    await input.press('ArrowRight');
    await expect(input).toHaveValue('입력w 2');
    expect([await actor.getAttribute('data-world-x'), await actor.getAttribute('data-world-y')]).toEqual(position);
    await expect(actor).not.toHaveAttribute('data-motion', 'attack');
    await expect(page.locator('[data-hotbar-action="showcase-gender-toggle"]')).not.toHaveClass(/is-active/);
  } finally { await page.locator('#finish-theme-external-input').evaluate(input => input.remove()); }

  await client.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await changeRole(page, client, 'operator');
  await expect(stage).toHaveAttribute('data-access-role', 'operator');
  await expect(themeSelect).toBeVisible();
  await themeSelect.selectOption('deep-greige');
  await expect(canvas).toHaveAttribute('data-finish-theme', 'deep-greige');
  await expect(dialog).toBeHidden();
  await page.locator('#share-showcase').click();
  const sharedUrl = await page.locator('#share-link-value').inputValue();
  await page.locator('#share-dialog').getByRole('button', { name: '닫기' }).click();
  await page.goto(sharedUrl);
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await ready(page);
  await expect(page.locator('.share-readonly-banner')).toBeVisible();
  await expect(stage).toHaveAttribute('data-access-role', 'operator');
  await expect(canvas).toHaveAttribute('data-finish-theme', 'stone-greige');
  await expect(picker).toHaveCount(0);
  await expect(themeSelect).toHaveCount(0);
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});
