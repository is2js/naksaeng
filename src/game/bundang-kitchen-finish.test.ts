import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { apartmentPropPlacement, apartmentUnitWorldPoint } from './apartment-transform';
import { refineBundangOptionProps } from './bundang-option-layout';
import {
  BUNDANG_KITCHEN_STONE_OPTION_ID as OPTION,
  BUNDANG_KITCHEN_STONE_PROFILE,
  bundangKitchenWallFinishSurfaces,
  isBundangKitchenStonePart,
  refineBundangKitchenFinishProp,
} from './bundang-kitchen-finish';
import {
  applyBundangKitchenStoneMetricUVs,
  applyBundangKitchenWallFaceFinish,
  bundangKitchenStonePixels,
  createBundangKitchenStoneMaterial,
  createBundangKitchenStoneTextures,
  createBundangKitchenWallSelectionProxy,
} from './bundang-kitchen-finish-material';
import { applyBundangMeasuredGeometry } from './bundang-measured-geometry';
import { bundangWallFaceMaterialIndex } from './bundang-wall-finish';
import { istarparkLaserObstacles } from './istarpark-laser-measurement';
import { BUNDANG_MINUS_OPTION_ID } from './minus-option';
import { associateOptionSources } from './option-prop-selection';
import { applyPlanVariantInteriorOverrides, availablePlanVariants, planVariantDefinition } from './plan-variants';
import { readBundangPrototypeApartments } from './test-support/bundang-prototypes';
import { mergeEditorPropsWithBase, STRUCTURAL_PROP_ASSETS, ThreeWorldRenderer } from './three-world';
import type { ApartmentInteriorProp, WorldObject } from './types';

let sources: Map<string, WorldObject>;
const cases = ['51A', '55A', '55B', '59A'].flatMap(unit => availablePlanVariants(unit).map(variant => ({ unit, variant })));
beforeAll(async () => { sources = await readBundangPrototypeApartments(); });

function fresh(unit: string, variant: 'A' | 'B' | 'C' | 'D') {
  const object = structuredClone(sources.get(unit)!);
  applyBundangMeasuredGeometry(object);
  object.transform = planVariantDefinition(unit, variant).transform;
  applyPlanVariantInteriorOverrides(object, variant);
  return object;
}

