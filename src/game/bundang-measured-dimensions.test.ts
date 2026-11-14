import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { apartmentUnitWorldPoint, apartmentWorldPointToLocalMeters } from './apartment-transform';
import {
  BUNDANG_MEASURED_DIMENSIONS,
  bundangMeasuredDimensions,
  resolveBundangMeasuredDimension,
} from './bundang-measured-dimensions';
import { applyBundangMeasuredGeometry, BUNDANG_GEOMETRY_ADJUSTMENT_LIMIT_METERS } from './bundang-measured-geometry';
import { measureIstarparkLaserGap } from './istarpark-laser-measurement';
import { applyPlanVariant } from './plan-variants';
import { readBundangPrototypeApartments } from './test-support/bundang-prototypes';
import type { ApartmentGeometry, StaticMapEntry, WorldData, WorldObject } from './types';

const UNITS = ['51A', '55A', '55B', '59A'] as const;
const VARIANTS = ['A', 'B', 'C', 'D'] as const;
const cases = BUNDANG_MEASURED_DIMENSIONS.flatMap(reference => VARIANTS.map(variant => ({
  reference, variant, name: `${reference.unitType}-${variant} ${reference.id}`,
})));
let sourceApartments: Map<string, WorldObject>;
const calibrated = new Map<string, WorldObject>();
const snapshots = new Map<string, string>();

beforeAll(async () => {
  sourceApartments = await readBundangPrototypeApartments();
  for (const [unit, source] of sourceApartments) {
    snapshots.set(unit, JSON.stringify(source));
    const apartment = { ...source };
    expect(applyBundangMeasuredGeometry(apartment)).toBe(true);
    expect(apartment.geometry).not.toBe(source.geometry);
    calibrated.set(unit, apartment);
  }
});

