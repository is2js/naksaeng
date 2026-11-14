import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { apartmentUnitWorldPoint } from './apartment-transform';
import { applyBundangMeasuredGeometry } from './bundang-measured-geometry';
import { BUNDANG_55B_GEOMETRY_REVISION } from './bundang-55b-geometry';
import { bundangMeasuredDimensions, resolveBundangMeasuredDimension } from './bundang-measured-dimensions';
import { bundang55BEntryOptionProps, bundangDesignWallProps, BUNDANG_DESIGN_WALL_MATERIAL_ID } from './bundang-option-layout';
import { applyPlanVariant } from './plan-variants';
import { readBundangPrototypeApartments } from './test-support/bundang-prototypes';
import { STRUCTURAL_PROP_ASSETS } from './three-world';
import { isWalkable, nearestWalkable, synchronizeBundangMinusOptionWorldCollision } from './world';
import { BUNDANG_MINUS_OPTION_ID } from './minus-option';
import type { StaticMapEntry, WorldData, WorldObject } from './types';

type Row = Record<string, any>;
let source: WorldObject;
let recipes: Row[];
beforeAll(async () => {
  source = (await readBundangPrototypeApartments()).get('55B')!;
  recipes = JSON.parse(await readFile(path.join(process.cwd(), 'public/generated/exports/fa4f82d714b3-dirty-d0e870db4e20/interior/recipes.json'), 'utf8')).assets;
});

function world(variant: 'A' | 'B' | 'C' | 'D'): WorldData {
  const apartment = structuredClone(source);
  const blocked = new Set((apartment.blockedCells || []).map(cell => `${cell.x},${cell.y}`));
  blocked.add('99,99');
  applyBundangMeasuredGeometry(apartment);
  const result = { entry: { id: 'bundang-first-village-55b-prototype', unitType: '55B' } as StaticMapEntry,
    width: 64, height: 64, objects: [apartment], blocked } as WorldData;
  applyPlanVariant(result, variant);
  return result;
}

