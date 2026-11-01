import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';

const require = createRequire(import.meta.url);
const { PNG } = require('playwright-core/lib/utilsBundle') as {
  PNG: { sync: { read: (buffer: Buffer) => { width: number; height: number; data: Buffer } } };
};
const map = 'bundang-first-village-55a-prototype';

async function enter(page: Page, option?: string): Promise<void> {
  await page.addInitScript(({ mapId, selected }) => {
    sessionStorage.setItem('bunfirvil:household-verification:v1', JSON.stringify({
      schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(), role: 'operator',
      authRevision: 2, scope: 'playground', nickname: '가림 검수',
    }));
    if (selected) localStorage.setItem(`bunfirvil:review:v1:${mapId}`, JSON.stringify({ selectedOptionIds: [selected] }));
  }, { mapId: map, selected: option });
  await page.goto(`./?map=${map}&variant=A`);
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 45_000 });
}

/**
 * Put a red plane in the *actual* actor layer and a black plane behind it.
 * Thus screenshot pixels measure the layer's real rendered mask alpha rather
 * than just testing CSS / SVG attributes. Stop the renderer after a frame so
 * mask coordinates and screenshots come from the same camera position.
 */
async function probeMaskPixels(page: Page, targetSelector: string): Promise<void> {
  await page.evaluate(async () => {
    const original = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = () => 0;
    await new Promise<void>((resolve) => original(() => original(() => resolve())));
  });
  const points = await page.locator('#actor-layer').evaluate((element, selector) => {
    const layer = element as HTMLElement;
    const stage = layer.parentElement!;
    const maskId = layer.style.mask.match(/#([^"')]+)/)?.[1];
    const mask = maskId ? document.getElementById(maskId) : null;
    if (!mask) throw new Error('actor layer mask is missing');
    const readPoints = (polygon: SVGPolygonElement) => [...polygon.points].map(({ x, y }) => ({ x, y }));
    const targets = [...mask.querySelectorAll<SVGPolygonElement>(selector)].filter((polygon) => {
      const rgb = polygon.getAttribute('fill')?.match(/rgb\((\d+),(\d+),(\d+)\)/);
      return rgb && Number(rgb[1]) > 15 && Number(rgb[1]) < 240;
    }).map(readPoints);
    const all = [...mask.querySelectorAll<SVGPolygonElement>('polygon')].map(readPoints);
    const inside = (poly: Array<{ x: number; y: number }>, x: number, y: number): boolean => {
      let result = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j];
        if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) result = !result;
      }
      return result;
    };
    const rect = layer.getBoundingClientRect();
    const actor = layer.querySelector<HTMLElement>('.rpg-actor:not([hidden]) .actor-sprite');
    if (!actor) throw new Error('visible actor sprite is missing');
    const actorRect = actor.getBoundingClientRect();
    const masked: Array<{ x: number; y: number }> = [];
    const clear: Array<{ x: number; y: number }> = [];
    for (let y = 16; y < rect.height - 16; y += 8) for (let x = 16; x < rect.width - 16; x += 8) {
      if (masked.length < 500 && x + rect.left >= actorRect.left && x + rect.left < actorRect.right
        && y + rect.top >= actorRect.top && y + rect.top < actorRect.bottom
        && targets.some((poly) => [[0, 0], [-2, 0], [2, 0], [0, -2], [0, 2]].every(([dx, dy]) => inside(poly, x + dx, y + dy)))) masked.push({ x, y });
      if (clear.length < 500 && !all.some((poly) => inside(poly, x, y))) clear.push({ x, y });
    }
    const black = document.createElement('div');
    black.id = 'actor-mask-probe-background';
    black.style.cssText = 'position:absolute;inset:0;background:rgb(0,0,0);z-index:7;pointer-events:none';
    stage.append(black);
    const red = document.createElement('div');
    red.id = 'actor-mask-probe-plane';
    red.style.cssText = 'position:absolute;inset:0;background:rgb(255,0,0);z-index:999999;pointer-events:none';
    layer.append(red);
    return { masked, clear, targets: targets.length };
  }, targetSelector);
  expect(points.targets).toBeGreaterThan(0);
  expect(points.masked.length).toBeGreaterThan(0);
  expect(points.clear.length).toBeGreaterThan(0);
  const image = PNG.sync.read(await page.locator('#game-stage').screenshot());
  const redAt = ({ x, y }: { x: number; y: number }) => {
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return -1;
    const index = (y * image.width + x) * 4;
    return image.data[index];
  };
  // At least one fully interior pixel is neither invisible nor fully opaque.
  expect(points.masked.some(point => { const value = redAt(point); return value > 15 && value < 240; })).toBe(true);
  expect(points.clear.some(point => redAt(point) > 245)).toBe(true);
}

