import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apartmentSolidBlockVisualFootprint, apartmentUnitWorldPoint, apartmentWorldPointToLocalMeters } from './apartment-transform';
import { applyBundangMeasuredGeometry } from './bundang-measured-geometry';
import { bundangMeasuredDimensions, resolveBundangMeasuredDimension } from './bundang-measured-dimensions';
import { createBundangServiceFloorTextures } from './bundang-service-floor-finish';
import { createBundangDesignWallTextures, createBundangWallpaperTextures } from './bundang-wall-finish';
import { measureIstarparkLaserGap } from './istarpark-laser-measurement';
import { applyPlanVariant, type ApartmentPlanVariant } from './plan-variants';
import { readBundangPrototypeApartments } from './test-support/bundang-prototypes';
import { ThreeWorldRenderer } from './three-world';
import { canTraverse, isWalkable } from './world';
import type { StaticMapEntry, WorldData, WorldObject } from './types';

let source: WorldObject;
const maps = { entry: createBundangServiceFloorTextures('entry'), utility: createBundangServiceFloorTextures('utility') };
const wallpaper = { common: createBundangWallpaperTextures('common'), bedroom: createBundangWallpaperTextures('bedroom') };
const designWall = createBundangDesignWallTextures(), wood = new THREE.Texture(), bathroom = new THREE.Texture();
beforeAll(async () => { source = (await readBundangPrototypeApartments()).get('55B')!; });
afterAll(() => {
  [maps.entry, maps.utility, wallpaper.common, wallpaper.bedroom, designWall].forEach(set => Object.values(set).forEach(map => map.dispose()));
  wood.dispose(); bathroom.dispose();
});

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
  it('keeps the 800 mm door and gives the continuous jamb-to-exterior wall a single physical owner', () => {
    const original = JSON.stringify(source);
    const { geometry } = scene('A');
    const opening = geometry.openings!.find(row => row.id === 'utility-kitchen-east-opening')!;
    const lintel = geometry.wallSegments!.find(row => row.id === 'utility-kitchen-east-lintel')!;
    const returns = geometry.wallSegments!.filter(row => row.id === 'utility-kitchen-east-after');
    expect(opening).toMatchObject({ a: [3.45, 7.26], b: [3.45, 8.06], hingeEndpoint: 'b', wallThicknessMeters: .20 });
    expect(lintel).toMatchObject({ a: opening.a, b: opening.b, baseMeters: 2.1, heightMeters: .2 });
    expect(returns).toHaveLength(1);
    expect(returns[0]).toMatchObject({ a: [3.45, 8.06], b: [3.45, 9.20], thicknessMeters: .20,
      baseMeters: 0, heightMeters: 2.3, strictDoorJamb: true });
    const column = geometry.solidBlocks!.find(row => row.id === 'utility-solid-column')!;
    expect(column).toMatchObject({ boundsMeters: [2.80, 8.25, 3.35, 9.10], wallContactClearanceMeters: 0 });
    expect(apartmentSolidBlockVisualFootprint({ geometry } as WorldObject, column))
      .toEqual([[2.80, 8.25], [3.35, 8.25], [3.35, 9.10], [2.80, 9.10]]);
    // The same occupied union below the opening, without a duplicate 200 mm
    // wall strip or the old visual-only 215/15 mm subtraction from the core.
    const previousArea = .20 * .19 + .75 * .85;
    const currentArea = .20 * (9.10 - 8.06) + .55 * .85;
    expect(currentArea).toBeCloseTo(previousArea, 8);
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
    it(`${variant}: leaves the doorway bidirectional and renders/measures/blocks the entire connected wall`, () => {
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
      const renderer = Object.create(ThreeWorldRenderer.prototype) as any;
      Object.assign(renderer, { apartment, world, selectedOptionIds: [],
        structureRoot: new THREE.Group(), structureOccluders: [], canvas: { dataset: {} },
        woodFloorTexture: wood, wallpaperTextures: wallpaper, designWallTextures: designWall,
        serviceFloorTextures: maps, textureCache: new Map([['bundang-55b-gray-grout-tile-v1', bathroom]]) });
      renderer.buildApartment(apartment);
      renderer.structureRoot.updateMatrixWorld(true);
      try {
        const wall = renderer.structureRoot.children.find((mesh: THREE.Mesh) => mesh.userData.laserObstacleId === 'utility-kitchen-east-after') as THREE.Mesh<THREE.BoxGeometry>;
        const column = renderer.structureRoot.children.find((mesh: THREE.Mesh) => mesh.userData.laserObstacleId === 'utility-solid-column') as THREE.Mesh;
        expect(wall.geometry.parameters.width * .5).toBeCloseTo(1.14, 8);
        expect(wall.geometry.parameters.height * .5).toBeCloseTo(2.3, 8);
        const at = (x: number, y: number) => {
          const p = point([x, y]);
          return new THREE.Vector3(p.x - world.width / 2 + .5, 1.2 / .5, p.y - world.height / 2 + .5);
        };
        for (const y of [8.15, 8.50, 8.90]) {
          const start = at(3.8, y), direction = at(3.0, y).sub(start).normalize();
          const contact = new THREE.Raycaster(start, direction, 0, 2).intersectObjects([wall, column], false)[0];
          expect(contact?.object).toBe(wall);
          const local = apartmentWorldPointToLocalMeters(apartment,
            { x: contact.point.x + world.width / 2 - .5, y: contact.point.z + world.height / 2 - .5 });
          expect(local[0]).toBeCloseTo(3.55, 5);
          const laser = measureIstarparkLaserGap({ apartment, geometry, props: [], axis: 'x',
            anchorPlanPoint: [3.8, y], laserHeightMeters: 1.2 });
          expect(laser.valid).toBe(true);
          expect(laser.negativeHit!.obstacleId).toBe('utility-kitchen-east-after');
          expect(laser.negativeHit!.point![0]).toBeCloseTo(local[0], 5);
          const from = point([3.0, y]), to = point([3.9, y]);
          expect(canTraverse(world, from.x, from.y, to.x, to.y)).toBe(false);
        }
      } finally {
        renderer.structureRoot.traverse((object: THREE.Object3D) => {
          const mesh = object as THREE.Mesh;
          mesh.geometry?.dispose();
          if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => material.dispose());
        });
      }
    });
  }
});
