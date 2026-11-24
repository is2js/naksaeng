import { expect, test, type Page } from '@playwright/test';
import { createBundangReadOnlyShare, encodeBundangReadOnlyShare } from '../../src/game/read-only-share';

test.describe.configure({ timeout: 75_000 });
test.use({ actionTimeout: 12_000 });

const picker = (page: Page) => page.locator('#household-building-picker');
const map = (page: Page, state: 'loading' | 'ready' | 'error' = 'ready') => picker(page).locator(`.building-map[data-building-map-state="${state}"]`);
const canvas = (page: Page) => map(page).locator('canvas[data-site-canvas]');
const marker = (page: Page, id: string) => map(page).locator(`[data-building-marker="${id}"]`);
const reset = (page: Page) => map(page).locator('[data-site-reset]');
const action = (page: Page) => map(page).locator('[data-site-confirm]');
const cards = (page: Page) => picker(page).locator('.household-building-picker');
const card = (page: Page, id: string) => cards(page).locator(`[data-choose-building="${id}"]`);
const facilityTrigger = (page: Page, id: string) => map(page).locator(`[data-site-facility-detail="${id}"]`);
const facilityDetail = (page: Page, id: string) => map(page).locator(`.building-map-viewport > [data-facility-detail="${id}"]`);
const isSiteModel = (url: string | URL) => {
  const target = new URL(url);
  return /\/bunfirvil-site-v\d+(?:-[^/]+)?\.glb$/.test(target.pathname)
    && !target.searchParams.has('url') && !target.searchParams.has('import');
};

const expectedWizardTitles = ['동 선택', '세대 선택', '닉네임 입력'];
const step = (page: Page, name: 'building' | 'unit' | 'nickname') => page.locator(`#household-step-${name}`);

function observedSiteModels(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', request => { if (isSiteModel(request.url())) requests.push(request.url()); });
  return requests;
}

async function openWhileModelIsDelayed(page: Page, loadingScreenshot?: string) {
  // Capture even a transient card render, then hold the model network response
  // until the real loading state has been measured.
  await page.addInitScript(() => {
    const state = window as Window & { __buildingCardsRendered?: boolean };
    state.__buildingCardsRendered = false;
    new MutationObserver(records => {
      if (records.some(record => Array.from(record.addedNodes).some(node =>
        node instanceof Element && (node.matches('[data-choose-building]') || node.querySelector('[data-choose-building]'))))) {
        state.__buildingCardsRendered = true;
      }
    }).observe(document, { childList: true, subtree: true });
  });
  let releaseModel!: () => void;
  const modelGate = new Promise<void>((resolve) => { releaseModel = resolve; });
  let requested = false;
  const modelRoute = (url: URL) => isSiteModel(url);
  await page.route(modelRoute, async route => {
    requested = true;
    await modelGate;
    await route.continue();
  });
  let frame: { width: number; height: number } | null = null;
  try {
    await page.goto('./', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => requested, { timeout: 30_000 }).toBe(true);
    const loading = map(page, 'loading');
    await expect(loading).toBeVisible();
    await expect(loading.getByRole('status')).toContainText(/불러오는 중/);
    await expect(cards(page)).toHaveCount(0);
    await expect(picker(page).locator('[data-choose-building]')).toHaveCount(0);
    frame = await loading.boundingBox();
    expect(frame?.height ?? 0).toBeGreaterThan(200);
    if (loadingScreenshot) await page.screenshot({ path: loadingScreenshot, animations: 'disabled' });
  } finally {
    releaseModel();
  }
  await expect(map(page)).toBeVisible({ timeout: 30_000 });
  const readyFrame = await map(page).boundingBox();
  expect(readyFrame?.width).toBeCloseTo(frame!.width, 0);
  expect(readyFrame?.height).toBeCloseTo(frame!.height, 0);
  expect(await page.evaluate(() => (window as Window & { __buildingCardsRendered?: boolean }).__buildingCardsRendered)).toBe(false);
  await page.unroute(modelRoute);
}

async function zoom(page: Page): Promise<number> {
  return Number(await canvas(page).getAttribute('data-zoom'));
}

async function readFacilityApproach(page: Page) {
  return {
    target: (await canvas(page).getAttribute('data-camera-target'))!,
    zoom: await zoom(page),
  };
}

