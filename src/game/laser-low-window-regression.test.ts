import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { apartmentUnitWorldPoint, apartmentWorldPointToLocalMeters } from './apartment-transform';
import { applyBundangMeasuredGeometry } from './bundang-measured-geometry';
import { refineBundangOptionProps } from './bundang-option-layout';
import { istarparkLaserObstacles, istarparkLaserPointInPolygon, measureIstarparkLaserGap } from './istarpark-laser-measurement';
import { applyPlanVariant, availablePlanVariants, type ApartmentPlanVariant } from './plan-variants';
import { readBundangPrototypeApartments } from './test-support/bundang-prototypes';
import type { ApartmentGeometry, ApartmentInteriorProp, StaticMapEntry, WorldData, WorldObject } from './types';

type Point = [number, number];
let prototypes: Map<string, WorldObject>;
let runtimeProps: (geo: ApartmentGeometry, unit: string, options: string[]) => ApartmentInteriorProp[];

beforeAll(async () => {
  prototypes = await readBundangPrototypeApartments();
  const publicRoot = resolve(process.cwd(), 'public');
  const catalog = JSON.parse(readFileSync(resolve(publicRoot, 'generated/catalog.v1.json'), 'utf8'));
  const module = await import(/* @vite-ignore */ pathToFileURL(resolve(publicRoot, catalog.renderAssets.optionModuleUrl)).href);
  runtimeProps = module.bundangPrototypeOptionProps;
});

function scene(unit: string, variant: ApartmentPlanVariant, options: string[] = []) {
  const apartment = structuredClone(prototypes.get(unit)!);
  expect(applyBundangMeasuredGeometry(apartment)).toBe(true);
  const world = { entry: { id: `bundang-first-village-${unit.toLowerCase()}-prototype`, unitType: unit } as StaticMapEntry,
    width: 64, height: 64, objects: [apartment], blocked: new Set() } as WorldData;
  applyPlanVariant(world, variant);
  const geometry = apartment.geometry!;
  const props = refineBundangOptionProps(geometry, unit, options, runtimeProps(geometry, unit, options), variant);
  return { apartment, geometry, props };
}

const cases = ['51A', '55A', '55B', '59A'].flatMap(unit => availablePlanVariants(unit).map(variant => ({ unit, variant })));

describe('전 평형 저상창·열린 방향 자동 실측', () => {
  it.each(cases)('$unit-$variant: 세대 안에서 두 축을 대조하고 닿는 끝점만 표시한다', ({ unit, variant }) => {
    const context = scene(unit, variant);
    const { apartment, geometry } = context;
    const obstacles = istarparkLaserObstacles(context);
    const lowPanes = obstacles.filter(row => row.kind === 'window');
    expect(lowPanes.map(({ id }) => id)).toEqual(expect.arrayContaining([expect.stringContaining('living-window'), expect.stringContaining('outdoor-window')]));
    let sampled = 0;
    let halfSpans = 0;
    const paneHits = new Set<string>();
    for (let x = -.41; x < 13; x += .38) for (let y = .21; y < 11; y += .39) {
      const anchor: Point = [x, y];
      if (!istarparkLaserPointInPolygon(anchor, geometry.floorPolygon) || obstacles.some(o => istarparkLaserPointInPolygon(anchor, o.polygon))) continue;
      const anchorPlanPoint = apartmentWorldPointToLocalMeters(apartment, apartmentUnitWorldPoint(apartment, anchor));
      for (const axis of ['x', 'y'] as const) {
        const measurement = measureIstarparkLaserGap({ ...context, axis, anchorPlanPoint });
        expect(measurement.valid, `${x.toFixed(2)},${y.toFixed(2)} ${axis}: ${measurement.reason}`).toBe(true);
        sampled++;
        if (measurement.measurementMode === 'one-sided') {
          halfSpans++;
          const ends = [measurement.negativeHit, measurement.positiveHit];
          expect(ends.find(hit => hit?.kind === 'cursor')?.point).toEqual(anchorPlanPoint);
          expect(ends.filter(hit => hit?.obstacleId)).toHaveLength(1);
        }
        for (const hit of [measurement.negativeHit, measurement.positiveHit]) {
          if (hit?.kind === 'window') paneHits.add(hit.obstacleId!);
        }
      }
    }
    expect(sampled).toBeGreaterThan(700);
    expect(halfSpans).toBeGreaterThan(0);
    for (const pane of lowPanes) expect(paneHits.has(pane.id), pane.id).toBe(true);
  });

  it.each(availablePlanVariants('55B'))('55B-%s: 거실 창↔냉장고장 5200mm, 미설치 시 창↔벽 직접 실측', variant => {
    const anchorPlanPoint: Point = [1.5, 5.36];
    const axis = 'x' as const;
    expect(measureIstarparkLaserGap({ ...scene('55B', variant), axis, anchorPlanPoint })).toMatchObject({
      valid: true, distanceMm: 5960, negativeHit: { obstacleId: 'outer-west-living-window', kind: 'window', point: [-.52, 5.36] },
      positiveHit: { obstacleId: 'alpha-west', kind: 'wall' },
    });
    expect(measureIstarparkLaserGap({ ...scene('55B', variant, ['refrigerator-cabinet-pet-basic']), axis, anchorPlanPoint })).toMatchObject({
      valid: true, distanceMm: 5200, negativeHit: { obstacleId: 'outer-west-living-window' },
      positiveHit: { obstacleId: 'inspection-55B-refrigerator-cabinet', kind: 'furniture' },
    });
  });
});
