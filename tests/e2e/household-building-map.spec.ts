import { expect, test, type Page } from '@playwright/test';
import { createBundangReadOnlyShare, encodeBundangReadOnlyShare } from '../../src/game/read-only-share';

test.describe.configure({ timeout: 75_000 });
test.use({ actionTimeout: 12_000 });

const picker = (page: Page) => page.locator('#household-building-picker');
const map = (page: Page) => picker(page).locator('.building-map[data-building-map-state="ready"]');
const canvas = (page: Page) => map(page).locator('canvas[data-site-canvas]');
const marker = (page: Page, id: string) => map(page).locator(`[data-building-marker="${id}"]`);
const reset = (page: Page) => map(page).locator('[data-site-reset]');
const action = (page: Page) => map(page).locator('[data-site-confirm]');
const cards = (page: Page) => picker(page).locator('.household-building-picker');
const card = (page: Page, id: string) => cards(page).locator(`[data-choose-building="${id}"]`);
const isSiteModel = (url: string | URL) => /\/bunfirvil-site-v\d+(?:-[^/]+)?\.glb$/.test(new URL(url).pathname);

const expectedWizardTitles = ['동 선택', '세대 선택', '닉네임 입력'];
const step = (page: Page, name: 'building' | 'unit' | 'nickname') => page.locator(`#household-step-${name}`);

function observedSiteModels(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', request => { if (isSiteModel(request.url())) requests.push(request.url()); });
  return requests;
}

async function zoom(page: Page): Promise<number> {
  return Number(await canvas(page).getAttribute('data-zoom'));
}

async function expectOverview(page: Page) {
  await expect(canvas(page)).toHaveAttribute('data-camera-phase', 'overview');
  await expect(map(page).locator('[data-site-compass]')).toHaveAttribute('data-bearing', '0');
  await expect(reset(page)).toBeHidden();
}

async function expectFocusedBuilding(page: Page, id: string) {
  await expect(canvas(page)).toHaveAttribute('data-camera-phase', 'building', { timeout: 12_000 });
  await expect.poll(() => zoom(page)).toBeGreaterThan(1.1);
  await expect(reset(page)).toBeVisible();
  await expect(reset(page)).toContainText('다시 한눈에');
  await expect(action(page)).toBeVisible();
  await expect(action(page)).toHaveText(new RegExp(`${id}동 세대 선택`));
}

test('main desktop wizard embeds the building map and confirms the unit step without changing the wizard', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('./');
  await expect(map(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.household-wizard-progress button b')).toHaveText(expectedWizardTitles);
  await expect(page.locator('.household-topbar')).toBeVisible();
  await expect(step(page, 'building')).toHaveAttribute('aria-current', 'step');
  await expect(step(page, 'unit')).toBeDisabled();
  await expect(step(page, 'nickname')).toBeDisabled();
  await expect(page.getByRole('heading', { name: '분당퍼스트빌리지 동 선택' })).toBeVisible();
  await expectOverview(page);
  await expect(action(page)).toBeHidden();
  await expect(cards(page)).toBeHidden();

  const desktopList = picker(page).locator('.household-building-map-list');
  await expect(desktopList.locator('[data-map-building]:visible')).toHaveCount(12);
  const sceneBounds = await canvas(page).boundingBox();
  const listBounds = await desktopList.boundingBox();
  expect(sceneBounds).not.toBeNull();
  expect(listBounds?.x ?? 0).toBeGreaterThan(sceneBounds!.x + sceneBounds!.width * .5);

  await marker(page, '105').click();
  await expectFocusedBuilding(page, '105');
  await expect(step(page, 'building')).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('#household-building-detail')).toBeHidden();
  await reset(page).click();
  await expectOverview(page);
  await expect(action(page)).toBeHidden();

  await desktopList.locator('[data-map-building="105"]').click();
  await expectFocusedBuilding(page, '105');
  await action(page).click();
  await expect(page).toHaveURL(/#building=105$/);
  await expect(step(page, 'unit')).toHaveAttribute('aria-current', 'step');
  await expect(page.getByRole('heading', { name: '105동 세대 선택' })).toBeVisible();
  await expect(page.locator('.household-cell[data-building="105"][data-floor="25"][data-line="1"]')).toBeVisible();
  await expect(picker(page)).toBeHidden();

  await page.goBack();
  await expect(map(page)).toBeVisible({ timeout: 30_000 });
  await expect(step(page, 'building')).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('#household-building-detail')).toBeHidden();
  await expectOverview(page);
  await expect(desktopList.locator('[data-map-building="105"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(action(page)).toHaveText(/105동 세대 선택/);
  await action(page).click();
  await expect(page).toHaveURL(/#building=105$/);
});

async function pinchFromOpenCanvas(page: Page) {
  const bounds = await canvas(page).boundingBox();
  expect(bounds).not.toBeNull();
  const from = await canvas(page).evaluate((surface, area) => {
    for (const y of [.55, .37, .68, .77, .29]) {
      for (const x of [.5, .42, .58, .27, .72]) {
        const center = { x: area.x + area.width * x, y: area.y + area.height * y };
        if ([-20, 20].every(offset => document.elementFromPoint(center.x + offset, center.y) === surface)) return center;
      }
    }
    return null;
  }, bounds!);
  expect(from, 'find two unobscured touch points on the rendered model').not.toBeNull();
  const cdp = await page.context().newCDPSession(page);
  const points = (distance: number) => [-distance, distance].map((offset, id) => ({ id, x: from!.x + offset, y: from!.y }));
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(20) });
    for (const distance of [26, 34, 44, 54]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(distance) });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await cdp.detach();
  }
}

