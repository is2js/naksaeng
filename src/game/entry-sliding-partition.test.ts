import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { isUserPlacedFurnitureProp } from '../manage/interior-layout';
import { apartmentUnitWorldPoint, type NumericPoint } from './apartment-transform';
import { refineBundangOptionProps } from './bundang-option-layout';
import { applyBundangMeasuredGeometry } from './bundang-measured-geometry';
import { ENTRY_PARTITION_ID, ENTRY_PARTITION_RAIL_ID } from './bundang-entry-partition';
import { createEntrySlidingPanel } from './entry-partition-model';
import { interiorPropCorners } from './interior-placement';
import { BUNDANG_MINUS_OPTION_ID } from './minus-option';
import { associateOptionSources, optionPropsForSelection } from './option-prop-selection';
import { applyPlanVariantInteriorOverrides, availablePlanVariants, planVariantDefinition } from './plan-variants';
import { readBundangPrototypeApartments } from './test-support/bundang-prototypes';
import { mergeEditorPropsWithBase } from './three-world';
import type { ApartmentGeometry, ApartmentInteriorProp, ShowcaseCatalog, WorldObject } from './types';

type Bounds = [number, number, number, number];
const PARKING: Record<string, [number, number]> = {
  '51A': [2.92, 4], '55A': [6.45, 7.38], '55B': [5.8, 6.95], '59A': [6.45, 7.78],
};
const cases = Object.keys(PARKING).flatMap(unit => availablePlanVariants(unit).map(variant => ({ unit, variant })));
let sources: Map<string, WorldObject>;
let runtime: { bundangPrototypeOptionProps(geometry: ApartmentGeometry, unit: string, ids: string[]): ApartmentInteriorProp[] };

beforeAll(async () => {
  sources = await readBundangPrototypeApartments();
  const root = path.join(process.cwd(), 'public');
  const catalog = JSON.parse(await readFile(path.join(root, 'generated/catalog.v1.json'), 'utf8')) as ShowcaseCatalog;
  runtime = await import(pathToFileURL(path.join(root, catalog.renderAssets!.optionModuleUrl)).href) as typeof runtime;
  for (const unit of Object.keys(PARKING)) {
    expect(catalog.bOptions.find(option => option.id === ENTRY_PARTITION_ID)?.compatibleUnitTypes).toContain(unit);
  }
});

function bounds(points: NumericPoint[]): Bounds {
  return [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])),
    Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))];
}

function gap(a: Bounds, b: Bounds): number {
  return Math.hypot(Math.max(0, a[0] - b[2], b[0] - a[2]), Math.max(0, a[1] - b[3], b[1] - a[3]));
}

function fresh(unit: string, variant: 'A' | 'B' | 'C' | 'D'): WorldObject {
  const apartment = structuredClone(sources.get(unit)!);
  expect(applyBundangMeasuredGeometry(apartment)).toBe(true);
  apartment.transform = planVariantDefinition(unit, variant).transform;
  applyPlanVariantInteriorOverrides(apartment, variant);
  return apartment;
}

