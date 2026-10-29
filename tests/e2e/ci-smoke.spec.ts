import { expect, test } from '@playwright/test';

const MAPS = [
  ['bundang-first-village-51a-prototype', '51A'],
  ['bundang-first-village-55a-prototype', '55A'],
  ['bundang-first-village-55b-prototype', '55B'],
  ['bundang-first-village-59a-prototype', '59A'],
] as const;

test('smokes household selection, deployed maps, read-only sharing, living-room spawn, and option palette', async ({ page, context }) => {
  const forbiddenRequests: string[] = [];
  const consoleErrors: string[] = [];
  let verificationMode: 'match' | 'mismatch' | 'error' = 'match';
  await page.route('**/config/household-verification.v1.json', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 1,
        enabled: true,
        provider: 'google-apps-script',
        endpoint: 'https://script.google.com/macros/s/mock-bunfirvil-verification/exec',
        timeoutMs: 8_000,
      }),
    });
  });
  await page.route('https://script.google.com/macros/s/mock-bunfirvil-verification/exec', async (route) => {
    if (verificationMode === 'error') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ schemaVersion: 1, ok: false, verified: false, code: 'service_unavailable' }),
      });
      return;
    }
    const request = JSON.parse(route.request().postData() || '{}') as Record<string, unknown>;
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['content-type']).toContain('text/plain');
    expect(request).toMatchObject({ schemaVersion: 1, buildingId: '105' });
    expect(['verifyHousehold', 'verifyShareViewer']).toContain(request.action);
    if (request.action === 'verifyShareViewer') expect(request.unitType).toBe('');
    else expect(['51A', '59A']).toContain(request.unitType);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 1,
        ok: true,
        authRevision: 2,
        operatorVerified: verificationMode === 'match',
        scope: request.action === 'verifyShareViewer' ? 'share' : 'playground',
        verified: verificationMode === 'match',
        operator: verificationMode === 'match',
        requested: false,
        status: verificationMode === 'match' ? 'operator' : 'not_found',
      }),
    });
  });
  page.on('request', (request) => {
    const url = request.url();
    if (/^wss?:/i.test(url) || /socket\.io/i.test(url) || new URL(url).pathname.includes('/api/')) forbiddenRequests.push(url);
  });
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.setViewportSize({ width: 390, height: 844 });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:4173' });
  await page.goto('./');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://is2js.github.io/naksaeng/bunfirvil/og-playground-v3.jpg');
  const previewResponse = await page.request.get('og-playground-v3.jpg');
  expect(previewResponse.ok()).toBe(true);
  expect(previewResponse.headers()['content-type']).toContain('image/jpeg');
  await expect(page.getByRole('heading', { name: '분당퍼스트빌리지 동 선택' })).toBeVisible();
  await expect(page.locator('.household-selector-shell > .topbar')).toBeVisible();
  await expect(page.locator('.household-selector-shell > .serverless-banner')).toBeVisible();
  await expect(page.locator('.household-topbar').getByRole('link', { name: '전체 동·호 현황' })).toHaveCount(0);
  await expect(page.locator('.household-topbar').getByRole('button', { name: '저장 관리' })).toBeVisible();
  await expect(page.locator('.household-building-choice')).toHaveCount(12);
  await expect(page.locator('#household-step-building')).toHaveAttribute('aria-current', 'step');
  await expect.poll(async () => page.locator('.household-building-picker').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(3);
  expect((await page.locator('.household-building-choice').first().boundingBox())!.height).toBeGreaterThanOrEqual(48);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('[data-choose-building="105"]').click();
  expect(await page.locator('.household-building-row.is-single .household-cell[data-floor="25"]').first().evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(9.5);
  const mobileHouseholdBox = (await page.locator('.household-building-row.is-single .household-cell[data-floor="25"]').first().boundingBox())!;
  expect(mobileHouseholdBox.width).toBeLessThanOrEqual(46);
  expect(mobileHouseholdBox.height).toBeGreaterThanOrEqual(22);
  await page.locator('#household-step-building').click();
  await expect(page.getByRole('heading', { name: '분당퍼스트빌리지 동 선택' })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect.poll(async () => page.locator('.household-building-picker').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(4);
  expect((await page.locator('.household-building-choice').first().boundingBox())!.height).toBeLessThanOrEqual(72);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => sessionStorage.setItem('bunfirvil:household-verification:v1', JSON.stringify({
    schemaVersion: 1,
    provider: 'google-apps-script',
    verifiedAt: Date.now(),
    role: 'operator',
    authRevision: 2,
    scope: 'playground',
  })));
  await page.goto('./households/');
  await expect(page.getByRole('heading', { name: '분당퍼스트빌리지 전체 동·호 현황' })).toBeVisible();
  await expect(page.locator('.household-overview-shell > .topbar')).toBeVisible();
  await expect(page.locator('.household-building-row').first().locator('.household-building-card')).toHaveCount(3);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator('.household-building-row').first().locator('.household-building-card')).toHaveCount(3);
  await page.evaluate(() => sessionStorage.removeItem('bunfirvil:household-verification:v1'));
  await page.goto('./');
  await page.locator('[data-choose-building="105"]').click();
  await expect(page.getByRole('heading', { name: '105동 세대 선택' })).toBeVisible();
  await expect(page.locator('#household-step-unit')).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('#household-selected-building')).toHaveText('105동 선택됨');
  await expect(page.locator('.household-building-row.is-single .household-building-card')).toHaveCount(1);
  expect(await page.locator('.household-building-row.is-single .household-cell[data-floor="25"]').first().evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(11);
  const desktopHouseholdBox = (await page.locator('.household-building-row.is-single .household-cell[data-floor="25"]').first().boundingBox())!;
  expect(desktopHouseholdBox.width).toBeLessThanOrEqual(60);
  expect(desktopHouseholdBox.height).toBeGreaterThanOrEqual(24);
  expect(await page.locator('.household-building-row.is-single .household-building-card footer span').first().evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(10);
  await page.getByRole('button', { name: '동 다시 선택' }).click();
  await expect(page.getByRole('heading', { name: '분당퍼스트빌리지 동 선택' })).toBeVisible();
  await expect(page.locator('[data-choose-building="105"]')).toHaveClass(/is-selected/);
  await page.locator('[data-choose-building="105"]').click();
  const household = page.locator('.household-cell[data-building="105"][data-floor="25"][data-line="1"]');
  await household.click();
  await expect(household).toHaveClass(/is-selected/);
  await expect(page.locator('#household-building-detail')).toBeHidden();
  await expect(page.locator('#household-nickname-stage')).toBeVisible();
  await expect(page.locator('#household-nickname-stage').getByRole('heading', { name: '닉네임 입력' })).toHaveCount(1);
  await expect(page.locator('#household-step-nickname')).toHaveAttribute('aria-current', 'step');
  await page.getByRole('button', { name: '세대 다시 선택' }).click();
  await expect(page.getByRole('heading', { name: '105동 세대 선택' })).toBeVisible();
  await expect(page.locator('#household-building-detail')).toBeVisible();
  await household.click();
  await expect(page.locator('#household-selection-dock')).toBeVisible();
  await expect(page.locator('#household-enter')).toBeDisabled();
  await expect(page.getByRole('button', { name: '해당 닉네임으로 등록 요청' })).toBeVisible();
  verificationMode = 'error';
  await page.getByPlaceholder('닉네임 입력').fill('통신오류');
  await page.getByRole('button', { name: '인증 확인' }).click();
  await expect(page.locator('#household-nickname-status')).toHaveText('인증 서비스를 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
  await expect(page.locator('#household-enter')).toBeDisabled();
  verificationMode = 'mismatch';
  await page.getByPlaceholder('닉네임 입력').fill('잘못된닉네임');
  await page.getByRole('button', { name: '인증 확인' }).click();
  await expect(page.locator('#household-nickname-status')).toHaveText('선택한 동·타입과 닉네임을 확인할 수 없습니다.');
  await expect(page.locator('#household-enter')).toBeDisabled();
  verificationMode = 'match';
  await page.getByPlaceholder('닉네임 입력').fill('돌범이웃');
  await expect(page.locator('#household-selection-summary')).toHaveText('105동 2501호 · 25층 · 51A · 돌범이웃 · 남동향');
  await expect(page.locator('#household-selection-summary')).not.toContainText('A형');
  await page.getByRole('button', { name: '인증 확인' }).click();
  await expect(page.locator('#household-nickname-stage')).toBeVisible();
  await expect(page.locator('#household-nickname-status')).toHaveText('운영자 인증이 완료되었습니다. 관리 메뉴를 사용할 수 있습니다.');
  await expect(page.getByPlaceholder('닉네임 입력')).toBeDisabled();
  await expect(page.locator('#household-verify-nickname')).toBeDisabled();
  await expect(page.locator('#household-request-verification')).toBeDisabled();
  await expect(page.locator('#household-selection-dock')).toBeVisible();
  await expect(page.locator('#household-selection-dock')).toHaveClass(/is-authenticated/);
  await expect(page.getByRole('button', { name: '놀이터 입장' })).toBeEnabled();
  await page.getByRole('button', { name: '놀이터 입장' }).click();
  await expect(page).toHaveURL(/map=bundang-first-village-51a-prototype/);
  await expect(page).toHaveURL(/variant=A/);
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 30_000 });
  expect(await page.evaluate(() => {
    const parsed = JSON.parse(sessionStorage.getItem('bunfirvil:household-verification:v1') || '{}') as Record<string, unknown>;
    return { keys: Object.keys(parsed).sort(), schemaVersion: parsed.schemaVersion, provider: parsed.provider };
  })).toEqual({ keys: ['authRevision', 'nickname', 'provider', 'role', 'schemaVersion', 'scope', 'verifiedAt'], schemaVersion: 1, provider: 'google-apps-script' });

  await page.evaluate(() => sessionStorage.removeItem('bunfirvil:household-verification:v1'));
  await page.goto('./?map=bundang-first-village-55b-prototype&actor=200&variant=B');
  await expect(page.getByRole('heading', { name: '분당퍼스트빌리지 동 선택' })).toBeVisible();
  await page.locator('[data-choose-building="105"]').click();
  await page.locator('.household-cell[data-building="105"][data-floor="25"][data-line="1"]').click();
  await page.getByPlaceholder('닉네임 입력').fill('돌범이웃');
  await page.getByRole('button', { name: '인증 확인' }).click();
  await expect(page.locator('#household-nickname-status')).toHaveText('운영자 인증이 완료되었습니다. 관리 메뉴를 사용할 수 있습니다.');
  await page.getByRole('button', { name: '놀이터 입장' }).click();
  await expect(page).toHaveURL(/map=bundang-first-village-55b-prototype/);
  await expect(page).toHaveURL(/actor=200/);
  await expect(page).toHaveURL(/variant=B/);
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 30_000 });
  await page.reload();
  await expect(page.locator('#household-nickname-stage')).toHaveCount(0);
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 30_000 });

  const mapSelect = page.getByLabel('검수맵 선택');
  for (const [mapId, unitType] of MAPS) {
    await mapSelect.selectOption(mapId);
    await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 30_000 });
    await expect(page.locator('#map-unit')).toHaveText(unitType);
    await expect(page.locator('#metric-chunks')).toHaveText('16/16');
    await expect(page.locator('#game-stage')).toHaveAttribute('data-actor-spawn-room', 'living');
  }

  await page.locator('#share-showcase').click();
  await expect(page.locator('#share-dialog')).toContainText('닉네임');
  await page.locator('#share-link-copy').click();
  await expect(page.locator('#toast')).toContainText('읽기 전용 공유 링크를 복사했습니다.');
  const sharedUrl = await page.evaluate(() => navigator.clipboard.readText());
  expect(sharedUrl).toMatch(/\?map=bundang-first-village-59a-prototype&variant=B#share=v1\./);
  expect(sharedUrl).not.toMatch(/actor=|nickname|household|operator/);
  await page.evaluate(() => sessionStorage.removeItem('bunfirvil:household-verification:v1'));
  // Invalid shares must fail before authentication or loading a game scene.
  await page.goto('./#share=v1.');
  await expect(page.getByRole('heading', { name: '공유 링크를 열 수 없습니다' })).toBeVisible();
  await expect(page.locator('#household-nickname')).toHaveCount(0);
  await expect(page.locator('#game-stage')).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('bunfirvil:household-verification:v1'))).toBeNull();
  const fragmentOnlyUrl = new URL(sharedUrl);
  fragmentOnlyUrl.search = '';
  await page.goto(fragmentOnlyUrl.toString());
  await expect(page.getByRole('heading', { name: '분당퍼스트빌리지 동 선택' })).toBeVisible();
  await expect(page.locator('#household-step-unit')).toHaveCount(0);
  await page.locator('[data-choose-building="105"]').click();
  await expect(page.locator('#household-building-detail')).toBeHidden();
  await expect(page.locator('#household-nickname-stage')).toBeVisible();
  await page.getByPlaceholder('닉네임 입력').fill('돌범이웃');
  await page.getByRole('button', { name: '인증 확인' }).click();
  await page.getByRole('button', { name: '공유 놀이터 열람' }).click();
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 30_000 });
  await expect(page.locator('.share-readonly-banner')).toBeVisible();
  await expect(page.locator('#map-title')).toHaveText('돌범이웃님의 59A타입 공유 놀이터');
  await expect(page.locator('#map-revision')).toHaveText('공유 놀이터는 수정 불가입니다.');
  await expect(page.locator('#plan-variant-badge')).toHaveText(/남동향|남서향/);
  await expect(page.locator('#open-storage-manager')).toBeHidden();
  await expect(page.locator('#palette-applied-only')).toBeHidden();
  await expect(page.locator('#palette-view-label')).toContainText('적용 옵션');
  await expect(page.locator('.hotbar-slot').nth(0)).toBeEnabled();
  await expect(page.locator('.hotbar-slot').nth(1)).toBeDisabled();
  await expect(page.locator('.hotbar-slot').nth(2)).toBeDisabled();
  await expect(page.locator('.hotbar-slot').nth(3)).toBeDisabled();

  await expect(page.locator('.rpg-actor')).toHaveCount(2);
  await expect(page.locator('#option-categories').getByRole('button', { name: '전체', exact: true })).toBeVisible();
  await expect(page.locator('#option-list .option-card input:not(:disabled)')).toHaveCount(0);
  expect((await page.locator('#option-total').innerText()).replace(/\s/g, '')).toMatch(/^\d{1,3}(,\d{3})*원$/);
  expect(await page.locator('.stage-tip').evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(10);

  const laserToggle = page.locator('#inspection-laser-toggle');
  await expect(laserToggle).toBeAttached();
  await expect(page.locator('#inspection-laser-point-mode')).toBeAttached();
  if (await laserToggle.isVisible()) {
    await mapSelect.evaluate((element) => (element as HTMLSelectElement).blur());
    await page.keyboard.press('KeyJ');
    await expect(page.locator('#game-stage')).toHaveAttribute('data-istarpark-laser-active', 'true');
    await expect(page.locator('#inspection-laser-phase')).toHaveText('자동');
    await page.keyboard.press('KeyJ');
    await expect(page.locator('#inspection-laser-phase')).toHaveText('시작점');
    await expect(page.locator('#inspection-laser-point-mode')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('KeyJ');
    await expect(page.locator('#inspection-laser-phase')).toHaveText('자동');
    await page.keyboard.press('Escape');
    await expect(page.locator('#game-stage')).not.toHaveAttribute('data-istarpark-laser-active', 'true');
    await expect(page.locator('#inspection-laser-hud')).toBeHidden();
  }

  await page.goto('manage/');
  await expect(page.locator('#loadingState')).toBeHidden();
  await expect(page.locator('.map-card')).toHaveCount(4);
  await page.goto('./?map=bundang-first-village-55a-prototype&actor=100&variant=A');
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 30_000 });
  await page.locator('#choose-household').click();
  await expect(page.getByRole('heading', { name: '분당퍼스트빌리지 동 선택' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('bunfirvil:household-verification:v1'))).toBeNull();
  expect(forbiddenRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
