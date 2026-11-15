import { beforeAll, describe, expect, it } from 'vitest';
import { apartmentUnitWorldPoint } from './apartment-transform';
import { applyBundang55BGeometry } from './bundang-55b-geometry';
import { applyBundangExactGeometry } from './bundang-exact-geometry';
import { BUNDANG_EXACT_GEOMETRY_REVISION } from './bundang-exact-source';
import { bundangMeasuredDimensions, resolveBundangMeasuredDimension } from './bundang-measured-dimensions';
import { measureIstarparkLaserGap } from './istarpark-laser-measurement';
import { planVariantDefinition } from './plan-variants';
import { readBundangPrototypeApartments } from './test-support/bundang-prototypes';
import type { ApartmentInteriorProp, WorldObject } from './types';

let sources: Map<string, WorldObject>;
beforeAll(async () => { sources = await readBundangPrototypeApartments(); });

describe('offline exact geometry runtime', () => {
  for (const unit of ['51A', '55A', '55B', '59A']) it(`${unit}: actual reference contacts, laser and A–D world spans agree`, () => {
    const apartment = structuredClone(sources.get(unit)!);
    expect(unit === '55B' ? applyBundang55BGeometry(apartment) : applyBundangExactGeometry(apartment)).toBe(true);
    const geometry = apartment.geometry!;
    for (const reference of bundangMeasuredDimensions(unit)) {
      const resolved = resolveBundangMeasuredDimension(geometry, reference);
      expect(resolved.valid, `${reference.id}:${resolved.reason}`).toBe(true);
      expect(resolved.distanceMeters! * 1000, reference.id).toBeCloseTo(reference.targetMm, 5);
      const start = resolved.startMeters!, end = resolved.endMeters!;
      expect(Math.hypot(end[0] - start[0], end[1] - start[1]) * 1000).toBeCloseTo(reference.targetMm, 5);
      for (const variant of ['A', 'B', 'C', 'D'] as const) {
        apartment.transform = planVariantDefinition(unit, variant).transform;
        const a = apartmentUnitWorldPoint(apartment, start), b = apartmentUnitWorldPoint(apartment, end);
        expect(Math.hypot(b.x - a.x, b.y - a.y) * geometry.cellSizeMeters! * 1000).toBeCloseTo(reference.targetMm, 5);
      }
      if (reference.kind === 'wall-face-span') {
        const measured = measureIstarparkLaserGap({ geometry: { ...geometry, kitchenFixtures: [], interiorProps: [] },
          props: [], axis: reference.axis, anchorPlanPoint: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2] });
        expect(measured.valid, `${reference.id}:${measured.reason}`).toBe(true);
        expect(measured.distanceMm, `${reference.id}:${JSON.stringify(measured.negativeHit)}→${JSON.stringify(measured.positiveHit)}`).toBe(reference.targetMm);
        expect(measured.rawDistanceMm).toBe(reference.targetMm);
        expect(measured.finishCalibrationMm).toBe(0);
      }
    }
  });

  it('clones a known raw source once, preserves wall thickness/annotations and refuses a stale geometry', () => {
    const apartment = structuredClone(sources.get('55A')!);
    const raw = apartment.geometry!, before = structuredClone(raw);
    expect(applyBundangExactGeometry(apartment)).toBe(true);
    expect(raw).toEqual(before);
    expect(apartment.geometry).not.toBe(raw);
    expect(apartment.geometry!.wallSegments!.map(wall => wall.thicknessMeters)).toEqual(raw.wallSegments!.map(wall => wall.thicknessMeters));
    expect(apartment.geometry!.dimensionAnnotations).toEqual(raw.dimensionAnnotations);
    expect(apartment.geometry!.measuredDimensionsMeters).toEqual(raw.measuredDimensionsMeters);
    expect(apartment.geometry!.bundangMeasuredGeometryRevision).toBe(BUNDANG_EXACT_GEOMETRY_REVISION);
    const once = apartment.geometry;
    expect(applyBundangExactGeometry(apartment)).toBe(false);
    expect(apartment.geometry).toBe(once);
    const stale = structuredClone(sources.get('55A')!);
    (stale.geometry!.wallSegments![0].a as number[])[0] += .001;
    const staleSource = stale.geometry;
    expect(applyBundangExactGeometry(stale)).toBe(false);
    expect(stale.geometry).toBe(staleSource);
  });

  it('moves source-owned products as rigid shapes, not stretched furniture, and leaves saved/user props untouched', () => {
    const apartment = structuredClone(sources.get('55A')!);
    const product: ApartmentInteriorProp = { id: 'fixed-test', assetId: 'fixed-product', positionMeters: [3.25, 6.5],
      dimensionsMeters: [1.2, .5, .8], renderDimensionsMeters: { width: 1.1, depth: .45, height: .75 },
      footprintPolygonMeters: [[2.65, 6.25], [3.85, 6.25], [3.85, 6.75], [2.65, 6.75]] };
    const users: ApartmentInteriorProp[] = [
      { id: 'edited', assetId: 'user-product', localOverride: true, positionMeters: [3.25, 6.5], dimensionsMeters: [1, 1, 1] },
      { id: 'placed', assetId: 'user-product', userPlaced: true, positionMeters: [3.25, 6.5] },
      { id: 'local-untagged', assetId: 'user-product', positionMeters: [3.25, 6.5] },
    ];
    apartment.geometry!.interiorProps!.push(product, ...users);
    (apartment as WorldObject & { savedFurniture: unknown }).savedFurniture = users;
    const original = structuredClone(product), saved = structuredClone(users);
    expect(applyBundangExactGeometry(apartment)).toBe(true);
    const moved = apartment.geometry!.interiorProps!.find(prop => prop.id === product.id)!;
    expect(moved.positionMeters).not.toEqual(product.positionMeters);
    expect(moved.dimensionsMeters).toEqual(product.dimensionsMeters);
    expect(moved.renderDimensionsMeters).toEqual(product.renderDimensionsMeters);
    const polygon = moved.footprintPolygonMeters as number[][];
    (original.footprintPolygonMeters as number[][]).forEach((point, index) => {
      expect(polygon[index][0] - moved.positionMeters![0]).toBeCloseTo(point[0] - original.positionMeters![0], 9);
      expect(polygon[index][1] - moved.positionMeters![1]).toBeCloseTo(point[1] - original.positionMeters![1], 9);
    });
    expect(apartment.geometry!.interiorProps!.filter(prop => users.some(user => user.id === prop.id))).toEqual(saved);
    expect((apartment as WorldObject & { savedFurniture: unknown }).savedFurniture).toBe(users);
    expect(users).toEqual(saved);
    expect(product).toEqual(original);
  });

  it('provides physically warped logical door gaps for fixed door options without shrinking their aperture', () => {
    for (const unit of ['55A', '59A']) {
      const apartment = structuredClone(sources.get(unit)!);
      expect(applyBundangExactGeometry(apartment)).toBe(true);
      const gaps = apartment.geometry!.optionAnchors!.bunfirvilExactDoorwayGaps as Record<string, { a: number[]; b: number[] }>;
      const gap = gaps['bedroom-1'];
      expect(Math.hypot(gap.b[0] - gap.a[0], gap.b[1] - gap.a[1])).toBeGreaterThanOrEqual(.9 - 1e-8);
    }
  });
});