test('faded wall partially masks actor-layer pixels while unobstructed pixels stay opaque', async ({ page }) => {
  test.setTimeout(120_000);
  await enter(page);
  const layer = page.locator('#actor-layer');
  await expect.poll(async () => Number(await layer.getAttribute('data-wall-mask-count') || 0), { timeout: 30_000 }).toBeGreaterThan(0);
  const overlaps = () => layer.evaluate(element => {
    const actor = element.querySelector<HTMLElement>('.rpg-actor:not([hidden]) .actor-sprite');
    if (!actor) return false;
    const layerBounds = element.getBoundingClientRect(), actorBounds = actor.getBoundingClientRect();
    const polygons = [...document.querySelectorAll<SVGPolygonElement>('polygon[data-wall-occluder="true"]')]
      .filter(polygon => Number(polygon.dataset.wallOpacity) > 0 && Number(polygon.dataset.wallOpacity) < .9);
    return polygons.some(polygon => {
      for (let y = actorBounds.top - layerBounds.top + 2; y < actorBounds.bottom - layerBounds.top - 2; y += 4) {
        for (let x = actorBounds.left - layerBounds.left + 2; x < actorBounds.right - layerBounds.left - 2; x += 4) {
          if (polygon.isPointInFill(new DOMPoint(x, y))) return true;
        }
      }
      return false;
    });
  });
  const stage = page.locator('#game-stage');
  for (const [x, y] of [[.5, .5], [.4, .5], [.6, .5], [.35, .65], [.65, .65], [.25, .45], [.75, .45], [.5, .7], [.3, .7], [.7, .7], [.45, .4], [.55, .4]]) {
    if (await overlaps()) break;
    await page.waitForTimeout(2_100);
    await stage.evaluate((element, point) => {
      const bounds = element.getBoundingClientRect();
      element.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, pointerType: 'mouse', button: 1, buttons: 4,
        clientX: bounds.left + point.x * bounds.width, clientY: bounds.top + point.y * bounds.height,
      }));
    }, { x, y });
    await page.waitForTimeout(400);
  }
  expect(await overlaps(), 'a faded wall must physically overlap the actor sprite').toBe(true);
  await probeMaskPixels(page, 'polygon[data-wall-occluder="true"]');
});

test('nearby ceiling appliance partially masks actor-layer pixels and restores when moved away', async ({ page }) => {
  test.setTimeout(150_000);
  await enter(page, 'system-ac-2-general');
  const stage = page.locator('#game-stage');
  const polygon = page.locator('polygon[data-ceiling-asset-id="ceiling-cassette-air-conditioner"][data-ground-x][data-ground-y]').first();
  await expect(polygon).toBeAttached({ timeout: 30_000 });
  const teleportNear = async () => {
    await stage.evaluate((element, polygonElement) => {
      const bounds = element.getBoundingClientRect();
      const target = polygonElement as SVGPolygonElement;
      element.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, pointerType: 'mouse', button: 1, buttons: 4,
        clientX: bounds.left + Number(target.dataset.groundX), clientY: bounds.top + Number(target.dataset.groundY),
      }));
    }, await polygon.elementHandle());
  };
  await teleportNear();
  await expect.poll(async () => Number(await polygon.getAttribute('data-ceiling-opacity')), { timeout: 15_000 }).toBeLessThan(.8);
  // Move to a different room after the teleport cooldown; the ceiling unit
  // must restore its opaque material and mask when no longer near the actor.
  for (const [x, y] of [[.5, .7], [.3, .6], [.7, .6], [.5, .4]]) {
    await page.waitForTimeout(2_100);
    await stage.evaluate((element, point) => {
      const bounds = element.getBoundingClientRect();
      element.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, pointerType: 'mouse', button: 1, buttons: 4,
        clientX: bounds.left + point.x * bounds.width, clientY: bounds.top + point.y * bounds.height,
      }));
    }, { x, y });
    await page.waitForTimeout(500);
    if (Number(await polygon.getAttribute('data-ceiling-opacity')) > .99) break;
  }
  await expect.poll(async () => Number(await polygon.getAttribute('data-ceiling-opacity')), { timeout: 10_000 }).toBeGreaterThan(.99);
  await expect(polygon).toHaveAttribute('fill', 'rgb(0,0,0)');
  await page.waitForTimeout(2_100);
  await teleportNear();
  await expect.poll(async () => Number(await polygon.getAttribute('data-ceiling-opacity')), { timeout: 15_000 }).toBeLessThan(.8);
  await probeMaskPixels(page, 'polygon[data-ceiling-asset-id="ceiling-cassette-air-conditioner"]');
});