test.describe('main wizard at 390px and on touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1, reducedMotion: 'reduce' });

  test('no stacked building list during successful 3D; tap and pinch operate in the model', async ({ page }) => {
    await page.goto('./');
    await expect(map(page)).toBeVisible({ timeout: 30_000 });
    await expectOverview(page);
    await expect(cards(page)).toBeHidden();
    await expect(picker(page).locator('.household-building-map-list [data-map-building]:visible')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await marker(page, '105').tap();
    await expectFocusedBuilding(page, '105');
    await expect(action(page)).toBeInViewport();
    await reset(page).tap();
    await expectOverview(page);
    await expect(action(page)).toBeHidden();

    const before = await zoom(page);
    await pinchFromOpenCanvas(page);
    await expect.poll(() => zoom(page)).toBeGreaterThan(before * 1.1);
    await expect(reset(page)).toBeVisible();
    await expect(action(page)).toBeHidden();
    await expect(step(page, 'building')).toHaveAttribute('aria-current', 'step');
  });

  test('a failed model reveals the original mobile cards and still opens the unit step', async ({ page }) => {
    let aborted = 0;
    await page.route(url => isSiteModel(url), route => {
      aborted += 1;
      return route.abort();
    });
    await page.goto('./');
    await expect(page.locator('#household-building-map-fallback-notice')).toBeVisible({ timeout: 30_000 });
    expect(aborted).toBe(1);
    await expect(map(page)).toHaveCount(0);
    await expect(cards(page).locator('[data-choose-building]:visible')).toHaveCount(12);
    await card(page, '106').tap();
    await expect(page).toHaveURL(/#building=106$/);
    await expect(step(page, 'unit')).toHaveAttribute('aria-current', 'step');
    await expect(page.getByRole('heading', { name: '106동 세대 선택' })).toBeVisible();
  });
});

test('explicit cards, direct building hashes and authenticated map links do not request the site model', async ({ page }) => {
  const siteRequests = observedSiteModels(page);
  await page.goto('./?buildingPicker=cards');
  await expect(cards(page).locator('[data-choose-building]:visible')).toHaveCount(12);
  await expect(picker(page).locator('canvas[data-site-canvas]')).toHaveCount(0);
  await card(page, '105').click();
  await expect(page).toHaveURL(/\?buildingPicker=cards#building=105$/);
  await expect(step(page, 'unit')).toHaveAttribute('aria-current', 'step');

  await page.goto('./#building=109');
  await expect(page.getByRole('heading', { name: '109동 세대 선택' })).toBeVisible();
  await expect(step(page, 'unit')).toHaveAttribute('aria-current', 'step');

  await page.addInitScript(() => sessionStorage.setItem('bunfirvil:household-verification:v1', JSON.stringify({
    schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(),
    role: 'public', authRevision: 2, scope: 'playground', nickname: '테스트 입주자',
  })));
  await page.goto('./?map=bundang-first-village-55a-prototype&variant=A');
  await expect(page.locator('#game-stage')).toBeAttached({ timeout: 30_000 });
  await expect(picker(page)).toHaveCount(0);
  expect(siteRequests).toEqual([]);
});

test('a read-only share keeps its two-step building cards and skips the site model', async ({ page }) => {
  const siteRequests = observedSiteModels(page);
  const token = encodeBundangReadOnlyShare(createBundangReadOnlyShare({
    sharedByNickname: '테스트 공유자',
    mapId: 'bundang-first-village-55a-prototype',
    unitType: '55A',
    planVariant: 'A',
    selectedOptionIds: [],
    furniture: [],
  }));
  await page.goto(`./#share=v1.${token}`);
  await expect(cards(page).locator('[data-choose-building]:visible')).toHaveCount(12);
  await expect(page.locator('.household-wizard-progress button b')).toHaveText(['동 선택', '닉네임 입력']);
  await expect(picker(page).locator('canvas[data-site-canvas]')).toHaveCount(0);
  await card(page, '105').click();
  await expect(page.locator('#household-nickname-stage')).toBeVisible();
  await expect(step(page, 'nickname')).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('#household-building-detail')).toBeHidden();
  expect(siteRequests).toEqual([]);
});
