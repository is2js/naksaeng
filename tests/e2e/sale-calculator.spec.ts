import { expect, test, type Page } from '@playwright/test';

const CALCULATOR_CONTEXT_KEY = 'bunfirvil:sale-calculator:v1';
const VERIFICATION_KEY = 'bunfirvil:household-verification:v1';
const RETURN_URL = '/naksaeng/bunfirvil/?map=bundang-first-village-55a-prototype&actor=200&variant=A';

type CalculatorContext = {
  schemaVersion: 1;
  unitType: '55A' | '55B';
  priceFloorBand: '5+';
  applicantRoute: 'pre-subscription' | 'main-subscription';
  optionIds: string[];
  returnUrl: string;
};

async function seedCalculatorSession(page: Page, context: CalculatorContext): Promise<void> {
  await page.addInitScript(({ calculatorContext, verificationKey, calculatorKey }) => {
    sessionStorage.clear();
    sessionStorage.setItem(verificationKey, JSON.stringify({
      schemaVersion: 1,
      provider: 'google-apps-script',
      verifiedAt: Date.now(),
      role: 'verified',
    }));
    sessionStorage.setItem(calculatorKey, JSON.stringify(calculatorContext));
    Object.defineProperty(window, 'print', {
      configurable: true,
      value: () => document.documentElement.dataset.printCalled = 'true',
    });
  }, { calculatorContext: context, verificationKey: VERIFICATION_KEY, calculatorKey: CALCULATOR_CONTEXT_KEY });
}

