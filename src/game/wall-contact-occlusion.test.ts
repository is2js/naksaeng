import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { apartmentUnitWorldPoint, wallCrossesSightline, type NumericPoint } from './apartment-transform';
import { availablePlanVariants, planVariantDefinition } from './plan-variants';
import type { ShowcaseCatalog, WorldChunk, WorldObject } from './types';

const units = ['51A', '55A', '55B', '59A'] as const;
const expectedWalls = { '51A': 57, '55A': 74, '55B': 71, '59A': 73 };
const degenerateWalls: Record<string, string[]> = {
  '51A': [], '55A': ['bathroom-2-west-after'], '55B': [], '59A': ['pantry-east-after'],
};
const apartments = new Map<string, WorldObject>();

beforeAll(async () => {
  const root = path.join(process.cwd(), 'public');
  const catalog = JSON.parse(await readFile(path.join(root, 'generated/catalog.v1.json'), 'utf8')) as ShowcaseCatalog;
  for (const unit of units) {
    const map = catalog.maps.find((entry) => entry.unitType === unit)!;
    const directory = path.join(root, path.dirname(map.manifestUrl), 'chunks');
    for (const file of (await readdir(directory)).sort()) {
      if (!file.endsWith('.json')) continue;
      const chunk = JSON.parse(await readFile(path.join(directory, file), 'utf8')) as WorldChunk;
      const apartment = chunk.objects?.find((object) => object.type === 'enterable-apartment-unit-v1' && object.geometry);
      if (apartment) { apartments.set(unit, apartment); break; }
    }
    expect(apartments.has(unit), `${unit}: authored geometry exists`).toBe(true);
  }
});

describe('wall contact occlusion across every apartment plan', () => {
  for (const unit of units) for (const variant of availablePlanVariants(unit)) {
    it(`${unit}-${variant}: every finite wall stays faded at face/cap contact and restores outside`, () => {
      const source = apartments.get(unit)!;
      const apartment = { ...source, transform: planVariantDefinition(unit, variant).transform };
      const cellSize = Number(source.geometry!.cellSizeMeters);
      const walls = source.geometry!.wallSegments!;
      expect(walls).toHaveLength(expectedWalls[unit]);
      const zeroIds: string[] = [];
      let checked = 0;
      for (const wall of walls) {
        const convert = (point: NumericPoint): NumericPoint => {
          const result = apartmentUnitWorldPoint(apartment, point);
          return [result.x, result.y];
        };
        const start = convert(wall.a as NumericPoint), end = convert(wall.b as NumericPoint);
        const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
        const label = `${unit}-${variant}:${wall.id}`;
        const half = Math.max(.04, Number(wall.thicknessMeters) / cellSize) / 2;
        if (length < 1e-7) {
          zeroIds.push(String(wall.id));
          expect(wallCrossesSightline(start, end, [start[0] + 18, start[1] + 18], start, half), label).toBe(false);
          continue;
        }
        checked++;
        const tangent: NumericPoint = [(end[0] - start[0]) / length, (end[1] - start[1]) / length];
        let normal: NumericPoint = [-tangent[1], tangent[0]];
        if (normal[0] + normal[1] < 0) normal = [-normal[0], -normal[1]];
        const view: NumericPoint = [Math.SQRT1_2, Math.SQRT1_2];
        const projection = view[0] * normal[0] + view[1] * normal[1];
        expect(projection, `${label}: axis-aligned authored wall faces camera`).toBeGreaterThan(.7);
        const shifted = (p: NumericPoint, d: NumericPoint, amount: number): NumericPoint => [p[0] + d[0] * amount, p[1] + d[1] * amount];
        for (const fraction of [0, .05, .5, .95, 1]) {
          const point: NumericPoint = [start[0] + (end[0] - start[0]) * fraction, start[1] + (end[1] - start[1]) * fraction];
          const camera = shifted(point, view, 30);
          const test = (distance: number) => wallCrossesSightline(start, end, camera, shifted(point, view, distance / projection), half);
          expect(test(-.15 / cellSize), `${label}@${fraction}: behind`).toBe(true);
          expect(test(-.001 / cellSize), `${label}@${fraction}: almost touching`).toBe(true);
          expect(test(0), `${label}@${fraction}: direct face/cap contact`).toBe(true);
          // Cap-adjacent points can legitimately leave the finite rectangle.
          if (fraction === .5) {
            expect(test(half / 2), `${label}: inside slab`).toBe(true);
            expect(test(half + .03 / cellSize), `${label}: beyond front face`).toBe(false);
            const alongCamera = shifted(point, tangent, length + 5);
            expect(wallCrossesSightline(start, end, alongCamera, shifted(point, normal, half / 2), half), `${label}: parallel inside slab`).toBe(true);
            expect(wallCrossesSightline(start, end, shifted(shifted(point, normal, half + .03 / cellSize), tangent, length + 5), shifted(point, normal, half + .03 / cellSize), half), `${label}: parallel outside slab`).toBe(false);
          }
        }
      }
      expect(zeroIds.sort(), `${unit}: explicitly recorded degenerate source stubs`).toEqual(degenerateWalls[unit]);
      expect(checked).toBe(expectedWalls[unit] - degenerateWalls[unit].length);
    });
  }

  it('uses the finite cap rather than an extended infinite wall near a corner', () => {
    expect(wallCrossesSightline([0, 0], [0, 2], [3, 1], [-.02, -.01], .06)).toBe(true);
    expect(wallCrossesSightline([0, 0], [0, 2], [3, -.2], [-.02, -.2], .06)).toBe(false);
    expect(wallCrossesSightline([0, 0], [0, 2], [3, 1], [0, 1], .06)).toBe(true);
    expect(wallCrossesSightline([0, 0], [0, 2], [0, 1], [3, 1], .06)).toBe(true);
    expect(wallCrossesSightline([0, 0], [0, 2], [.06, 1], [3, 1], .06)).toBe(false);
    expect(wallCrossesSightline([0, 0], [0, 2], [3, 1], [0, 0])).toBe(false);
  });
});
