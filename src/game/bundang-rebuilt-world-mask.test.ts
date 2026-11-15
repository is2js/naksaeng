import { beforeAll, describe, expect, it } from 'vitest';
import { apartmentUnitWorldPoint, apartmentWorldPointToLocalMeters } from './apartment-transform';
import { hasBundangRebuiltGeometry, normalizeBundang55BWorldMask } from './bundang-55b-geometry';
import { applyBundangMeasuredGeometry } from './bundang-measured-geometry';
import { BUNDANG_MINUS_OPTION_ID } from './minus-option';
import { applyPlanVariant, planVariantDefinition } from './plan-variants';
import { readBundangPrototypeApartments } from './test-support/bundang-prototypes';
import { isWalkable, synchronizeBundangMinusOptionWorldCollision } from './world';
import type { StaticMapEntry, WorldData, WorldObject } from './types';

type Cell = { x: number; y: number };
type Point = [number, number];
const UNITS = ['51A', '55A', '55B', '59A'];
const VARIANTS = ['A', 'B', 'C', 'D'] as const;
const CELL_FIELDS = ['floorCells', 'footprintCells', 'interiorCells', 'collisionCells',
  'structuralBlockedCells', 'interiorPropBlockedCells', 'inspectionWallCells', 'occlusionCells',
  'transparencyCells', 'vegetationExclusionCells', 'entranceCells'] as const;
let sources: Map<string, WorldObject>;
beforeAll(async () => { sources = await readBundangPrototypeApartments(); });
const key = (cell: Cell): string => `${cell.x},${cell.y}`;
const keys = (cells: Cell[]): string[] => cells.map(key).sort();
const cells = (apartment: WorldObject, field: string): Cell[] =>
  ((apartment as unknown as Record<string, unknown>)[field] as Cell[] | undefined) || [];

function scene(unit: string) {
  const apartment = structuredClone(sources.get(unit)!);
  const oldBlocked = keys(apartment.blockedCells || []);
  const unrelated = { id: 'unrelated-world-blocker', type: 'test-blocker', blockedCells: [{ x: 63, y: 63 }] };
  const world = { entry: { id: `bundang-first-village-${unit.toLowerCase()}-prototype`, unitType: unit } as StaticMapEntry,
    width: 64, height: 64, objects: [apartment, unrelated], blocked: new Set([...oldBlocked, '63,63']) } as WorldData;
  expect(applyBundangMeasuredGeometry(apartment)).toBe(true);
  expect(hasBundangRebuiltGeometry(apartment)).toBe(true);
  return { world, apartment, oldBlocked };
}