test('인증 세대의 옵션·청약·감액 계산 흐름은 개인정보 없이 이어진다', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.clock.install({ time: new Date('2026-10-22T14:59:59Z') });
  await page.clock.pauseAt(new Date('2026-10-22T14:59:59Z'));
  const context: CalculatorContext = {
    schemaVersion: 1,
    unitType: '55A',
    priceFloorBand: '5+',
    applicantRoute: 'main-subscription',
    optionIds: ['system-ac-2-general', 'wide-plank-floor-finish'],
    returnUrl: RETURN_URL,
  };
  await seedCalculatorSession(page, context);
  await page.goto('calculator/');

  await expect(page.getByRole('heading', { name: '내 자금 계획' })).toBeVisible();
  await expect(page.locator('a[href*="joy-papa.github.io"]')).toHaveCount(0);
  await expect(page.locator('#calculator-context-header')).toContainText('55A · 5층 이상');
  await expect(page.locator('.context-highlight')).toContainText('55A · 5층 이상 · 본청약 기준');
  await expect(page.getByLabel('본청약(신규신청자)')).toBeChecked();
  await expect(page.locator('#calculator-contract-cash')).toHaveText('64,524,800원');
  await expect(page.locator('#calculator-account-supply')).toContainText('63,651,000원');
  await expect(page.locator('#calculator-account-balcony')).toContainText('513,800원');
  await expect(page.locator('#calculator-account-system-ac')).toContainText('360,000원');
  await expect(page.locator('#calculator-future-option-contract')).toContainText('182,000원');
  await expect(page.locator('#calculator-post-contract-base-cash')).toHaveText('182,543,200원');
  await expect(page.locator('.calculator-side > :first-child')).toHaveAttribute('id', 'calculator-option-details');
  await expect(page.locator('#calculator-option-details')).not.toHaveAttribute('open', '');
  await page.locator('#calculator-option-details summary').click();
  await expect(page.locator('[data-option-tier="option-ii"]')).toContainText('시스템에어컨 2대 · 일반형');
  await expect(page.locator('[data-option-tier="option-ii"]')).toContainText('3,600,000원');
  await expect(page.locator('[data-option-tier="option-iii"]')).toContainText('광폭 강마루');
  await expect(page.locator('[data-option-tier="option-iii"]')).toContainText('1,820,000원');
  await expect(page.locator('.schedule-table thead')).toContainText('시스템에어컨');
  await expect(page.locator('.schedule-table thead')).toContainText('기타 옵션');
  await expect(page.locator('.schedule-table thead')).toContainText('납부일');
  await expect(page.locator('.schedule-table [data-finance-due="계약 시"] .schedule-date')).toContainText('2026.11.04~11.13');
  const countdown = (due: string) => page.locator(`.schedule-table [data-payment-due="${due}"] b`);
  await expect(countdown('계약 시')).toHaveText('시작 D-13');
  await expect(countdown('옵션Ⅲ 계약 시')).toHaveText('일정 미정');
  await expect(countdown('2027-04-12')).toHaveText('D-172');
  await expect(countdown('2028-02-14')).toHaveText('D-480');
  await expect(countdown('별도 안내')).toHaveText('일정 미정');
  await expect(countdown('입주 시')).toHaveText('예정월 D-833');
  await expect(page.locator('#calculator-deadline-today')).toContainText('2026.10.22');
  await expect(page.locator('.deadline-note')).toContainText('기타 옵션Ⅲ 계약금은 별도 계약 시 납부하며 일정은 별도 안내');
  const mainFirstInterim = page.locator('[data-finance-due="2027-04-12"]');
  await expect(mainFirstInterim.locator('[data-flow="loan-draw"]')).toContainText('63,651,000원');
  await expect(mainFirstInterim.locator('[data-flow="deferred-interest"]')).toHaveCount(0);
  await expect(page.locator('[data-finance-due="2028-02-14"] [data-flow="cash-due"] b')).toHaveText('0원');
  await expect(page.locator('[data-finance-due="입주 시"] [data-flow="interim-repayment"]')).toContainText('127,302,000원');
  await expect(page.locator('[data-finance-due="입주 시"] [data-flow="deferred-interest"]')).toContainText('7,073,109원');
  // Seoul midnight changes date labels only; open sections and quote state survive.
  await page.clock.fastForward(1_100);
  await expect(countdown('계약 시')).toHaveText('시작 D-12');
  await expect(countdown('2027-04-12')).toHaveText('D-171');
  await expect(page.locator('#calculator-deadline-today')).toContainText('2026.10.23');
  await expect(page.locator('#calculator-option-details')).toHaveAttribute('open', '');
  await page.locator('#calculator-payments').screenshot({ path: testInfo.outputPath('payment-countdowns-desktop.png') });

  await page.locator('.plan-switch label').filter({ hasText: '사전청약 당첨자' }).click();
  await expect(page.getByLabel('사전청약 당첨자')).toBeChecked();
  await expect(page.locator('#calculator-contract-cash')).toHaveText('32,262,400원');
  await expect(page.locator('#calculator-account-supply')).toContainText('31,825,500원');
  await expect(page.locator('#calculator-account-balcony')).toContainText('256,900원');
  await expect(page.locator('#calculator-account-system-ac')).toContainText('180,000원');
  await expect(page.locator('#calculator-future-option-contract')).toContainText('91,000원');
  await expect(page.locator('#calculator-post-contract-base-cash')).toHaveText('214,805,600원');
  await expect(page.locator('.context-highlight')).toContainText('사전청약 당첨자 기준');
  await expect(page.locator('.schedule-table tbody')).toContainText('계약금');
  await expect(page.locator('.schedule-table tbody')).toContainText('31,825,500원');
  await expect(page.locator('.schedule-table tbody')).toContainText('중도금');
  await expect(page.locator('.schedule-table tbody')).not.toContainText('중도금 2차');
  await expect(page.locator('.schedule-table [data-payment-due="2027-04-12"]')).toHaveCount(0);
  await expect(countdown('2028-02-14')).toHaveText('D-479');
  await expect(page.locator('[data-finance-due="2028-02-14"] [data-flow="loan-draw"]')).toContainText('127,302,000원');
  await expect(page.locator('[data-finance-due="입주 시"] [data-flow="deferred-interest"]')).toContainText('4,924,669원');

  const taxDetails = page.locator('#calculator-tax-details');
  await page.locator('#calculator-settlement-rate-input').fill('4.2');
  const taxShortcut = page.locator('[data-enable-estimate="tax"]');
  await expect(taxShortcut).toHaveCSS('cursor', 'pointer');
  await taxShortcut.hover();
  await taxShortcut.click();
  await expect(page.getByLabel('취득세 추정 활성화')).toBeChecked();
  await expect(page.locator('#calculator-settlement-rate-input')).toHaveValue('4.2');
  await expect(page.getByLabel('사전청약 당첨자')).toBeChecked();
  await page.locator('#calculator-settlement-rate-input').fill('4.0');
  await page.locator('#calculator-settlement-rate-input').press('Enter');
  await expect(page.locator('#calculator-tax-details')).toHaveAttribute('open', '');
  await expect(page.locator('#calculator-option-details')).toHaveAttribute('open', '');
  await taxDetails.locator('.relief-options label').filter({ hasText: '생애최초' }).click();
  await expect(page.locator('#calculator-tax-details')).toContainText('−2,000,000원');
  await expect(page.locator('#calculator-tax-details')).toContainText('지방교육세');
  await expect(page.locator('#calculator-tax-details .calculation-total')).toContainText('원');
  const interimDetails = page.locator('#calculator-interim-loan-details');
  // A selected group-loan scenario includes projected interest without another activation step.
  await expect(page.locator('#calculator-deferred-interest')).not.toHaveText('0원');
  const initialInterest = await page.locator('#calculator-deferred-interest').textContent();
  await page.locator('#calculator-settlement-rate-up').click();
  await expect(page.locator('#calculator-settlement-rate-input')).toHaveValue('4.1');
  await expect(page.locator('#calculator-deferred-interest')).not.toHaveText(initialInterest!);
  await page.locator('#calculator-settlement-rate-input').fill('4.3');
  await page.locator('#calculator-settlement-rate-input').press('Enter');
  await expect(page.locator('#calculator-interim-rate-input')).toHaveValue('4.3');
  await interimDetails.locator('summary').click();
  await expect(page.getByLabel('집단대출 가정 · 후불이자 반영', { exact: true })).toBeChecked();
  await expect(interimDetails).toContainText('4.0%');
  await expect(interimDetails).toContainText('주택 공급대금 중도금 20%');
  await expect(interimDetails).toContainText('기타 옵션 중도금 · 자납');
  await page.locator('#calculator-interim-rate-up').click();
  await expect(page.locator('#calculator-interim-rate-input')).toHaveValue('4.4');
  await expect(page.locator('#calculator-settlement-rate-input')).toHaveValue('4.4');

  const preMortgageCash = await page.locator('#calculator-pre-mortgage-cash').textContent();
  await expect(page.locator('#calculator-balance-mortgage-enabled')).toBeChecked();
  await expect(page.locator('#calculator-balance-mortgage-enabled')).toBeDisabled();
  await expect(page.locator('#calculator-mortgage-enabled')).toBeChecked();
  await expect(page.locator('#calculator-mortgage-enabled')).toBeDisabled();
  await expect(page.locator('#calculator-balance-mortgage-principal')).toHaveText('400,000,000원');
  await expect(page.locator('#calculator-pre-mortgage-cash')).toHaveText(preMortgageCash!);
  await expect(page.locator('#calculator-balance-mortgage-info')).toContainText('의무가입 대상');
  await page.locator('#calculator-balance-ltv').selectOption('60');
  await expect(page.locator('#calculator-balance-mortgage-principal')).toHaveText('384,988,800원');
  await page.locator('#calculator-balance-ltv').selectOption('30');
  await expect(page.locator('#calculator-ltv')).toHaveValue('30');
  await expect(page.locator('#calculator-balance-mortgage-principal')).toHaveText('192,494,400원');
  await expect(page.locator('#calculator-post-contract-base-cash')).toHaveText('422,311,200원');
  await page.locator('#calculator-balance-ltv').selectOption('70');
  await expect(interimDetails).toHaveAttribute('open', '');
  await expect(interimDetails.locator('.calculation-total')).toContainText('원');
  const mortgageDetails = page.locator('#calculator-mortgage-details');
  await mortgageDetails.locator('summary').click();
  await expect(page.locator('#calculator-mortgage-enabled')).toBeDisabled();
  await expect(page.locator('#calculator-mortgage-details')).toHaveAttribute('open', '');
  await expect(page.locator('#calculator-mortgage-details')).toContainText('월 원리금');
  await expect(page.locator('#calculator-mortgage-details')).toContainText('1.3% 고정');
  await expect(page.locator('#calculator-mortgage-details')).toContainText('상환 만기');
  await expect(page.locator('#calculator-mortgage-details')).toContainText('정산 시 대출 유지기간');
  await page.locator('#calculator-children').selectOption('2');
  await page.locator('#calculator-settlement-period').selectOption('9');
  // 4억원 cap / (55A adjusted supply + balcony) floors to 62% effective LTV.
  await expect(page.locator('#calculator-mortgage-details')).toContainText('향후 매각차익 기금 정산비율26%');
  await expect(page.locator('#calculator-mortgage-details')).toContainText('641,648,000원');

  await expect(page.locator('#calculator-interim-repayment')).toHaveText('127,302,000원');
  await page.getByLabel('전액 자납 가정', { exact: true }).check();
  await expect(page.locator('#calculator-interim-repayment')).toHaveText('0원');
  await expect(page.locator('#calculator-deferred-interest')).toHaveText('0원');
  await expect(page.locator('#calculator-pre-mortgage-cash')).toHaveText('0원');
  await page.getByLabel('집단대출 가정', { exact: true }).check();
  await expect(page.locator('#calculator-interim-repayment')).toHaveText('127,302,000원');
  await expect(page.locator('#calculator-deferred-interest')).not.toHaveText('0원');
  expect(await page.locator('#calculator-non-balance-cash').evaluate(node => Boolean(node.compareDocumentPosition(document.querySelector('#calculator-required-cash')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(page.locator('#calculator-option-details')).toHaveAttribute('open', '');

  const unchangedContract = await page.locator('.hero-total strong').textContent();
  const costs = page.locator('#calculator-cost-details');
  await page.locator('#calculator-settlement-rate-input').fill('4.6');
  await page.locator('[data-enable-estimate="costs"]').click();
  await expect(page.getByLabel('미납 부대비용 반영', { exact: true })).toBeChecked();
  await expect(page.locator('#calculator-settlement-rate-input')).toHaveValue('4.6');
  await expect(page.locator('#calculator-children')).toHaveValue('2');
  await expect(page.locator('#calculator-settlement-period')).toHaveValue('9');
  await page.locator('#calculator-settlement-rate-input').fill('4.4');
  await page.locator('#calculator-settlement-rate-input').press('Enter');
  await page.locator('#calculator-cost-management').fill('1000000');
  await page.locator('#calculator-cost-management').press('Tab');
  await expect(page.locator('#calculator-extra-cost-total')).toHaveText('1,000,000원');
  await expect(page.locator('#calculator-post-contract-base-cash')).toHaveText('214,805,600원');
  await expect(page.locator('.hero-total strong')).toHaveText(unchangedContract!);
  await expect(costs).toHaveAttribute('open', '');
  await page.getByLabel('미납 부대비용 반영', { exact: true }).uncheck();
  await page.locator('[data-enable-estimate="costs"]').click();
  await expect(page.locator('#calculator-cost-management')).toHaveValue('1000000');
  await page.locator('#calculator-cost-management').fill('');
  await page.locator('#calculator-cost-management').press('Tab');
  await expect(page.locator('#calculator-extra-cost-total')).toHaveText('0원');
  await expect(page.locator('#calculator-cost-management')).toHaveValue('0');
  await page.locator('#calculator-cost-management').fill('1000000');
  await page.locator('#calculator-cost-management').press('Tab');

  await page.locator('#calculator-move-in-date').fill('2029-03-01');
  await page.locator('#calculator-move-in-date').press('Tab');
  await expect(interimDetails).toContainText('2029-03-01');
  await expect(page.locator('tr[data-phase="balance"] .schedule-date')).toContainText('2029.02 예정');
  await expect(countdown('입주 시')).toHaveText('예정월 D-832');
  await page.locator('#calculator-term').selectOption('20');
  await expect(page.locator('#calculator-settlement-period option[value="24"]')).toHaveCount(0);
  await page.locator('#calculator-settlement-period').selectOption('20');
  await expect(page.locator('#calculator-required-cash')).toContainText('원');
  const resale = page.locator('#calculator-resale-details');
  await resale.locator('summary').click();
  await page.locator('#calculator-sale-price').fill('900000000');
  await page.locator('#calculator-sale-price').press('Tab');
  await expect(page.locator('#calculator-resale-proceeds')).toHaveText('874,164,800원');
  await expect(resale).toContainText('회수액은 순이익이 아닙니다');
  await expect(resale).toHaveAttribute('open', '');
  await page.locator('#calculator-move-in-settlement').screenshot({ path: testInfo.outputPath('move-in-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const mobileCurrentContract = page.locator('[data-mobile-finance-due="계약 시"]');
  const mobileFutureContract = page.locator('[data-mobile-finance-due="옵션Ⅲ 계약 시"]');
  await expect(mobileCurrentContract).toBeVisible();
  await expect(mobileCurrentContract).toContainText('32,262,400원');
  await expect(mobileFutureContract).toBeVisible();
  await expect(mobileFutureContract).toContainText('91,000원');
  await mobileFutureContract.click();
  const mobileFutureDetails = page.locator('details.payment-stage[data-payment-stage-due="옵션Ⅲ 계약 시"]');
  await expect(mobileFutureDetails).toHaveAttribute('open', '');
  await expect(mobileFutureDetails).toContainText('일정 미정');
  await page.locator('#calculator-move-in-settlement').screenshot({ path: testInfo.outputPath('move-in-mobile.png') });
  await page.locator('#calculator-payments').screenshot({ path: testInfo.outputPath('payment-countdowns-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });

  // Direct browser printing must include enabled but manually collapsed evidence.
  await taxDetails.locator('summary').click();
  await interimDetails.locator('summary').click();
  await mortgageDetails.locator('summary').click();
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await expect(taxDetails).toHaveAttribute('open', '');
  await expect(interimDetails).toHaveAttribute('open', '');
  await expect(mortgageDetails).toHaveAttribute('open', '');

  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.topbar')).toBeHidden();
  await expect(page.locator('.calculator-side')).toBeVisible();
  await expect(page.locator('#calculator-tax-details')).toBeVisible();
  await expect(page.locator('.source-card')).toBeHidden();
  await expect(page.locator('#calculator-move-in-settlement')).toBeVisible();
  await expect(page.locator('#calculator-contract-cash')).toBeVisible();
  await expect(page.locator('#calculator-post-contract-base-cash')).toBeVisible();
  await expect(page.locator('#calculator-cost-details .cost-print-summary')).toContainText('1,000,000원');
  await expect(page.locator('#calculator-deadline-today')).toBeVisible();
  await expect(page.locator('#calculator-deadline-today')).toContainText('2026.10.23');
  await expect(countdown('2028-02-14')).toBeVisible();
  await expect(page.locator('#calculator-non-balance-cash')).toBeVisible();
  await expect(page.locator('#calculator-pre-mortgage-cash')).toBeVisible();
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(taxDetails).not.toHaveAttribute('open', '');
  await expect(interimDetails).not.toHaveAttribute('open', '');
  await expect(mortgageDetails).not.toHaveAttribute('open', '');
  await page.getByRole('button', { name: '인쇄 · PDF 저장' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-print-called', 'true');

  const stored = await page.evaluate((key) => sessionStorage.getItem(key), CALCULATOR_CONTEXT_KEY);
  expect(JSON.parse(stored || '{}')).toEqual(context);
  expect(page.url()).not.toMatch(/105|1903|%ED%94%BC%EC%B9%98/u);
  await expect(page.locator('body')).not.toContainText('105동');
  await expect(page.locator('body')).not.toContainText('1903호');
  await expect(page.locator('body')).not.toContainText('피치');
  expect(stored).not.toMatch(/105|1903|피치/u);

  await page.locator('#calculator-return-options').click();
  await expect(page).toHaveURL(new RegExp(`${RETURN_URL.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`));

  // 동일 탭의 새 계산기 실행은 선택 옵션 스냅샷만 바꾸며 개인 식별값을 추가하지 않는다.
  await seedCalculatorSession(page, {
    schemaVersion: 1,
    unitType: '55A',
    priceFloorBand: '5+',
    applicantRoute: 'main-subscription',
    optionIds: ['bundang-minus-option-package'],
    returnUrl: RETURN_URL,
  });
  await page.goto('calculator/');

  await expect(page.getByRole('heading', { name: '내 자금 계획' })).toBeVisible();
  await expect(page.locator('[data-option-tier="discount-metadata-only"]')).toContainText('마이너스 옵션은 할인 전용 항목');
  await expect(page.locator('[data-option-tier="discount-metadata-only"]')).toContainText('공급가 감액−28,490,000원');
  await expect(page.locator('[data-option-tier="discount-metadata-only"]')).toContainText('발코니 감액−770,000원');
  await expect(page.locator('.contract-breakdown .discount')).toContainText('마이너스 감액');
  await expect(page.locator('.contract-breakdown .discount')).toContainText('−29,260,000원');
});

test('옵션 없는 기본형과 모바일 바로가기·최신 계약 안내가 유지된다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedCalculatorSession(page, {
    schemaVersion: 1, unitType: '55A', priceFloorBand: '5+', applicantRoute: 'main-subscription', optionIds: [], returnUrl: RETURN_URL,
  });
  await page.goto('calculator/');
  await expect(page.getByRole('heading', { name: '내 자금 계획' })).toBeVisible();
  await expect(page.locator('.hero-total strong')).toHaveText('641,648,000원');
  await expect(page.locator('.contract-breakdown')).toContainText('선택 옵션 합계0원');
  await expect(page.locator('.contract-booking-note')).toContainText('당일 예약 불가');
  await expect(page.locator('.contract-booking-note')).toContainText('10.30 10:00 ~ 11.12 23:59');
  await expect(page.locator('.contract-booking-note')).toContainText('10:00~17:00');
  await expect(page.locator('.contract-stamp-note')).toContainText('15만원을 선납');
  await expect(page.locator('.contract-stamp-note')).toContainText('잔금에서 차감');
  await expect(page.locator('.contract-stamp-note')).toContainText('모두 미반영');
  await expect(page.locator('.stamp-settlement-reminder')).toContainText('반영되지 않았으니');
  await page.locator('[data-calculator-jump="calculator-option-details"]').click();
  await expect(page.locator('#calculator-option-details')).toHaveAttribute('open', '');
  await expect(page.locator('#calculator-option-details')).toContainText('선택한 유상옵션이 없습니다');
  await page.locator('[data-calculator-jump="calculator-tax-details"]').click();
  await expect(page.locator('#calculator-tax-details')).toHaveAttribute('open', '');
  await expect(page.locator('#calculator-tax-enabled')).not.toBeChecked();
  await expect(page.locator('#calculator-plan-main')).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.contract-booking-note')).toBeVisible();
  await expect(page.locator('.contract-stamp-note')).toBeVisible();
  await expect(page.locator('#calculator-future-option-contract')).toBeVisible();
  for (const installment of await page.locator('.interim-account-summary').all()) {
    await expect(installment).toBeVisible();
  }
  await expect(page.locator('.stamp-settlement-reminder')).toBeVisible();
  await expect(page.locator('.calculator-mobile-jump')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
});

const priceCases = [
  { name: '별도 옵션 포함', ids: ['system-ac-2-general', 'wide-plank-floor-finish'], total: '647,068,000원', mainDeposit: '64,524,800원', preDeposit: '32,262,400원', mainFuture: '182,000원', preFuture: '91,000원', mainBalance: '452,405,600원', preBalance: '485,301,000원', ltv60: '384,988,800원', separate: true },
  { name: '별도 기타 옵션 없음', ids: ['system-ac-2-general'], total: '645,248,000원', mainDeposit: '64,524,800원', preDeposit: '32,262,400원', mainFuture: '0원', preFuture: '0원', mainBalance: '451,313,600원', preBalance: '483,936,000원', ltv60: '384,988,800원', separate: false },
  { name: '옵션 없는 기본형', ids: [], total: '641,648,000원', mainDeposit: '64,164,800원', preDeposit: '32,082,400원', mainFuture: '0원', preFuture: '0원', mainBalance: '449,153,600원', preBalance: '481,236,000원', ltv60: '384,988,800원', separate: false },
  { name: '마이너스 옵션', ids: ['bundang-minus-option-package'], total: '612,388,000원', mainDeposit: '61,238,800원', preDeposit: '30,619,400원', mainFuture: '0원', preFuture: '0원', mainBalance: '428,671,600원', preBalance: '459,291,000원', ltv60: '367,432,800원', separate: false },
];

test('계약서 대조 금액·항목명과 잔금·융자금 설명은 화면과 인쇄에서 총액을 바꾸지 않는다', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.clock.install({ time: new Date('2026-11-07T03:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-07T03:00:00Z'));
  await seedCalculatorSession(page, {
    schemaVersion: 1, unitType: '55B', priceFloorBand: '5+', applicantRoute: 'main-subscription',
    optionIds: ['system-ac-4-general'],
    returnUrl: '/naksaeng/bunfirvil/?map=bundang-first-village-55b-prototype&actor=200&variant=A',
  });
  await page.goto('calculator/');

  const details = page.locator('#calculator-payment-details');
  const stage = (due: string) => details.locator(`[data-payment-stage-due="${due}"]`);
  const split = page.locator('#calculator-contract-balance-breakdown');
  const balanceRow = page.locator('.schedule-table [data-finance-due="입주 시"]');
  await expect(page.locator('#calculator-contract-review')).toContainText('2026.11.07');
  await expect(page.locator('#calculator-contract-review')).toContainText('사전청약·다른 평형·다른 에어컨 구성·기타 옵션Ⅲ은 기존 공고 기준');
  await expect(page.locator('.hero-total strong')).toHaveText('647,446,000원');
  await expect(page.locator('#calculator-contract-cash')).toHaveText('64,744,600원');
  await expect(stage('계약 시')).toHaveAttribute('open', '');
  await expect(details.locator('.payment-stage[open]')).toHaveCount(1);
  for (const [id, label, amount] of [
    ['calculator-account-supply', '아파트 공급대금', '63,629,000원'],
    ['calculator-account-balcony', '추가선택품목Ⅰ · 발코니 확장', '455,600원'],
    ['calculator-account-system-ac', '추가선택품목Ⅱ · 천장형 시스템에어컨', '660,000원'],
  ]) {
    await expect(page.locator(`#${id}`)).toContainText(label);
    await expect(page.locator(`#${id} b`)).toHaveText(amount);
  }
  await expect(page.locator('.schedule-table [data-finance-due="2027-04-12"] .schedule-date')).toContainText('2027-04-12');
  await expect(page.locator('.schedule-table [data-finance-due="2028-02-14"] .schedule-date')).toContainText('2028-02-14');
  await expect(page.locator('.schedule-table [data-finance-due="2027-04-12"] [data-flow="loan-draw"] b')).toHaveText('−63,629,000원');
  await expect(page.locator('.schedule-table [data-finance-due="2028-02-14"] [data-flow="loan-draw"] b')).toHaveText('−63,629,000원');
  await expect(balanceRow.locator('.contract-due b')).toHaveText('452,552,200원');
  await expect(balanceRow.locator('[data-flow="interim-repayment"] b')).toHaveText('＋127,258,000원');
  await expect(balanceRow.locator('[data-flow="mortgage"] b')).toHaveText('−400,000,000원');
  await expect(page.locator('#calculator-balance-mortgage-principal')).toHaveText('400,000,000원');

  await stage('입주 시').locator('summary').click();
  await expect(details.locator('.payment-stage[open]')).toHaveCount(1);
  await expect(split).toBeVisible();
  await expect(split.locator('[data-contract-balance="balance"]')).toHaveText('390,403,000원');
  await expect(split.locator('[data-contract-balance="fund"]')).toHaveText('55,000,000원');
  await expect(split.locator('[data-contract-balance="total"]')).toHaveText('445,403,000원');
  await expect(split).toContainText('별도 수령액으로 차감하거나 모기지에 다시 더하지 않습니다');
  await expect(split).toContainText('시행사가 받은 이후 상환 예정이므로 계약자가 받을 수 없다고 명시');
  await expect(split).toContainText('계약자 본인의 추가 대출이나 별도 기금 상환금으로 계산하지 않습니다');
  await expect(stage('입주 시').locator('.contract-payment-terms')).toContainText('금융기관 휴무일이면 다음 영업일');

  const unchanged = async () => ({
    total: await page.locator('.hero-total strong').textContent(),
    deposit: await page.locator('#calculator-contract-cash').textContent(),
    balance: await balanceRow.locator('.contract-due b').textContent(),
    loan: await page.locator('#calculator-balance-mortgage-principal').textContent(),
    funding: await balanceRow.locator('.financing-lines').textContent(),
  });
  const beforePrint = await unchanged();
  await page.locator('#calculator-print').click();
  await expect(page.locator('html')).toHaveAttribute('data-print-called', 'true');
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.emulateMedia({ media: 'print' });
  await expect(details.locator('.payment-stage[open]')).toHaveCount(4);
  await expect(split).toBeVisible();
  await expect(split.locator('[data-contract-balance="total"]')).toHaveText('445,403,000원');
  expect(await unchanged()).toEqual(beforePrint);
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(details.locator('.payment-stage[open]')).toHaveCount(1);
  await expect(stage('입주 시')).toHaveAttribute('open', '');
  expect(await unchanged()).toEqual(beforePrint);

  await page.setViewportSize({ width: 390, height: 844 });
  await stage('계약 시').locator('summary').click();
  await expect(details.locator('.payment-stage[open]')).toHaveCount(1);
  for (const id of ['calculator-account-supply', 'calculator-account-balcony', 'calculator-account-system-ac']) {
    const label = page.locator(`#${id} > span`);
    await expect(label).toBeVisible();
    expect(await label.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(12);
    await expect(page.locator(`#${id} > b`)).toHaveCSS('white-space', 'nowrap');
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await stage('계약 시').screenshot({ path: testInfo.outputPath('executed-contract-mobile.png'), animations: 'disabled' });
});

test('납부표 아래 가까운 회차 상세 하나만 열고 변경·모바일·인쇄 후에도 선택을 보존한다', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.clock.install({ time: new Date('2026-11-07T03:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-07T03:00:00Z'));
  await seedCalculatorSession(page, {
    schemaVersion: 1, unitType: '55A', priceFloorBand: '5+', applicantRoute: 'main-subscription',
    optionIds: ['system-ac-2-general', 'wide-plank-floor-finish'], returnUrl: RETURN_URL,
  });
  await page.goto('calculator/');

  const group = page.locator('#calculator-payment-details');
  const stages = group.locator('details.payment-stage');
  const stage = (due: string) => group.locator(`details.payment-stage[data-payment-stage-due="${due}"]`);
  const openStages = () => group.locator('details.payment-stage[open]');
  await expect(stage('계약 시')).toHaveAttribute('open', '');
  await expect(openStages()).toHaveCount(1);
  await expect(stage('옵션Ⅲ 계약 시')).not.toHaveAttribute('open', '');
  await expect(stage('별도 안내')).not.toHaveAttribute('open', '');
  const ids = await page.locator('[id]').evaluateAll(nodes => nodes.map(node => node.id));
  expect(new Set(ids).size).toBe(ids.length);
  expect(await group.evaluate(node => Boolean(document.querySelector('.schedule-scroll')!.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(page.locator('#calculator-account-supply')).toBeVisible();
  await expect(page.locator('#calculator-account-supply')).toContainText('63,651,000원');

  await stage('2027-04-12').locator('summary').click();
  await expect(stage('2027-04-12')).toHaveAttribute('open', '');
  await expect(openStages()).toHaveCount(1);
  await expect(page.locator('#calculator-account-supply')).toBeHidden();
  await expect(stage('2027-04-12').locator('[data-interim-account="supply"]')).toBeVisible();
  await page.locator('#calculator-settlement-rate-up').click();
  await expect(stage('2027-04-12')).toHaveAttribute('open', '');
  await expect(openStages()).toHaveCount(1);

  await stage('2028-02-14').locator('summary').click();
  await page.locator('.plan-switch label').filter({ hasText: '사전청약 당첨자' }).click();
  await expect(stage('2028-02-14')).toHaveAttribute('open', '');
  await expect(stage('2027-04-12')).toHaveCount(0);
  await expect(openStages()).toHaveCount(1);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await group.screenshot({ path: testInfo.outputPath('payment-detail-desktop.png'), animations: 'disabled' });

  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.schedule-scroll')).toBeVisible();
  for (const detail of await stages.all()) {
    await expect(detail).toHaveAttribute('open', '');
  }
  await expect(page.locator('#calculator-account-supply')).toBeVisible();
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(stage('2028-02-14')).toHaveAttribute('open', '');
  await expect(openStages()).toHaveCount(1);

  // Unknown option deadlines never supersede the next dated installment.
  await page.locator('.plan-switch label').filter({ hasText: '본청약(신규신청자)' }).click();
  for (const [now, expected] of [
    ['2026-11-14T03:00:00Z', '2027-04-12'],
    ['2027-04-13T03:00:00Z', '2028-02-14'],
  ]) {
    await page.clock.setFixedTime(new Date(now));
    await page.reload();
    await expect(stage(expected)).toHaveAttribute('open', '');
    await expect(openStages()).toHaveCount(1);
    await expect(stage('옵션Ⅲ 계약 시')).not.toHaveAttribute('open', '');
    await expect(stage('별도 안내')).not.toHaveAttribute('open', '');
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.schedule-scroll')).toBeHidden();
  await expect(group).toBeVisible();
  await stage('계약 시').locator('summary').click();
  await expect(stage('계약 시')).toHaveAttribute('open', '');
  await expect(openStages()).toHaveCount(1);
  await expect(page.locator('#calculator-account-supply')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await group.screenshot({ path: testInfo.outputPath('payment-detail-mobile.png'), animations: 'disabled' });
  expect(errors).toEqual([]);
});

for (const scenario of priceCases) for (const plan of ['main-subscription', 'pre-subscription'] as const) {
  test(`납부 사례: ${scenario.name} · ${plan}`, async ({ page }) => {
    await seedCalculatorSession(page, { schemaVersion: 1, unitType: '55A', priceFloorBand: '5+', applicantRoute: plan, optionIds: scenario.ids, returnUrl: RETURN_URL });
    await page.goto('calculator/');
    await expect(page.locator('.hero-total strong')).toHaveText(scenario.total);
    const main = plan === 'main-subscription';
    await expect(page.locator('[data-finance-due="계약 시"] .contract-due b')).toHaveText(main ? scenario.mainDeposit : scenario.preDeposit);
    await expect(page.locator('#calculator-contract-cash')).toHaveText(main ? scenario.mainDeposit : scenario.preDeposit);
    await expect(page.locator('#calculator-future-option-contract b')).toHaveText(main ? scenario.mainFuture : scenario.preFuture);
    await expect(page.locator('#calculator-future-option-contract')).toContainText('별도 계약 · 일정 미정');
    await expect(page.locator('.account-contract-total + #calculator-future-option-contract')).toHaveCount(1);
    if (!scenario.separate) await expect(page.locator('#calculator-future-option-contract')).toContainText('선택 없음');
    const expectedCombined = Number((main ? scenario.mainDeposit : scenario.preDeposit).replace(/[^0-9]/g, '')) + Number((main ? scenario.mainFuture : scenario.preFuture).replace(/[^0-9]/g, ''));
    await expect(page.locator('.account-contract-overall b')).toHaveText(`${expectedCombined.toLocaleString('ko-KR')}원`);
    await expect(page.locator('[data-finance-due="옵션Ⅲ 계약 시"]')).toHaveCount(scenario.separate ? 1 : 0);
    await expect(page.locator('[data-mobile-finance-due="옵션Ⅲ 계약 시"]')).toHaveCount(scenario.separate ? 1 : 0);
    if (scenario.separate) await expect(page.locator('[data-finance-due="옵션Ⅲ 계약 시"] .contract-due b')).toHaveText(main ? scenario.mainFuture : scenario.preFuture);
    await expect(page.locator('[data-finance-due="입주 시"] .contract-due b')).toHaveText(main ? scenario.mainBalance : scenario.preBalance);
    await expect(page.locator('[data-finance-due="별도 안내"]')).toHaveCount(scenario.separate ? 1 : 0);
    const firstInterim = page.locator(`[data-interim-account-due="${main ? '2027-04-12' : '2028-02-14'}"]`);
    await expect(firstInterim.locator('[data-interim-account="supply"]')).toContainText('주택 집단대출 가정');
    await expect(firstInterim.locator('[data-interim-account="balcony"]')).toContainText('자납');
    await expect(page.locator('[data-interim-account-due="별도 안내"]')).toHaveCount(scenario.separate ? 1 : 0);
    if (scenario.separate) {
      await expect(firstInterim.locator('[data-interim-account="system-ac"]')).toContainText('자납');
      await expect(page.locator('[data-interim-account-due="별도 안내"] [data-interim-account="other"]')).toContainText(main ? '546,000원' : '364,000원');
      await expect(page.locator('[data-interim-account-due="별도 안내"]')).toContainText('자납');
    }
    if (main) {
      await expect(page.locator('[data-interim-account-due="2028-02-14"] [data-interim-account="balcony"]')).toContainText('해당 회차 납부 없음');
      await expect(page.locator('[data-interim-account-due="2028-02-14"] [data-interim-account="system-ac"]')).toContainText('해당 회차 납부 없음');
    }
    await expect(page.locator('[data-finance-due="2027-04-12"]')).toHaveCount(main ? 1 : 0);
    await expect(page.locator('[data-finance-due="2028-02-14"] [data-flow="deferred-interest"]')).toHaveCount(0);
    await expect(page.locator('[data-finance-due="입주 시"] [data-flow="deferred-interest"]')).toHaveCount(1);
    await expect(page.locator('[data-flow="interim-repayment"]')).toHaveCount(1);
    await page.locator('#calculator-balance-ltv').selectOption('60');
    await expect(page.locator('#calculator-balance-mortgage-principal')).toHaveText(scenario.ltv60);
    await page.locator('#calculator-balance-ltv').selectOption('70');
    await expect(page.locator('#calculator-balance-mortgage-principal')).toHaveText('400,000,000원');
    await expect(page.locator('a[href*="joy-papa.github.io"]')).toHaveCount(0);
  });
}