async function expectFacilityApproach(page: Page, approach: Awaited<ReturnType<typeof readFacilityApproach>>) {
  await expect(canvas(page)).toHaveAttribute('data-camera-phase', 'manual');
  await expect(canvas(page)).toHaveAttribute('data-camera-target', approach.target);
  await expect.poll(() => zoom(page)).toBeCloseTo(approach.zoom, 3);
  await expect(reset(page)).toBeVisible();
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
  await expect(canvas(page)).toHaveAttribute('data-outline-building', id);
}

async function expectInlineFacility(page: Page, id: string, floor: 'b1' | '1f' | '2f', previousUrl: string) {
  const detail = facilityDetail(page, id);
  await expect(detail).toBeVisible({ timeout: 30_000 });
  await expect(detail).toHaveAttribute('data-active-facility-floor', floor);
  await expect(detail.locator('canvas[data-facility-detail-canvas]')).toBeVisible();
  await expect(detail.locator('[data-facility-return]')).toHaveAccessibleName('단지로 이동');
  await expect(detail.locator('.facility-detail-title')).not.toContainText(/\bB1\b/i);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(canvas(page)).toHaveAttribute('data-camera-phase', 'facility');
  await expect(page.getByRole('heading', { name: '분당퍼스트빌리지 동 선택' })).toBeVisible();
  await expect(step(page, 'building')).toHaveAttribute('aria-current', 'step');
  await expect(action(page)).toBeHidden();
  await expect(page).toHaveURL(previousUrl);
  return detail;
}

async function findFacilitySurfacePoint(page: Page, id: string) {
  const layer = await canvas(page).boundingBox();
  expect(layer).not.toBeNull();
  const line = map(page).locator(`[data-facility-leader="${id}"]`);
  const x = Number(await line.getAttribute('x1'));
  const y = Number(await line.getAttribute('y1'));
  for (let i = 0; i < 57; i++) {
    const distance = 6 * Math.sqrt(i), angle = 2.4 * i;
    const point = { x: layer!.x + x + distance * Math.cos(angle), y: layer!.y + y + distance * Math.sin(angle) };
    await page.mouse.move(point.x, point.y);
    if (await canvas(page).getAttribute('data-hover-facility') === id) return point;
  }
  throw new Error(`Could not find the visible coloured mesh for ${id}`);
}

test('main desktop wizard stays on its map while loading, outlines a single building and confirms the unit step', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await openWhileModelIsDelayed(page, testInfo.outputPath('desktop-in-map-loading.png'));
  await expect(page.locator('.household-wizard-progress button b')).toHaveText(expectedWizardTitles);
  await expect(page.locator('.household-topbar')).toBeVisible();
  await expect(step(page, 'building')).toHaveAttribute('aria-current', 'step');
  await expect(step(page, 'unit')).toBeDisabled();
  await expect(step(page, 'nickname')).toBeDisabled();
  await expect(page.getByRole('heading', { name: '분당퍼스트빌리지 동 선택' })).toBeVisible();
  await expectOverview(page);
  await expect(action(page)).toBeHidden();
  await expect(map(page).locator('[data-site-facility-label]:visible:not([data-facility-kind="main-entrance"], [data-facility-kind="sub-entrance"], [data-site-facility-detail])')).toHaveCount(0);
  await expect(map(page).locator('button[data-site-facility-detail]:visible')).toHaveCount(3);
  for (const id of ['community-1', 'community-2']) {
    await expect(facilityTrigger(page, id)).not.toContainText(/\bB1\b/i);
  }
  await expect(cards(page)).toHaveCount(0);
  await expect(map(page).locator('canvas[data-outline-building]')).toHaveCount(0);

  const desktopList = picker(page).locator('.household-building-map-list');
  await expect(desktopList.locator('[data-map-building]:visible')).toHaveCount(12);
  const sceneBounds = await canvas(page).boundingBox();
  const listBounds = await desktopList.boundingBox();
  expect(sceneBounds).not.toBeNull();
  expect(sceneBounds!.height).toBeGreaterThanOrEqual(600);
  expect(listBounds?.x ?? 0).toBeGreaterThan(sceneBounds!.x + sceneBounds!.width * .5);

  await marker(page, '105').click();
  await expectFocusedBuilding(page, '105');
  await expect(canvas(page)).toHaveAttribute('data-facility-areas', 'community-1 community-2 daycare-104');
  const facilityName = map(page).locator('span[data-site-facility-label]:visible').first();
  await expect(facilityName).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(facilityName).toHaveCSS('font-size', '8.5px');
  await expect(map(page).locator('[data-site-facility-legend]')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('desktop-105-outline.png'), animations: 'disabled' });
  await expect(step(page, 'building')).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('#household-building-detail')).toBeHidden();
  await desktopList.locator('[data-map-building="106"]').click();
  await expectFocusedBuilding(page, '106');
  await expect(marker(page, '105')).toHaveAttribute('aria-pressed', 'false');
  await reset(page).click();
  await expectOverview(page);
  await expect(action(page)).toBeHidden();
  await expect(map(page).locator('canvas[data-outline-building]')).toHaveCount(0);

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
  await expect(canvas(page)).toHaveAttribute('data-outline-building', '105');
  await expect(action(page)).toHaveText(/105동 세대 선택/);
  await action(page).click();
  await expect(page).toHaveURL(/#building=105$/);
});

