import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { apartmentSolidBlockVisualFootprint, apartmentUnitWorldPoint, type NumericPoint } from './apartment-transform';
import { availablePlanVariants, planVariantDefinition } from './plan-variants';
import { solidBlockCrossesSightline } from './solid-block-occlusion';
import type { ShowcaseCatalog, WorldChunk, WorldObject } from './types';

const block: NumericPoint[] = [[0, 0], [2, 0], [2, 2], [0, 2]];
const camera: NumericPoint = [10, 10];
const units = ['51A', '55A', '55B', '59A'] as const;
const expectedBlocks = { '51A': 2, '55A': 3, '55B': 3, '59A': 3 };
const expectedVertices = { '51A': 10, '55A': 14, '55B': 14, '59A': 12 };
const apartments = new Map<string, WorldObject>();

beforeAll(async () => {
  const root = path.join(process.cwd(), 'public');
  const catalog = JSON.parse(await readFile(path.join(root, 'generated/catalog.v1.json'), 'utf8')) as ShowcaseCatalog;
  for (const unit of units) {
    const map = catalog.maps.find(entry => entry.unitType === unit)!;
    const directory = path.join(root, path.dirname(map.manifestUrl), 'chunks');
    for (const file of (await readdir(directory)).sort()) {
      if (!file.endsWith('.json')) continue;
      const chunk = JSON.parse(await readFile(path.join(directory, file), 'utf8')) as WorldChunk;
      const apartment = chunk.objects?.find(object => object.type === 'enterable-apartment-unit-v1' && object.geometry);
      if (apartment) { apartments.set(unit, apartment); break; }
    }
    expect(apartments.has(unit), `${unit}: authored geometry exists`).toBe(true);
  }
});

describe('solid-block polygon actor occlusion', () => {
  it('keeps inside, face and corner contact faded', () => {
    for (const focus of [[1, 1], [0, 1], [0, 0], [2, 2], [2, 1]] as NumericPoint[]) {
      expect(solidBlockCrossesSightline(block, camera, focus), String(focus)).toBe(true);
    }
  });

  it('fades blocks between the actor and camera, but not blocks behind or beside them', () => {
    expect(solidBlockCrossesSightline(block, camera, [-1, -1])).toBe(true);
    expect(solidBlockCrossesSightline(block, camera, [3, 3])).toBe(false);
    expect(solidBlockCrossesSightline(block, camera, [-2, 4])).toBe(false);
  });

  it('preserves concave gaps even when the focus and sightline enter the bounding box', () => {
    const concave: NumericPoint[] = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]];
    expect(solidBlockCrossesSightline(concave, [10, 10], [2, 2])).toBe(false);
    expect(solidBlockCrossesSightline(concave, [3, -3], [2, 2])).toBe(true);
    expect(solidBlockCrossesSightline(concave, [10, 10], [.5, 3])).toBe(true);
  });

  it('handles grazing edges without treating camera-only contact as an obstruction', () => {
    expect(solidBlockCrossesSightline(block, [4, 0], [-1, 0])).toBe(true);
    expect(solidBlockCrossesSightline(block, [0, 0], [-1, -1])).toBe(false);
    expect(solidBlockCrossesSightline(block, [0, 0], [0, -1])).toBe(false);
  });

  it('is unchanged by reversed winding, repeated closing point and rotation/reflection', () => {
    for (const transform of [
      ([x, y]: NumericPoint): NumericPoint => [x + 30, y + 40],
      ([x, y]: NumericPoint): NumericPoint => [-y + 30, x + 40],
      ([x, y]: NumericPoint): NumericPoint => [-x + 30, y + 40],
    ]) for (const points of [block, [...block].reverse(), [...block, block[0]]]) {
      expect(solidBlockCrossesSightline(points.map(transform), transform(camera), transform([0, 0]))).toBe(true);
      expect(solidBlockCrossesSightline(points.map(transform), transform(camera), transform([3, 3]))).toBe(false);
    }
  });

  it('retains tiny valid geometry without widening it into nearby empty space', () => {
    const tiny: NumericPoint[] = [[32, 32], [32.000001, 32], [32.000001, 32.000001], [32, 32.000001]];
    expect(solidBlockCrossesSightline(tiny, [40, 40], [32.0000005, 32.0000005])).toBe(true);
    expect(solidBlockCrossesSightline(tiny, [40, 40], [32.000002, 32.000002])).toBe(false);
  });

  it('rejects zero-area and invalid polygons and a stationary sight outside the block', () => {
    for (const points of [[], [[0, 0], [1, 1]], [[0, 0], [1, 1], [2, 2]], [[0, 0], [0, 0], [0, 0]], [[0, 0], [1, NaN], [2, 2]]] as NumericPoint[][]) {
      expect(solidBlockCrossesSightline(points, camera, [0, 0])).toBe(false);
    }
    expect(solidBlockCrossesSightline(block, [3, 3], [3, 3])).toBe(false);
    expect(solidBlockCrossesSightline(block, [1, 1], [1, 1])).toBe(true);
  });
});

