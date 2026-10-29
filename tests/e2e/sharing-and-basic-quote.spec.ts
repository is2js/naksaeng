import { expect, test } from '@playwright/test';

const mapId = 'bundang-first-village-55a-prototype';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('공유 정보를 확인하고 수동 복사하며 옵션 없이도 계산할 수 있다', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(({ map }) => {
    if (!sessionStorage.getItem('bunfirvil:household-verification:v1')) sessionStorage.setItem('bunfirvil:household-verification:v1', JSON.stringify({
      schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(), role: 'verified', authRevision: 2, scope: 'playground', nickname: '이웃',
    }));
    if (!sessionStorage.getItem('bunfirvil:sale-calculator:v1')) sessionStorage.setItem('bunfirvil:sale-calculator:v1', JSON.stringify({
      schemaVersion: 1, unitType: '55A', priceFloorBand: '5+',
    }));
    localStorage.removeItem(`bunfirvil:review:v1:${map}`);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } });
    document.execCommand = () => false;
  }, { map: mapId });
  await page.goto(`./?map=${mapId}&variant=A`);
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 45_000 });
  await expect(page.locator('.option-storage-note')).toContainText('이 브라우저의 같은 평형');
  await page.locator('#share-showcase').click();
  const dialog = page.locator('#share-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('닉네임, 평형과 방향, 선택 옵션, 배치 가구');
  await expect(dialog).toContainText('동·호수와 인증코드는 포함되지 않습니다');
  await expect(dialog).toContainText('암호화되지 않으며');
  await expect(page.locator('#share-link-value')).toHaveValue(/#share=v1\./);
  await page.locator('#share-link-copy').click();
  await expect(page.locator('#share-link-status')).toContainText('직접 복사');
  await expect(page.locator('#share-link-value')).toBeFocused();
  await dialog.getByRole('button', { name: '닫기' }).click();
  await expect(page.locator('#stage-option-count')).toHaveText('0개');
  await page.locator('#open-sale-calculator').click();
  await expect(page.locator('#sale-calculator-dialog')).toBeVisible();
  await page.locator('#sale-calculator-dialog button[value="confirm"]').click();
  await expect(page).toHaveURL(/\/calculator\/$/);
  await expect(page.getByRole('heading', { name: '내 자금 계획' })).toBeVisible();
  await expect(page.locator('.restore-card')).toContainText('이 브라우저의 같은 평형');
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('bunfirvil:sale-calculator:v1') || '{}'));
  expect(saved.optionIds).toEqual([]);
});

test('WebGL을 사용할 수 없는 경우 레이저 실측 불가를 안내한다', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('bunfirvil:household-verification:v1', JSON.stringify({
      schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(), role: 'verified', authRevision: 2, scope: 'playground', nickname: '이웃',
    }));
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind: string, ...args: unknown[]) {
      if (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl') return null;
      return original.call(this, kind as '2d', ...args as []);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto(`./?map=${mapId}&variant=A`);
  await expect(page.locator('#world-canvas')).toBeVisible();
  await page.locator('#touch-laser-toggle').click();
  await expect(page.locator('#toast')).toContainText('2D 화면에서는 레이저 실측을 사용할 수 없습니다');
  await expect(page.locator('#inspection-laser-hud')).toBeHidden();
});
