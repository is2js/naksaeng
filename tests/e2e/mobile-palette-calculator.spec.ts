import { expect, test, type Locator, type Page } from '@playwright/test';

test.use({ hasTouch: true });

async function mobileControlLayout(page: Page) {
  return page.evaluate(() => {
    const box = (element: Element) => {
      const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
      return { left, top, right, bottom, width, height };
    };
    const stage = document.querySelector('#game-stage')!;
    const options = document.querySelector('#mobile-stage-options')!;
    const chips = options.querySelector<HTMLElement>('#stage-option-chips')!;
    return {
      stage: box(stage), options: box(options), pad: box(document.querySelector('.touch-move-pad')!),
      laser: box(document.querySelector('#touch-laser-toggle')!),
      direction: getComputedStyle(chips).flexDirection, wrap: getComputedStyle(chips).flexWrap,
      scrollHeight: chips.scrollHeight, clientHeight: chips.clientHeight, scrollTop: chips.scrollTop,
      rows: Array.from(chips.querySelectorAll('.stage-option-chip')).map(chip => ({
        ...box(chip), buttonHeight: chip.querySelector('button')!.getBoundingClientRect().height,
        fontSize: parseFloat(getComputedStyle(chip.querySelector('b')!).fontSize),
      })),
    };
  });
}