describe('solid-block visual footprint contact across every apartment plan', () => {
  for (const unit of units) for (const variant of availablePlanVariants(unit)) {
    it(`${unit}-${variant}: every transformed polygon keeps face/corner contact and restores in front or beside it`, () => {
      const source = apartments.get(unit)!;
      const apartment = { ...source, transform: planVariantDefinition(unit, variant).transform };
      const blocks = source.geometry!.solidBlocks!;
      expect(blocks).toHaveLength(expectedBlocks[unit]);
      let checkedVertices = 0;
      for (const value of blocks) {
        const polygon = apartmentSolidBlockVisualFootprint(apartment, value as Record<string, unknown>).map(point => {
          const world = apartmentUnitWorldPoint(apartment, point);
          return [world.x, world.y] as NumericPoint;
        });
        const label = `${unit}-${variant}:${value.id}`;
        expect(polygon.length, `${label}: actual visual footprint`).toBeGreaterThanOrEqual(3);
        checkedVertices += polygon.length;
        const view: NumericPoint = [Math.SQRT1_2, Math.SQRT1_2];
        const side: NumericPoint = [Math.SQRT1_2, -Math.SQRT1_2];
        const shift = (point: NumericPoint, direction: NumericPoint, distance: number): NumericPoint => [
          point[0] + direction[0] * distance, point[1] + direction[1] * distance,
        ];
        const dot = (point: NumericPoint, direction: NumericPoint): number => point[0] * direction[0] + point[1] * direction[1];
        for (let edge = 0; edge < polygon.length; edge++) {
          const a = polygon[edge], b = polygon[(edge + 1) % polygon.length];
          for (const fraction of [0, .5, 1]) {
            const focus: NumericPoint = [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction];
            expect(solidBlockCrossesSightline(polygon, shift(focus, view, 30), focus), `${label}:${edge}@${fraction}: face/vertex contact`).toBe(true);
          }
        }
        // The camera-facing support vertex gives a precise transition out of
        // the physical polygon, including concave blocks after A-D transforms.
        const front = polygon.reduce((result, point) => dot(point, view) > dot(result, view) ? point : result);
        const frontCamera = shift(front, view, 30);
        expect(solidBlockCrossesSightline(polygon, frontCamera, shift(front, view, -.03)), `${label}: just behind contact`).toBe(true);
        expect(solidBlockCrossesSightline(polygon, frontCamera, front), `${label}: exact contact`).toBe(true);
        expect(solidBlockCrossesSightline(polygon, frontCamera, shift(front, view, .03)), `${label}: beyond front face`).toBe(false);
        const sideVertex = polygon.reduce((result, point) => dot(point, side) > dot(result, side) ? point : result);
        const sideFocus = shift(sideVertex, side, .03);
        expect(solidBlockCrossesSightline(polygon, shift(sideFocus, view, 30), sideFocus), `${label}: beside actual footprint`).toBe(false);
      }
      expect(checkedVertices, `${unit}: all authored polygon edges and vertices checked`).toBe(expectedVertices[unit]);
    });
  }
});
