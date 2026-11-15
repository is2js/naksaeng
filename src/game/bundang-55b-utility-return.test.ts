import { beforeAll, describe, expect, it } from 'vitest';
import { apartmentUnitWorldPoint } from './apartment-transform';
import { applyBundangMeasuredGeometry } from './bundang-measured-geometry';
import { bundangMeasuredDimensions, resolveBundangMeasuredDimension } from './bundang-measured-dimensions';
import { measureIstarparkLaserGap } from './istarpark-laser-measurement';
import { applyPlanVariant, type ApartmentPlanVariant } from './plan-variants';
import { readBundangPrototypeApartments } from './test-support/bundang-prototypes';
import { canTraverse, isWalkable } from './world';
import type { StaticMapEntry, WorldData, WorldObject } from './types';

let source: WorldObject;
beforeAll(async () => { source = (await readBundangPrototypeApartments()).get('55B')!; });

function scene(variant: ApartmentPlanVariant) {
  const apartment = structuredClone(source);
  const blocked = new Set((apartment.blockedCells || []).map(cell => `${cell.x},${cell.y}`));
  expect(applyBundangMeasuredGeometry(apartment)).toBe(true);
  const world = { entry: { id: 'bundang-first-village-55b-prototype', unitType: '55B' } as StaticMapEntry,
    width: 64, height: 64, objects: [apartment], blocked } as WorldData;
  applyPlanVariant(world, variant);
  return { world, apartment, geometry: apartment.geometry! };
}

describe('55B utility doorway fixed return', () => {
  it('splits the original 990 mm span into an 800 mm opening and one inferred 190 mm wall', () => {
    const original = JSON.stringify(source);
    const { geometry } = scene('A');
    const opening = geometry.openings!.find(row => row.id === 'utility-kitchen-east-opening')!;
    const lintel = geometry.wallSegments!.find(row => row.id === 'utility-kitchen-east-lintel')!;
    const returns = geometry.wallSegments!.filter(row => row.id === 'utility-kitchen-east-after');
    expect(opening).toMatchObject({ a: [3.45, 7.26], b: [3.45, 8.06], hingeEndpoint: 'b', wallThicknessMeters: .20 });
    expect(lintel).toMatchObject({ a: opening.a, b: opening.b, baseMeters: 2.1, heightMeters: .2 });
    expect(returns).toHaveLength(1);
    expect(returns[0]).toMatchObject({ a: [3.45, 8.06], b: [3.45, 8.25], thicknessMeters: .20,
      baseMeters: 0, heightMeters: 2.3, strictDoorJamb: true });
    expect(geometry.solidBlocks!.find(row => row.id === 'utility-solid-column')!.boundsMeters).toEqual([2.80, 8.25, 3.55, 9.10]);
    expect(geometry.geometryProvenance).toMatchObject({ utilityDoorReturn: {
      source: 'user-annotated-runtime-image', confidence: 'inferred', clearOpeningMeters: .8, returnLengthMeters: .19,
    } });
    expect(JSON.stringify(source)).toBe(original);
  });

  it('preserves the twelve reference dimensions and existing utility/kitchen anchors', () => {
    const { geometry } = scene('A');
    expect(bundangMeasuredDimensions('55B')).toHaveLength(12);
    for (const reference of bundangMeasuredDimensions('55B')) {
      const actual = resolveBundangMeasuredDimension(geometry, reference);
      expect(actual.valid, reference.id).toBe(true);
      expect(actual.errorMm, reference.id).toBeCloseTo(0, 6);
    }
    expect(geometry.roomZones!.find(row => row.id === 'utility')!.boundsMeters).toEqual([1.10, 7.36, 3.35, 9.10]);
    expect(geometry.kitchenFixtures!.find(row => row.id === 'kitchen-window-base-cabinet')!.boundsMeters).toEqual([3.55, 8.38, 5.40, 9.10]);
  });

  for (const variant of ['A', 'B', 'C', 'D'] as const) {
    it(`${variant}: leaves the real doorway bidirectional and measures/blocks the short physical wall`, () => {
      const { world, apartment, geometry } = scene(variant);
      const point = (local: [number, number]) => apartmentUnitWorldPoint(apartment, local);
      const inside = point([3.1, 7.65]), outside = point([3.8, 7.65]);
      expect(isWalkable(world, inside.x, inside.y)).toBe(true);
      expect(isWalkable(world, outside.x, outside.y)).toBe(true);
      expect(canTraverse(world, inside.x, inside.y, outside.x, outside.y)).toBe(true);
      expect(canTraverse(world, outside.x, outside.y, inside.x, inside.y)).toBe(true);
      const wallInside = point([3.0, 8.16]), wallOutside = point([3.9, 8.16]);
      expect(canTraverse(world, wallInside.x, wallInside.y, wallOutside.x, wallOutside.y)).toBe(false);
      expect(canTraverse(world, wallOutside.x, wallOutside.y, wallInside.x, wallInside.y)).toBe(false);
      const measurement = measureIstarparkLaserGap({ apartment, geometry, axis: 'x', anchorPlanPoint: [3.8, 8.15] });
      expect(measurement.valid).toBe(true);
      expect(measurement.negativeHit!.obstacleId).toBe('utility-kitchen-east-after');
      expect(measurement.negativeHit!.point![0]).toBeCloseTo(3.55, 8);
      expect(measurement.negativeHit!.point![1]).toBeCloseTo(8.15, 8);
    });
  }
});
