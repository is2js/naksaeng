import { expect, test } from '@playwright/test';

// One real playground instance, its actual renderer and actor. The prototype
// hook exists only in this test; no position/debug endpoint ships in the app.
test('55B first, then all 12 plan variants keep wall and actor masks at face/cap contact', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  let rendererModule = '';
  const errors: string[] = [];
  page.on('response', response => { if (/\/assets\/three-world-[^/]+\.js$/.test(response.url())) rendererModule = response.url(); });
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => sessionStorage.setItem('bunfirvil:household-verification:v1', JSON.stringify({
    schemaVersion: 1, provider: 'google-apps-script', verifiedAt: Date.now(),
    role: 'operator', authRevision: 2, scope: 'playground', nickname: '벽 가림 검수',
  })));
  await page.goto('./?map=bundang-first-village-55b-prototype&variant=B');
  await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/, { timeout: 45_000 });
  expect(rendererModule).not.toBe('');
  await page.evaluate(async url => {
    const { ThreeWorldRenderer } = await import(/* @vite-ignore */ url);
    const original = ThreeWorldRenderer.prototype.setOcclusionFocus;
    ThreeWorldRenderer.prototype.setOcclusionFocus = function(actor: unknown) {
      (window as any).__wallProbe = { renderer: this, actor };
      return original.call(this, actor);
    };
  }, rendererModule);
  await page.waitForFunction(() => Boolean((window as any).__wallProbe?.actor));

  const results: unknown[] = [];
  const plans: Array<[string, string[]]> = [['55B', ['B', 'A']], ['51A', ['A', 'B', 'C', 'D']], ['55A', ['A', 'B', 'C', 'D']], ['59A', ['A', 'B']]];
  for (const [unit, variants] of plans) for (const variant of variants) {
    const mapId = `bundang-first-village-${unit.toLowerCase()}-prototype`;
    if (await page.locator('#map-select').inputValue() !== mapId) {
      await page.locator('#map-select').selectOption(mapId);
      await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/);
      await expect.poll(() => page.evaluate(() => (window as any).__wallProbe.renderer.apartment?.unitTypeId)).toBe(unit);
    }
    await page.locator(`button[data-plan-variant="${variant}"]`).click();
    await expect(page.locator('#stage-loader')).toHaveClass(/is-hidden/);
    await expect(page.locator('#game-stage')).toHaveAttribute('data-plan-variant', variant);
    await expect.poll(() => page.evaluate(() => (window as any).__wallProbe.renderer.apartment?.planVariant)).toBe(variant);
    for (const sample of ['behind', 'face', 'center', 'cap', 'front']) {
      const result = await page.evaluate(async ({ unit, sample }) => {
        const { renderer: r, actor: a } = (window as any).__wallProbe;
        const entries = r.structureOccluders.filter((entry: any) => entry.mesh.userData.laserObstacleKind === 'wall'
          && entry.mesh.geometry.parameters.width > 2 && entry.mesh.geometry.parameters.height > 3
          && entry.mesh.position.y - entry.mesh.geometry.parameters.height / 2 < .01);
        const preferred = unit === '55B' ? 'bedroom-1-bathroom-1' : '';
        const entry = entries.find((entry: any) => entry.mesh.userData.laserObstacleId === preferred)
          || entries.find((entry: any) => /^(bedroom|bathroom)/.test(String(entry.mesh.userData.laserObstacleId)));
        if (!entry) throw Error(`No full-height wall for ${unit}`);
        const mesh = entry.mesh, halfLength = mesh.geometry.parameters.width / 2, halfDepth = mesh.geometry.parameters.depth / 2;
        const yaw = mesh.rotation.y;
        let nx = Math.sin(yaw), nz = Math.cos(yaw);
        if (nx * r.cameraOffset.x + nz * r.cameraOffset.z < 0) { nx *= -1; nz *= -1; }
        const cell = Number(r.apartment.geometry.cellSizeMeters);
        const offset = sample === 'behind' ? -halfDepth - .1 / cell
          : sample === 'face' ? -halfDepth
          : sample === 'front' ? halfDepth + 1 / cell
          : sample === 'cap' ? halfDepth * .5 : 0;
        const along = sample === 'cap' ? halfLength - .005 / cell : 0;
        const x = mesh.position.x + nx * offset + Math.cos(yaw) * along;
        const z = mesh.position.z + nz * offset - Math.sin(yaw) * along;
        Object.assign(a, { x: x + r.world.width / 2 - .5, y: z + r.world.height / 2 - .5,
          displayX: x + r.world.width / 2 - .5, displayY: z + r.world.height / 2 - .5,
          travel: null, moving: false, motion: 'idle', motionUntil: 0 });
        r.focusAt(a.x, a.y);
        r.setOcclusionFocus(a);
        for (let i = 0; i < 36; i++) r.updateStructureOcclusion(performance.now() + i * 50);
        r.render(performance.now() + 1800);
        // Map rebuilds can finish between two app frames. Wait for the actual
        // ActorView to paint this position before comparing its DOM silhouette.
        let painted = false;
        for (let frame = 0; frame < 12; frame++) {
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          const actorElement = document.querySelector<HTMLElement>('.rpg-actor:not([hidden])');
          painted = Boolean(actorElement && Math.abs(Number(actorElement.dataset.worldX) - a.displayX) < .0002
            && Math.abs(Number(actorElement.dataset.worldY) - a.displayY) < .0002);
          if (painted) break;
        }
        if (!painted) throw Error(`ActorView did not paint ${unit}:${sample}`);
        const id = String(mesh.userData.laserObstacleId);
        const layer = document.querySelector<HTMLElement>('#actor-layer')!;
        const maskId = layer.style.mask.match(/#([^"')]+)/)?.[1];
        const mask = maskId ? document.getElementById(maskId) : null;
        const polygon = [...(mask?.querySelectorAll<SVGPolygonElement>('polygon[data-wall-occluder-id]') || [])]
          .find(node => node.dataset.wallOccluderId === id);
        const sprite = document.querySelector<HTMLElement>('.rpg-actor:not([hidden]) .actor-sprite')!;
        const layerBounds = layer.getBoundingClientRect(), actorBounds = sprite.getBoundingClientRect();
        let overlapsActor = false;
        if (polygon) for (let yy = actorBounds.top - layerBounds.top + 2; yy < actorBounds.bottom - layerBounds.top - 2; yy += 4) {
          for (let xx = actorBounds.left - layerBounds.left + 2; xx < actorBounds.right - layerBounds.left - 2; xx += 4) {
            if (polygon.isPointInFill(new DOMPoint(xx, yy))) { overlapsActor = true; break; }
          }
          if (overlapsActor) break;
        }
        return { unit, sample, wall: id, opacity: entry.currentOpacity, baseOpacity: entry.baseOpacity,
          mask: polygon?.getAttribute('fill') || '', overlapsActor,
          actorMask: layer.style.mask, actorBounds: actorBounds.toJSON(), layerBounds: layerBounds.toJSON(),
          projected: r.project(a.displayX, a.displayY), polygon: polygon?.getAttribute('points') };
      }, { unit, sample });
      results.push({ ...result, variant });
      if (sample === 'front') {
        expect(result.opacity, `${unit}-${variant}: front restores`).toBeCloseTo(result.baseOpacity, 2);
        expect(result.mask, JSON.stringify({ ...result, variant })).toBe('');
      } else {
        expect(result.opacity, `${unit}-${variant}:${sample}`).toBeLessThanOrEqual(.285);
        expect(result.mask).toMatch(/^rgb\(18[0-9],18[0-9],18[0-9]\)$/);
        expect(result.actorMask).toContain('url(');
        expect(result.overlapsActor, JSON.stringify({ ...result, variant })).toBe(true);
      }
      if (unit === '55B' && variant === 'B' && (sample === 'center' || sample === 'cap')) {
        await page.locator('#game-stage').screenshot({ path: testInfo.outputPath(`55b-b-${sample}-1440.png`) });
        if (sample === 'center') {
          await page.setViewportSize({ width: 390, height: 844 });
          await page.waitForTimeout(100);
          await page.locator('#game-stage').screenshot({ path: testInfo.outputPath('55b-b-contact-390.png') });
          await page.setViewportSize({ width: 1440, height: 1000 });
        }
      }
    }
  }
  await testInfo.attach('all-variant-contact-results', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  expect(results).toHaveLength(60);
  expect(errors).toEqual([]);
});
