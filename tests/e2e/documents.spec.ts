import { expect, test } from '@playwright/test';

test('공개 자료실은 PDF를 요청할 때만 열고 모바일에서도 다운로드·출처·요약을 제공한다', async ({ page }, testInfo) => {
  const entry = {
    id: 'mortgage-product', title: '전용 모기지 상품설명서', description: '상품 조건과 계산 사항을 확인합니다.',
    category: 'mortgage', file: 'documents/mortgage-product-20261107.pdf', sourceUrl: 'https://example.com/mortgage',
    sourceLabel: '상품설명서 원문', retrievedAt: '2026-11-07', pageCount: 12, bytes: 250000,
    summaryGuideId: 'mortgage-product', notice: '단지 적용 금리와 실제 심사 조건을 구분해 확인하세요.',
  };
  let malformed = false;
  await page.route('**/documents/document-catalog.v1.json', route => route.fulfill({ json: {
    schemaVersion: 1, updatedAt: '2026-11-07', documents: [entry, {
      ...entry, id: 'official-notice', title: '입주자모집공고', category: 'official',
      file: malformed ? '../private.pdf' : 'documents/official-notice.pdf', summaryGuideId: undefined,
    }],
  } }));
  const pdfRequests: string[] = [];
  await page.route('**/*.pdf', async route => { pdfRequests.push(route.request().url()); await route.abort(); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('documents/?document=not-a-registered-document');
  await expect(page.getByRole('heading', { name: '공식 문서 · PDF 자료실', exact: true })).toBeVisible();
  await expect(page.locator('#documentTitle')).toHaveText(entry.title);
  await expect(page.locator('#documentReader iframe')).toHaveCount(0);
  expect(pdfRequests).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
  await expect(page.locator('.documents-privacy')).toContainText('개인 공급계약서·서명 문서·가상계좌는 공개하지 않습니다');
  await expect(page.getByRole('link', { name: 'PDF 다운로드', exact: true })).toHaveAttribute('href', /\/naksaeng\/bunfirvil\/documents\/mortgage-product-20261107\.pdf$/);
  await expect(page.getByRole('link', { name: 'PDF 다운로드', exact: true })).toHaveAttribute('download', `${entry.title}.pdf`);
  await expect(page.getByRole('link', { name: '핵심·계산 안내 읽기 →' })).toHaveAttribute('href', '../guides/?guide=mortgage-product');
  await expect(page.getByRole('link', { name: '상품설명서 원문 ↗' })).toHaveAttribute('href', entry.sourceUrl);
  await expect(page.getByRole('link', { name: '상품설명서 원문 ↗' })).toHaveAttribute('rel', 'noopener noreferrer');
  await page.getByRole('button', { name: '이 화면에서 PDF 보기', exact: true }).click();
  await expect(page.locator('#documentReader iframe')).toHaveAttribute('src', /mortgage-product-20261107\.pdf#view=FitH$/);
  await expect.poll(() => pdfRequests.length).toBe(1);
  await page.getByRole('button', { name: 'PDF 미리보기 닫기', exact: true }).click();
  await expect(page.locator('#documentReader iframe')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '이 화면에서 PDF 보기', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: '입주자모집공고', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#documentTitle')).toHaveText('입주자모집공고');
  expect(new URL(page.url()).searchParams.get('document')).toBe('official-notice');
  await expect(page.locator('#documentReader iframe')).toHaveCount(0);
  expect(pdfRequests).toHaveLength(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('link', { name: 'PDF 다운로드', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'PDF 새 탭에서 열기 ↗' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('documents-mobile.png'), fullPage: true });
  malformed = true;
  await page.reload();
  await expect(page.locator('#documentsError')).toBeVisible();
  await expect(page.locator('#documentsLayout')).toBeHidden();
  await expect(page.locator('#documentReader a')).toHaveCount(0);
});