describe('벽 앞에 완전히 주차되는 고정 슬라이딩 중문', () => {
  it.each(cases)('$unit $variant: legacy frame을 leaf+상하 rail 단일 옵션으로 교체하고 통로·벽 이격을 유지한다', ({ unit, variant }) => {
    const sourceBefore = JSON.stringify(sources.get(unit));
    const apartment = fresh(unit, variant);
    const geometry = apartment.geometry!;
    const geometryBefore = JSON.stringify(geometry);
    const produce = (ids: string[], extra: ApartmentInteriorProp[] = []) => associateOptionSources(refineBundangOptionProps(
      geometry, unit, ids, [...runtime.bundangPrototypeOptionProps(geometry, unit, ids), ...extra], variant,
    ), ids);
    const assembly = (props: ApartmentInteriorProp[]) => props.filter(prop => prop.assetId === ENTRY_PARTITION_ID
      || prop.assetId === ENTRY_PARTITION_RAIL_ID || String(prop.anchorId || '').startsWith('entryPartition'));

    expect(assembly(produce([]))).toEqual([]);
    const originals = runtime.bundangPrototypeOptionProps(geometry, unit, [ENTRY_PARTITION_ID]);
    const legacy = originals.find(prop => prop.assetId === ENTRY_PARTITION_ID)!;
    expect(legacy).toBeDefined();
    const originalPropsBefore = JSON.stringify(originals);
    const duplicate = { ...legacy, id: 'legacy-entry-duplicate', positionMeters: [-10, -10] };
    const props = produce([ENTRY_PARTITION_ID], [duplicate]);
    const parts = assembly(props);
    expect(parts).toHaveLength(3);
    expect(new Set(parts.map(prop => prop.id)).size).toBe(3);
    expect(optionPropsForSelection(props, ENTRY_PARTITION_ID)).toEqual(parts);
    expect(parts.some(prop => prop.id === duplicate.id)).toBe(false);
    expect(JSON.stringify(originals)).toBe(originalPropsBefore);
    for (const part of parts) {
      expect(part).toMatchObject({ sourceOptionId: ENTRY_PARTITION_ID, fixedOptionLayout: true,
        entrySlidingRevision: 'wall-slide-v2', displayState: 'open', openRatio: 1, wallClearanceMeters: .01 });
      expect(isUserPlacedFurnitureProp(part)).toBe(false);
    }
    const leaf = parts.find(prop => prop.assetId === ENTRY_PARTITION_ID)!;
    const rails = parts.filter(prop => prop.assetId === ENTRY_PARTITION_RAIL_ID);
    expect(rails).toHaveLength(2);
    expect(rails.map(prop => prop.anchorId).sort()).toEqual(['entryPartition.rail.bottom', 'entryPartition.rail.top']);
    for (const rail of rails) expect(rail).toMatchObject({ measurementObstacle: false, collisionMode: 'visual-only' });
    const bottom = rails.find(prop => prop.anchorId === 'entryPartition.rail.bottom')!;
    expect((bottom.dimensionsMeters as number[])[2]).toBeCloseTo(.010, 8);
    expect(Number(bottom.mountHeightMeters)).toBeGreaterThan(.035 * Number(geometry.cellSizeMeters || .5));
    expect(leaf).toMatchObject({ anchorId: 'entryPartition', installationRole: 'entry-partition',
      measurementObstacle: true, collisionMode: 'solid', mountHeightMeters: .018 });
    const size = leaf.dimensionsMeters as [number, number, number];
    expect(size[0]).toBeCloseTo(Number(leaf.usableOpeningLengthMeters) + .04, 8);
    expect(size.slice(1)).toEqual([.04, 2.2]);
    const model = createEntrySlidingPanel(leaf, 1);
    const actualSize = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    actualSize.toArray().forEach((value, index) => expect(value).toBeCloseTo([size[0], size[2], size[1]][index], 6));

    const local = bounds(interiorPropCorners(leaf));
    expect(local[0]).toBeCloseTo(PARKING[unit][0], 3);
    expect(local[2]).toBeCloseTo(PARKING[unit][1], 3);
    const parking = leaf.entryParkingBoundsMeters as number[];
    expect(local[1] - parking[1]).toBeCloseTo(.01, 8);
    const opening = leaf.entryOpeningBoundsMeters as number[];
    expect(unit === '51A' ? local[0] - opening[2] : opening[0] - local[2]).toBeGreaterThanOrEqual(.009);
    const worldBounds = (points: NumericPoint[]): Bounds => bounds(points.map(point => {
      const p = apartmentUnitWorldPoint(apartment, point);
      return [p.x, p.y];
    }));
    const leafWorld = worldBounds(interiorPropCorners(leaf));
    let closestGap = Infinity;
    for (const wall of geometry.wallSegments || []) {
      const a = wall.a as NumericPoint, b = wall.b as NumericPoint;
      const base = Number(wall.baseMeters || 0), height = Number(wall.heightMeters || 2.3);
      if (base >= .018 + size[2] || base + height <= .018) continue;
      const half = Number(wall.thicknessMeters || .12) / 2;
      const rectangle: NumericPoint[] = Math.abs(a[1] - b[1]) < .001
        ? [[Math.min(a[0], b[0]), a[1] - half], [Math.max(a[0], b[0]), a[1] + half]]
        : [[a[0] - half, Math.min(a[1], b[1])], [a[0] + half, Math.max(a[1], b[1])]];
      const wallBounds: NumericPoint[] = [rectangle[0], [rectangle[1][0], rectangle[0][1]], rectangle[1], [rectangle[0][0], rectangle[1][1]]];
      const distance = gap(leafWorld, worldBounds(wallBounds)) * Number(geometry.cellSizeMeters || .5);
      closestGap = Math.min(closestGap, distance);
      expect(distance, String(wall.id)).toBeGreaterThanOrEqual(.01 - 1e-7);
    }
    expect(closestGap).toBeCloseTo(.01, 7);
    expect(assembly(produce([]))).toEqual([]);
    expect(assembly(produce([BUNDANG_MINUS_OPTION_ID]))).toEqual([]);
    expect(assembly(produce([ENTRY_PARTITION_ID, BUNDANG_MINUS_OPTION_ID]))).toEqual([]);
    expect(JSON.stringify(geometry)).toBe(geometryBefore);
    expect(JSON.stringify(sources.get(unit))).toBe(sourceBefore);
  });

  it('이전 위치·회전·삭제 override가 고정 leaf와 두 rail을 덮지 않으며 저장 원문도 그대로 둔다', () => {
    const apartment = fresh('51A', 'A');
    const ids = [ENTRY_PARTITION_ID];
    const props = refineBundangOptionProps(apartment.geometry!, '51A', ids,
      runtime.bundangPrototypeOptionProps(apartment.geometry!, '51A', ids), 'A');
    const assembly = props.filter(prop => prop.sourceOptionId === ENTRY_PARTITION_ID);
    expect(assembly).toHaveLength(3);
    const overrides = assembly.map((prop, index) => ({ ...prop, id: `old-${index}`, sourcePropId: prop.id,
      localOverride: true, localDeleted: index === 0, positionMeters: [-50, -50], yawDeg: 45 }));
    const stored = JSON.stringify(overrides);
    expect(mergeEditorPropsWithBase(assembly, overrides)).toEqual(assembly);
    expect(JSON.stringify(overrides)).toBe(stored);
  });
});