describe('공식 마감재의 주방 벽·상판 Golden Shore', () => {
  it('밝은 아이보리 골재 채널은 결정적이며 재질은 지도만 공유하고 벽별 opacity를 독립 소유한다', () => {
    const first = bundangKitchenStonePixels(), second = bundangKitchenStonePixels();
    expect([first.width, first.height]).toEqual([256, 256]);
    expect(first.data).toEqual(second.data);
    const reds = [...first.data].filter((_, index) => index % 4 === 0);
    expect(reds.reduce((sum, value) => sum + value, 0) / reds.length).toBeGreaterThan(230);
    expect(new Set(reds).size).toBeGreaterThan(15);
    const maps = createBundangKitchenStoneTextures();
    const a = createBundangKitchenStoneMaterial(maps), b = createBundangKitchenStoneMaterial(maps, .28);
    expect(a).not.toBe(b); expect(a.map).toBe(b.map);
    expect(a.roughness).toBe(BUNDANG_KITCHEN_STONE_PROFILE.roughness);
    expect(a.metalness).toBe(0); expect(a.opacity).toBe(1); expect(b.opacity).toBe(.28);
    expect(a.bumpMap).toBe(maps.bump); expect(a.roughnessMap).toBe(maps.roughness);
    a.opacity = .2; expect(b.opacity).toBe(.28);
    a.dispose(); b.dispose(); Object.values(maps).forEach(map => map.dispose());
  });

  it.each(cases)('$unit $variant: 실제 주방 벽 안쪽 면·벽구멍을 지키며 반전은 한 번만 적용한다', ({ unit, variant }) => {
    const object = fresh(unit, variant), geometry = object.geometry!;
    const before = JSON.stringify(geometry);
    const rows = bundangKitchenWallFinishSurfaces(geometry, [OPTION]);
    expect(rows.length).toBe(unit === '55B' ? 6 : 5);
    expect(bundangKitchenWallFinishSurfaces(geometry, [])).toEqual([]);
    expect(bundangKitchenWallFinishSurfaces(geometry, [OPTION, BUNDANG_MINUS_OPTION_ID])).toEqual([]);
    for (const row of rows) {
      const wall = geometry.wallSegments!.find(w => w.id === row.wallSegmentId)!;
      expect(row.startFraction).toBeGreaterThanOrEqual(-1e-7);
      expect(row.endFraction).toBeLessThanOrEqual(1 + 1e-7);
      const a = apartmentUnitWorldPoint(object, wall.a as [number, number]);
      const b = apartmentUnitWorldPoint(object, wall.b as [number, number]);
      const normalOrigin = apartmentUnitWorldPoint(object, [0, 0]);
      const normalTo = apartmentUnitWorldPoint(object, row.normalMeters);
      const desired = new THREE.Vector3(normalTo.x - normalOrigin.x, 0, normalTo.y - normalOrigin.y).normalize();
      const faceIndex = bundangWallFaceMaterialIndex(object, wall.a as [number, number], wall.b as [number, number], row.normalMeters);
      const rotation = new THREE.Matrix4().makeRotationY(-Math.atan2(b.y - a.y, b.x - a.x));
      const renderedNormal = new THREE.Vector3(0, 0, faceIndex === 4 ? 1 : -1).transformDirection(rotation);
      expect(renderedNormal.dot(desired)).toBeCloseTo(1, 8);
      // A real window aperture never acquires a new wall finishing polygon.
      for (const opening of geometry.openings || []) {
        if (!String(opening.type).includes('window')) continue;
        const openingA = opening.a as number[], openingB = opening.b as number[];
        const p = [(Number(openingA[0]) + Number(openingB[0])) / 2,
          (Number(openingA[1]) + Number(openingB[1])) / 2];
        const horizontal = Math.abs(row.startMeters[1] - row.endMeters[1]) < .001;
        const axis = horizontal ? 0 : 1, across = 1 - axis;
        if (Math.abs(p[across] - row.startMeters[across]) > .2) continue;
        const height = Number(opening.baseMeters || 0) + Number(opening.heightMeters || 1.2) / 2;
        const covers = p[axis] > Math.min(row.startMeters[axis], row.endMeters[axis]) + 1e-6
          && p[axis] < Math.max(row.startMeters[axis], row.endMeters[axis]) - 1e-6
          && height > row.baseMeters && height < row.baseMeters + row.heightMeters;
        expect(covers, `${row.wallSegmentId}:${opening.id}`).toBe(false);
      }
    }
    if (unit === '55B') {
      const alpha = rows.find(row => row.wallSegmentId === 'alpha-west')!;
      expect(alpha.startMeters[1]).toBeCloseTo(6.86, 8);
      expect(alpha.endMeters[1]).toBeCloseTo(7.51, 8);
      expect(rows.find(row => row.wallSegmentId === 'outer-step-east')!.endMeters[1]).toBeCloseTo(9.10, 8);
    } else {
      const side = rows.find(row => row.runIndex === 1)!;
      expect(side.startMeters[1]).toBeCloseTo(.15, 8); // Include the connected window-cabinet end at the L corner.
    }
    const run = (geometry.optionAnchors as any).kitchen.countertopRuns[1];
    const prop: ApartmentInteriorProp = { id: `inspection-${unit}-kitchen-backsplash-2`, assetId: 'kitchen-backsplash-radianz-run',
      sourceOptionId: OPTION, installationRole: 'kitchen-backsplash', anchorId: 'kitchen.countertopRuns.1.backsplash',
      dimensionsMeters: [1.8, .035, .55], positionMeters: [run.boundsMeters[0], run.boundsMeters[1]], yawDeg: 90, mountHeightMeters: .9 };
    const proxy = refineBundangKitchenFinishProp(geometry, [OPTION], prop);
    expect(proxy.id).toBe(prop.id);
    expect(proxy).toMatchObject({ fixedOptionLayout: true, sourceOptionId: OPTION, collisionMode: 'visual-only', measurementObstacle: false });
    const meshGroup = createBundangKitchenWallSelectionProxy(proxy, object);
    const placement = apartmentPropPlacement(object, prop);
    meshGroup.position.set(placement.center.x, .9 / placement.cellSize, placement.center.y);
    meshGroup.rotation.y = placement.worldYaw;
    meshGroup.updateMatrixWorld(true);
    for (const mesh of meshGroup.children as THREE.Mesh[]) {
      const material = mesh.material as THREE.MeshBasicMaterial;
      expect(material.colorWrite).toBe(false); expect(material.depthWrite).toBe(false);
      const row = rows.find(row => row.wallSegmentId === mesh.userData.wallSegmentId)!;
      const vertex = new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute('position'), 0).applyMatrix4(mesh.matrixWorld);
      const target = apartmentUnitWorldPoint(object, row.startMeters);
      expect(vertex.x).toBeCloseTo(target.x, 5); expect(vertex.z).toBeCloseTo(target.y, 5);
      expect(vertex.y).toBeCloseTo(row.baseMeters / placement.cellSize, 5);
    }
    expect(istarparkLaserObstacles({ geometry, apartment: object, props: [proxy] }))
      .toEqual(istarparkLaserObstacles({ geometry, apartment: object, props: [] }));
    expect(JSON.stringify(geometry)).toBe(before);
  });

  it('55B의 alpha-west 벽 원래 face만 부분 분할해 공면 중복 없이 물리 표면과 나머지 5면을 유지한다', () => {
    const object = fresh('55B', 'A');
    const row = bundangKitchenWallFinishSurfaces(object.geometry!, [OPTION]).find(row => row.wallSegmentId === 'alpha-west')!;
    const length = Math.hypot(row.wallEndMeters[0] - row.wallStartMeters[0], row.wallEndMeters[1] - row.wallStartMeters[1]);
    const geometry = new THREE.BoxGeometry(length, row.heightMeters, .12);
    const before = new THREE.Box3().setFromBufferAttribute(geometry.getAttribute('position') as THREE.BufferAttribute);
    expect(applyBundangKitchenWallFaceFinish(geometry, 4, [row], 6, 1)).toBeGreaterThan(0);
    expect(geometry.boundingBox).toEqual(before);
    const materials = Array.from({ length: 7 }, () => new THREE.MeshBasicMaterial({ side: THREE.FrontSide }));
    const mesh = new THREE.Mesh(geometry, materials); mesh.updateMatrixWorld(true);
    const rayAt = (fraction: number) => new THREE.Raycaster(new THREE.Vector3((fraction - .5) * length, 0, 2), new THREE.Vector3(0, 0, -1))
      .intersectObject(mesh).filter(hit => hit.face?.normal.z === 1);
    expect(rayAt(.9)[0].face?.materialIndex).toBe(6);
    expect(rayAt(.2)[0].face?.materialIndex).toBe(4);
    for (const fraction of [.2, .9]) {
      const hits = rayAt(fraction);
      expect(hits).toHaveLength(1);
      expect(hits[0].point.z).toBeCloseTo(.06, 6);
    }
    // Selected triangles all lie in the intended source interval, not the refrigerator side.
    const positions = geometry.getAttribute('position');
    let area = 0;
    for (let index = 0; index < positions.count; index += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(positions, index), b = new THREE.Vector3().fromBufferAttribute(positions, index + 1), c = new THREE.Vector3().fromBufferAttribute(positions, index + 2);
      area += b.sub(a).cross(c.sub(a)).length() / 2;
    }
    expect(area).toBeCloseTo(2 * (length * row.heightMeters + .12 * row.heightMeters + length * .12), 5);
    geometry.dispose(); materials.forEach(material => material.dispose());
  });

  it('상판·연동 아일랜드 윗면만 같은 스톤을 쓰고 PET 하부장·슬라이드서랍·기본상판은 바꾸지 않는다', () => {
    const maps = createBundangKitchenStoneTextures();
    const renderer = Object.create(ThreeWorldRenderer.prototype) as any;
    renderer.apartment = { geometry: { cellSizeMeters: .5 } };
    renderer.kitchenStoneTextures = maps; renderer.variants = new Map();
    const produce = (prop: ApartmentInteriorProp) => renderer.proceduralProp(prop, STRUCTURAL_PROP_ASSETS.find(asset => asset.assetId === prop.assetId)) as THREE.Group;
    const countertop = { assetId: 'kitchen-countertop-radianz-run', dimensionsMeters: [2, .72, .06], materialVariantId: 'golden-shore-engineered-stone' };
    const stoneTop = produce(countertop).children[0] as THREE.Mesh;
    expect((stoneTop.material as THREE.MeshStandardMaterial).map).toBe(maps.albedo);
    const island = produce({ assetId: 'bunfirvil-island-integrated-cabinet-base', dimensionsMeters: [1.26, .8, .9], materialVariantId: 'golden-shore-engineered-stone' });
    for (const part of island.children as THREE.Mesh[]) {
      const role = part.userData.materialRole;
      expect((part.material as THREE.MeshStandardMaterial).map, role).toBe(role === 'secondary' ? maps.albedo : null);
    }
    const original = produce({ assetId: 'kitchen-countertop-default-run', materialVariantId: 'mma-sanded-goose' }).children[0] as THREE.Mesh;
    expect((original.material as THREE.MeshStandardMaterial).map).toBeNull();
    expect(isBundangKitchenStonePart({ installationRole: 'kitchen-island-dining-extension', materialVariantId: 'golden-shore-engineered-stone' }, 'primary')).toBe(true);
    const object = fresh('55A', 'D');
    const proxy = refineBundangKitchenFinishProp(object.geometry!, [OPTION], { id: 'old-owner', assetId: 'kitchen-backsplash-radianz-run', anchorId: 'kitchen.countertopRuns.0.backsplash' });
    const stored = [{ sourcePropId: 'old-owner', localOverride: true, localDeleted: true, positionMeters: [-20, -20] }];
    const before = JSON.stringify(stored);
    expect(mergeEditorPropsWithBase([proxy], stored)).toEqual([proxy]);
    expect(JSON.stringify(stored)).toBe(before);
    const ids = [OPTION];
    const restored = refineBundangOptionProps(object.geometry!, '55A', [], [{ id: 'default', assetId: 'kitchen-backsplash-default-run' }], 'D');
    expect(restored.find(prop => prop.id === 'default')?.kitchenWallFinishMode).toBeUndefined();
    expect(associateOptionSources([proxy], ids)[0].sourceOptionId).toBe(OPTION);
    Object.values(maps).forEach(map => map.dispose());
  });

  it.each(cases)('$unit $variant: 상판의 두 plan축 UV가 회전/반전 뒤에도 미터 기준이고 높이에 눌리지 않는다', ({ unit, variant }) => {
    const object = fresh(unit, variant), world = { width: 64, height: 64 };
    const prop: ApartmentInteriorProp = { positionMeters: [4, 1], yawDeg: 0 };
    const placement = apartmentPropPlacement(object, prop);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2 / .5, .06 / .5, .72 / .5));
    mesh.position.set(placement.center.x - world.width / 2 + .5, .9 / .5, placement.center.y - world.height / 2 + .5);
    mesh.rotation.y = placement.worldYaw; mesh.updateMatrixWorld(true);
    applyBundangKitchenStoneMetricUVs(mesh.geometry, mesh.matrixWorld, object, world);
    const normals = mesh.geometry.getAttribute('normal'), uv = mesh.geometry.getAttribute('uv');
    const top = Array.from({ length: uv.count }, (_, i) => i).filter(i => normals.getY(i) > .9);
    const u = top.map(i => uv.getX(i)), v = top.map(i => uv.getY(i));
    expect(Math.max(...u) - Math.min(...u)).toBeCloseTo(2 / .4, 5);
    expect(Math.max(...v) - Math.min(...v)).toBeCloseTo(.72 / .4, 5);
    mesh.geometry.dispose();
  });
});
