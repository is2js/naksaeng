import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';

const require = createRequire(import.meta.url);
const { PNG } = require('playwright-core/lib/utilsBundle') as { PNG: { sync: { read: (buffer: Buffer) => { width: number; data: Buffer } } } };
const map = 'bundang-first-village-55a-prototype';

async function checkMaskPixels(page: Page): Promise<void> {
  const layer = page.locator('#actor-layer');
  await expect.poll(async () => Number(await layer.getAttribute('data-ceiling-mask-count') || 0)).toBeGreaterThan(0);
  // Stop this page's animation after the already scheduled tick so the
  // screenshot and its sampled mask coordinates use the same camera frame.
  await page.evaluate(async () => {
    const original = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = () => 0;
    await new Promise<void>((resolve) => original(() => original(() => resolve())));
  });
  const points = await layer.evaluate((element) => {
    const match = element.style.mask.match(/#([^"')]+)/);
    const mask = match ? document.getElementById(match[1]) : null;
    const polygons = [...(mask?.querySelectorAll('polygon') || [])];
    const box = element.getBoundingClientRect();
    const regions = polygons.map((polygon) => [...polygon.points].map((point) => ({ x: point.x, y: point.y })));
    const left = Math.max(0, Math.floor(Math.min(...regions.flat().map((p) => p.x))));
    const right = Math.min(box.width - 1, Math.ceil(Math.max(...regions.flat().map((p) => p.x))));
    const top = Math.max(0, Math.floor(Math.min(...regions.flat().map((p) => p.y))));
    const bottom = Math.min(box.height - 1, Math.ceil(Math.max(...regions.flat().map((p) => p.y))));
    const contains = (poly: Array<{ x: number; y: number }>, x: number, y: number): boolean => {
      let isInside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j];
        if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) isInside = !isInside;
      }
      return isInside;
    };
    const inside = regions.map((region) => ({
      x: Math.round(region.reduce((sum, p) => sum + p.x, 0) / region.length),
      y: Math.round(region.reduce((sum, p) => sum + p.y, 0) / region.length),
    })).filter((point) => point.x >= 0 && point.y >= 0 && point.x < box.width && point.y < box.height);
    const gap: Array<{ x: number; y: number }> = [];
    for (let y = top; y <= bottom && gap.length < 100; y += 20) for (let x = left; x <= right && gap.length < 100; x += 20) {
      const point = { x: Math.round(x), y: Math.round(y) };
      if (!regions.some((region) => contains(region, x, y))) gap.push(point);
    }
    const overlay = document.createElement('div');
    overlay.id = 'mask-pixel-probe';
    overlay.style.cssText = 'position:absolute;inset:0;background:rgb(255,0,0);z-index:999;pointer-events:none';
    element.append(overlay);
    return { inside, gap };
  });
  expect(points.inside.length).toBeGreaterThan(0);
  expect(points.gap.length).toBeGreaterThan(0);
  const image = PNG.sync.read(await page.locator('#game-stage').screenshot());
  const isRed = ({ x, y }: { x: number; y: number }): boolean => {
    const offset = (y * image.width + x) * 4;
    return image.data[offset] > 245 && image.data[offset + 1] < 10 && image.data[offset + 2] < 10;
  };
  expect(points.inside.some((point) => !isRed(point))).toBe(true);
  expect(points.gap.some(isRed)).toBe(true);
  await layer.locator('#mask-pixel-probe').evaluate((element) => element.remove());
}

test('air conditioner and ventilation mask only their projected parts and clear after deselection', async ({ page, context }) => {
  test.setTimeout(180_000);
  await context.addInitScript(() => sessionStorage.setItem('bunfirvil:household-verification:v1', JSON.stringify({
    schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(), role: 'operator', authRevision: 2, scope: 'playground', nickname: '테스트',
  })));
  await page.goto(`./?map=${map}&variant=A`);
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 25_000 });
  for (const option of ['system-ac-2-general', 'air-planner-ceiling-vent']) {
    await page.evaluate(({ mapId, optionId }) => localStorage.setItem(`bunfirvil:review:v1:${mapId}`, JSON.stringify({ selectedOptionIds: [optionId] })), { mapId: map, optionId: option });
    await page.reload();
    await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 25_000 });
    await checkMaskPixels(page);
    await page.evaluate((mapId) => localStorage.setItem(`bunfirvil:review:v1:${mapId}`, JSON.stringify({ selectedOptionIds: [] })), map);
    await page.reload();
    await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 25_000 });
    await expect(page.locator('#actor-layer')).not.toHaveAttribute('data-ceiling-mask-count');
    await expect(page.locator('#actor-layer')).not.toHaveAttribute('style', /mask:/);
  }
});