describe('46 physical/reference dimension contracts', () => {
  it('keeps all provided targets, with only the ambiguous 55B alpha width marked inferred', () => {
    expect(BUNDANG_MEASURED_DIMENSIONS).toHaveLength(46);
    expect(cases).toHaveLength(184);
    for (const unit of UNITS) {
      const references = bundangMeasuredDimensions(unit);
      const annotations = sourceApartments.get(unit)!.geometry!.dimensionAnnotations as Array<{ id: string; valueMeters: number }>;
      expect(new Map(references.map(reference => [reference.id, reference.targetMm])))
        .toEqual(new Map(annotations.map(annotation => [annotation.id, Math.round(annotation.valueMeters * 1000)])));
      expect(new Set(references.map(reference => reference.id)).size).toBe(references.length);
    }
    expect(BUNDANG_MEASURED_DIMENSIONS.filter(reference => reference.provenance.targetConfidence === 'inferred-decimal')
      .map(reference => `${reference.unitType}:${reference.id}`)).toEqual(['55B:alpha-room-width']);
  });

  it.each(cases)('$name preserves endpoint physics, millimetres and non-worsening error after A-D transformation', ({ reference, variant }) => {
    const source = sourceApartments.get(reference.unitType)!;
    const apartment = structuredClone(calibrated.get(reference.unitType)!);
    const before = resolveBundangMeasuredDimension(source.geometry!, reference);
    const after = resolveBundangMeasuredDimension(apartment.geometry!, reference);
    expect(before.valid, before.reason).toBe(true);
    expect(after.valid, after.reason).toBe(true);
    const targetMeters = reference.targetMm / 1000;
    expect(Math.abs(after.distanceMeters! - targetMeters))
      .toBeLessThanOrEqual(Math.abs(before.distanceMeters! - targetMeters) + 1e-6);

    const world = {
      entry: { unitType: reference.unitType } as StaticMapEntry,
      objects: [apartment], blocked: new Set((apartment.blockedCells || []).map(cell => `${cell.x},${cell.y}`)),
    } as WorldData;
    applyPlanVariant(world, variant);
    const variantSpan = resolveBundangMeasuredDimension(apartment.geometry!, reference);
    expect(variantSpan.distanceMm).toBe(after.distanceMm);
    const start = apartmentUnitWorldPoint(apartment, variantSpan.startMeters!);
    const end = apartmentUnitWorldPoint(apartment, variantSpan.endMeters!);
    const cellSize = Number(apartment.geometry!.cellSizeMeters);
    expect(Math.round(Math.hypot(end.x - start.x, end.y - start.y) * cellSize * 1000)).toBe(after.distanceMm);
    for (const [worldPoint, expected] of [[start, variantSpan.startMeters!], [end, variantSpan.endMeters!]] as const) {
      const local = apartmentWorldPointToLocalMeters(apartment, worldPoint);
      expect(local[0]).toBeCloseTo(expected[0], 8);
      expect(local[1]).toBeCloseTo(expected[1], 8);
    }

    const geometry: ApartmentGeometry = { ...apartment.geometry, kitchenFixtures: [] };
    const midpoint = after.startMeters!.map((value, axis) => (value + after.endMeters![axis]) / 2) as [number, number];
    const actualGap = measureIstarparkLaserGap({ geometry, apartment: { ...apartment, geometry }, props: [],
      anchorPlanPoint: midpoint, axis: reference.axis });
    expect(actualGap.valid, actualGap.reason).toBe(true);
    expect(actualGap.dimensionLimitMm).toBeNull();
    expect(actualGap.finishCalibrationApplied).toBe(false);
    if (reference.kind === 'wall-face-span') {
      expect(actualGap.distanceMm).toBe(after.distanceMm);
      const along = reference.axis === 'x' ? 0 : 1;
      expect(actualGap.negativeHit!.point![along]).toBeCloseTo(after.startMeters![along], 6);
      expect(actualGap.positiveHit!.point![along]).toBeCloseTo(after.endMeters![along], 6);
    }
  });

  it.each(UNITS)('%s retains the source snapshot and exact exterior, with every wall displacement within 50mm', unit => {
    const source = sourceApartments.get(unit)!;
    const apartment = calibrated.get(unit)!;
    const before = source.geometry!, after = apartment.geometry!;
    expect(JSON.stringify(source)).toBe(snapshots.get(unit));
    expect(after.floorPolygon).toEqual(before.floorPolygon);
    expect(after.wallSegments!.filter(wall => wall.kind === 'exterior')).toEqual(before.wallSegments!.filter(wall => wall.kind === 'exterior'));
    expect(after.openings!.filter(opening => String(opening.id).startsWith('outer-'))).toEqual(before.openings!.filter(opening => String(opening.id).startsWith('outer-')));
    expect(after.wallSegments!.map(wall => wall.id)).toEqual(before.wallSegments!.map(wall => wall.id));
    expect(after.openings!.map(opening => opening.id)).toEqual(before.openings!.map(opening => opening.id));
    const limit = BUNDANG_GEOMETRY_ADJUSTMENT_LIMIT_METERS + 1e-7;
    for (const oldWall of before.wallSegments!) {
      const wall = after.wallSegments!.find(candidate => candidate.id === oldWall.id)!;
      const oldA = oldWall.a as number[], oldB = oldWall.b as number[];
      const a = wall.a as number[], b = wall.b as number[];
      expect(Math.hypot(a[0] - oldA[0], a[1] - oldA[1]), String(wall.id)).toBeLessThanOrEqual(limit);
      expect(Math.hypot(b[0] - oldB[0], b[1] - oldB[1]), String(wall.id)).toBeLessThanOrEqual(limit);
      expect(Math.hypot((a[0] + b[0] - oldA[0] - oldB[0]) / 2, (a[1] + b[1] - oldA[1] - oldB[1]) / 2), String(wall.id)).toBeLessThanOrEqual(limit);
      expect(Math.abs(Number(wall.thicknessMeters) - Number(oldWall.thicknessMeters)), String(wall.id)).toBeLessThanOrEqual(limit);
      const oldLength = Math.hypot(oldB[0] - oldA[0], oldB[1] - oldA[1]);
      if (oldLength < 1e-8) continue;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const oldNormal = [-(oldB[1] - oldA[1]) / oldLength, (oldB[0] - oldA[0]) / oldLength];
      const normal = [-(b[1] - a[1]) / length, (b[0] - a[0]) / length];
      for (const sign of [-1, 1]) for (const [oldEnd, end] of [[oldA, a], [oldB, b]]) {
        const dx = end[0] + sign * normal[0] * Number(wall.thicknessMeters) / 2 - oldEnd[0] - sign * oldNormal[0] * Number(oldWall.thicknessMeters) / 2;
        const dy = end[1] + sign * normal[1] * Number(wall.thicknessMeters) / 2 - oldEnd[1] - sign * oldNormal[1] * Number(oldWall.thicknessMeters) / 2;
        expect(Math.hypot(dx, dy), `${wall.id}:face${sign}`).toBeLessThanOrEqual(limit);
      }
    }
    const calibratedOnce = JSON.stringify(apartment);
    expect(applyBundangMeasuredGeometry(apartment)).toBe(false);
    expect(JSON.stringify(apartment)).toBe(calibratedOnce);
  });

  it('never derives endpoints from target labels or turns reference lines into new walls', () => {
    for (const unit of UNITS) {
      const apartment = calibrated.get(unit)!;
      const geometry = structuredClone(apartment.geometry!);
      geometry.dimensionAnnotations = [];
      geometry.measuredDimensionsMeters = {};
      for (const reference of bundangMeasuredDimensions(unit)) {
        const original = resolveBundangMeasuredDimension(geometry, reference);
        const changedTarget = resolveBundangMeasuredDimension(geometry, { ...reference, targetMm: reference.targetMm + 10000 });
        expect(changedTarget.startMeters).toEqual(original.startMeters);
        expect(changedTarget.endMeters).toEqual(original.endMeters);
        expect(changedTarget.distanceMm).toBe(original.distanceMm);
      }
    }
  });

  it('keeps the 46-row audit and public guide synchronized with actual geometry calculations', async () => {
    const files = ['docs/bundang-measured-dimensions-2026-11-14.md', 'src/guides/content/laser-dimensions.md'];
    const documents = await Promise.all(files.map(file => readFile(path.join(process.cwd(), file), 'utf8')));
    const tables = documents.map(document => document.split('\n')
      .filter(line => line.startsWith('| ') && !line.startsWith('| 항목') && !line.startsWith('| ---')));
    expect(tables[0]).toHaveLength(46);
    expect(tables[1]).toEqual(tables[0]);
    for (const [index, reference] of BUNDANG_MEASURED_DIMENSIONS.entries()) {
      const before = resolveBundangMeasuredDimension(sourceApartments.get(reference.unitType)!.geometry!, reference);
      const after = resolveBundangMeasuredDimension(calibrated.get(reference.unitType)!.geometry!, reference);
      const cells = tables[0][index].split('|').slice(1, -1).map(value => value.trim());
      const number = (value: string): number => Number(value.replaceAll(',', ''));
      expect(cells[1]).toBe(reference.kind === 'reference-span' ? '기준선' : '실제 면');
      expect(number(cells[2])).toBe(reference.targetMm);
      expect(number(cells[3])).toBe(before.distanceMm);
      expect(number(cells[4])).toBe(after.distanceMm);
      expect(number(cells[5])).toBe(after.errorMm);
    }
  });
});
