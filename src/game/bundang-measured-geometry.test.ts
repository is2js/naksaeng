import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { applyBundangMeasuredGeometry, bundangGeometryCalibration, BUNDANG_GEOMETRY_ADJUSTMENT_LIMIT_METERS } from './bundang-measured-geometry';
import { bundangMeasuredDimensions, resolveBundangMeasuredDimension } from './bundang-measured-dimensions';
import { applyPlanVariantInteriorOverrides } from './plan-variants';
import { readBundangPrototypeApartments } from './test-support/bundang-prototypes';
import type { WorldObject } from './types';
import { loadWorld } from './world';

type Point = [number, number];
type Row = Record<string, any>;
let prototypes: Map<string, WorldObject>;
beforeAll(async () => { prototypes = await readBundangPrototypeApartments(); });
const distance = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const tolerance = 2e-8;

describe('bounded source-only Bundang geometry calibration', () => {
  for (const unitType of ['51A', '55A', '55B', '59A']) {
    it(`${unitType}: clones once and preserves the entire exterior outline and source annotations`, () => {
      const apartment = structuredClone(prototypes.get(unitType)!);
      const original = apartment.geometry!;
      const preserved = structuredClone(original);
      expect(applyBundangMeasuredGeometry(apartment)).toBe(true);
      expect(apartment.geometry).not.toBe(original);
      expect(original).toEqual(preserved);
      expect(apartment.geometry!.floorPolygon).toEqual(original.floorPolygon);
      expect(apartment.geometry!.wallSegments!.filter(wall => wall.kind === 'exterior'))
        .toEqual(original.wallSegments!.filter(wall => wall.kind === 'exterior'));
      expect(apartment.geometry!.openings!.filter(opening => String(opening.id).startsWith('outer-')))
        .toEqual(original.openings!.filter(opening => String(opening.id).startsWith('outer-')));
      expect(apartment.geometry!.dimensionAnnotations).toEqual(original.dimensionAnnotations);
      expect(apartment.geometry!.measuredDimensionsMeters).toEqual(original.measuredDimensionsMeters);
      const alreadyCorrected = apartment.geometry;
      expect(applyBundangMeasuredGeometry(apartment)).toBe(false);
      expect(apartment.geometry).toBe(alreadyCorrected);
    });

    it(`${unitType}: every center, endpoint, thickness and final face stays inside the actual 50 mm limit`, () => {
      const apartment = structuredClone(prototypes.get(unitType)!);
      const original = apartment.geometry!;
      applyBundangMeasuredGeometry(apartment);
      const walls = apartment.geometry!.wallSegments!;
      expect(walls.map(wall => wall.id)).toEqual(original.wallSegments!.map(wall => wall.id));
      for (const [index, wall] of walls.entries()) {
        const before = original.wallSegments![index] as Row;
        const after = wall as Row;
        const axis = before.a[0] === before.b[0] ? 0 : 1;
        expect(Number(after.thicknessMeters)).toBeGreaterThan(0);
        expect(Math.abs(after.thicknessMeters - before.thicknessMeters)).toBeLessThanOrEqual(.05 + tolerance);
        expect(after.a[axis]).toBeCloseTo(after.b[axis], 8);
        for (const endpoint of ['a', 'b']) {
          expect(distance(before[endpoint], after[endpoint]), `${unitType}:${wall.id}:${endpoint}`)
            .toBeLessThanOrEqual(BUNDANG_GEOMETRY_ADJUSTMENT_LIMIT_METERS + tolerance);
          for (const sign of [-1, 1]) {
            const oldFace = [...before[endpoint]] as Point;
            const newFace = [...after[endpoint]] as Point;
            oldFace[axis] += sign * before.thicknessMeters / 2;
            newFace[axis] += sign * after.thicknessMeters / 2;
            expect(distance(oldFace, newFace), `${unitType}:${wall.id}:${endpoint}:face${sign}`)
              .toBeLessThanOrEqual(.05 + tolerance);
          }
        }
        const oldCenter: Point = [(before.a[0] + before.b[0]) / 2, (before.a[1] + before.b[1]) / 2];
        const newCenter: Point = [(after.a[0] + after.b[0]) / 2, (after.a[1] + after.b[1]) / 2];
        expect(distance(oldCenter, newCenter)).toBeLessThanOrEqual(.05 + tolerance);
      }
    });

    it(`${unitType}: true physical/reference error never worsens and agrees with the offline table`, () => {
      const apartment = structuredClone(prototypes.get(unitType)!);
      const original = apartment.geometry!;
      const table = bundangGeometryCalibration(unitType)!;
      applyBundangMeasuredGeometry(apartment);
      let beforeTotal = 0;
      let afterTotal = 0;
      for (const reference of bundangMeasuredDimensions(unitType)) {
        const before = resolveBundangMeasuredDimension(original, reference);
        const after = resolveBundangMeasuredDimension(apartment.geometry!, reference);
        expect(before.valid, reference.id).toBe(true);
        expect(after.valid, `${reference.id}:${after.reason}`).toBe(true);
        const beforeMm = before.distanceMeters! * 1000;
        const afterMm = after.distanceMeters! * 1000;
        const saved = table.dimensions.find(row => row.id === reference.id)!;
        expect(afterMm).toBeCloseTo(saved.afterMm, 5);
        expect(Math.abs(afterMm - reference.targetMm)).toBeLessThanOrEqual(Math.abs(beforeMm - reference.targetMm) + .00001);
        beforeTotal += Math.abs(beforeMm - reference.targetMm);
        afterTotal += Math.abs(afterMm - reference.targetMm);
      }
      expect(afterTotal).toBeLessThan(beforeTotal);
      expect(afterTotal).toBeCloseTo(table.summary.afterTotalErrorMm, 5);
    });

    it(`${unitType}: kitchen runs and B/D absolute fixture overrides stay aligned without changing saved user data`, () => {
      const apartment = structuredClone(prototypes.get(unitType)!);
      const source = apartment.geometry!;
      const userFurniture = [{ assetId: 'user-bed', positionMeters: [1.23, 6.78], yawDeg: 90 }];
      const untouched = structuredClone(userFurniture);
      applyBundangMeasuredGeometry(apartment);
      const corrected = apartment.geometry!;
      const runs = ((corrected.optionAnchors as Row).kitchen.countertopRuns || []) as Row[];
      for (const [index, fixture] of (corrected.kitchenFixtures || []).entries()) {
        expect(fixture.boundsMeters).toEqual(runs[index].boundsMeters);
      }
      const oldOverrides = (source.optionAnchors as Row).planVariantOverrides?.B?.bathrooms?.roomOverrides;
      const newOverrides = (corrected.optionAnchors as Row).planVariantOverrides?.B?.bathrooms?.roomOverrides;
      for (const [roomId, fixtures] of Object.entries(oldOverrides || {})) {
        for (const [fixtureId, oldFixture] of Object.entries(fixtures as Row)) {
          const oldPosition = (oldFixture as Row).positionMeters;
          if (!oldPosition) continue;
          expect(distance(oldPosition, newOverrides[roomId][fixtureId].positionMeters)).toBeLessThanOrEqual(.05 + tolerance);
        }
      }
      applyPlanVariantInteriorOverrides(apartment, 'D');
      for (const prop of corrected.interiorProps || []) {
        const match = String(prop.anchorId || '').match(/^(bathroom-[12])\.(toilet|basin|wetFixture)$/);
        if (!match) continue;
        expect(prop.positionMeters).toEqual((corrected.optionAnchors as Row).bathrooms[match[1]][match[2]].positionMeters);
      }
      expect(userFurniture).toEqual(untouched);
    });
  }

  it('refuses unrelated maps and stale source geometry rather than applying a stale calibration', () => {
    const apartment = structuredClone(prototypes.get('51A')!);
    (apartment.geometry!.wallSegments![0].a as number[])[0] += .001;
    const source = apartment.geometry;
    expect(applyBundangMeasuredGeometry(apartment)).toBe(false);
    expect(apartment.geometry).toBe(source);
    expect(applyBundangMeasuredGeometry({ type: 'other', unitTypeId: '51A', geometry: prototypes.get('51A')!.geometry })).toBe(false);
  });

  it('preserves the 55B alpha-door and adjacent jamb geometry that protects bidirectional grid approaches', () => {
    const apartment = structuredClone(prototypes.get('55B')!);
    const source = apartment.geometry!;
    applyBundangMeasuredGeometry(apartment);
    for (const id of ['alpha-west', 'alpha-north-door-before', 'alpha-north-door-after', 'alpha-north-door-lintel']) {
      expect(apartment.geometry!.wallSegments!.find(wall => wall.id === id))
        .toEqual(source.wallSegments!.find(wall => wall.id === id));
    }
    expect(apartment.geometry!.openings!.find(opening => opening.id === 'alpha-north-door-opening'))
      .toEqual(source.openings!.find(opening => opening.id === 'alpha-north-door-opening'));
  });

  it('applies calibration in the actual static world loader before any variant is selected', async () => {
    const publicRoot = path.join(process.cwd(), 'public');
    const catalog = JSON.parse(await readFile(path.join(publicRoot, 'generated/catalog.v1.json'), 'utf8'));
    const entry = catalog.maps.find((map: Row) => map.unitType === '55A');
    vi.stubGlobal('window', { location: { href: 'http://localhost/bunfirvil/' } });
    vi.stubGlobal('fetch', async (url: string) => {
      const pathname = new URL(url).pathname;
      const generatedPath = pathname.slice(pathname.indexOf('/generated/') + 1);
      try {
        return new Response(await readFile(path.join(publicRoot, generatedPath), 'utf8'), { status: 200 });
      } catch {
        return new Response('', { status: 404 });
      }
    });
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null;
      set src(_url: string) { queueMicrotask(() => this.onload?.()); }
    });
    try {
      const world = await loadWorld(entry);
      const apartment = world.objects.find(object => object.type === 'enterable-apartment-unit-v1')!;
      expect(apartment.geometry!.bundangMeasuredGeometryRevision).toBe('bundang-measured-geometry-v1');
      expect(apartment.geometry!.floorPolygon).toEqual(prototypes.get('55A')!.geometry!.floorPolygon);
      expect(applyBundangMeasuredGeometry(apartment)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
