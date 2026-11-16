import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test';

const mapId = 'bundang-first-village-55a-prototype';
const pantryId = 'entry-pantry-system-shelf';
test.use({ hasTouch: true });

async function optionState(page: Page) {
  return page.evaluate(map => ({
    review: localStorage.getItem(`bunfirvil:review:v1:${map}`),
    layout: localStorage.getItem(`bunfirvil:layout:v1:${map}`),
    quote: document.querySelector('#option-total')!.textContent,
    count: document.querySelector('#option-selected-count')!.textContent,
  }), mapId);
}

async function emptyChildClicks(page: Page, dialog: Locator) {
  await dialog.click({ position: { x: 4, y: 4 } }); // Real empty dialog padding.
  await expect(dialog).toBeVisible();
  await page.touchscreen.tap(2, 2); // Native modal backdrop, not a DOM dispatch.
  await expect(dialog).toBeVisible();
}

async function swipeUp(page: Page, client: CDPSession, x: number, y: number, distance = 120) {
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  try {
    for (let step = 1; step <= 6; step++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - distance * step / 6 }] });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    }
    // End a deliberate slow swipe, not an inertial fling into the next check.
    await page.waitForTimeout(100);
  } finally { await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
}

async function positionScrollTarget(page: Page, selector: string) {
  await page.evaluate(selector => {
    const rect = document.querySelector(selector)!.getBoundingClientRect();
    const maximum = document.documentElement.scrollHeight - innerHeight;
    const top = Math.max(0, Math.min(rect.top + scrollY - innerHeight * .42, maximum - 140));
    scrollTo({ top, behavior: 'instant' });
  }, selector);
}