test('ceiling appliances fade near the player and return to opaque when the player moves away', async ({ page, context }) => {
  test.setTimeout(240_000);
  await context.addInitScript(() => sessionStorage.setItem('bunfirvil:household-verification:v1', JSON.stringify({
    schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(), role: 'operator', authRevision: 2, scope: 'playground', nickname: '테스트',
  })));
  const appliances = [
    { option: 'system-ac-2-general', asset: 'ceiling-cassette-air-conditioner' },
    { option: 'air-planner-ceiling-vent', asset: 'air-planner-ceiling-vent' },
    { option: 'bathroom-combination-ventilator', asset: 'bunfirvil-bathroom-combination-ventilator-rounded' },
  ];
  const stage = page.locator('#game-stage');
  const canvas = page.locator('#three-world-canvas');
  const layer = page.locator('#actor-layer');
  await page.goto(`./?map=${map}&variant=A`);
  for (const { option, asset } of appliances) {
    await page.evaluate(({ mapId, optionId }) => localStorage.setItem(`bunfirvil:review:v1:${mapId}`, JSON.stringify({ selectedOptionIds: [optionId] })), { mapId: map, optionId: option });
    await page.reload();
    await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 25_000 });
    const polygons = page.locator(`polygon[data-ceiling-asset-id="${asset}"][data-ground-x][data-ground-y]`);
    await expect(polygons.first()).toBeAttached({ timeout: 20_000 });
    const propId = await polygons.first().getAttribute('data-ceiling-prop-id');
    expect(propId).toBeTruthy();
    const polygon = page.locator(`polygon[data-ceiling-prop-id="${propId}"]`).first();
    const teleport = async (x: number, y: number): Promise<void> => {
      await stage.evaluate((element, point) => {
        const bounds = element.getBoundingClientRect();
        element.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, pointerType: 'mouse', button: 1, buttons: 4,
          clientX: bounds.left + point.x, clientY: bounds.top + point.y,
        }));
      }, { x, y });
      await page.waitForTimeout(2_100);
    };
    await stage.evaluate((element, id) => {
      const target = document.querySelector<SVGPolygonElement>(`polygon[data-ceiling-prop-id="${id}"]`);
      if (!target) throw new Error('천장 설비가 화면에 없습니다.');
      const bounds = element.getBoundingClientRect();
      element.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, pointerType: 'mouse', button: 1, buttons: 4,
        clientX: bounds.left + Number(target.dataset.groundX), clientY: bounds.top + Number(target.dataset.groundY),
      }));
    }, propId);
    await page.waitForTimeout(2_100);
    await expect.poll(async () => Number(await polygon.getAttribute('data-ceiling-opacity')), { timeout: 10_000 }).toBeLessThan(0.8);
    await expect.poll(async () => Number(await canvas.getAttribute('data-ceiling-faded-count'))).toBeGreaterThan(0);
    const fadedFill = await polygon.getAttribute('fill');
    expect(fadedFill).toMatch(/^rgb\((?!0,0,0)/);
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    for (const [x, y] of [[0.5, 0.7], [0.3, 0.6], [0.7, 0.6], [0.5, 0.4]]) {
      if (Number(await polygon.getAttribute('data-ceiling-opacity')) > .99) break;
      await teleport(box!.width * x, box!.height * y);
    }
    await expect.poll(async () => Number(await polygon.getAttribute('data-ceiling-opacity')), { timeout: 10_000 }).toBeGreaterThan(.99);
    await expect(polygon).toHaveAttribute('fill', 'rgb(0,0,0)');
  }
  await page.evaluate((mapId) => localStorage.setItem(`bunfirvil:review:v1:${mapId}`, JSON.stringify({ selectedOptionIds: [] })), map);
  await page.reload();
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 25_000 });
  await expect(layer).not.toHaveAttribute('data-ceiling-mask-count');
});