test('facility areas and buttons work on a taller touch map without showing the legend', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await page.goto('./');
    await expect(map(page)).toBeVisible({ timeout: 30_000 });
    await expectOverview(page);
    await expect(map(page).locator('[data-site-facility-legend]')).toBeHidden();
    expect((await canvas(page).boundingBox())!.height).toBeGreaterThanOrEqual(525);
    await expect(map(page).locator('[data-site-facility-label]')).toHaveCount(35);
    await expect(map(page).locator('button[data-site-facility-detail]:visible')).toHaveCount(3);
    await expect(canvas(page)).toHaveAttribute('data-facility-areas', 'community-1 community-2 daycare-104');
    await page.screenshot({ path: testInfo.outputPath('mobile-facilities.png'), animations: 'disabled' });
    await expect(action(page)).toBeHidden();
    const before = page.url();
    const surface = await findFacilitySurfacePoint(page, 'community-2');
    await page.touchscreen.tap(surface.x, surface.y);
    const detail = await expectInlineFacility(page, 'community-2', 'b1', before);
    await expect(detail.getByRole('button', { name: '다함께돌봄센터', exact: true })).toHaveCount(1);
    await expect(detail.locator('[data-facility-room="care-rooms"]')).toHaveCount(0);
    const room = detail.locator('button[data-facility-room]:visible:not([data-unplaced])').first();
    const communityApproach = await readFacilityApproach(page);
    const name = (await room.textContent())!.trim();
    expect(name).not.toHaveLength(0);
    await room.tap();
    await expect(detail.locator('.facility-detail-current-name')).toHaveText(name);
    await detail.screenshot({ path: testInfo.outputPath('mobile-community-2-detail.png'), animations: 'disabled' });
    await detail.locator('[data-facility-return]').tap();
    await expect(detail).toHaveCount(0);
    await expect(page).toHaveURL(before);
    await expectFacilityApproach(page, communityApproach);
    await map(page).locator('[data-site-zoom="out"]').tap();
    await expect.poll(() => zoom(page)).toBeLessThan(communityApproach.zoom);
    await reset(page).tap();
    await expectOverview(page);

    // The third detail is also reachable directly from the unzoomed 390px overview.
    await facilityTrigger(page, 'daycare-104').tap();
    const school = await expectInlineFacility(page, 'daycare-104', '1f', before);
    const roomLabels = school.locator('button[data-facility-room]:visible:not([data-unplaced])');
    await expect(roomLabels.filter({ hasText: /^보육실$/ })).toHaveCount(7);
    await expect(roomLabels.filter({ hasText: /^화장실$/ })).toHaveCount(2);
    await expect(roomLabels.filter({ hasText: /^유아화장실$/ })).toHaveCount(4);
    await expect(roomLabels.filter({ hasText: /^조리실$/ })).toHaveCount(1);
    const schoolApproach = await readFacilityApproach(page);
    await school.locator('[data-facility-stair]').filter({ hasText: '2층으로' }).tap();
    await expect(school).toHaveAttribute('data-active-facility-floor', '2f');
    await school.locator('[data-facility-return]').tap();
    await expect(school).toHaveCount(0);
    await expectFacilityApproach(page, schoolApproach);
    await reset(page).tap();
    await expectOverview(page);
    await marker(page, '105').tap();
    await expectFocusedBuilding(page, '105');
  } finally {
    await context.close();
  }
});

