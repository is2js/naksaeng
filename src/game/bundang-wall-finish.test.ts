import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { apartmentPropPlacement, apartmentUnitWorldPoint, apartmentWorldPointToLocalMeters, type NumericPoint } from './apartment-transform';
import { BUNDANG_DESIGN_WALL_MATERIAL_ID, bundangDesignWallProps } from './bundang-option-layout';
import {
  applyBundangWallFinishUVs, BUNDANG_DESIGN_WALL_PROFILE, BUNDANG_WALLPAPER_PROFILES, bundangDesignWallPixels,
  bundangWallFaceFinishes, bundangWallFaceMaterialIndex, createBundangDesignWallMaterial,
  createBundangDesignWallTextures, createBundangWallFinishSelectionSurface,
  createBundangWallpaperTextures, createBundangWallpaperMaterial, bundangWallpaperKindAt,
} from './bundang-wall-finish';
import { ThreeWorldRenderer, STRUCTURAL_PROP_ASSETS } from './three-world';
import { BUNDANG_MINUS_OPTION_ID } from './minus-option';
import { istarparkLaserObstacles } from './istarpark-laser-measurement';
import { laserPointerWorldPoint } from './laser-pointer-projection';
import type { ApartmentGeometry, ApartmentInteriorProp, WorldObject } from './types';

const sourceWall = { id: 'bathroom-1-east', a: [3.6, 2.2], b: [3.6, 4.8], thicknessMeters: .2, baseMeters: 0, heightMeters: 2.3 };
const sourceGeometry = { cellSizeMeters: .5, wallSegments: [sourceWall] } as ApartmentGeometry;

