import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { apartmentSolidBlockVisualFootprint, apartmentUnitWorldPoint, apartmentWorldPointToLocalMeters } from './apartment-transform';
import { applyPlanVariant, availablePlanVariants } from './plan-variants';
import {
  measureIstarparkLaserDirectionalGap,
  measureIstarparkLaserFreePointPair,
  measureIstarparkLaserGap,
  istarparkLaserObstacles,
  snapIstarparkLaserPoint,
} from './istarpark-laser-measurement';
import type { StaticMapEntry, WorldChunk, WorldData, WorldObject } from './types';

function loadWorld(unitType: string): WorldData {
  const publicRoot = resolve(process.cwd(), 'public');
  const catalog = JSON.parse(readFileSync(join(publicRoot, 'generated', 'catalog.v1.json'), 'utf8')) as { maps: StaticMapEntry[] };
  const entry = catalog.maps.find((row) => row.unitType === unitType);
  if (!entry) throw new Error(`Missing ${unitType}`);
  const manifestPath = join(publicRoot, ...entry.manifestUrl.split('/'));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const blocked = new Set<string>();
  const objects: WorldObject[] = [];
  const chunkDir = join(dirname(manifestPath), 'chunks');
  for (const name of readdirSync(chunkDir).filter((value) => value.endsWith('.json'))) {
    const chunk = JSON.parse(readFileSync(join(chunkDir, name), 'utf8')) as WorldChunk;
    const width = Number(chunk.size?.width || 16);
    const originX = Number(chunk.origin?.x || 0);
    const originY = Number(chunk.origin?.y || 0);
    for (const index of chunk.blockedCellIndices || []) blocked.add(`${originX + index % width},${originY + Math.floor(index / width)}`);
    objects.push(...(chunk.objects || []));
  }
  return { entry, manifest, width: entry.width, height: entry.height, chunkWidth: 16, chunkHeight: 16,
    palette: new Map(), tiles: new Map(), blocked, objects, loadedChunkCount: 16, requestedChunkCount: 16,
    minimap: null, sourceMode: 'chunks' };
}

describe('real apartment measurement regression', () => {
  for (const unitType of ['51A', '55A', '55B', '59A']) {
    for (const variant of availablePlanVariants(unitType)) {
      it(`${unitType}-${variant}: wall spans are stable in real rooms and variant transform`, () => {
        const world = loadWorld(unitType);
        applyPlanVariant(world, variant);
        const apartment = world.objects.find((row) => row.type === 'enterable-apartment-unit-v1') as WorldObject;
        const geometry: any = apartment.geometry;
        const physicalGeometry = { ...geometry, floorAnnotationMode: undefined };
        if (unitType === '59A') {
          const block = geometry.solidBlocks.find((row: any) => row.id === 'bathroom-2-north-service-block');
          const measuredBlock = istarparkLaserObstacles({ geometry, apartment, props: geometry.interiorProps })
            .find((row) => row.id === block.id);
          expect(measuredBlock?.polygon).toEqual(apartmentSolidBlockVisualFootprint(apartment, block));
        }
        let comparisons = 0;
        let pointRayComparisons = 0;
        const clipped: string[] = [];
        const pointRayMismatches: string[] = [];
        for (const zone of geometry.roomZones || []) {
          const bounds = zone.boundsMeters || zone.bounds;
          if (!Array.isArray(bounds) || bounds.length !== 4) continue;
          for (const fx of [.25, .5, .75]) for (const fy of [.25, .5, .75]) {
            const local: [number, number] = [bounds[0] + (bounds[2] - bounds[0]) * fx, bounds[1] + (bounds[3] - bounds[1]) * fy];
            const roundtrip = apartmentWorldPointToLocalMeters(apartment, apartmentUnitWorldPoint(apartment, local));
            expect(roundtrip[0]).toBeCloseTo(local[0], 8);
            expect(roundtrip[1]).toBeCloseTo(local[1], 8);
            for (const axis of ['x', 'y'] as const) {
              const physical = measureIstarparkLaserGap({ geometry: physicalGeometry, apartment, anchorPlanPoint: roundtrip, axis, props: geometry.interiorProps });
              const actual = measureIstarparkLaserGap({ geometry, apartment, anchorPlanPoint: roundtrip, axis, props: geometry.interiorProps });
              if (!physical.valid || physical.anchorSnapped) continue;
              if (!actual.valid || actual.anchorSnapped) {
                clipped.push(`${zone.id}:${axis}:${local.join(',')}: ${actual.reason || 'anchor moved'} despite a valid physical span`);
                continue;
              }
              comparisons += 1;
              if (actual.negativeHit?.obstacleId !== physical.negativeHit?.obstacleId
                  || actual.positiveHit?.obstacleId !== physical.positiveHit?.obstacleId
                  || physical.distanceMm !== actual.distanceMm) {
                clipped.push(`${zone.id}:${axis}:${local.join(',')}:${actual.distanceMm}!=${physical.distanceMm}`);
              }
              if (!actual.negativeHit?.point || !actual.positiveHit?.point) continue;
              const start = snapIstarparkLaserPoint({
                geometry, apartment, props: geometry.interiorProps,
                candidatePlanPoint: actual.negativeHit.point,
                axisLock: axis, referencePlanPoint: roundtrip,
                maxSnapDistanceMeters: .001, requireSurface: true,
              });
              // Other touching meshes may tie at corners; compare only an
              // unambiguous start on the same physical obstacle as the ray.
              if (!start.valid || start.obstacleId !== actual.negativeHit.obstacleId) continue;
              const pointRay = measureIstarparkLaserDirectionalGap({
                geometry, apartment, props: geometry.interiorProps, startHit: start,
                axisLock: axis, pointerPlanPoint: roundtrip,
              });
              pointRayComparisons += 1;
              if (!pointRay.valid || Math.abs(Number(pointRay.distanceMm) - Number(actual.distanceMm)) > 0) {
                pointRayMismatches.push(`${zone.id}:${axis}:${local.join(',')}: ${pointRay.distanceMm ?? pointRay.reason} != ${actual.distanceMm}`);
              }
              const pair = measureIstarparkLaserFreePointPair({
                geometry, apartment, props: geometry.interiorProps, startHit: start,
                endPlanPoint: actual.positiveHit.point, axisLock: axis,
              });
              if (!pair.valid || Math.abs(Number(pair.distanceMm) - Number(actual.distanceMm)) > 0) {
                pointRayMismatches.push(`${zone.id}:${axis}:${local.join(',')}: point-pair ${pair.distanceMm ?? pair.reason} != ${actual.distanceMm}`);
              }
            }
          }
        }
        expect(comparisons).toBeGreaterThan(20);
        expect(pointRayComparisons).toBeGreaterThan(10);
        expect(clipped, clipped.slice(0, 12).join('\n')).toEqual([]);
        expect(pointRayMismatches, pointRayMismatches.slice(0, 12).join('\n')).toEqual([]);
      });
    }
  }
});
