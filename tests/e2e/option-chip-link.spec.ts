import { expect, test } from '@playwright/test';

const OPTION_ID = 'air-planner-ceiling-vent';

async function expectLinkedOption(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.locator('#option-palette-body')).toBeVisible();
  await expect(page.locator('#option-categories button.is-active')).toHaveText('빌트인 가전');
  await expect(page.locator(`[data-option-card-id="${OPTION_ID}"]`)).toHaveClass(/is-world-linked/);
  await expect(page.locator(`.stage-option-chip[data-stage-option-select="${OPTION_ID}"]`)).toHaveClass(/is-world-selected/);
  await expect(page.locator('#three-world-canvas')).toHaveAttribute('data-selected-editor-mask', 'rpg-gold');
  await expect(page.locator('#three-world-canvas')).toHaveAttribute('data-air-planner-room-unit-count', '4');

  const cardIsVisible = await page.locator(`[data-option-card-id="${OPTION_ID}"]`).evaluate((card) => {
    const list = card.closest('#option-list');
    if (!list) return false;
    const listBounds = list.getBoundingClientRect();
    const cardBounds = card.getBoundingClientRect();
    return cardBounds.top >= listBounds.top && cardBounds.bottom <= listBounds.bottom;
  });
  expect(cardIsVisible).toBe(true);
}

test('좌하단 옵션 chip은 옵션·가구 탭 모두에서 인게임 mask와 우측 카드로 연결된다', async ({ page }) => {
  await page.route('https://script.google.com/**', route => route.abort());
  await page.addInitScript(() => {
    sessionStorage.setItem('bunfirvil:household-verification:v1', JSON.stringify({
      schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(), role: 'verified', memberCodeRevision: 1,
      authRevision: 2, scope: 'playground', nickname: '옵션 연결 확인',
    }));
    localStorage.removeItem('bunfirvil:review:v1:bundang-first-village-55a-prototype');
    localStorage.removeItem('bunfirvil:layout:v1:bundang-first-village-55a-prototype');
  });
  await page.goto('./?map=bundang-first-village-55a-prototype&actor=200&variant=A');
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 30_000 });

  await page.locator(`input[data-option-id="${OPTION_ID}"]`).setChecked(true, { force: true });
  const chipButton = page.locator(`button[data-stage-option-select="${OPTION_ID}"]`);
  await expect(chipButton).toBeVisible();
  const installedState = () => page.evaluate(() => ({
    review: localStorage.getItem('bunfirvil:review:v1:bundang-first-village-55a-prototype'),
    price: document.querySelector('#stage-option-total')!.textContent,
  }));
  const baseline = await installedState();

  // 기본 옵션 탭: stage pointerdown이 chip DOM을 교체하지 않아야 한다.
  await chipButton.click();
  await expectLinkedOption(page);

  // 이미 활성인 칩의 바깥 테두리를 다시 누르면 설치를 취소하지 않고
  // 강조만 OFF한다. 한 번 더 누르면 옵션 탭/카드까지 다시 연결된다.
  await page.getByRole('button', { name: '가구 배치', exact: true }).click();
  const chip = page.locator(`.stage-option-chip[data-stage-option-select="${OPTION_ID}"]`);
  await chip.click({ position: { x: 1, y: 1 } });
  await expect(chip).not.toHaveClass(/is-world-selected/);
  await expect(page.locator(`[data-option-card-id="${OPTION_ID}"]`)).not.toHaveClass(/is-world-linked/);
  await expect(page.locator('#three-world-canvas')).toHaveAttribute('data-selected-editor-prop-id', '');
  await expect(page.locator('#three-world-canvas')).not.toHaveAttribute('data-selected-editor-mask', /.+/);
  await expect(page.locator(`input[data-option-id="${OPTION_ID}"]`)).toBeChecked();
  expect(await installedState()).toEqual(baseline);
  await chip.click({ position: { x: 1, y: 1 } });
  await expectLinkedOption(page);
  expect(await installedState()).toEqual(baseline);

  // 삭제 X는 강조 토글과 달리 설치 옵션/견적에서 실제로 제거한다.
  await chip.locator('.stage-option-remove').click();
  await expect(chip).toHaveCount(0);
  await expect(page.locator(`input[data-option-id="${OPTION_ID}"]`)).not.toBeChecked();
  await expect(page.locator('#option-selected-count')).toHaveText('0개');
  await expect(page.locator('#stage-option-total')).toHaveText('0원');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bunfirvil:review:v1:bundang-first-village-55a-prototype')!).selectedOptionIds)).toEqual([]);
});