test('desktop site right click keeps the selection, right drag pans, and the reset button restores overview', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./');
  await expectOverview(page);
  await page.locator('[data-map-building="105"]').click();
  await expectFocusedBuilding(page, '105');
  const before = await canvas(page).getAttribute('data-camera-target');
  const bounds = await canvas(page).boundingBox();
  const start = { x: bounds!.x + bounds!.width * .81, y: bounds!.y + bounds!.height * .31 };
  await page.evaluate(() => document.addEventListener('contextmenu', (event) => {
    document.body.dataset.mapContextMenuPrevented = String(event.defaultPrevented);
  }));
  await page.mouse.click(start.x, start.y, { button: 'right' });
  await expect(page.locator('body')).toHaveAttribute('data-map-context-menu-prevented', 'true');
  await expect(canvas(page)).toHaveAttribute('data-camera-target', before!);
  await expect(canvas(page)).toHaveAttribute('data-outline-building', '105');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(start.x + 59, start.y + 39, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  await expect(canvas(page)).not.toHaveAttribute('data-camera-target', before!);
  await expect(canvas(page)).toHaveAttribute('data-outline-building', '105');

  // Windows can deliver contextmenu after release, retargeted outside the
  // WebGL host. A new, unrelated right click outside must still be native.
  const title = page.getByRole('heading', { name: '분당퍼스트빌리지 동 선택' });
  const contextMenuIsSuppressed = () => title.evaluate(node =>
    !node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })));
  const titleBounds = (await title.boundingBox())!;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(titleBounds.x + 6, titleBounds.y + 6, { steps: 7 });
  await page.mouse.up({ button: 'right' });
  expect(await contextMenuIsSuppressed()).toBe(true);
  await title.evaluate(node => node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 2, pointerId: 1 })));
  expect(await contextMenuIsSuppressed()).toBe(false);
  await reset(page).click();
  await expectOverview(page);
});

