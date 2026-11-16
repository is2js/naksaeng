import { expect, test, type Locator, type Page } from '@playwright/test';

const mapId = 'bundang-first-village-55a-prototype';
const route = `./?map=${mapId}&variant=A`;
const sessionKey = 'bunfirvil:household-verification:v1';
const themeIds = ['stone-greige', 'warm-taupe', 'neutral-ash', 'soft-ivory', 'deep-greige'];
test.use({ hasTouch: true });

async function ready(page: Page) {
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 60_000 });
  await expect(page.locator('#three-world-canvas')).toBeVisible();
  await expect(page.locator('.finish-theme-legend .finish-theme-materials > li > span')).toHaveText(['벽', '벽 단면', '마루']);
  await expect(page.locator('.finish-theme-legend .finish-theme-swatch')).toHaveCount(3);
  await expect(page.locator('.finish-theme-legend svg')).toHaveCount(0);
}

async function unchangedState(page: Page) {
  return page.evaluate(map => ({
    review: localStorage.getItem(`bunfirvil:review:v1:${map}`),
    layout: localStorage.getItem(`bunfirvil:layout:v1:${map}`),
    quote: document.querySelector('#option-total')!.textContent,
    count: document.querySelector('#option-selected-count')!.textContent,
  }), mapId);
}

async function expectCompactPopup(page: Page, popup: Locator) {
  await expect(popup).toBeVisible();
  const choices = popup.locator('[role="option"]');
  expect(await choices.evaluateAll(elements => elements.map(element => (element as HTMLElement).dataset.finishThemeId))).toEqual(themeIds);
  await expect(popup.locator('[aria-selected="true"]')).toHaveCount(1);
  await expect(popup.locator('svg')).toHaveCount(0);
  const layout = await popup.evaluate(element => {
    const stage = document.querySelector('#game-stage')!.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom,
      stage: { left: stage.left, right: stage.right, top: stage.top, bottom: stage.bottom }, width: innerWidth, height: innerHeight,
      rows: Array.from(element.querySelectorAll('[role="option"]')).map(row => ({
        height: row.getBoundingClientRect().height,
        fontSize: parseFloat(getComputedStyle(row.querySelector('.finish-theme-option-name')!).fontSize),
        swatches: Array.from(row.querySelectorAll('.finish-theme-option-swatch')).map(swatch => {
          const { width, height } = swatch.getBoundingClientRect(); return { width, height };
        }),
      })),
    };
  });
  expect(layout.left).toBeGreaterThanOrEqual(Math.max(0, layout.stage.left) - 1);
  expect(layout.right).toBeLessThanOrEqual(Math.min(layout.width, layout.stage.right) + 1);
  expect(layout.top).toBeGreaterThanOrEqual(Math.max(0, layout.stage.top) - 1);
  expect(layout.bottom).toBeLessThanOrEqual(Math.min(layout.height, layout.stage.bottom) + 1);
  for (const row of layout.rows) {
    expect(row.height).toBeGreaterThanOrEqual(44);
    expect(row.fontSize).toBeLessThanOrEqual(12);
    expect(row.swatches).toHaveLength(3);
    for (const swatch of row.swatches) {
      expect(swatch.width).toBeGreaterThan(0);
      expect(swatch.width).toBeLessThanOrEqual(14);
      expect(Math.abs(swatch.width - swatch.height)).toBeLessThanOrEqual(1);
    }
  }
}