describe('rebuilt Bundang collision masks', () => {
  it.each(UNITS)('%s replaces the old source mask and transforms every cell family once for A–D', unit => {
    const sourceBefore = JSON.stringify(sources.get(unit));
    for (const variant of VARIANTS) {
      const { world, apartment, oldBlocked } = scene(unit);
      const rebuiltBeforeTransform = structuredClone(apartment);
      const newBlocked = keys(apartment.blockedCells || []);
      expect(newBlocked).not.toEqual(oldBlocked);
      normalizeBundang55BWorldMask(world);
      expect([...world.blocked].sort()).toEqual([...new Set([...newBlocked, '63,63'])].sort());
      applyPlanVariant(world, variant);
      for (const field of CELL_FIELDS) {
        const expected = cells(rebuiltBeforeTransform, field).map(cell => {
          const local = apartmentWorldPointToLocalMeters(rebuiltBeforeTransform, cell);
          const transformed = apartmentUnitWorldPoint(apartment, local);
          return { x: Math.round(transformed.x), y: Math.round(transformed.y) };
        });
        expect(keys(cells(apartment, field)), `${unit}-${variant}:${field}`).toEqual(keys(expected));
      }
      const floor = new Set(keys(cells(apartment, 'floorCells')));
      const structural = keys(cells(apartment, 'structuralBlockedCells'));
      const fixtures = keys(cells(apartment, 'interiorPropBlockedCells'));
      expect(floor.size).toBeGreaterThan(0);
      expect(structural.length).toBeGreaterThan(0);
      expect(fixtures.length).toBeGreaterThan(0);
      expect([...structural, ...fixtures].every(cell => floor.has(cell))).toBe(true);
      expect(keys(cells(apartment, 'collisionCells'))).toEqual([...structural, ...fixtures].sort());
      expect((apartment.blockedCells || []).every(cell => world.blocked.has(key(cell)))).toBe(true);
      expect(world.blocked.has('63,63')).toBe(true);

      const polygon = apartment.geometry!.floorPolygon!;
      const xs = polygon.map(point => point[0]), ys = polygon.map(point => point[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const outsideCandidates: Point[] = [[minX - .75, (minY + maxY) / 2], [maxX + .75, (minY + maxY) / 2],
        [(minX + maxX) / 2, minY - .75], [(minX + maxX) / 2, maxY + .75]];
      const outside = outsideCandidates.map(point => apartmentUnitWorldPoint(apartment, point))
        .map(point => ({ x: Math.round(point.x), y: Math.round(point.y) }))
        .find(point => point.x >= 0 && point.y >= 0 && point.x < 64 && point.y < 64 && !world.blocked.has(key(point)));
      expect(outside, `${unit}-${variant}: globally in-bounds but outside the new floor`).toBeDefined();
      expect(isWalkable(world, outside!.x, outside!.y)).toBe(false);
      expect(cells(apartment, 'interiorCells').some(cell => isWalkable(world, cell.x, cell.y))).toBe(true);
    }
    expect(JSON.stringify(sources.get(unit))).toBe(sourceBefore);
  });

  it('keeps another object’s blocker when it overlaps a source-owned blocker during variant changes', () => {
    for (const unit of UNITS) {
      let checked = 0;
      for (const variant of VARIANTS) {
        const { world, apartment } = scene(unit);
        const target = structuredClone(apartment);
        target.transform = planVariantDefinition(unit, variant).transform;
        const transformedOwnKeys = new Set((apartment.blockedCells || []).map(cell => {
          const local = apartmentWorldPointToLocalMeters(apartment, cell);
          const transformed = apartmentUnitWorldPoint(target, local);
          return key({ x: Math.round(transformed.x), y: Math.round(transformed.y) });
        }));
        // Pick a blocker that the transformed apartment cannot incidentally
        // recreate, so only the unrelated owner's preservation can pass.
        const sharedCell = cells(apartment, 'structuralBlockedCells').find(cell => !transformedOwnKeys.has(key(cell)));
        if (!sharedCell) continue;
        checked++;
        world.objects.push({ id: 'overlapping-unrelated-owner', type: 'test-blocker', blockedCells: [{ ...sharedCell }] });
        world.blocked.add(key(sharedCell));
        applyPlanVariant(world, variant);
        expect(world.blocked.has(key(sharedCell)), `${unit}-${variant}: unrelated owner stays at its original cell`).toBe(true);
        expect(world.blocked.has('63,63')).toBe(true);
      }
      expect(checked, `${unit}: non-identity overlap checked`).toBeGreaterThan(0);
    }
  });

  it('releases only the updated fixture mask for minus options and restores the exact baseline', () => {
    for (const unit of UNITS) for (const variant of VARIANTS) {
      const { world, apartment } = scene(unit);
      applyPlanVariant(world, variant);
      const baseline = [...world.blocked].sort();
      const baselineSet = new Set(baseline);
      const structural = cells(apartment, 'structuralBlockedCells').filter(cell => baselineSet.has(key(cell)));
      const fixtures = cells(apartment, 'interiorPropBlockedCells').filter(cell => !isWalkable(world, cell.x, cell.y));
      expect(fixtures.length, `${unit}-${variant}: fixture candidates`).toBeGreaterThan(0);
      synchronizeBundangMinusOptionWorldCollision(world, [BUNDANG_MINUS_OPTION_ID]);
      expect(structural.every(cell => world.blocked.has(key(cell))), `${unit}-${variant}: structure retained`).toBe(true);
      expect(fixtures.some(cell => isWalkable(world, cell.x, cell.y)), `${unit}-${variant}: updated fixture floor released`).toBe(true);
      expect(world.blocked.has('63,63')).toBe(true);
      synchronizeBundangMinusOptionWorldCollision(world, []);
      expect([...world.blocked].sort(), `${unit}-${variant}: baseline restored`).toEqual(baseline);
      expect(fixtures.every(cell => !isWalkable(world, cell.x, cell.y)), `${unit}-${variant}: fixture collision restored`).toBe(true);
    }
  });
});