function expectMobileControlPlacement(layout: Awaited<ReturnType<typeof mobileControlLayout>>) {
  // Reserve one narrow right-hand rail for the joystick and the laser below
  // it. Options stay beside it, never above/between the actual touch targets.
  expect(layout.options.right + 8).toBeLessThanOrEqual(layout.pad.left);
  expect(layout.pad.bottom + 6).toBeLessThanOrEqual(layout.laser.top);
  expect(Math.abs((layout.pad.left + layout.pad.right - layout.laser.left - layout.laser.right) / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs(layout.options.bottom - layout.laser.bottom)).toBeLessThanOrEqual(2);
  expect(layout.options.left - layout.stage.left).toBeGreaterThanOrEqual(7);
  expect(layout.options.left - layout.stage.left).toBeLessThanOrEqual(10);
  expect(layout.stage.bottom - layout.options.bottom).toBeGreaterThanOrEqual(80);
  expect(layout.stage.bottom - layout.options.bottom).toBeLessThanOrEqual(85);
  expect(layout.options.width).toBeLessThanOrEqual(261);
  expect(layout.options.left).toBeGreaterThanOrEqual(layout.stage.left);
  expect(layout.pad.right).toBeLessThanOrEqual(layout.stage.right);
  expect(layout.laser.height).toBeGreaterThanOrEqual(40);
  expect(layout.direction).toBe('row');
  expect(layout.wrap).toBe('wrap');
  for (const row of layout.rows) {
    expect(row.buttonHeight).toBeGreaterThanOrEqual(32);
    expect(row.fontSize).toBeGreaterThanOrEqual(9);
    expect(row.fontSize).toBeLessThanOrEqual(10);
    expect(row.width).toBeLessThanOrEqual(layout.options.width);
  }
  for (let index = 1; index < layout.rows.length; index++) {
    const previous = layout.rows[index - 1], current = layout.rows[index];
    if (Math.abs(current.top - previous.top) <= 1) {
      expect(current.left).toBeGreaterThanOrEqual(previous.right + 2);
    } else expect(current.top).toBeGreaterThanOrEqual(previous.bottom + 2);
  }
}

async function expectNameEllipsis(button: Locator, fullName: string, mustClip = true) {
  await expect(button).toHaveAttribute('aria-label', `${fullName} 인게임 구성 선택`);
  await expect(button.locator('b')).toHaveText(fullName);
  const name = await button.locator('b').evaluate(element => ({
    ellipsis: getComputedStyle(element).textOverflow, whiteSpace: getComputedStyle(element).whiteSpace,
    overflow: getComputedStyle(element).overflowX, scrollWidth: element.scrollWidth, width: element.clientWidth,
  }));
  expect(name.ellipsis).toBe('ellipsis');
  expect(name.whiteSpace).toBe('nowrap');
  expect(name.overflow).toBe('hidden');
  if (mustClip) expect(name.scrollWidth).toBeGreaterThan(name.width);
}

test('모바일 이름 칩은 맵 선택과 연결되고 계산기는 팔레트 합계 아래에만 남는다', async ({ page, context }) => {
  test.setTimeout(process.env.CI ? 300_000 : 180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    sessionStorage.setItem('bunfirvil:household-verification:v1', JSON.stringify({
      schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(), role: 'verified', memberCodeRevision: 1,
      authRevision: 2, scope: 'playground', nickname: '모바일 확인',
    }));
    if (!sessionStorage.getItem('bunfirvil:sale-calculator:v1')) sessionStorage.setItem('bunfirvil:sale-calculator:v1', JSON.stringify({
      schemaVersion: 1, unitType: '55A', priceFloorBand: '5+',
    }));
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./?map=bundang-first-village-55a-prototype&variant=A');
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 45_000 });
  const button = page.locator('#open-sale-calculator');
  const mobileOptions = page.locator('#mobile-stage-options');
  const chips = page.locator('#stage-option-chips');
  await chips.evaluate(element => { (element as HTMLElement).dataset.identityToken = 'same-chips'; });
  await expect(page.locator('.stage-option-quote')).toBeHidden();
  await expect(mobileOptions).toBeHidden();
  expect((await page.locator('#game-stage').boundingBox())!.height).toBeGreaterThanOrEqual(600);
  await expect(page.locator('#mobile-palette-calculator #open-sale-calculator')).toHaveCount(1);
  await expect(button).toBeEnabled(); // Basic finish still supports calculating.
  expect((await page.locator('#option-list').boundingBox())!.height).toBeGreaterThanOrEqual(350);
  expect((await page.locator('.option-storage-note').innerText()).trim()).toBe('가상 공간의 옵션 디자인·색상·배치는 실제 시공과 다를 수 있습니다.');
  await expect(page.locator('.option-storage-description')).toBeHidden();
  await expect(page.locator('.option-design-reference')).toBeHidden();
  await page.locator('input[data-option-id="wide-plank-floor-finish"]').check({ force: true });
  await expect(page.locator('#option-selected-count')).toHaveText('1개');
  await expect(page.locator('#option-total')).toContainText('1,820,000');
  await page.locator('[data-option-category="전체"]').click();
  await page.locator('input[data-option-id="entry-pantry-system-shelf"]').check({ force: true });
  await expect(mobileOptions).toBeVisible();
  await expect(page.locator('#mobile-stage-options #stage-option-chips')).toHaveAttribute('data-identity-token', 'same-chips');
  await expect(mobileOptions.locator('.stage-option-chip')).toHaveCount(2);
  expect(await mobileOptions.innerText()).not.toMatch(/원|감액|×/);
  await expect(mobileOptions.locator('em').first()).toBeHidden();
  await expect(mobileOptions.locator('.stage-option-remove').first()).toBeHidden();
  expect(await mobileOptions.locator('.stage-option-chip').nth(1).evaluate(element => getComputedStyle(element, '::before').content)).toContain('+');
  const pantry = mobileOptions.locator('button[data-stage-option-select="entry-pantry-system-shelf"]');
  const pantryFullName = (await pantry.locator('b').textContent())!;
  await expect(pantry).toHaveAccessibleName(`${pantryFullName} 인게임 구성 선택`);
  await pantry.tap();
  await expect(mobileOptions.locator('.stage-option-chip[data-stage-option-select="entry-pantry-system-shelf"]')).toHaveClass(/is-world-selected/);
  await expect(page.locator('[data-option-card-id="entry-pantry-system-shelf"]')).toHaveClass(/is-world-linked/);
  await expect(page.locator('#three-world-canvas')).toHaveAttribute('data-selected-editor-mask', 'rpg-gold');
  const label = (await page.locator('#furniture-selection-toolbar').boundingBox())!;
  const mapBounds = (await page.locator('#game-stage').boundingBox())!;
  expect(label.x).toBeGreaterThanOrEqual(mapBounds.x);
  expect(label.x + label.width).toBeLessThanOrEqual(mapBounds.x + mapBounds.width);
  for (const viewport of [
    { width: 320, height: 740 }, { width: 390, height: 844 },
    { width: 430, height: 932 }, { width: 768, height: 1024 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(mobileOptions).toBeVisible();
    await expect(page.locator('.stage-option-quote')).toBeHidden();
    await expect.poll(async () => (await mobileControlLayout(page)).direction).toBe('row');
    expectMobileControlPlacement(await mobileControlLayout(page));
    const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll('body *')].flatMap(element => {
        const rect = element.getBoundingClientRect();
        return rect.right > innerWidth + 1 && getComputedStyle(element).visibility !== 'hidden'
          ? [{ tag: element.tagName, id: element.id, className: element.className?.toString(), right: rect.right, width: rect.width }] : [];
      }).slice(0, 16) }));
    expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width);
    await page.locator('#game-stage').screenshot({ path: `test-results/mobile-controls-${viewport.width}.png` });
    if (viewport.width === 768) expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
  }
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(pantry).toBeVisible();
  await expect(mobileOptions.locator('.stage-option-chip[data-stage-option-select="entry-pantry-system-shelf"]')).toHaveClass(/is-world-selected/);
  await expect(page.locator('#three-world-canvas')).toHaveAttribute('data-selected-editor-mask', 'rpg-gold');

  // Stress the narrowest viewport using only existing chip DOM: no option, price, saved data
  // or GPU model is selected. Remove the temporary rows before interaction.
  await chips.evaluate(element => {
    const original = element.querySelector('.stage-option-chip')!;
    const cloneWithName = (name: string, sample: string) => {
      const clone = original.cloneNode(true) as HTMLElement;
      clone.dataset.layoutStress = sample;
      clone.setAttribute('aria-hidden', 'true');
      clone.querySelectorAll('button').forEach(button => { button.tabIndex = -1; });
      clone.querySelector('b')!.textContent = name;
      clone.querySelector('.stage-option-select')!.setAttribute('aria-label', `${name} 인게임 구성 선택`);
      return clone;
    };
    element.prepend(cloneWithName('마루', 'short-first'), cloneWithName('중문', 'short-second'));
    for (let index = 0; index < 12; index++) {
      element.append(cloneWithName(`작은 화면 선택 옵션 세로 스크롤 확인 ${index + 1}`, `long-${index}`));
    }
  });
  try {
    const first = (await chips.locator('[data-layout-stress="short-first"]').boundingBox())!;
    const second = (await chips.locator('[data-layout-stress="short-second"]').boundingBox())!;
    expect(Math.abs(first.y - second.y)).toBeLessThanOrEqual(1);
    expect(second.x).toBeGreaterThanOrEqual(first.x + first.width + 2);
    expect(await chips.locator('[data-layout-stress="short-second"]').evaluate(element => getComputedStyle(element, '::before').content)).toContain('+');
    // This real label may fit exactly; only genuinely long names must clip.
    await expectNameEllipsis(pantry, pantryFullName, false);
    await expectNameEllipsis(chips.locator('[data-layout-stress="long-0"] .stage-option-select'), '작은 화면 선택 옵션 세로 스크롤 확인 1');
    const stress = await mobileControlLayout(page);
    expectMobileControlPlacement(stress);
    expect(stress.scrollHeight).toBeGreaterThan(stress.clientHeight);
    expect(stress.clientHeight).toBeLessThanOrEqual(168);
    await chips.evaluate(element => { element.scrollTop = element.scrollHeight; });
    expect((await mobileControlLayout(page)).scrollTop).toBeGreaterThan(0);
  } finally {
    await chips.evaluate(element => {
      element.querySelectorAll('[data-layout-stress]').forEach(clone => clone.remove());
      element.scrollTop = 0;
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(mobileOptions.locator('.stage-option-chip')).toHaveCount(2);
  await expect(page.locator('#mobile-palette-calculator #open-sale-calculator')).toHaveCount(1);
  await page.locator('#touch-laser-toggle').tap();
  await page.locator('#inspection-laser-point-mode').tap();
  await pantry.tap();
  await expect(page.locator('#inspection-laser-phase')).toHaveText('시작점');
  await expect(page.locator('#three-world-canvas')).not.toHaveAttribute('data-inspection-laser-start-point', /.+/);
  await page.locator('#touch-laser-toggle').tap();
  await page.locator('#game-stage').screenshot({ path: 'test-results/mobile-option-names.png' });
  await page.locator('.option-panel').scrollIntoViewIfNeeded();
  const price = (await page.locator('.option-summary .quote-row').boundingBox())!;
  const cta = (await button.boundingBox())!;
  expect(cta.y).toBeGreaterThanOrEqual(price.y + price.height);
  expect(cta.height).toBeGreaterThanOrEqual(54);
  expect(await button.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  const footerBottom = (await page.locator('.option-summary').boundingBox())!;
  await page.locator('#option-list').evaluate(element => { element.scrollTop = element.scrollHeight; });
  expect((await page.locator('.option-summary').boundingBox())!.y).toBeCloseTo(footerBottom.y, 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-palette-calculator.png', fullPage: false });

  await button.evaluate(element => { (element as HTMLElement).dataset.identityToken = 'same-cta'; });
  const client = await context.newCDPSession(page);
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator('.stage-option-quote')).toBeVisible();
  await expect(mobileOptions).toBeHidden();
  await expect(page.locator('.stage-option-content #stage-option-chips')).toHaveAttribute('data-identity-token', 'same-chips');
  await expect(chips.locator('em').first()).toBeVisible();
  await expect(page.locator('.stage-option-footer #open-sale-calculator')).toHaveAttribute('data-identity-token', 'same-cta');
  await expect(page.locator('#mobile-palette-calculator')).toBeHidden();
  await expect(page.locator('.option-storage-description')).toBeVisible();
  await expect(page.locator('.option-design-reference')).toBeVisible();
  const desktopPantry = chips.locator('button[data-stage-option-select="entry-pantry-system-shelf"]');
  await expect(desktopPantry).toHaveAccessibleName(`${pantryFullName} 인게임 구성 선택`);
  await expect(desktopPantry.locator('b')).toHaveText(pantryFullName);
  const desktopLongName = '침실1 파우더 결합형 드레스룸 붙박이장과 의류관리기 결합 구성 전체 이름';
  await chips.evaluate((element, fullName) => {
    const clone = element.querySelector('.stage-option-chip')!.cloneNode(true) as HTMLElement;
    clone.dataset.layoutStress = 'desktop-long';
    clone.querySelector('b')!.textContent = fullName;
    clone.querySelector('.stage-option-select')!.setAttribute('aria-label', `${fullName} 인게임 구성 선택`);
    element.prepend(clone);
  }, desktopLongName);
  try {
    const longChip = chips.locator('[data-layout-stress="desktop-long"]');
    await expectNameEllipsis(longChip.locator('.stage-option-select'), desktopLongName);
    await expect(longChip.locator('em')).toBeVisible();
    await expect(longChip.locator('.stage-option-remove')).toBeVisible();
    const region = await longChip.evaluate(element => {
      const box = (selector: string) => {
        const { left, right, top, bottom } = element.querySelector(selector)!.getBoundingClientRect();
        return { left, right, top, bottom };
      };
      const { left, right, top, bottom } = element.getBoundingClientRect();
      return { chip: { left, right, top, bottom }, name: box('b'), price: box('em'), remove: box('.stage-option-remove') };
    });
    expect(region.price.left).toBeGreaterThanOrEqual(region.name.right);
    expect(region.remove.left).toBeGreaterThanOrEqual(region.price.right);
    for (const part of [region.price, region.remove]) {
      expect(part.left).toBeGreaterThanOrEqual(region.chip.left);
      expect(part.right).toBeLessThanOrEqual(region.chip.right);
      expect(part.top).toBeGreaterThanOrEqual(region.chip.top);
      expect(part.bottom).toBeLessThanOrEqual(region.chip.bottom);
    }
    await page.locator('#game-stage').screenshot({ path: 'test-results/mobile-controls-desktop.png' });
  } finally { await chips.locator('[data-layout-stress]').evaluateAll(elements => elements.forEach(element => element.remove())); }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.stage-option-quote')).toBeHidden();
  await expect(mobileOptions).toBeVisible();
  await expect(page.locator('#mobile-stage-options #stage-option-chips')).toHaveAttribute('data-identity-token', 'same-chips');
  await expect(page.locator('#mobile-palette-calculator #open-sale-calculator')).toHaveAttribute('data-identity-token', 'same-cta');
  await expect(button).toHaveCount(1);
  await button.click();
  await expect(page.locator('#sale-calculator-dialog')).toBeVisible();
  await expect(page.locator('input[name="sale-calculator-route"][value="main-subscription"]')).toBeChecked();
  await page.locator('input[name="sale-calculator-route"][value="pre-subscription"]').check();
  await page.locator('#sale-calculator-dialog button[value="confirm"]').click();
  await expect(page).toHaveURL(/\/calculator\/$/);
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('bunfirvil:sale-calculator:v1') || '{}'));
  expect(saved.optionIds.sort()).toEqual(['wide-plank-floor-finish', 'entry-pantry-system-shelf'].sort());
  expect(saved.applicantRoute).toBe('pre-subscription');
  expect(errors).toEqual([]);
});