test('공통 색감 dropdown은 작고 즉시 닫히며 입력·설치·읽기전용 권한을 보존한다', async ({ page, context }, testInfo) => {
  test.setTimeout(process.env.CI ? 360_000 : 180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://script.google.com/**', route => route.abort());
  await page.addInitScript(({ key, map }) => {
    if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify({
      schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(), role: 'verified',
      authRevision: 2, scope: 'playground', nickname: '색감 확인',
    }));
    if (!localStorage.getItem(`bunfirvil:layout:v1:${map}`)) localStorage.setItem(`bunfirvil:layout:v1:${map}`, JSON.stringify({
      schemaVersion: 1, mapId: map, updatedAt: '2026-11-16T00:00:00.000Z', props: [{
        id: 'local-bed-single-finish-check', assetId: 'bed-single', positionMeters: [8.5, 6.7],
        dimensionsMeters: [1, 2, .55], yawDeg: 0, mirrored: false, materialVariantId: 'warm-oak-ivory',
      }],
    }));
  }, { key: sessionKey, map: mapId });
  const client = await context.newCDPSession(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(route);
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await ready(page);
  const canvas = page.locator('#three-world-canvas'), stage = page.locator('#game-stage');
  const trigger = page.locator('#finish-theme-open'), popup = page.locator('#finish-theme-list');
  const option = (id: string) => popup.locator(`[role="option"][data-finish-theme-id="${id}"]`);
  await expect(page.locator('#finish-theme-select, #finish-theme-dialog')).toHaveCount(0);
  await expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
  await expect(canvas).toHaveAttribute('data-finish-theme', 'stone-greige');
  await page.locator('input[data-option-id="wide-plank-floor-finish"]').check({ force: true });
  await expect(page.locator('#option-selected-count')).toHaveText('1개');
  const baseline = await unchangedState(page);
  const actor = page.locator('.rpg-actor--100');
  await expect(actor).toHaveAttribute('data-travel-state', 'settled');
  const position = [await actor.getAttribute('data-world-x'), await actor.getAttribute('data-world-y')];

  await trigger.click();
  await expectCompactPopup(page, popup);
  await option('stone-greige').focus();
  await page.keyboard.press('w');
  await page.keyboard.press('End');
  await expect(option('deep-greige')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(option('stone-greige')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(option('warm-taupe')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(popup).toBeHidden();
  await expect(canvas).toHaveAttribute('data-finish-theme', 'warm-taupe');
  expect([await actor.getAttribute('data-world-x'), await actor.getAttribute('data-world-y')]).toEqual(position);
  await expect(actor).not.toHaveAttribute('data-motion', 'attack');
  expect(await unchangedState(page)).toEqual(baseline);
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(popup).toBeHidden();
  await trigger.click();
  await page.locator('.serverless-banner').click({ position: { x: 1, y: 1 } });
  await expect(popup).toBeHidden();
  await stage.screenshot({ path: testInfo.outputPath('finish-theme-dropdown-desktop.png') });

  await client.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  for (const [width, id] of [[390, 'neutral-ash'], [320, 'soft-ivory']] as const) {
    await page.setViewportSize({ width, height: 844 });
    await stage.scrollIntoViewIfNeeded();
    await trigger.tap();
    await expectCompactPopup(page, popup);
    await option(id).tap();
    await expect(popup).toBeHidden();
    await expect(canvas).toHaveAttribute('data-finish-theme', id);
    expect(await unchangedState(page)).toEqual(baseline);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#touch-laser-toggle').tap();
  await page.locator('#inspection-laser-point-mode').tap();
  await expect(page.locator('#inspection-laser-reference-notice')).toBeHidden();
  await expect(page.locator('#inspection-laser-phase')).toHaveText('시작점');
  await trigger.tap();
  await option('stone-greige').focus();
  await page.keyboard.press('w');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(popup).toBeHidden();
  await expect(canvas).toHaveAttribute('data-finish-theme', 'warm-taupe');
  await expect(canvas).not.toHaveAttribute('data-inspection-laser-start-point', /.+/);
  await expect(page.locator('#inspection-laser-phase')).toHaveText('시작점');
  expect([await actor.getAttribute('data-world-x'), await actor.getAttribute('data-world-y')]).toEqual(position);
  expect(await unchangedState(page)).toEqual(baseline);
  await trigger.tap();
  await option('warm-taupe').tap(); // Selecting the current value still dismisses.
  await expect(popup).toBeHidden();
  await trigger.tap();
  const outside = await page.evaluate(() => {
    const box = document.querySelector('#three-world-canvas')!.getBoundingClientRect();
    for (const fy of [.7, .55, .85]) for (const fx of [.1, .5, .9]) {
      const point = { x: box.x + box.width * fx, y: box.y + box.height * fy };
      if (document.elementFromPoint(point.x, point.y)?.id === 'three-world-canvas') return point;
    }
    return null;
  });
  expect(outside).not.toBeNull();
  await page.touchscreen.tap(outside!.x, outside!.y);
  await expect(popup).toBeHidden();
  await expect(canvas).not.toHaveAttribute('data-inspection-laser-start-point', /.+/);
  await expect(stage).not.toHaveClass(/is-panning/);
  await stage.screenshot({ path: testInfo.outputPath('finish-theme-dropdown-mobile.png') });
  await page.locator('#touch-laser-toggle').tap();

  await page.locator('#share-showcase').click();
  const sharedUrl = await page.locator('#share-link-value').inputValue();
  await page.locator('#share-dialog').getByRole('button', { name: '닫기' }).click();
  await page.evaluate(key => {
    const session = JSON.parse(sessionStorage.getItem(key)!); session.role = 'public';
    sessionStorage.setItem(key, JSON.stringify(session));
  }, sessionKey);
  await page.goto(route);
  await ready(page);
  await expect(trigger).toHaveCount(0);
  await expect(popup).toHaveCount(0);
  await page.evaluate(key => {
    const session = JSON.parse(sessionStorage.getItem(key)!); session.role = 'operator';
    sessionStorage.setItem(key, JSON.stringify(session));
  }, sessionKey);
  await page.goto(sharedUrl);
  await ready(page);
  await expect(page.locator('.share-readonly-banner')).toBeVisible();
  await expect(canvas).toHaveAttribute('data-finish-theme', 'stone-greige');
  await expect(trigger).toHaveCount(0);
  await expect(popup).toHaveCount(0);
  expect(errors).toEqual([]);
});
