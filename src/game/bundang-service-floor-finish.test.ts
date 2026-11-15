import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apartmentWorldPointToLocalMeters } from './apartment-transform';
import { BUNDANG_FLOOR_SURFACE_Y, WIDE_PLANK_FLOOR_OPTION_ID } from './bundang-floor-finish';
import { applyBundangMeasuredGeometry } from './bundang-measured-geometry';
import {
  BUNDANG_SERVICE_FLOOR_PROFILES,
  bundangServiceFloorBridges,
  bundangServiceFloorKind,
  bundangServiceFloorPixels,
  createBundangServiceFloorMaterial,
  createBundangServiceFloorTextures,
} from './bundang-service-floor-finish';
import { createBundangDesignWallTextures, createBundangWallpaperTextures } from './bundang-wall-finish';
import { istarparkLaserObstacles, istarparkLaserPointInPolygon } from './istarpark-laser-measurement';
import { applyPlanVariantInteriorOverrides, availablePlanVariants, planVariantDefinition } from './plan-variants';
import { readBundangPrototypeApartments } from './test-support/bundang-prototypes';
import { ThreeWorldRenderer } from './three-world';
import type { ApartmentGeometry, WorldObject } from './types';

let sources: Map<string, WorldObject>;
const cases = ['51A', '55A', '55B', '59A'].flatMap(unit => availablePlanVariants(unit).map(variant => ({ unit, variant })));
const maps = { entry: createBundangServiceFloorTextures('entry'), utility: createBundangServiceFloorTextures('utility') };
const wallpaper = { common: createBundangWallpaperTextures('common'), bedroom: createBundangWallpaperTextures('bedroom') };
const designWall = createBundangDesignWallTextures();
const wood = new THREE.Texture(), bathroom = new THREE.Texture();
beforeAll(async () => { sources = await readBundangPrototypeApartments(); });
afterAll(() => {
  [maps.entry, maps.utility, wallpaper.common, wallpaper.bedroom, designWall].forEach(set => Object.values(set).forEach(map => map.dispose()));
  wood.dispose(); bathroom.dispose();
});

function build(object: WorldObject, selected: string[] = []) {
  const renderer = Object.create(ThreeWorldRenderer.prototype) as any;
  Object.assign(renderer, { apartment: object, world: { width: 64, height: 64, entry: { unitType: object.unitTypeId } },
    selectedOptionIds: selected, structureRoot: new THREE.Group(), structureOccluders: [], canvas: { dataset: {} },
    woodFloorTexture: wood, wallpaperTextures: wallpaper, designWallTextures: designWall,
    serviceFloorTextures: maps, textureCache: new Map([['bundang-55b-gray-grout-tile-v1', bathroom]]) });
  renderer.buildApartment(object);
  return renderer;
}

function dispose(group: THREE.Group) {
  const geometry = new Set<THREE.BufferGeometry>(), material = new Set<THREE.Material>();
  group.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometry.add(mesh.geometry); (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(m => material.add(m));
  });
  geometry.forEach(g => g.dispose()); material.forEach(m => m.dispose());
}

