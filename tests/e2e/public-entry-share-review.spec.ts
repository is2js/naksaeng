import { expect, test, type Page } from '@playwright/test';

const sessionKey = 'bunfirvil:household-verification:v1';

async function ready(page: Page) {
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 60_000 });
  await expect(page.locator('#three-world-canvas')).toBeVisible();
}

test('공개 입장 색상과 공개 공유·가이드·읽기전용 저장 보호를 유지한다', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  const endpoint = 'https://script.google.com/macros/s/member-code-smoke/exec';
  const memberCode = 'synthetic-member-code-for-smoke';
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/config/household-verification.v1.json', route => route.fulfill({ json: {
    schemaVersion: 1, enabled: true, provider: 'google-apps-script', endpoint, timeoutMs: 8_000,
  } }));
  await page.route('https://script.google.com/**', route => route.abort());
  await page.route(endpoint, async route => {
    const input = route.request().postDataJSON();
    expect(input.action).toBe('verifyShareViewer');
    expect(input.unitType).toBe('');
    const verified = input.nickname === '열람자' && input.buildingId === '105' && input.memberCode === memberCode;
    await route.fulfill({ json: {
      schemaVersion: 1, authRevision: 2, ok: true, verified, operator: false,
      status: verified ? 'verified' : 'not_found', scope: 'share',
      ...(verified ? { memberCodeVerified: true, memberCodeRevision: 1 } : { code: 'member_code_required' }),
    } });
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (value: string) => { (window as unknown as { copiedShare: string }).copiedShare = value; },
    } });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('./?buildingPicker=cards');
  await page.locator('[data-choose-building="105"]').click();
  await page.locator('.household-cell[data-building="105"][data-floor="19"][data-line="4"]').click();
  const nickname = page.locator('#household-nickname'), enter = page.locator('#household-enter');
  await nickname.fill('공');
  await expect(enter).toBeDisabled();
  await nickname.fill('공개 방문');
  await expect(enter).toBeEnabled();
  await expect(enter).toHaveCSS('background-image', 'none');
  await expect(enter).toHaveCSS('background-color', 'rgb(134, 217, 237)');
  await expect(enter).toHaveCSS('color', 'rgb(17, 40, 61)');
  await enter.hover();
  await expect(enter).toHaveCSS('background-color', 'rgb(164, 232, 247)');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.mouse.move(0, 0);
  await expect(enter).toHaveCSS('background-image', 'none');
  await expect(enter).toHaveCSS('background-color', 'rgb(134, 217, 237)');
  await enter.click();
  await ready(page);
  await expect(page.locator('#game-stage')).toHaveAttribute('data-access-role', 'public');
  await page.getByRole('button', { name: '놀이터 조작법' }).click();
  const guide = page.locator('#help-dialog');
  await expect(guide).toHaveAttribute('data-guide-audience', 'public');
  await expect(guide.locator('article')).toContainText('3 자녀 인형');
  await expect(guide.locator('article')).not.toContainText('회원 4번');
  await guide.getByRole('button', { name: '가이드 닫기' }).click();
  await page.locator('input[data-option-id="wide-plank-floor-finish"]').check({ force: true });
  await expect(page.locator('#option-selected-count')).toHaveText('1개');
  await page.locator('#share-showcase').click();
  const sharedUrl = await page.locator('#share-link-value').inputValue();
  await page.locator('#share-link-copy').click();
  expect(await page.evaluate(() => (window as unknown as { copiedShare: string }).copiedShare)).toBe(sharedUrl);
  await page.locator('#share-dialog').getByRole('button', { name: '닫기' }).click();
  const localBefore = await page.evaluate(() => ({ ...localStorage }));
  await page.evaluate(key => sessionStorage.removeItem(key), sessionKey);
  await page.goto(sharedUrl);
  await page.locator('[data-choose-building="105"]').click();
  await expect(page.locator('#household-nickname')).toBeVisible();
  await expect(page.locator('.household-cell')).toHaveCount(0);
  await expect(page.locator('#selector-open-storage, #selector-storage-dialog, #selector-reset-all')).toHaveCount(0);
  await page.locator('#household-nickname').fill('열람자');
  await page.locator('#household-nickname').press('Enter');
  const code = page.locator('#household-operator-code');
  await expect(code).toBeVisible();
  await expect(page.locator('#household-selection-dock')).toHaveAttribute('data-entry-role', 'public');
  await expect(page.locator('#household-enter')).toBeEnabled();
  await code.fill('incorrect-member-code');
  await code.press('Enter');
  await expect(page.locator('#household-nickname-status')).toContainText('회원 인증코드를 입력');
  await expect(page.locator('#household-selection-dock')).toHaveAttribute('data-entry-role', 'public');
  await code.fill(memberCode);
  await code.press('Enter');
  await expect(page.locator('#household-selection-dock')).toHaveAttribute('data-entry-role', 'verified');
  await expect(page.locator('#household-selection-dock')).toHaveClass(/is-authenticated/);
  await expect(code).toHaveValue('');
  await expect(code).toBeDisabled();
  await page.locator('#household-enter').click();
  await ready(page);
  await expect(page.locator('#map-title')).toHaveText('공개 방문님의 55A타입 공유 놀이터');
  await expect(page.locator('#palette-applied-only')).toBeHidden();
  await expect(page.locator('#open-storage-manager')).toBeHidden();
  await expect(page.locator('#open-sale-calculator')).toBeDisabled();
  await expect(page.locator('input[data-option-id="wide-plank-floor-finish"]')).toBeDisabled();
  await page.getByRole('button', { name: '놀이터 조작법' }).click();
  await expect(guide).toHaveAttribute('data-guide-audience', 'shared');
  await expect(guide.locator('article')).toContainText('읽기 전용');
  await expect(guide.locator('article')).not.toContainText('3 자녀 인형');
  const session = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!), sessionKey);
  expect(session).toMatchObject({ role: 'verified', memberCodeRevision: 1, scope: 'share' });
  expect(session).not.toHaveProperty('memberCode');
  expect(session).not.toHaveProperty('operatorCode');
  expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain(memberCode);
  expect(await page.evaluate(() => ({ ...localStorage }))).toEqual(localBefore);
  expect(errors).toEqual([]);
});
