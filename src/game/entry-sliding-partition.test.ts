import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { isUserPlacedFurnitureProp } from '../manage/interior-layout';
import { apartmentUnitWorldPoint, type NumericPoint } from './apartment-transform';
import { refineBundangOptionProps } from './bundang-option-layout';
import { interiorPropCorners } from './interior-placement';
import { associateOptionSources } from './option-prop-selection';
import { applyPlanVariantInteriorOverrides, availablePlanVariants, planVariantDefinition } from './plan-variants';
import type { ApartmentGeometry, ApartmentInteriorProp, ShowcaseCatalog, WorldChunk, WorldObject } from './types';

const OPTION_ID = 'entry-sliding-partition-door';

function distanceToSegment(p: NumericPoint, a: NumericPoint, b: NumericPoint): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

it('51A A–D 중문은 가구 기본폭 대신 고정 옵션의 유효 통로폭으로 설치·해제된다', async () => {
  const root = path.join(process.cwd(), 'public');
  const catalog = JSON.parse(await readFile(path.join(root, 'generated/catalog.v1.json'), 'utf8')) as ShowcaseCatalog;
  const map = catalog.maps.find((row) => row.unitType === '51A')!;
  const runtime = await import(pathToFileURL(path.join(root, catalog.renderAssets!.optionModuleUrl)).href) as {
    bundangPrototypeOptionProps(geometry: ApartmentGeometry, unit: string, ids: string[]): ApartmentInteriorProp[];
  };
  const chunk = JSON.parse(await readFile(path.join(root, path.dirname(map.manifestUrl), 'chunks/1-1.json'), 'utf8')) as WorldChunk;
  const source = chunk.objects!.find((object) => object.type === 'enterable-apartment-unit-v1' && object.geometry)!;
  expect(catalog.bOptions.find((option) => option.id === OPTION_ID)?.compatibleUnitTypes).toContain('51A');
  for (const variant of availablePlanVariants('51A')) {
    const apartment = structuredClone(source) as WorldObject;
    apartment.transform = planVariantDefinition('51A', variant).transform;
    applyPlanVariantInteriorOverrides(apartment, variant);
    const geometry = apartment.geometry!;
    const before = JSON.stringify(geometry);
    const produce = (ids: string[]) => associateOptionSources(refineBundangOptionProps(
      geometry, '51A', ids, runtime.bundangPrototypeOptionProps(geometry, '51A', ids), variant,
    ), ids).filter((prop) => prop.assetId === OPTION_ID);
    expect(produce([]), variant).toEqual([]);
    const props = produce([OPTION_ID]);
    expect(props, variant).toHaveLength(1);
    const door = props[0];
    expect(door).toMatchObject({
      sourceOptionId: OPTION_ID, anchorId: 'entryPartition', installationRole: 'entry-partition',
      usableOpeningLengthMeters: 1.1, dimensionsMeters: [.968, .14, 2.2],
    });
    expect(isUserPlacedFurnitureProp(door)).toBe(false);
    // Check the full frame, not only its centre, against the unchanged wall faces.
    const corners = interiorPropCorners(door);
    const worldPoint = (p: NumericPoint): NumericPoint => {
      const point = apartmentUnitWorldPoint(apartment, p);
      return [point.x, point.y];
    };
    for (const value of geometry.wallSegments || []) {
      const wall = value as Record<string, unknown>;
      if (!Array.isArray(wall.a) || !Array.isArray(wall.b) || Number(wall.baseMeters) >= 2.2) continue;
      const a = worldPoint(wall.a as NumericPoint), b = worldPoint(wall.b as NumericPoint);
      const halfThickness = Number(wall.thicknessMeters) / (2 * Number(geometry.cellSizeMeters));
      for (let edge = 0; edge < corners.length; edge++) {
        const from = corners[edge], to = corners[(edge + 1) % corners.length];
        const steps = Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / .02);
        for (let i = 0; i <= steps; i++) {
          const point = worldPoint([from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps]);
          expect(distanceToSegment(point, a, b), `${variant}:${wall.id}`).toBeGreaterThan(halfThickness);
        }
      }
    }
    expect(produce([]), `${variant}:removed`).toEqual([]);
    expect(JSON.stringify(geometry), `${variant}:source preserved`).toBe(before);
  }
});