describe('디자인월은 구조벽의 공용면 재질만 교체한다', () => {
  it('한 원본에서 유상 마감과 무두께 선택 프록시를 생성하고 마옵·해제 시 복원한다', () => {
    const geometry = structuredClone(sourceGeometry), original = structuredClone(geometry);
    const ids = ['living-design-wall-panel'];
    const assignments = bundangWallFaceFinishes(geometry, '55A', ids);
    expect(assignments.size).toBe(1);
    expect(assignments.get(sourceWall.id)).toMatchObject({ wallSegmentId: sourceWall.id, normalMeters: [1, 0],
      materialId: BUNDANG_DESIGN_WALL_MATERIAL_ID, sourceOptionId: ids[0], baseProvided: false });
    const proxy = bundangDesignWallProps(geometry, '55A', ids)[0];
    expect(proxy.positionMeters).toEqual([3.7, 3.5]);
    expect((proxy.dimensionsMeters as number[])[0]).toBeCloseTo(2.6);
    expect((proxy.dimensionsMeters as number[]).slice(1)).toEqual([0, 2.3]);
    expect(proxy.wallFinishMode).toBe('material-replacement');
    expect(proxy.measurementObstacle).toBe(false);
    expect(bundangWallFaceFinishes(geometry, '55A', []).size).toBe(0);
    expect(bundangWallFaceFinishes(geometry, '55A', [...ids, BUNDANG_MINUS_OPTION_ID]).size).toBe(0);
    expect(bundangWallFaceFinishes(geometry, '55A', ids)).toEqual(assignments);
    expect(geometry).toEqual(original);
    expect(istarparkLaserObstacles({ geometry, props: [proxy] })).toEqual(istarparkLaserObstacles({ geometry, props: [] }));
  });

  it('복제한 기본 TV벽은 같은 재질을 쓰되 유상 소유자가 아니고 마옵에서만 빠진다', () => {
    const geometry = { wallSegments: [{ ...sourceWall, id: 'bedroom-1-east-before' }] } as ApartmentGeometry;
    const base = bundangWallFaceFinishes(geometry, '55A', []);
    expect(base.get('bedroom-1-east-before')).toMatchObject({ baseProvided: true, materialId: BUNDANG_DESIGN_WALL_MATERIAL_ID });
    expect(base.get('bedroom-1-east-before')?.sourceOptionId).toBeUndefined();
    expect(bundangWallFaceFinishes(geometry, '55A', ['living-design-wall-panel'])).toEqual(base);
    expect(bundangWallFaceFinishes(geometry, '55A', [BUNDANG_MINUS_OPTION_ID]).size).toBe(0);
  });

  it('회전·양축 반전 후에도 공용면만 선택하고 반대편 방 내부면을 칠하지 않는다', () => {
    const a: NumericPoint = [3.6, 2.2], b: NumericPoint = [3.6, 4.8];
    for (const rotationDeg of [0, 90, 180, 270]) for (const mirrorX of [false, true]) for (const mirrorY of [false, true]) {
      const object = { x: 12, y: 9, transform: { rotationDeg, mirrorX, mirrorY }, geometry: sourceGeometry } as WorldObject;
      for (const normal of [[1, 0], [-1, 0]] as NumericPoint[]) {
        const face = bundangWallFaceMaterialIndex(object, a, b, normal);
        const start = apartmentUnitWorldPoint(object, a), end = apartmentUnitWorldPoint(object, b);
        const rotation = -Math.atan2(end.y - start.y, end.x - start.x);
        const actual = new THREE.Vector3(0, 0, face === 4 ? 1 : -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotation);
        const zero = apartmentUnitWorldPoint(object, [0, 0]), toward = apartmentUnitWorldPoint(object, normal);
        const desired = new THREE.Vector3(toward.x - zero.x, 0, toward.y - zero.y).normalize();
        expect(actual.distanceTo(desired)).toBeLessThan(1e-6);
        expect(bundangWallFaceMaterialIndex(object, a, b, [-normal[0], -normal[1]])).not.toBe(face);
      }
    }
  });

  it('고운 웜그레이지 석질 텍스처를 결정적으로 생성하고 벽별 재질만 독립 소유한다', () => {
    const first = bundangDesignWallPixels(), second = bundangDesignWallPixels();
    expect(Buffer.compare(first.data, second.data)).toBe(0);
    let red = 0, green = 0, blue = 0, minimumRed = 255, squares = 0;
    for (let i = 0; i < first.data.length; i += 4) {
      red += first.data[i]; green += first.data[i + 1]; blue += first.data[i + 2];
      minimumRed = Math.min(minimumRed, first.data[i]);
      squares += first.data[i] ** 2;
    }
    const count = first.width * first.height;
    expect(red / count).toBeGreaterThan(218);
    expect(red / count).toBeLessThan(228);
    expect((red - green) / count).toBeCloseTo(9, 1);
    expect((green - blue) / count).toBeCloseTo(16, 1);
    expect(Math.sqrt(squares / count - (red / count) ** 2)).toBeGreaterThan(6);
    expect(minimumRed).toBeGreaterThan(175); // Mineral pixels clamp, never wrap Uint8 to black.
    const textures = createBundangDesignWallTextures();
    const a = createBundangDesignWallMaterial(textures), b = createBundangDesignWallMaterial(textures);
    expect(a).not.toBe(b);
    expect(a.map).toBe(b.map);
    expect(a.bumpMap).toBe(b.bumpMap);
    expect(a.roughnessMap).toBe(b.roughnessMap);
    expect(a.bumpMap!.colorSpace).toBe(THREE.NoColorSpace);
    expect(a.map!.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(a.roughness).toBe(BUNDANG_DESIGN_WALL_PROFILE.roughness);
    expect(a.bumpScale).toBeCloseTo(.0014);
    expect(a.metalness).toBe(0);
    expect(a.polygonOffset).toBe(false);
    a.opacity = .28;
    expect(b.opacity).toBe(1);
    a.dispose(); b.dispose(); Object.values(textures).forEach(texture => texture.dispose());
  });

  it('실크벽지 공용부와 침실은 밝은 중성 바탕과 서로 다른 미세 섬유결을 사용한다', () => {
    const geometry = { roomZones: [{ id: 'bedroom-1', boundsMeters: [0, 0, 2, 3] },
      { id: 'living', boundsMeters: [2, 0, 4, 3] }] } as ApartmentGeometry;
    expect(bundangWallpaperKindAt(geometry, [1, 1])).toBe('bedroom');
    expect(bundangWallpaperKindAt(geometry, [3, 1])).toBe('common');
    const common = createBundangWallpaperTextures('common'), bedroom = createBundangWallpaperTextures('bedroom');
    expect(Buffer.compare(common.albedo.image.data as Uint8Array, bedroom.albedo.image.data as Uint8Array)).not.toBe(0);
    for (const kind of ['common', 'bedroom'] as const) {
      const maps = kind === 'common' ? common : bedroom;
      const material = createBundangWallpaperMaterial(maps, kind);
      const values = maps.albedo.image.data as Uint8Array;
      let red = 0, blue = 0;
      for (let i = 0; i < values.length; i += 4) { red += values[i]; blue += values[i + 2]; }
      expect(blue / (values.length / 4)).toBeGreaterThan(220);
      expect(Math.abs(red - blue) / (values.length / 4)).toBeLessThan(5);
      expect(material.color.getHexString()).toBe('ffffff');
      expect(material.userData.wallFinishProfile).toBe(BUNDANG_WALLPAPER_PROFILES[kind].id);
      expect(material.bumpScale).toBeLessThan(.0003);
      material.dispose(); Object.values(maps).forEach(texture => texture.dispose());
    }
  });

  it('인피니티 도어 복도면은 모든 회전·반전에서 벽과 동일 A042 maps/미터UV를 쓴다', () => {
    const maps = createBundangDesignWallTextures();
    const wallpaper = { common: createBundangWallpaperTextures('common'), bedroom: createBundangWallpaperTextures('bedroom') };
    const world = { width: 64, height: 48 };
    const asset = STRUCTURAL_PROP_ASSETS.find(asset => asset.assetId === 'interior-infinity-door-panel')!;
    for (const rotationDeg of [0, 90, 180, 270]) for (const mirrorX of [false, true]) for (const mirrorY of [false, true]) {
      const object = { x: 12, y: 9, transform: { rotationDeg, mirrorX, mirrorY }, geometry: sourceGeometry } as WorldObject;
      const prop: ApartmentInteriorProp = { id: 'door', assetId: asset.assetId, positionMeters: [3.6, 3.5], dimensionsMeters: [2.6, .02, 2.2],
        yawDeg: 90, wallFaceNormalMeters: [1, 0], occlusionSegmentsMeters: [[[3.6, 2.2], [3.6, 4.8]]], installationRole: 'wall-door-finish' };
      const renderer = Object.create(ThreeWorldRenderer.prototype) as any;
      Object.assign(renderer, { apartment: object, world, variants: new Map(), textureCache: new Map(), designWallTextures: maps,
        wallpaperTextures: wallpaper, canvas: { dataset: {} } });
      const group = renderer.proceduralProp(prop, asset) as THREE.Group;
      expect(group.children).toHaveLength(5); // One existing leaf plus four outlines, no finish overlay.
      const placement = apartmentPropPlacement(object, prop);
      group.position.set(placement.center.x - world.width / 2 + .5, 0, placement.center.y - world.height / 2 + .5);
      group.rotation.y = placement.worldYaw;
      renderer.applyInfinityDoorWallFinish(object, prop, group);
      const body = group.children[0] as THREE.Mesh;
      const faceIndex = body.userData.wallFinishFaceIndex;
      const materials = body.material as THREE.MeshStandardMaterial[];
      expect(materials[faceIndex].map).toBe(maps.albedo);
      expect(materials[faceIndex].bumpMap).toBe(maps.bump);
      expect(materials[faceIndex].roughnessMap).toBe(maps.roughness);
      expect(materials[faceIndex === 4 ? 5 : 4].map).toBe(wallpaper.bedroom.albedo);
      expect(body.geometry.groups.length).toBeLessThanOrEqual(3);
      const face = body.geometry.groups.find(group => group.materialIndex === faceIndex)!;
      const uv = body.geometry.getAttribute('uv'), positions = body.geometry.getAttribute('position');
      for (let j = face.start; j < face.start + face.count; j++) {
        const i = body.geometry.index!.getX(j);
        const vertex = new THREE.Vector3(positions.getX(i), positions.getY(i), positions.getZ(i)).applyMatrix4(body.matrixWorld);
        const local = apartmentWorldPointToLocalMeters(object, { x: vertex.x + world.width / 2 - .5, y: vertex.z + world.height / 2 - .5 });
        expect(uv.getX(i)).toBeCloseTo(local[1] / BUNDANG_DESIGN_WALL_PROFILE.textureRepeatMeters, 4);
      }
      group.children.forEach(child => {
        const mesh = child as THREE.Mesh;
        mesh.geometry.dispose();
        new Set(Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => material.dispose());
      });
    }
    [maps, ...Object.values(wallpaper)].forEach(set => Object.values(set).forEach(texture => texture.dispose()));
  });

  it('선택 면은 색·깊이를 쓰지 않는 단일 평면이며 레이저 대상이나 두 번째 표시 면이 아니다', () => {
    const proxy = createBundangWallFinishSelectionSurface(5, 4.6);
    proxy.geometry.computeBoundingBox();
    const size = proxy.geometry.boundingBox!.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(5);
    expect(size.y).toBeCloseTo(4.6);
    expect(size.z).toBe(0);
    const material = proxy.material as THREE.MeshBasicMaterial;
    expect(material.colorWrite).toBe(false);
    expect(material.depthWrite).toBe(false);
    proxy.userData.editorPropId = 'visual-design-wall';
    proxy.updateMatrixWorld();
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 2, 5), new THREE.Vector3(0, 0, -1));
    expect(ray.intersectObject(proxy).length).toBeGreaterThan(0);
    const hit = { obstacleId: '', kind: '' };
    laserPointerWorldPoint(ray, [proxy], 1, new Set(['physical-wall']), hit);
    expect(hit.obstacleId).toBe('');
    proxy.geometry.dispose(); material.dispose();
  });

  it('문 옆 조각·상인방의 UV가 미터 좌표로 이어지고 다른 벽면 UV는 보존된다', () => {
    const world = { width: 64, height: 48 }, cellSize = .5;
    for (const rotationDeg of [0, 90, 180, 270]) for (const mirrorX of [false, true]) {
      const object = { x: 12, y: 9, transform: { rotationDeg, mirrorX }, geometry: sourceGeometry } as WorldObject;
      for (const [a, b, base, height] of [
        [[3.6, 0], [3.6, 1.2], 0, 2.3],
        [[3.6, 1.2], [3.6, 2.1], 2.1, .2],
      ] as Array<[NumericPoint, NumericPoint, number, number]>) {
        const start = apartmentUnitWorldPoint(object, a), end = apartmentUnitWorldPoint(object, b);
        const length = Math.hypot(end.x - start.x, end.y - start.y);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, height / cellSize, .2 / cellSize));
        mesh.position.set((start.x + end.x) / 2 - world.width / 2 + .5, (base + height / 2) / cellSize,
          (start.y + end.y) / 2 - world.height / 2 + .5);
        mesh.rotation.y = -Math.atan2(end.y - start.y, end.x - start.x);
        mesh.updateMatrix();
        const original = mesh.geometry.getAttribute('uv').clone();
        const faceIndex = bundangWallFaceMaterialIndex(object, a, b, [1, 0]);
        applyBundangWallFinishUVs(mesh.geometry, mesh.matrix, object, world, a, b, faceIndex);
        const uv = mesh.geometry.getAttribute('uv'), positions = mesh.geometry.getAttribute('position');
        const group = mesh.geometry.groups.find(group => group.materialIndex === faceIndex)!;
        const finished = new Set(Array.from({ length: group.count }, (_, i) => mesh.geometry.index!.getX(group.start + i)));
        for (let i = 0; i < positions.count; i++) {
          if (!finished.has(i)) {
            expect(uv.getX(i)).toBe(original.getX(i)); expect(uv.getY(i)).toBe(original.getY(i));
            continue;
          }
          const point = new THREE.Vector3(positions.getX(i), positions.getY(i), positions.getZ(i)).applyMatrix4(mesh.matrix);
          const local = apartmentWorldPointToLocalMeters(object, { x: point.x + world.width / 2 - .5, y: point.z + world.height / 2 - .5 });
          expect(uv.getX(i)).toBeCloseTo(local[1] / BUNDANG_DESIGN_WALL_PROFILE.textureRepeatMeters, 4);
          expect(uv.getY(i)).toBeCloseTo(point.y * cellSize / BUNDANG_DESIGN_WALL_PROFILE.textureRepeatMeters, 4);
        }
        mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
      }
    }
  });
});
