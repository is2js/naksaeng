import { expect, test } from '@playwright/test';

const MAP_ID = 'bundang-first-village-55a-prototype';
const MINUS_OPTION_ID = 'bundang-minus-option-package';
const ORDINARY_OPTION_ID = 'living-design-wall-panel';

test('마이너스 옵션은 기존 옵션을 확인 후 교체하고 기본 제공 요소를 동적으로 제외한다', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('bunfirvil:minus-option-smoke:initialized') !== 'true') {
      localStorage.clear();
      sessionStorage.setItem('bunfirvil:minus-option-smoke:initialized', 'true');
    }
    sessionStorage.setItem('bunfirvil:household-verification:v1', JSON.stringify({
      schemaVersion: 1,
      provider: 'google-apps-script',
      verifiedAt: Date.now(),
      role: 'verified', memberCodeRevision: 1,
    }));
  });
  await page.goto(`./?map=${MAP_ID}&actor=200&variant=A`);
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 30_000 });

  await expect(page.getByText('세대 옵션 구성', { exact: true })).toHaveCount(0);
  await expect(page.locator('.option-panel')).toHaveAttribute('aria-label', '옵션 팔레트');
  await expect(page.locator('#option-categories button').nth(1)).toHaveText('마이너스 옵션');
  await expect(page.locator('#option-list [data-option-card-id]').first()).toHaveAttribute('data-option-card-id', MINUS_OPTION_ID);
  const minusPreview = page.locator(`[data-option-card-id="${MINUS_OPTION_ID}"] img`);
  await expect(minusPreview).toBeVisible();
  expect(await minusPreview.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator(`[data-option-card-id="${MINUS_OPTION_ID}"]`)).toContainText('공급가 감액 −28,490,000원');
  await expect(page.locator(`[data-option-card-id="${MINUS_OPTION_ID}"]`)).toContainText('발코니 감액 −770,000원');

  await page.locator(`input[data-option-id="${ORDINARY_OPTION_ID}"]`).click({ force: true });
  await expect(page.locator(`input[data-option-id="${ORDINARY_OPTION_ID}"]`)).toBeChecked();

  await page.locator(`input[data-option-id="${MINUS_OPTION_ID}"]`).click({ force: true });
  await expect(page.locator('#option-confirm-dialog')).toBeVisible();
  await expect(page.locator('#option-confirm-message')).toContainText('기존 선택 옵션을 모두 해제');
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.locator(`input[data-option-id="${ORDINARY_OPTION_ID}"]`)).toBeChecked();
  await expect(page.locator(`input[data-option-id="${MINUS_OPTION_ID}"]`)).not.toBeChecked();

  await page.locator(`input[data-option-id="${MINUS_OPTION_ID}"]`).click({ force: true });
  await page.getByRole('button', { name: '모두 해제 후 적용', exact: true }).click();
  await expect(page.locator(`input[data-option-id="${MINUS_OPTION_ID}"]`)).toBeChecked();
  await expect(page.locator(`input[data-option-id="${ORDINARY_OPTION_ID}"]`)).toBeDisabled();
  await expect(page.locator('.minus-option-lock-note')).toBeVisible();
  await expect(page.locator(`.stage-option-chip[data-stage-option-select="${MINUS_OPTION_ID}"]`)).toContainText('감액 별도');
  await expect(page.locator('#stage-option-total')).toHaveText('0원');

  const canvas = page.locator('#three-world-canvas');
  await expect(canvas).toHaveAttribute('data-minus-option-active', 'true');
  await expect(canvas).toHaveAttribute('data-kitchen-fixture-count', '0');
  await expect(canvas).toHaveAttribute('data-bathroom-base-fixture-count', '0');
  await expect(canvas).toHaveAttribute('data-interior-door-leaf-count', '0');
  await expect(canvas).not.toHaveAttribute('data-kitchen-cooktop-asset-id', /.+/);
  await expect(canvas).not.toHaveAttribute('data-kitchen-range-hood-asset-id', /.+/);

  await page.reload();
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 30_000 });
  await expect(page.locator(`input[data-option-id="${MINUS_OPTION_ID}"]`)).toBeChecked();
  await expect(page.locator('#stage-option-total')).toHaveText('0원');

  await page.locator(`button[data-stage-option-remove="${MINUS_OPTION_ID}"]`).click();
  await expect(canvas).toHaveAttribute('data-minus-option-active', 'false');
  await expect.poll(async () => Number(await canvas.getAttribute('data-kitchen-fixture-count'))).toBeGreaterThan(0);
  await expect.poll(async () => Number(await canvas.getAttribute('data-interior-door-leaf-count'))).toBeGreaterThan(0);
  await expect(canvas).toHaveAttribute('data-kitchen-cooktop-asset-id', 'bunfirvil-default-navien-magic-gas-cooktop-3');
  await expect(canvas).toHaveAttribute('data-kitchen-range-hood-asset-id', 'bunfirvil-default-kitchen-range-hood');
});
