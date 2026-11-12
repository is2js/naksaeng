import { expect, test } from '@playwright/test';
import { strToU8, zlibSync } from 'fflate';

test('51A guide stays in the playground, separate guides return, and the entrance card uses its fitted option', async ({ page, context }, testInfo) => {
  test.setTimeout(process.env.CI ? 240_000 : 150_000);
  const mapId = 'bundang-first-village-51a-prototype';
  const route = `./?map=${mapId}&actor=200&variant=B`;
  const errors: string[] = [];
  await page.clock.install();
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(id => {
    if (!sessionStorage.getItem('bunfirvil:household-verification:v1')) {
      sessionStorage.setItem('bunfirvil:household-verification:v1', JSON.stringify({
        schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(),
        role: 'verified', authRevision: 2, scope: 'playground', nickname: '가이드테스트',
      }));
    }
    if (!localStorage.getItem(`bunfirvil:review:v1:${id}`)) {
      localStorage.setItem(`bunfirvil:review:v1:${id}`, JSON.stringify({
        mapId: id, status: 'unreviewed', notes: '', updatedAt: new Date().toISOString(),
        selectedOptionIds: ['wide-plank-floor-finish'],
      }));
    }
  }, mapId);
  await page.goto(route);
  const canvas = page.locator('#three-world-canvas');
  const stage = page.locator('#game-stage');
  const dialog = page.locator('#help-dialog');
  const actor = page.locator('.rpg-actor--200');
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 60_000 });
  await expect(actor).toBeVisible();
  const playgroundUrl = page.url();
  await expect(page.locator('#option-design-disclaimer')).toBeVisible();
  await expect(page.locator('#option-design-disclaimer')).toContainText('실제 시공과 다를 수');
  await expect(page.locator('.option-storage-description')).toBeVisible();
  const noticeStyle = () => page.locator('.option-storage-note').evaluate(note => {
    const storage = getComputedStyle(note.querySelector('.option-storage-description')!);
    const disclaimer = getComputedStyle(note.querySelector('#option-design-disclaimer')!);
    return { storageSize: storage.fontSize, disclaimerSize: disclaimer.fontSize, storageColor: storage.color, disclaimerColor: disclaimer.color };
  });
  const desktopNotice = await noticeStyle();
  expect(desktopNotice.disclaimerSize).toBe(desktopNotice.storageSize);
  expect(desktopNotice.disclaimerColor).not.toBe(desktopNotice.storageColor);

  await page.locator('[data-open-guide]').click();
  await expect(dialog).toBeVisible();
  const desktopBox = (await dialog.boundingBox())!;
  const desktopViewport = page.viewportSize()!;
  expect(Math.abs(desktopBox.x + desktopBox.width / 2 - desktopViewport.width / 2)).toBeLessThan(2);
  expect(Math.abs(desktopBox.y + desktopBox.height / 2 - desktopViewport.height / 2)).toBeLessThan(2);
  const position = await actor.getAttribute('data-cell-x');
  await dialog.locator('article').focus();
  await page.keyboard.press('ArrowRight');
  expect(await actor.getAttribute('data-cell-x')).toBe(position);
  await expect(actor).not.toHaveAttribute('data-motion', 'attack');
  await dialog.getByLabel('가이드 문서').selectOption('b-option');
  await expect(dialog.locator('article')).toContainText('마이너스 옵션');
  expect(await dialog.getByLabel('가이드 문서').locator('option').allTextContents()).not.toContain('인증·회원 운영 개정판');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  expect(page.url()).toBe(playgroundUrl);
  await expect(page.locator('#household-nickname')).toHaveCount(0);

  // A guide opened with noopener must not copy authentication to a new tab.
  // Its return control closes that guide and reveals the existing playground.
  await page.locator('[data-open-guide]').click();
  await dialog.getByLabel('가이드 문서').selectOption('b-option');
  const [guide] = await Promise.all([
    context.waitForEvent('page'), dialog.locator('.playground-guide-tools a').click(),
  ]);
  await expect(guide.locator('#guideTitle')).toBeVisible();
  expect(await guide.evaluate(() => sessionStorage.getItem('bunfirvil:household-verification:v1'))).toBeNull();
  await expect(guide.locator('#guideEditLink')).toBeHidden();
  await guide.getByRole('link', { name: '놀이터로 돌아가기', exact: true }).first().click();
  await expect.poll(() => guide.isClosed()).toBe(true);
  expect(page.url()).toBe(playgroundUrl);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();

  // Same-tab reading also preserves the map, actor and plan variant.
  const standalone = new URL('guides/?guide=playground', page.url());
  standalone.hash = new URLSearchParams({ playground: new URL(playgroundUrl).pathname + new URL(playgroundUrl).search }).toString();
  await page.goto(standalone.href);
  await page.getByRole('link', { name: '놀이터로 돌아가기', exact: true }).first().click();
  await expect(page).toHaveURL(playgroundUrl);
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 60_000 });
  await expect(actor).toBeVisible();
  await expect(page.locator('[data-stage-option-select="wide-plank-floor-finish"]').first()).toBeVisible();

  await page.getByRole('button', { name: '가구 배치', exact: true }).click();
  await page.locator('#furniture-search').fill('현관 슬라이딩');
  await page.locator('[data-furniture-asset="entry-sliding-partition-door"]').click();
  await expect(stage).not.toHaveClass(/has-interior-ghost/);
  const option = page.locator('[data-option-card-id="entry-sliding-partition-door"]');
  await expect(option).toBeVisible();
  await expect(page.locator('[data-palette-tab="options"]')).toHaveClass(/is-active/);
  const before = Number(await canvas.getAttribute('data-apartment-prop-count'));
  // The checkbox is deliberately styled underneath its clickable label card.
  await option.locator('.option-copy b').click();
  await expect(option.locator('input')).toBeChecked();
  await expect.poll(async () => Number(await canvas.getAttribute('data-apartment-prop-count'))).toBeGreaterThan(before);
  expect(await page.evaluate(id => JSON.parse(localStorage.getItem(`bunfirvil:review:v1:${id}`)!).selectedOptionIds, mapId))
    .toEqual(expect.arrayContaining(['wide-plank-floor-finish', 'entry-sliding-partition-door']));
  await expect(page.locator('#option-design-disclaimer')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileNotice = await noticeStyle();
  expect(mobileNotice.disclaimerSize).toBe(mobileNotice.storageSize);
  expect(mobileNotice.disclaimerColor).toBe(desktopNotice.disclaimerColor);
  await page.getByRole('button', { name: '놀이터 조작법' }).click();
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.width).toBeLessThanOrEqual(390);
  expect(box.height).toBeLessThanOrEqual(844);
  expect(Math.abs(box.x + box.width / 2 - 390 / 2)).toBeLessThan(2);
  expect(Math.abs(box.y + box.height / 2 - 844 / 2)).toBeLessThan(2);
  await dialog.screenshot({ path: testInfo.outputPath('mobile-guide-panel.png') });
  await dialog.getByRole('button', { name: '가이드 닫기' }).click();
  await expect(dialog).not.toBeVisible();
  // Software WebGL on CI can render less often than the 360ms attack lasts.
  // Advance a bounded animation frame rather than racing that transient state.
  // Keep the target beyond this test's deadline: the runner may take more
  // than 100ms to deliver pauseAt, which otherwise targets the virtual past.
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 600_000));
  await stage.focus();
  await page.keyboard.down('Space');
  await page.clock.runFor(40);
  await expect(actor).toHaveAttribute('data-motion', 'attack');
  await page.keyboard.up('Space');
  expect(errors).toEqual([]);
});

