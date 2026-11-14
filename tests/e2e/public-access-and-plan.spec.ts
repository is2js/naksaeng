import { expect, test, type Page } from '@playwright/test';

const sessionKey = 'bunfirvil:household-verification:v1';
const mapId = 'bundang-first-village-55b-prototype';

async function waitForPlayground(page: Page): Promise<void> {
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 60_000 });
  await expect(page.locator('#three-world-canvas')).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

async function changeTestRole(page: Page, role: 'verified' | 'operator'): Promise<void> {
  await page.evaluate(({ key, role }) => {
    sessionStorage.setItem(key, JSON.stringify({
      schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(),
      role, authRevision: 2, scope: 'playground', nickname: role === 'operator' ? '운영 검수' : '회원 검수',
    }));
  }, { key: sessionKey, role });
  if (role === 'verified') await page.goto(`./?map=${mapId}&variant=A`);
  else await page.reload();
  await waitForPlayground(page);
}

test('공개 입장과 회원 전용 기능·체험 평면 안내·공유 제한을 유지한다', async ({ page }, testInfo) => {
  test.setTimeout(process.env.CI ? 360_000 : 180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const endpoint = 'https://script.google.com/macros/s/public-access-smoke/exec';
  let attempts = 0;
  await page.route('**/config/household-verification.v1.json', route => route.fulfill({
    json: { schemaVersion: 1, enabled: true, provider: 'google-apps-script', endpoint, timeoutMs: 8_000 },
  }));
  await page.route(endpoint, async route => {
    attempts++;
    expect(route.request().postDataJSON()).toMatchObject({
      action: 'verifyHousehold', buildingId: '105', unitType: '55B', nickname: '공개 검수',
    });
    if (attempts === 2) { await route.abort('failed'); return; }
    await route.fulfill({ json: {
      schemaVersion: 1, authRevision: 2, ok: true, verified: false,
      operator: false, requested: false, status: 'not_found', scope: 'playground',
    } });
  });

  await test.step('실제 위저드에서 미등록·통신 장애에도 공개 입장하며 입력을 잠그지 않는다', async () => {
    await page.goto('./');
    await page.locator('[data-choose-building="105"]').click();
    await page.locator('.household-cell[data-building="105"][data-floor="19"][data-line="3"]').click();
    const nickname = page.locator('#household-nickname');
    const verify = page.locator('#household-verify-nickname');
    const enter = page.locator('#household-enter');
    await nickname.fill('공개 검수');
    await expect(enter).toBeEnabled();
    await verify.click();
    await expect(page.locator('#household-nickname-status')).toContainText('등록된 회원 정보를 확인할 수 없습니다');
    await expect(nickname).toBeEnabled();
    await expect(verify).toBeEnabled();
    await expect(page.locator('#household-request-verification')).toBeEnabled();
    await expect(enter).toBeEnabled();
    await nickname.press('Enter');
    await expect(page.locator('#household-nickname-status')).toContainText('회원 인증 서비스를 연결할 수 없습니다');
    await expect(nickname).toBeEnabled();
    await expect(verify).toBeEnabled();
    await expect(enter).toBeEnabled();
    await expect(page.locator('#household-selection-dock')).toHaveAttribute('data-entry-role', 'public');
    await enter.click();
    await waitForPlayground(page);
    const session = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key) || '{}'), sessionKey);
    expect(session).toMatchObject({ role: 'public', scope: 'playground', nickname: '공개 검수' });
    expect(session).not.toHaveProperty('buildingId');
    expect(session).not.toHaveProperty('unitType');
    await expect(page.locator('#game-stage')).toHaveAttribute('data-access-role', 'public');
    expect(attempts).toBe(2);
  });

  await test.step('공개 사용자는 연속된 1·2·3번 슬롯을 쓰며 회원 전용 평면·변신은 사용할 수 없다', async () => {
    const stage = page.locator('#game-stage');
    const slots = page.locator('#hotbar [data-slot]');
    const furnitureTab = page.locator('[data-palette-tab="furniture"]');
    await expect(furnitureTab).toBeHidden();
    expect(await slots.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-slot')))).toEqual(['0', '1', '2']);
    const children = page.locator('#hotbar [data-slot="2"][data-hotbar-action="showcase-children"]');
    await expect(children.locator('.slot-number')).toHaveText('3');
    const variant = await stage.getAttribute('data-plan-variant');
    await stage.focus();
    await page.keyboard.press('3');
    await expect(page.locator('.child-companion-dialog')).toBeVisible();
    await page.locator('.child-companion-dialog [data-child-action="close"]').click();
    await children.click();
    await expect(page.locator('.child-companion-dialog')).toBeVisible();
    await page.locator('.child-companion-dialog [data-child-action="close"]').click();
    await stage.focus();
    await page.keyboard.press('4');
    await page.keyboard.press('5');
    await expect(page.locator('.child-companion-dialog')).toHaveCount(0);
    await expect(stage).toHaveAttribute('data-plan-variant', variant!);
    await expect(page.locator('.rpg-actor--100')).not.toHaveAttribute('data-transformation', /.+/);
    // Dispatch directly as well: hiding the tab alone is not an authorization guard.
    await furnitureTab.evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await expect(page.locator('#furniture-palette-body')).toBeHidden();
    await expect(page.locator('#option-palette-body')).toBeVisible();
    await page.locator('input[data-option-id="wide-plank-floor-finish"]').check({ force: true });
    await expect(page.locator('#option-selected-count')).toHaveText('1개');
    await page.locator('#open-sale-calculator').click();
    await expect(page.locator('#sale-calculator-dialog')).toBeVisible();
    await page.locator('#sale-calculator-dialog button[value="cancel"]').click();
    await page.locator('#share-showcase').click();
    await expect(page.locator('#share-link-value')).toHaveValue(/#share=v1\./);
    await page.locator('#share-dialog').getByRole('button', { name: '닫기' }).click();
    await expectNoHorizontalOverflow(page);
    await page.setViewportSize({ width: 390, height: 844 });
    // A width-only resize deliberately retains the current camera. Reload to
    // exercise the actual mobile initial/reset zoom rather than that retention.
    await page.reload();
    await waitForPlayground(page);
    await expectNoHorizontalOverflow(page);
    await expect(slots).toHaveCount(3);
    await expect(children.locator('.slot-number')).toHaveText('3');
    await expect(page.locator('#zoom-value')).toHaveText('65%');
    for (let index = 0; index < 5; index++) await page.locator('#zoom-out').click();
    await expect(page.locator('#zoom-value')).toHaveText('40%');
    await page.locator('#zoom-out').click();
    await expect(page.locator('#zoom-value')).toHaveText('40%');
    await page.locator('#zoom-reset').click();
    await expect(page.locator('#zoom-value')).toHaveText('65%');
    await page.screenshot({ path: testInfo.outputPath('public-mobile.png') });

    await page.locator('#touch-laser-toggle').click();
    const hud = page.locator('#inspection-laser-hud');
    await expect(hud).toBeVisible();
    // The first-use notice reserves a temporary top row for exactly three
    // seconds. Permanent compact HUD positions resume immediately afterwards.
    await expect(page.locator('#inspection-laser-reference-notice')).toBeHidden();
    await expect(hud).toHaveCSS('top', '8px');
    const stageBox = (await stage.boundingBox())!;
    const hudBox = (await hud.boundingBox())!;
    expect(hudBox.height).toBeLessThanOrEqual(120);
    expect(hudBox.y - stageBox.y).toBeGreaterThanOrEqual(0);
    expect(hudBox.y - stageBox.y).toBeLessThanOrEqual(12);
    expect(hudBox.x).toBeGreaterThanOrEqual(stageBox.x);
    expect(hudBox.x + hudBox.width).toBeLessThanOrEqual(stageBox.x + stageBox.width);
    for (const selector of ['.floorplan-minimap', '.stage-zoom']) {
      const reserved = (await page.locator(selector).boundingBox())!;
      const overlap = hudBox.x < reserved.x + reserved.width && hudBox.x + hudBox.width > reserved.x
        && hudBox.y < reserved.y + reserved.height && hudBox.y + hudBox.height > reserved.y;
      expect(overlap, `mobile HUD overlaps ${selector}`).toBe(false);
      await expect(page.locator(selector)).toBeVisible();
    }
    await page.locator('#inspection-laser-point-mode').click();
    await expect(page.locator('#inspection-laser-point-mode')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#inspection-laser-line-snap').click();
    await expect(page.locator('#inspection-laser-line-snap')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#touch-laser-axis').click();
    const actionSizes = await hud.locator('.istarpark-laser-actions button').evaluateAll(buttons =>
      buttons.map(button => ({ height: button.getBoundingClientRect().height, fontSize: parseFloat(getComputedStyle(button).fontSize) })));
    expect(actionSizes).toHaveLength(4);
    expect(actionSizes.every(({ height, fontSize }) => height >= 32 && fontSize >= 11)).toBe(true);
    expect((await hud.boundingBox())!.height).toBeLessThanOrEqual(120);
    await stage.screenshot({ path: testInfo.outputPath('public-mobile-laser.png') });
    await page.locator('#touch-laser-toggle').click();
    await expect(hud).toBeHidden();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await stage.focus();
    await page.keyboard.press('j');
    await expect(hud).toBeVisible();
    await expect(hud).toHaveCSS('top', '76px');
    await stage.screenshot({ path: testInfo.outputPath('public-desktop-laser.png') });
    await page.keyboard.press('Escape');
    await expect(hud).toBeHidden();
  });

  let sharedUrl = '';
  await test.step('인증 회원은 5개 슬롯과 55B A→B→C→D 전환·중앙 안내를 사용한다', async () => {
    await changeTestRole(page, 'verified');
    const stage = page.locator('#game-stage');
    const notice = page.locator('#plan-experience-notice');
    const switchPlan = page.locator('#hotbar [data-slot="2"]');
    await expect(stage).toHaveAttribute('data-access-role', 'verified');
    await expect(page.locator('[data-palette-tab="furniture"]')).toBeVisible();
    await expect(page.locator('#hotbar [data-slot]')).toHaveCount(5);
    await expect(stage).toHaveAttribute('data-plan-variant', 'A');
    await switchPlan.click();
    await expect(stage).toHaveAttribute('data-plan-variant', 'B');
    await waitForPlayground(page);
    await expect(notice).toBeHidden();
    // The real notice lasts five seconds. Slow software WebGL can spend that
    // entire window on subsequent browser round trips, so observe its actual
    // visible transition before clicking, and capture both rects/text together.
    await page.evaluate(() => {
      const stage = document.querySelector<HTMLElement>('#game-stage')!;
      const notice = document.querySelector<HTMLElement>('#plan-experience-notice')!;
      const observer = new MutationObserver(() => {
        const variant = stage.dataset.planVariant;
        if (notice.hidden || (variant !== 'C' && variant !== 'D')) return;
        const style = getComputedStyle(notice);
        const stageRect = stage.getBoundingClientRect();
        const noticeRect = notice.getBoundingClientRect();
        notice.setAttribute(`data-smoke-observed-${variant.toLowerCase()}`, JSON.stringify({
          variant,
          experienceOnly: stage.dataset.experienceOnly,
          text: notice.textContent,
          visible: style.display !== 'none' && style.visibility !== 'hidden'
            && Number(style.opacity) > 0 && noticeRect.width > 0 && noticeRect.height > 0,
          centerDeltaX: Math.abs(noticeRect.x + noticeRect.width / 2 - stageRect.x - stageRect.width / 2),
          centerDeltaY: Math.abs(noticeRect.y + noticeRect.height / 2 - stageRect.y - stageRect.height / 2),
        }));
        if (variant === 'D') observer.disconnect();
      });
      observer.observe(notice, { attributes: true, attributeFilter: ['hidden'], childList: true, characterData: true, subtree: true });
    });
    const expectObservedNotice = async (variant: 'C' | 'D'): Promise<void> => {
      const attribute = `data-smoke-observed-${variant.toLowerCase()}`;
      await expect.poll(() => notice.getAttribute(attribute)).not.toBeNull();
      const observed = JSON.parse((await notice.getAttribute(attribute))!) as {
        variant: string; experienceOnly: string; text: string; visible: boolean;
        centerDeltaX: number; centerDeltaY: number;
      };
      expect(observed).toMatchObject({
        variant, experienceOnly: 'true', visible: true,
        text: '선택한 세대의 실제 배치와 다를 수 있는 체험용 평면입니다.',
      });
      expect(observed.centerDeltaX).toBeLessThan(3);
      expect(observed.centerDeltaY).toBeLessThan(3);
    };
    await switchPlan.click();
    await expect(stage).toHaveAttribute('data-plan-variant', 'C');
    await waitForPlayground(page);
    await expect(stage).toHaveAttribute('data-experience-only', 'true');
    await expectObservedNotice('C');
    await switchPlan.click();
    await expect(stage).toHaveAttribute('data-plan-variant', 'D');
    await waitForPlayground(page);
    await expectObservedNotice('D');
    await expect(page.locator('#option-selected-count')).toHaveText('1개');
    await stage.screenshot({ path: testInfo.outputPath('verified-55b-d.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
    await expect(page.locator('#hotbar [data-slot]')).toHaveCount(5);
    await expect(page.locator('#hotbar [data-slot="4"] .slot-number')).toHaveText('5');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('#share-showcase').click();
    sharedUrl = await page.locator('#share-link-value').inputValue();
    await page.locator('#share-dialog').getByRole('button', { name: '닫기' }).click();
  });

  await test.step('운영자 관리 기능은 유지되며 운영자도 공유 화면은 수정할 수 없다', async () => {
    await changeTestRole(page, 'operator');
    await expect(page.locator('#game-stage')).toHaveAttribute('data-access-role', 'operator');
    await expect(page.getByRole('link', { name: '검수맵 관리', exact: true })).toBeVisible();
    await expect(page.locator('.control-deck')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.goto(sharedUrl);
    await waitForPlayground(page);
    const stage = page.locator('#game-stage');
    await expect(page.locator('.share-readonly-banner')).toBeVisible();
    await expect(page.locator('#map-title')).toHaveText('회원 검수님의 55B타입 공유 놀이터');
    await expect(page.locator('#palette-applied-only')).toBeHidden();
    await expect(page.locator('#open-storage-manager')).toBeHidden();
    await expect(page.locator('#open-sale-calculator')).toBeDisabled();
    await expect(page.locator('.control-deck')).toBeHidden();
    await expect(page.locator('#hotbar [data-slot="0"]')).toBeEnabled();
    for (const slot of ['1', '2', '3', '4']) {
      await expect(page.locator(`#hotbar [data-slot="${slot}"]`)).toBeDisabled();
    }
    await expect(page.locator('input[data-option-id="wide-plank-floor-finish"]')).toBeDisabled();
    await stage.focus();
    await page.keyboard.press('3');
    await page.keyboard.press('4');
    await expect(stage).toHaveAttribute('data-plan-variant', 'D');
    await expect(page.locator('.rpg-actor--100')).not.toHaveAttribute('data-transformation', /.+/);
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
});