describe('사진 비례의 현관·서비스공간 회색 타일', () => {
  it('600/300mm는 추론 표기로 구별하고3mm밝은줄눈·차분한회색·비금속거친면을 결정적으로 생성한다', () => {
    expect(BUNDANG_SERVICE_FLOOR_PROFILES.entry.tilePitchMeters).toBe(.6);
    expect(BUNDANG_SERVICE_FLOOR_PROFILES.utility.tilePitchMeters).toBe(.3);
    for (const kind of ['entry', 'utility'] as const) {
      const pixels = bundangServiceFloorPixels(kind), again = bundangServiceFloorPixels(kind);
      expect(pixels.data).toEqual(again.data);
      expect(BUNDANG_SERVICE_FLOOR_PROFILES[kind]).toMatchObject({ groutWidthMeters: .003, dimensionConfidence: 'inferred-photo-proportion' });
      const at = (x: number, y: number, channel: number) => (y * pixels.width + x) * 4 + channel;
      expect(pixels.data[at(0, 128, 0)]).toBeGreaterThan(pixels.data[at(128, 128, 0)] + 55);
      expect(pixels.data[at(128, 128, 2)]).toBeGreaterThanOrEqual(pixels.data[at(128, 128, 0)]);
      expect(pixels.bump[at(0, 128, 0)]).toBeLessThan(pixels.bump[at(128, 128, 0)]);
      const a = createBundangServiceFloorMaterial(maps[kind], kind), b = createBundangServiceFloorMaterial(maps[kind], kind);
      expect(a).not.toBe(b); expect(a.map).toBe(b.map);
      expect(a.metalness).toBe(0); expect(a.roughness).toBe(.88);
      expect(a.bumpMap).toBe(maps[kind].bump); expect(a.roughnessMap).toBe(maps[kind].roughness);
      a.dispose(); b.dispose();
    }
    expect(bundangServiceFloorKind('entry-pantry')).toBe('entry');
    expect(bundangServiceFloorKind('outdoor-unit')).toBe('utility');
    expect(bundangServiceFloorKind('bathroom-1')).toBeNull();
    expect(bundangServiceFloorKind('living')).toBeNull();
  });

  it.each(cases)('$unit $variant: 실제 floor renderer에 적용하고 문 바닥까지 이어지며 geometry/욕실/목마루/실측은 유지한다', ({ unit, variant }) => {
    const object = structuredClone(sources.get(unit)!);
    expect(applyBundangMeasuredGeometry(object)).toBe(true);
    object.transform = planVariantDefinition(unit, variant).transform;
    applyPlanVariantInteriorOverrides(object, variant);
    const geometry = object.geometry!, before = JSON.stringify(geometry);
    const obstacles = istarparkLaserObstacles({ geometry, apartment: object, props: [] });
    const renderer = build(object);
    try {
      const meshes = renderer.structureRoot.children as THREE.Mesh[];
      const serviceRooms = meshes.filter(mesh => mesh.userData.roomZoneId);
      expect(serviceRooms.map(mesh => mesh.userData.roomZoneId).sort()).toEqual(
        (unit === '51A' ? ['entry', 'outdoor-unit', 'utility'] : ['entry', 'entry-pantry', 'outdoor-unit', 'utility']).sort());
      const bridgeMeshes = meshes.filter(mesh => mesh.userData.serviceFloorBridgeOpeningId);
      const bridges = bundangServiceFloorBridges(geometry);
      expect(bridges).toHaveLength(unit === '51A' ? 1 : 2);
      expect(bridgeMeshes).toHaveLength(bridges.length);
      expect(bridges.some(bridge => bridge.roomIds.includes('utility') && bridge.roomIds.includes('outdoor-unit'))).toBe(true);
      for (const bridge of bridges) {
        const opening = geometry.openings!.find(row => row.id === bridge.openingId)!;
        expect(String(opening.type)).not.toContain('window');
        expect(bridge.roomIds.every(room => bundangServiceFloorKind(room) === bridge.kind)).toBe(true);
        for (const p of bridge.polygonMeters) expect(istarparkLaserPointInPolygon(p, geometry.floorPolygon)).toBe(true);
      }
      for (const mesh of [...serviceRooms, ...bridgeMeshes]) {
        const profile = mesh.userData.floorFinishProfile === BUNDANG_SERVICE_FLOOR_PROFILES.entry.id ? 'entry' : 'utility';
        expect((mesh.material as THREE.MeshStandardMaterial).map).toBe(maps[profile].albedo);
        expect(mesh.position.y).toBe(.052); // Existing room finish elevation, no new step/slab.
        const positions = mesh.geometry.getAttribute('position'), uv = mesh.geometry.getAttribute('uv');
        for (let i = 0; i < positions.count; i++) {
          const local = apartmentWorldPointToLocalMeters(object, { x: positions.getX(i) + 31.5, y: positions.getZ(i) + 31.5 });
          expect(uv.getX(i)).toBeCloseTo(local[0] / BUNDANG_SERVICE_FLOOR_PROFILES[profile].tilePitchMeters, 4);
          expect(uv.getY(i)).toBeCloseTo(local[1] / BUNDANG_SERVICE_FLOOR_PROFILES[profile].tilePitchMeters, 4);
        }
      }
      // The two bathrooms retain the imported wet-floor map and former PBR path.
      expect(meshes.filter(mesh => (mesh.material as THREE.MeshStandardMaterial).map === bathroom)).toHaveLength(2);
      const apartmentFloor = meshes.find(mesh => mesh.userData.structureKind === 'apartment-floor')!;
      expect(apartmentFloor.userData.floorFinish).toBe('standard');
      expect((apartmentFloor.material as THREE.MeshStandardMaterial).map).toBe(wood);
      expect(apartmentFloor.position.y).toBe(BUNDANG_FLOOR_SURFACE_Y);
      expect(istarparkLaserObstacles({ geometry, apartment: object, props: [] })).toEqual(obstacles);
      expect(JSON.stringify(geometry)).toBe(before);
    } finally { dispose(renderer.structureRoot); }
  });

  it('광폭마루 선택도 서비스 타일을 덮지 않으며 창문·다른 방에는 문턱 바닥을 만들지 않는다', () => {
    const object = structuredClone(sources.get('55A')!); applyBundangMeasuredGeometry(object);
    const renderer = build(object, [WIDE_PLANK_FLOOR_OPTION_ID]);
    const meshes = renderer.structureRoot.children as THREE.Mesh[];
    expect(meshes.find(mesh => mesh.userData.structureKind === 'apartment-floor')!.userData.floorFinish).toBe('wide');
    expect(meshes.filter(mesh => mesh.userData.roomZoneId)).toHaveLength(4);
    dispose(renderer.structureRoot);
    const geometry: ApartmentGeometry = { roomZones: [
      { id: 'utility', boundsMeters: [0, 0, 1, 1] }, { id: 'outdoor-unit', boundsMeters: [1.2, 0, 2.2, 1] },
      { id: 'living', boundsMeters: [0, 2, 1, 3] },
    ], openings: [{ id: 'not-a-door', type: 'window', a: [1.1, .2], b: [1.1, .8] },
      { id: 'wood-room-door', type: 'interior-door', a: [0, 1.5], b: [1, 1.5] }] };
    expect(bundangServiceFloorBridges(geometry)).toEqual([]);
  });
});