test('all three facilities open in the same map; daycare stairs change floors and returning keeps the facility zoom', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('./');
  await expectOverview(page);
  const before = page.url();
  const overviewZoom = await zoom(page);
  const firstSurface = await findFacilitySurfacePoint(page, 'community-1');
  await page.mouse.click(firstSurface.x, firstSurface.y);
  const one = await expectInlineFacility(page, 'community-1', 'b1', before);
  await expect.poll(() => zoom(page)).toBeGreaterThan(overviewZoom * 1.5);
  const firstApproach = await readFacilityApproach(page);
  await one.locator('button[data-facility-room="fitness"]').click();
  await expect(one.locator('.facility-detail-current-name')).toHaveText('피트니스');
  await one.screenshot({ path: testInfo.outputPath('community-1-detail.png'), animations: 'disabled' });
  await one.locator('[data-facility-return]').click();
  await expect(one).toHaveCount(0);
  await expectFacilityApproach(page, firstApproach);
  await reset(page).click();
  await expectOverview(page);
  const communityTwo = facilityTrigger(page, 'community-2');
  await communityTwo.click();
  const two = await expectInlineFacility(page, 'community-2', 'b1', before);
  const secondApproach = await readFacilityApproach(page);
  await two.locator('button[data-facility-room="sports-court"]').click();
  await expect(two.locator('.facility-detail-current-name')).toHaveText('스포츠코트');
  await two.screenshot({ path: testInfo.outputPath('community-2-detail.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(two).toHaveCount(0);
  await expect(communityTwo).toBeFocused();
  await expectFacilityApproach(page, secondApproach);
  await reset(page).click();
  await expectOverview(page);

  await page.locator('[data-map-building="109"]').click();
  await expectFocusedBuilding(page, '109');
  await map(page).screenshot({ path: testInfo.outputPath('community-2-exterior.png'), animations: 'disabled' });
  await page.locator('[data-map-building="104"]').click();
  await expectFocusedBuilding(page, '104');
  const bounds = await canvas(page).boundingBox();
  // Tilt towards a near top view to expose the entrance side and whole roof.
  await page.mouse.move(bounds!.x + bounds!.width * .68, bounds!.y + bounds!.height * .4);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width * .74, bounds!.y + bounds!.height * .68, { steps: 10 });
  await page.mouse.up();
  const daycare = facilityTrigger(page, 'daycare-104');
  await expect(daycare).toBeVisible();
  await map(page).screenshot({ path: testInfo.outputPath('daycare-exterior.png'), animations: 'disabled' });
  const previousTarget = await canvas(page).getAttribute('data-camera-target');
  const schoolSurface = await findFacilitySurfacePoint(page, 'daycare-104');
  await page.mouse.click(schoolSurface.x, schoolSurface.y);
  const school = await expectInlineFacility(page, 'daycare-104', '1f', before);
  await expect(canvas(page)).toHaveAttribute('data-faded-building', '104');
  await expect(school.locator('canvas')).toBeVisible();
  expect(await school.locator('canvas').evaluate(node =>
    !node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))).toBe(true);
  const schoolApproach = await readFacilityApproach(page);
  expect(schoolApproach.target).not.toBe(previousTarget);
  await school.locator('[data-facility-stair]').filter({ hasText: '2층으로' }).click();
  await expect(school).toHaveAttribute('data-active-facility-floor', '2f');
  await school.getByRole('button', { name: /^교사실$/ }).click();
  await expect(school.locator('.facility-detail-current-name')).toHaveText('교사실');
  await school.screenshot({ path: testInfo.outputPath('daycare-2f-detail.png'), animations: 'disabled' });
  await school.locator('[data-facility-stair]').filter({ hasText: '1층으로' }).click();
  await expect(school).toHaveAttribute('data-active-facility-floor', '1f');
  await school.locator('[data-facility-return]').click();
  await expect(school).toHaveCount(0);
  await expect(canvas(page)).not.toHaveAttribute('data-faded-building');
  await expect(canvas(page)).toHaveAttribute('data-outline-building', '104');
  await expectFacilityApproach(page, schoolApproach);
  await expect(action(page)).toHaveText(/104동 세대 선택/);
  await expect(page).toHaveURL(before);
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

  test('mobile loading never flashes cards; 3D has no stacked list and supports tap and pinch', async ({ page }, testInfo) => {
    await openWhileModelIsDelayed(page, testInfo.outputPath('mobile-in-map-loading.png'));
    await expectOverview(page);
    await expect(cards(page)).toHaveCount(0);
    await expect(picker(page).locator('.household-building-map-list [data-map-building]:visible')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await marker(page, '105').tap();
    await expectFocusedBuilding(page, '105');
    await expect(action(page)).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('mobile-105-outline.png'), animations: 'disabled' });
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

  test('model failures stay in the mobile map until retry or explicit card recovery', async ({ page }) => {
    let attempts = 0;
    let allowModel = false;
    await page.route(url => isSiteModel(url), route => {
      attempts += 1;
      return allowModel ? route.continue() : route.abort();
    });
    await page.goto('./?source=smoke#keep-anchor');
    const failure = map(page, 'error');
    const retry = failure.locator('[data-site-retry]');
    const legacy = failure.locator('[data-site-card-fallback]');
    await expect(failure).toBeVisible({ timeout: 30_000 });
    const errorFrame = await failure.boundingBox();
    expect(attempts).toBe(1);
    await expect(retry).toBeVisible();
    await expect(legacy).toHaveText('기존 카드로 선택');
    await expect(cards(page)).toHaveCount(0);
    await expect(picker(page).locator('[data-choose-building]')).toHaveCount(0);

    allowModel = true;
    const beforeRetry = page.url();
    await retry.tap();
    await expect(map(page)).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(beforeRetry);
    expect(attempts).toBe(2);
    expect((await map(page).boundingBox())?.height).toBeCloseTo(errorFrame!.height, 0);
    await expect(cards(page)).toHaveCount(0);

    allowModel = false;
    await page.reload();
    await expect(failure).toBeVisible({ timeout: 30_000 });
    expect(attempts).toBe(3);
    await expect(cards(page)).toHaveCount(0);
    await legacy.tap();
    await expect(cards(page).locator('[data-choose-building]:visible')).toHaveCount(12);
    const legacyUrl = new URL(page.url());
    expect(legacyUrl.searchParams.get('buildingPicker')).toBe('cards');
    expect(legacyUrl.searchParams.get('source')).toBe('smoke');
    expect(legacyUrl.hash).toBe('#keep-anchor');
    await expect(map(page)).toHaveCount(0);
    await card(page, '106').tap();
    await expect(page).toHaveURL(/#building=106$/);
    await expect(step(page, 'unit')).toHaveAttribute('aria-current', 'step');
    await expect(page.getByRole('heading', { name: '106동 세대 선택' })).toBeVisible();
    expect(attempts).toBe(3);
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
