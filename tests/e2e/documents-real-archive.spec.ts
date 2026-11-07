import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';

test('실제 공개 자료실은 인증 없이 검토된 여섯 문서를 지연 열람·다운로드한다', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const pdfRequests: string[] = [];
  page.on('request', request => { if (/\.pdf(?:[?#]|$)/i.test(request.url())) pdfRequests.push(request.url()); });
  await page.setViewportSize({ width: 390, height: 844 });
  const catalogResponse = await page.request.get('documents/document-catalog.v1.json');
  expect(catalogResponse.ok()).toBe(true);
  const catalog = await catalogResponse.json() as { documents: Array<{ id: string; file: string; bytes: number; sha256: string }> };
  expect(catalog.documents.map(document => document.id).sort()).toEqual([
    'contract-procedure', 'funding-plan-notice', 'mortgage-product', 'sale-notice', 'stamp-tax-notice', 'supply-guide',
  ]);
  for (const document of catalog.documents) {
    const response = await page.request.head(document.file);
    expect(response.ok(), document.id).toBe(true);
    expect(response.headers()['content-type'], document.id).toContain('application/pdf');
    expect(Number(response.headers()['content-length']), document.id).toBe(document.bytes);
  }
  await page.goto('documents/?document=mortgage-product');
  await expect(page.locator('#documentsStatus')).toContainText('6개 보관 문서');
  await expect(page.locator('#documentTitle')).toHaveText('신혼희망타운 전용 모기지 상품설명서');
  await expect(page.locator('.document-notice')).toContainText('고객확인란');
  await expect(page.locator('a[href*="vflat"]')).toHaveCount(0);
  expect(pdfRequests).toEqual([]);
  await expect(page.locator('.skip-link')).toHaveCSS('opacity', '0');
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await expect(page.locator('.skip-link')).toHaveCSS('opacity', '1');
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toHaveCSS('opacity', '0');
  const document = catalog.documents.find(item => item.id === 'mortgage-product')!;
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.document-download').click()]);
  expect(await download.failure()).toBeNull();
  const path = (await download.path())!;
  expect((await stat(path)).size).toBe(document.bytes);
  expect(createHash('sha256').update(await readFile(path)).digest('hex')).toBe(document.sha256);
  await expect(page.locator('#documentPdfViewer iframe')).toHaveCount(0);
  await page.locator('[data-preview-document="mortgage-product"]').click();
  await expect(page.locator('#documentPdfViewer iframe')).toHaveAttribute('src', /shinhui-mortgage-product-20261107\.pdf/);
  await page.locator('[data-preview-document="mortgage-product"]').click();
  await expect(page.locator('#documentPdfViewer iframe')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('actual-document-archive-mobile.png'), fullPage: true });
  await page.goto('guides/?guide=mortgage-product');
  await expect(page.locator('body')).toContainText('발코니 확장비 포함');
  await expect(page.locator('body')).toContainText('감정가보다');
  await expect(page.locator('a[href*="vflat"]')).toHaveCount(0);
  await expect(page.locator('a[href*="documents/?document=mortgage-product"]').first()).toBeVisible();
});