test('간결한 범례·반응형 색감 선택·칩 토글·안전한 모달·옵션 스크롤을 유지한다', async ({ page, context }, testInfo) => {
  test.setTimeout(process.env.CI ? 360_000 : 180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://script.google.com/**', route => route.abort());
  await page.addInitScript(() => sessionStorage.setItem('bunfirvil:household-verification:v1', JSON.stringify({
    schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(), role: 'verified', memberCodeRevision: 1,
    authRevision: 2, scope: 'playground', nickname: '모바일 조작 확인',
  })));
  const client = await context.newCDPSession(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`./?map=${mapId}&variant=A`);
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 60_000 });
  const canvas = page.locator('#three-world-canvas');
  const stage = page.locator('#game-stage');
  const banner = page.locator('.serverless-banner');
  await expect(banner.locator('.playground-banner-reference')).toBeVisible();
  await expect(banner.locator('.playground-banner-disclaimer')).toBeVisible();
  await expect(banner.locator('.playground-banner-disclaimer')).toHaveText('실제 모습과 차이가 있을 수 있습니다.');
  const legend = page.locator('.finish-theme-legend');
  await expect(legend).toBeVisible();
  await expect(legend.locator('.finish-theme-legend-heading')).toHaveCount(0);
  await expect(legend.locator('.finish-theme-materials > li > span')).toHaveText(['벽', '벽 단면', '마루']);
  await expect(legend.locator('.finish-theme-swatch')).toHaveCount(3);
  for (const swatch of await legend.locator('.finish-theme-swatch').all()) await expect(swatch).toBeVisible();
  const themePicker = page.locator('#finish-theme-open');
  const themeList = page.locator('#finish-theme-list');
  await expect(themePicker).toBeVisible();
  await themePicker.click();
  await expect(themeList.locator('[role="option"]')).toHaveCount(5);
  await themeList.locator('[data-finish-theme-id="warm-taupe"]').click();
  await expect(canvas).toHaveAttribute('data-finish-theme', 'warm-taupe');
  await expect(themeList).toBeHidden();
  await expect(page.locator('#finish-theme-select, #finish-theme-dialog')).toHaveCount(0);
  await expect(legend.locator('.finish-theme-legend-heading')).toHaveCount(0);
  const pantryCard = page.locator(`[data-option-card-id="${pantryId}"]`);
  const unselectedBackground = await pantryCard.evaluate(element => getComputedStyle(element).backgroundImage);
  await page.locator('input[data-option-id="wide-plank-floor-finish"]').check({ force: true });
  await page.locator(`input[data-option-id="${pantryId}"]`).check({ force: true });
  await expect(page.locator('#option-selected-count')).toHaveText('2개');
  await expect(pantryCard).toHaveClass(/is-selected/);
  await expect(pantryCard).not.toHaveClass(/is-world-linked/);
  await expect(pantryCard).toHaveCSS('background-image', /225,\s*185,\s*99/);
  expect(await pantryCard.evaluate(element => getComputedStyle(element).backgroundImage)).not.toBe(unselectedBackground);
  const baseline = await optionState(page);
  // A scene pointer can focus the game, but must not paint a browser outline.
  await stage.click({ position: { x: 40, y: 200 } });
  await expect(stage).toBeFocused();
  await expect(stage).toHaveCSS('outline-style', 'none');
  await expect(stage).toHaveCSS('outline-width', '0px');
  const chip = page.locator(`#stage-option-chips .stage-option-chip[data-stage-option-select="${pantryId}"]`);
  await chip.locator('.stage-option-select').click();
  await expect(chip).toHaveClass(/is-world-selected/);
  await chip.locator('.stage-option-select').click();
  await expect(chip).not.toHaveClass(/is-world-selected/);
  await expect(canvas).toHaveAttribute('data-selected-editor-prop-id', '');
  await expect(canvas).not.toHaveAttribute('data-selected-editor-mask', /.+/);
  expect(await optionState(page)).toEqual(baseline);
  await chip.locator('.stage-option-select').click();
  await expect(chip).toHaveClass(/is-world-selected/);
  await stage.screenshot({ path: testInfo.outputPath('legend-only-desktop.png') });

  await client.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(banner.locator('.playground-banner-reference')).toBeHidden();
  await expect(banner.locator('.playground-banner-disclaimer')).toBeHidden();
  expect((await banner.innerText()).trim()).toBe('평면도, 사이버주택전시관 기반 추론가상공간입니다.');
  await expect(themePicker).toBeVisible();
  await expect(legend.locator('.finish-theme-legend-heading')).toHaveCount(0);
  // The existing selection survives the resize; first tap turns it OFF.
  await chip.locator('.stage-option-select').tap();
  await expect(chip).not.toHaveClass(/is-world-selected/);
  await expect(canvas).toHaveAttribute('data-selected-editor-prop-id', '');
  await expect(canvas).not.toHaveAttribute('data-selected-editor-mask', /.+/);
  expect(await optionState(page)).toEqual(baseline);
  await chip.locator('.stage-option-select').tap();
  await expect(chip).toHaveClass(/is-world-selected/);
  await expect(canvas).toHaveAttribute('data-selected-editor-mask', 'rpg-gold');
  await chip.locator('.stage-option-select').tap();
  await expect(chip).not.toHaveClass(/is-world-selected/);
  expect(await optionState(page)).toEqual(baseline);

  const summon = page.locator('[data-hotbar-action="showcase-children"]');
  const child = page.locator('.child-companion-dialog');
  await summon.tap();
  await expect(child.getByRole('heading', { name: '자녀수 선택' })).toBeVisible();
  await child.getByRole('button', { name: '자녀수 늘리기' }).tap();
  await emptyChildClicks(page, child);
  await expect(child.locator('.child-count-control strong')).toHaveText('2');
  await child.getByRole('button', { name: '다음', exact: true }).tap();
  await child.getByRole('radio', { name: '초등학생' }).check();
  await child.getByRole('radio', { name: '녀', exact: true }).check();
  await emptyChildClicks(page, child);
  await expect(child.getByRole('heading', { name: '1번째 자녀' })).toBeVisible();
  await expect(child.getByRole('radio', { name: '초등학생' })).toBeChecked();
  await expect(child.getByRole('radio', { name: '녀', exact: true })).toBeChecked();
  await child.getByRole('button', { name: '다음 자녀' }).tap();
  await emptyChildClicks(page, child);
  await expect(child.getByRole('heading', { name: '2번째 자녀' })).toBeVisible();
  await child.getByRole('button', { name: '이전', exact: true }).tap();
  await expect(child.getByRole('radio', { name: '초등학생' })).toBeChecked();
  await child.getByRole('button', { name: '다음 자녀' }).tap();
  await child.getByRole('button', { name: '소환', exact: true }).tap();
  await expect(child).toHaveCount(0);
  await expect(page.locator('.child-companion')).toHaveCount(2);
  await summon.tap();
  await child.getByRole('button', { name: '닫기', exact: true }).tap();
  await expect(child).toHaveCount(0);
  await expect(page.locator('.child-companion')).toHaveCount(2);
  await summon.tap();
  await page.keyboard.press('Escape');
  await expect(child).toHaveCount(0);
  await expect(page.locator('.child-companion')).toHaveCount(2);
  await summon.tap();
  await child.getByRole('button', { name: '소환 해제' }).tap();
  await expect(child).toHaveCount(0);
  await expect(page.locator('.child-companion')).toHaveCount(0);
  expect(await optionState(page)).toEqual(baseline);

  await page.locator('[data-option-category="전체"]').click();
  const list = page.locator('#option-list');
  await list.evaluate(element => { element.scrollTop = (element.scrollHeight - element.clientHeight) * .35; });
  await positionScrollTarget(page, '#option-list');
  const middle = await list.evaluate(element => ({ top: element.scrollTop, maximum: element.scrollHeight - element.clientHeight }));
  expect(middle.maximum - middle.top).toBeGreaterThan(400);
  const documentMiddle = await page.evaluate(() => scrollY);
  const listBox = (await list.boundingBox())!;
  const fingerY = Math.min(listBox.y + listBox.height, 824) - 18;
  expect(fingerY - 120).toBeGreaterThan(listBox.y);
  await swipeUp(page, client, listBox.x + listBox.width / 2, fingerY);
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(middle.top + 20);
  expect(Math.abs(await page.evaluate(() => scrollY) - documentMiddle)).toBeLessThanOrEqual(2);

  await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
  const documentAtEnd = await page.evaluate(() => scrollY);
  expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight - scrollY)).toBeGreaterThan(60);
  const endBox = (await list.boundingBox())!;
  await swipeUp(page, client, endBox.x + endBox.width / 2, Math.min(endBox.y + endBox.height, 824) - 18);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(documentAtEnd + 10);

  await positionScrollTarget(page, '#option-categories');
  const categories = page.locator('#option-categories');
  const categoryBox = (await categories.boundingBox())!;
  const categoryBefore = await page.evaluate(() => scrollY);
  const categoryLeft = await categories.evaluate(element => element.scrollLeft);
  await swipeUp(page, client, categoryBox.x + categoryBox.width / 2, categoryBox.y + categoryBox.height / 2);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(categoryBefore + 10);
  expect(await categories.evaluate(element => element.scrollLeft)).toBe(categoryLeft);
  expect(await optionState(page)).toEqual(baseline);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.option-panel').screenshot({ path: testInfo.outputPath('mobile-palette-scroll-chain.png') });
  expect(errors).toEqual([]);
});
