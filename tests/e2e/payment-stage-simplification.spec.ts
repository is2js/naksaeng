import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ timeout: 60_000 });

const CONTEXT_KEY = 'bunfirvil:sale-calculator:v1';
const VERIFICATION_KEY = 'bunfirvil:household-verification:v1';

async function seed(page: Page): Promise<void> {
  await page.clock.install({ time: new Date('2026-11-11T03:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-11T03:00:00Z'));
  await page.addInitScript(({ contextKey, verificationKey }) => {
    sessionStorage.clear();
    sessionStorage.setItem(verificationKey, JSON.stringify({ schemaVersion: 1,
      provider: 'google-apps-script', verifiedAt: Date.now(), role: 'verified' }));
    sessionStorage.setItem(contextKey, JSON.stringify({ schemaVersion: 1,
      unitType: '55A', priceFloorBand: '5+', applicantRoute: 'main-subscription',
      optionIds: ['system-ac-2-general', 'wide-plank-floor-finish'],
      returnUrl: '/naksaeng/bunfirvil/?map=bundang-first-village-55a-prototype&actor=200&variant=A' }));
    window.print = () => { document.documentElement.dataset.printCalled = 'true'; };
  }, { contextKey: CONTEXT_KEY, verificationKey: VERIFICATION_KEY });
  await page.goto('calculator/');
  await expect(page.getByRole('heading', { name: '내 자금 계획', exact: true })).toBeVisible();
}

async function assertUniqueIds(page: Page): Promise<void> {
  const ids = await page.locator('[id]').evaluateAll(nodes => nodes.map(node => node.id));
  expect(new Set(ids).size).toBe(ids.length);
}

async function changePlanWithoutDismissingDialog(page: Page, plan: 'main' | 'pre'): Promise<void> {
  // Native dialogs correctly make background controls inert. Exercise a
  // programmatic state update as a lifecycle regression, not as a user gesture.
  await page.locator(`#calculator-plan-${plan}`).evaluate(node => {
    const input = node as HTMLInputElement;
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

test('회차는 금액 중심으로 표시하고 자세한 안내만 대화상자로 열며 포커스·재계산을 보존한다', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await seed(page);
  const stage = (due: string) => page.locator(`.payment-stage[data-payment-stage-due="${due}"]`);
  const contract = stage('계약 시');
  const opener = contract.locator('[data-payment-guide-target="계약 시"]');
  const dialog = page.locator('#calculator-stage-guide-dialog');

  await expect(contract).toHaveAttribute('open', '');
  await expect(page.locator('#calculator-account-supply')).toBeVisible();
  await expect(page.locator('#calculator-account-supply b')).toHaveText('63,651,000원');
  await expect(page.locator('#calculator-future-option-contract')).toBeVisible();
  await expect(contract.locator('[data-stage-stamp-summary]')).toBeVisible();
  await expect(contract.locator('[data-stage-stamp-summary]')).toContainText(/15만|150,000/u);
  await expect(contract.locator('[data-stage-stamp-summary]')).toContainText(/7만\s?5천|75,000|7[.]5만/u);
  await expect(page.locator('.contract-booking-note')).toBeHidden();
  await expect(page.locator('.contract-stamp-note')).toBeHidden();
  await expect(page.locator('#calculator-contract-review')).toBeHidden();
  await expect(dialog).not.toHaveAttribute('open', '');
  for (const reference of await contract.locator('.payment-stage-reference').all()) {
    await expect(reference).toBeHidden();
  }
  await assertUniqueIds(page);
  await contract.screenshot({ path: testInfo.outputPath('concise-contract-1440.png'), animations: 'disabled' });

  await opener.click();
  await expect(dialog).toHaveAttribute('open', '');
  await expect(page.getByRole('dialog', { name: '계약금 · 자세한 안내', exact: true })).toBeVisible();
  await expect(dialog.locator('.contract-booking-note')).toBeVisible();
  await expect(dialog.locator('.contract-stamp-note')).toBeVisible();
  await expect(dialog.locator('#calculator-contract-review')).toBeVisible();
  await assertUniqueIds(page);
  // Focus stays within the native modal when traversing its controls.
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('#calculator-stage-guide-dialog')))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toHaveAttribute('open', '');
  await expect(opener).toBeFocused();
  await expect(contract.locator('.contract-booking-note')).toBeHidden();

  await opener.click();
  await changePlanWithoutDismissingDialog(page, 'pre');
  await expect(dialog).toHaveAttribute('open', '');
  await expect(page.locator('#calculator-account-supply b')).toHaveText('31,825,500원');
  await expect(page.locator('#calculator-future-option-contract b')).toHaveText('91,000원');
  await expect(dialog.locator('#calculator-contract-review')).toHaveCount(1);
  await assertUniqueIds(page);
  await dialog.locator('[data-close-payment-guide]').click();
  await expect(dialog).not.toHaveAttribute('open', '');
  await expect(opener).toBeFocused();

  await page.locator('.plan-switch label').filter({ hasText: '본청약(신규신청자)' }).click();
  await expect(page.getByLabel('본청약(신규신청자)')).toBeChecked();
  const interim = stage('2027-04-12');
  await interim.locator('summary').click();
  await interim.locator('[data-payment-guide-target="2027-04-12"]').click();
  await expect(dialog).toHaveAttribute('open', '');
  await changePlanWithoutDismissingDialog(page, 'pre');
  await expect(dialog).not.toHaveAttribute('open', '');
  await expect(stage('2027-04-12')).toHaveCount(0);
  await assertUniqueIds(page);
  expect(errors).toEqual([]);
});

test('모바일 회차의 필수 금액·미정 일정은 남기고 인쇄에는 전체 설명을 포함한 뒤 대화상자를 복원한다', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  const stage = (due: string) => page.locator(`.payment-stage[data-payment-stage-due="${due}"]`);
  const interim = stage('2027-04-12');
  const dialog = page.locator('#calculator-stage-guide-dialog');
  await page.locator('[data-mobile-finance-due="2027-04-12"]').click();
  await expect(interim).toHaveAttribute('open', '');
  await expect(interim.locator('[data-interim-account="other"]')).toBeVisible();
  await expect(interim.locator('[data-interim-account="other"]')).toContainText('546,000원');
  await expect(interim.locator('[data-interim-account="other"]')).toContainText('자납');
  await expect(interim.locator('[data-stage-flow="cash-due"] b')).toHaveText('2,653,600원');
  const screenCopy = await interim.innerText();
  expect(screenCopy).toMatch(/미정|별도 안내/u);
  expect(screenCopy).not.toContain('선납할인율');
  expect(screenCopy).not.toContain('1·2차로 임의 분할');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await interim.screenshot({ path: testInfo.outputPath('concise-interim-390.png'), animations: 'disabled' });

  const opener = interim.locator('[data-payment-guide-target="2027-04-12"]');
  await opener.click();
  await expect(dialog).toHaveAttribute('open', '');
  await expect(dialog.locator('.contract-payment-terms')).toBeVisible();
  await expect(dialog).toContainText('선납할인율');
  await dialog.locator('[data-close-payment-guide]').focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('region', { name: '납부 상세 안내' })).toBeFocused();
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.height).toBeLessThanOrEqual(844);
  await assertUniqueIds(page);
  await dialog.screenshot({ path: testInfo.outputPath('payment-guide-390.png'), animations: 'disabled' });

  const before = {
    total: await page.locator('.hero-total strong').textContent(),
    moveIn: await page.locator('#calculator-required-cash').textContent(),
    financing: await page.locator('.schedule-table .contract-due').allTextContents(),
  };
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.emulateMedia({ media: 'print' });
  await expect(dialog).not.toHaveAttribute('open', '');
  await expect(dialog).toBeHidden();
  await expect(page.locator('.payment-stage[open]')).toHaveCount(4);
  const references = page.locator('.payment-stage .payment-stage-reference');
  expect(await references.count()).toBeGreaterThanOrEqual(4);
  for (const reference of await references.all()) await expect(reference).toBeVisible();
  await expect(page.locator('.contract-booking-note')).toBeVisible();
  await expect(page.locator('.contract-stamp-note')).toBeVisible();
  await expect(page.locator('#calculator-contract-review')).toBeVisible();
  await expect(page.locator('#calculator-contract-balance-breakdown')).toBeVisible();
  for (const trigger of await page.locator('[data-payment-guide-target]').all()) await expect(trigger).toBeHidden();
  await assertUniqueIds(page);
  expect(await page.locator('.hero-total strong').textContent()).toBe(before.total);
  expect(await page.locator('#calculator-required-cash').textContent()).toBe(before.moveIn);
  expect(await page.locator('.schedule-table .contract-due').allTextContents()).toEqual(before.financing);

  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(dialog).toHaveAttribute('open', '');
  await expect(page.locator('.payment-stage[open]')).toHaveCount(1);
  await expect(interim).toHaveAttribute('open', '');
  await expect(dialog.locator('.contract-payment-terms')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toHaveAttribute('open', '');
  await expect(opener).toBeFocused();
  for (const reference of await interim.locator('.payment-stage-reference').all()) await expect(reference).toBeHidden();
  await assertUniqueIds(page);
  expect(errors).toEqual([]);
});