test('the in-playground guide preserves a read-only share without exposing authentication in its return context', async ({ page }) => {
  test.setTimeout(90_000);
  const json = strToU8(JSON.stringify({ schemaVersion: 1, sharedByNickname: '공유테스트',
    mapId: 'bundang-first-village-51a-prototype', unitType: '51A', planVariant: 'D',
    livingFacing: 'south-west', selectedOptionIds: ['wide-plank-floor-finish'], furniture: [],
  }));
  const compressed = zlibSync(json);
  const envelope = Buffer.alloc(4 + compressed.length);
  envelope.writeUInt32LE(json.length);
  envelope.set(compressed, 4);
  const token = envelope.toString('base64url');
  await page.addInitScript(() => sessionStorage.setItem('bunfirvil:household-verification:v1', JSON.stringify({
    schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(),
    role: 'verified', authRevision: 2, scope: 'share', nickname: '열람테스트',
  })));
  await page.goto(`./#share=v1.${token}`);
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 60_000 });
  await expect(page.locator('#option-design-disclaimer')).toBeVisible();
  await expect(page.locator('.option-storage-description')).toHaveCount(0);
  await page.getByRole('button', { name: '놀이터 조작법' }).click();
  const dialog = page.locator('#help-dialog');
  await expect(dialog.locator('article')).toBeVisible();
  const guideUrl = new URL((await dialog.locator('.playground-guide-tools a').getAttribute('href'))!);
  const returnUrl = new URLSearchParams(guideUrl.hash.slice(1)).get('playground')!;
  expect(new URL(returnUrl, page.url()).hash).toBe(`#share=v1.${token}`);
  expect(guideUrl.search).not.toMatch(/share|nickname|role|auth/i);
  await page.keyboard.press('Escape');
  await expect(page.locator('#map-title')).toHaveText('공유테스트님의 51A타입 공유 놀이터');
  await expect(page.locator('#open-sale-calculator')).toBeDisabled();
});