describe('55B v2 canonical reconstruction', () => {
  it('replaces only the reviewed source, once, without touching source/user data', () => {
    const apartment = structuredClone(source);
    const originalGeometry = apartment.geometry;
    const savedFurniture = [{ assetId: 'user-bed', positionMeters: [11, 8], yawDeg: 90 }];
    Object.assign(apartment, { userFurniture: savedFurniture });
    expect(applyBundangMeasuredGeometry(apartment)).toBe(true);
    expect(apartment.geometry).not.toBe(originalGeometry);
    expect(apartment.geometry!.bundangGeometryRevision).toBe(BUNDANG_55B_GEOMETRY_REVISION);
    expect(apartment.geometry!.floorPolygon).not.toEqual(originalGeometry!.floorPolygon);
    expect((apartment as unknown as Row).userFurniture).toBe(savedFurniture);
    expect(savedFurniture[0].positionMeters).toEqual([11, 8]);
    const once = JSON.stringify(apartment);
    expect(applyBundangMeasuredGeometry(apartment)).toBe(false);
    expect(JSON.stringify(apartment)).toBe(once);
    const custom = structuredClone(source);
    (custom.geometry!.wallSegments![0].a as number[])[0] += .001;
    expect(applyBundangMeasuredGeometry(custom)).toBe(false);
  });

  it('matches all 12 source dimensions and labels inferred service dimensions separately', () => {
    const apartment = structuredClone(source);
    applyBundangMeasuredGeometry(apartment);
    for (const reference of bundangMeasuredDimensions('55B')) {
      const actual = resolveBundangMeasuredDimension(apartment.geometry!, reference);
      expect(actual.valid, reference.id).toBe(true);
      expect(Math.abs(actual.errorMm!), reference.id).toBeLessThanOrEqual(20);
    }
    const rooms = apartment.geometry!.roomZones!;
    const entry = rooms.find(room => room.id === 'entry')!.boundsMeters as number[];
    const pantry = rooms.find(room => room.id === 'entry-pantry')!.boundsMeters as number[];
    expect(entry[2] - entry[0]).toBeCloseTo(1.50, 8);
    expect(pantry[2] - pantry[0]).toBeCloseTo(1.00, 8);
    expect((apartment.geometry!.geometryProvenance as Row).inferredEntryToleranceMeters).toBe(.05);
    const finish = bundangDesignWallProps(apartment.geometry!, '55B', []);
    expect(finish.find(prop => prop.anchorWallSegmentId === 'bedroom-1-south-lintel'))
      .toMatchObject({ materialVariantId: BUNDANG_DESIGN_WALL_MATERIAL_ID, baseProvided: true, mountHeightMeters: 2.1 });
  });

  it('has a single shared wet-wall owner with positive, orthogonal source geometry', () => {
    const apartment = structuredClone(source);
    applyBundangMeasuredGeometry(apartment);
    const geometry = apartment.geometry!;
    for (const wall of geometry.wallSegments!) {
      const a = wall.a as number[], b = wall.b as number[];
      expect(Number(wall.thicknessMeters)).toBeGreaterThan(0);
      expect(Math.hypot(a[0] - b[0], a[1] - b[1]), String(wall.id)).toBeGreaterThan(.005);
      expect(Math.abs(a[0] - b[0]) < 1e-8 || Math.abs(a[1] - b[1]) < 1e-8).toBe(true);
    }
    const north = geometry.wallSegments!.find(wall => wall.id === 'bedroom-2-north-after')!;
    const wet = geometry.wallSegments!.find(wall => wall.id === 'bathroom-2-south')!;
    expect((north.b as number[])[0]).toBe((wet.a as number[])[0]);
    expect((north.a as number[])[1] + Number(north.thicknessMeters) / 2).toBeCloseTo(4.86);
    expect((wet.a as number[])[1] + Number(wet.thicknessMeters) / 2).toBeCloseTo(4.86);
    expect(geometry.interiorProps!.find(prop => prop.anchorId === 'bathroom-2.wetFixture')!.dimensionsMeters)
      .toEqual([1.48, .68, .72]);
  });

  it('fits actual middle-door recipe edges with 10 mm joints and a flush shoe back/20 mm front-door end gap', () => {
    const apartment = structuredClone(source);
    applyBundangMeasuredGeometry(apartment);
    const props = bundang55BEntryOptionProps(apartment.geometry!, [
      'entry-sliding-partition-door', 'entry-open-premium-shoe-cabinet', 'entry-pantry-system-shelf',
    ], 'A');
    const door = props.find(prop => prop.installationRole === 'entry-partition')!;
    const parts = recipes.find(asset => asset.assetId === door.assetId)!.parts as Row[];
    const width = (door.dimensionsMeters as number[])[0], center = door.positionMeters![0];
    const actualMin = Math.min(...parts.map(part => center + (part.offset[0] - part.scale[0] / 2) * width));
    const actualMax = Math.max(...parts.map(part => center + (part.offset[0] + part.scale[0] / 2) * width));
    expect(actualMin - 6.99).toBeCloseTo(.01, 8);
    expect(8.10 - actualMax).toBeCloseTo(.01, 8);
    const shoe = props.find(prop => prop.assetId === 'entry-shoe-cabinet-tall')!;
    const shoeParts = recipes.find(asset => asset.assetId === shoe.assetId)!.parts as Row[];
    const depth = (shoe.dimensionsMeters as number[])[1];
    const back = shoe.positionMeters![0] - Math.min(...shoeParts.map(part => part.offset[1] - part.scale[1] / 2)) * depth;
    expect(back).toBeCloseTo(8.49, 8);
    // At the north end next to the front-door jamb, the full-height body is
    // the actual corner; middle handles/dividers do not reach this end plane.
    const body = shoeParts.find(part => part.materialRole === 'primary')!;
    const frontAtDoorEnd = shoe.positionMeters![0] - (body.offset[1] + body.scale[1] / 2) * depth;
    expect(frontAtDoorEnd - 8.12).toBeCloseTo(.02, 8);
    const pantry = props.find(prop => prop.roomZoneId === 'entry-pantry')!;
    const shelfRecipe = STRUCTURAL_PROP_ASSETS.find(asset => asset.assetId === pantry.assetId)!;
    expect(shelfRecipe.parts!.filter(part => part.shape === 'rounded-l-shelf')).toHaveLength(5);
    expect(shelfRecipe.parts!.filter(part => part.shape === 'box' && part.scale![2] > .5)
      .every(part => part.scale![0] < .05 && part.scale![1] < .05)).toBe(true);
    const shelfWidth = (pantry.dimensionsMeters as number[])[0];
    expect(pantry.positionMeters![0] - shelfWidth / 2).toBeGreaterThan(5.87);
    expect(pantry.positionMeters![0] + shelfWidth / 2).toBeLessThan(6.87);
  });

  for (const variant of ['A', 'B', 'C', 'D'] as const) it(`${variant}: blocks new walls/fixtures for walking and teleport while retaining open floor and minus restoration`, () => {
    const result = world(variant), apartment = result.objects[0];
    expect(result.blocked.has('99,99')).toBe(true);
    for (const local of [[5, 3], [5, 7], [5.5, 6]] as [number, number][]) {
      const point = apartmentUnitWorldPoint(apartment, local);
      expect(isWalkable(result, point.x, point.y), local.join(',')).toBe(false);
      expect(nearestWalkable(result, point.x, point.y)).not.toEqual(point);
    }
    const free = apartmentUnitWorldPoint(apartment, [1, 5]);
    expect(isWalkable(result, free.x, free.y)).toBe(true);
    synchronizeBundangMinusOptionWorldCollision(result, [BUNDANG_MINUS_OPTION_ID]);
    const counter = apartmentUnitWorldPoint(apartment, [5, 7]);
    expect(isWalkable(result, counter.x, counter.y)).toBe(true);
    const wall = apartmentUnitWorldPoint(apartment, [5.5, 6]);
    expect(isWalkable(result, wall.x, wall.y)).toBe(false);
    synchronizeBundangMinusOptionWorldCollision(result, []);
    expect(isWalkable(result, counter.x, counter.y)).toBe(false);
  });
});
