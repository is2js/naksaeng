import { expect, test } from '@playwright/test';

const MAP_URL = './?map=bundang-first-village-55b-prototype&actor=100&variant=A';

test('verified playground controls, guides, and calculator history return stay usable', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('bunfirvil:household-verification:v1')) {
      sessionStorage.setItem('bunfirvil:household-verification:v1', JSON.stringify({
        schemaVersion: 1,
        provider: 'google-apps-script',
        verifiedAt: Date.now(),
        role: 'verified',
      }));
    }
    if (!sessionStorage.getItem('bunfirvil:sale-calculator:v1')) {
      sessionStorage.setItem('bunfirvil:sale-calculator:v1', JSON.stringify({
        schemaVersion: 1,
        unitType: '55B',
        priceFloorBand: '5+',
      }));
    }
    if (!localStorage.getItem('bunfirvil:review:v1:bundang-first-village-55b-prototype')) {
      localStorage.setItem('bunfirvil:review:v1:bundang-first-village-55b-prototype', JSON.stringify({
        schemaVersion: 1,
        mapId: 'bundang-first-village-55b-prototype',
        selectedOptionIds: ['wide-plank-floor-finish'],
      }));
    }
  });

  await page.goto(MAP_URL);
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: '세대 다시 선택' })).toBeVisible();
  await expect(page.getByRole('button', { name: '캐릭터 위치 초기화' })).toBeVisible();
  await expect(page.getByRole('button', { name: '놀이터 조작법' })).toBeVisible();
  await expect(page.locator('.control-deck')).toBeHidden();
  await expect(page.locator('.map-tabs')).toBeHidden();
  await expect(page.locator('[data-palette-tab="options"]')).toHaveCSS('cursor', 'pointer');
  await expect(page.locator('[data-palette-tab="furniture"]')).toHaveCSS('cursor', 'pointer');

  await page.getByRole('button', { name: '놀이터 조작법' }).click();
  await expect(page.getByRole('heading', { name: '놀이터 조작법' })).toBeVisible();
  await expect(page.locator('#help-dialog')).toContainText('텔레포트');
  await expect(page.locator('#help-dialog')).toContainText('기본 공격');
  await page.locator('#help-dialog .dialog-close').click();

  await page.goto('./guides/?guide=playground');
  await expect(page.getByRole('heading', { name: '조작 가이드' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'GitHub에서 Markdown 수정' })).toBeHidden();

  await page.goto(MAP_URL);
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 30_000 });
  await page.locator('#open-sale-calculator').click();
  await page.getByRole('button', { name: '계산기 열기' }).click();
  await expect(page.getByRole('heading', { name: '내 자금 계획' })).toBeVisible();
  await page.goBack();
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 30_000 });
  await page.getByRole('button', { name: '놀이터 조작법' }).click();
  await expect(page.getByRole('heading', { name: '놀이터 조작법' })).toBeVisible();
});
