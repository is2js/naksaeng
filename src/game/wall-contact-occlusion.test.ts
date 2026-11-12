import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { apartmentUnitWorldPoint, wallCrossesSightline, type NumericPoint } from './apartment-transform';
import { planVariantDefinition } from './plan-variants';
import type { ShowcaseCatalog, WorldChunk } from './types';

describe('55B wall fade at character contact', () => {
  it('keeps A/B walls and actor masking active up to the wall face, and restores in front', async () => {
    const root = path.join(process.cwd(), 'public');
    const catalog = JSON.parse(await readFile(path.join(root, 'generated/catalog.v1.json'), 'utf8')) as ShowcaseCatalog;
    const map = catalog.maps.find((entry) => entry.unitType === '55B')!;
    const chunk = JSON.parse(await readFile(path.join(root, path.dirname(map.manifestUrl), 'chunks/1-1.json'), 'utf8')) as WorldChunk;
    const source = chunk.objects!.find((object) => object.type === 'enterable-apartment-unit-v1' && object.geometry)!;
    const wall = source.geometry!.wallSegments!.find((row) => row.id === 'bedroom-1-bathroom-1')!;
    const cellSize = Number(source.geometry!.cellSizeMeters);
    const halfThickness = Number(wall.thicknessMeters) / (2 * cellSize);
    for (const variant of ['A', 'B'] as const) {
      const apartment = { ...source, transform: planVariantDefinition('55B', variant).transform };
      const convert = (point: NumericPoint): NumericPoint => {
        const result = apartmentUnitWorldPoint(apartment, point);
        return [result.x, result.y];
      };
      const start = convert(wall.a as NumericPoint);
      const end = convert(wall.b as NumericPoint);
      const middle: NumericPoint = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
      const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
      let normal: NumericPoint = [-(end[1] - start[1]) / length, (end[0] - start[0]) / length];
      if (normal[0] + normal[1] < 0) normal = [-normal[0], -normal[1]];
      const camera: NumericPoint = [middle[0] + 18, middle[1] + 18];
      const point = (meters: number): NumericPoint => [middle[0] + normal[0] * meters / cellSize, middle[1] + normal[1] * meters / cellSize];
      const fades = (meters: number) => wallCrossesSightline(start, end, camera, point(meters), halfThickness);
      expect(fades(-.15), `${variant}: behind`).toBe(true);
      expect(fades(-.10), `${variant}: near face`).toBe(true);
      expect(fades(0), `${variant}: centerline`).toBe(true);
      expect(fades(.03), `${variant}: inside slab`).toBe(true);
      expect(fades(.15), `${variant}: in front`).toBe(false);
      expect(wallCrossesSightline(start, end, camera, start, halfThickness), `${variant}: end contact`).toBe(false);
    }
  });
});
