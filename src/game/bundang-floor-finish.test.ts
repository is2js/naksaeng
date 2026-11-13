import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { apartmentUnitWorldPoint } from './apartment-transform';
import {
  applyBundangFloorUVs, BUNDANG_FLOOR_PROFILES, BUNDANG_FLOOR_SURFACE_Y,
  bundangFloorFinish, bundangWoodFloorPixels, createBundangFloorSelectionSurface,
} from './bundang-floor-finish';
import { BUNDANG_MINUS_OPTION_ID } from './minus-option';
import type { WorldObject } from './types';

describe('마루는 기존 바닥 면을 교체하며 덧깔지 않는다', () => {
  it('공식 마감표의 폭·길이·실제품 두께를 사용하고 완성면 높이는 하나다', () => {
    expect(BUNDANG_FLOOR_PROFILES.standard).toEqual({ widthMeters: .115, lengthMeters: .8, boardThicknessMeters: .0075 });
    expect(BUNDANG_FLOOR_PROFILES.wide).toEqual({ widthMeters: .143, lengthMeters: 1.2, boardThicknessMeters: .0105 });
    expect(BUNDANG_FLOOR_SURFACE_Y).toBe(.035);
    expect(bundangFloorFinish([])).toBe('standard');
    expect(bundangFloorFinish(['wide-plank-floor-finish'])).toBe('wide');
    expect(bundangFloorFinish([BUNDANG_MINUS_OPTION_ID, 'wide-plank-floor-finish'])).toBe('standard');
    expect(bundangFloorFinish([])).toBe('standard');
  });

  it('한 그레이지 컬러맵을 결정적으로 생성하며 판별 색조 차이를 만들지 않는다', () => {
    const first = bundangWoodFloorPixels(), second = bundangWoodFloorPixels();
    expect(first.data).toEqual(second.data);
    expect(first.data.length).toBe(first.width * first.height * 4);
    let red = 0, green = 0, blue = 0;
    for (let i = 0; i < first.data.length; i += 4) {
      red += first.data[i]; green += first.data[i + 1]; blue += first.data[i + 2];
    }
    const count = first.width * first.height;
    expect(red / count).toBeGreaterThan(178);
    expect(red / count).toBeLessThan(181);
    expect((red - green) / count).toBe(10);
    expect((green - blue) / count).toBe(8);
  });

  it('선택 프록시는 옆면·두께 없는 평면이며 보이는 두 번째 바닥을 그리지 않는다', () => {
    const surface = createBundangFloorSelectionSurface(5, 7);
    surface.geometry.computeBoundingBox();
    const size = surface.geometry.boundingBox!.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(5);
    expect(size.z).toBeCloseTo(7);
    expect(size.y).toBeLessThan(1e-6);
    const material = surface.material as THREE.MeshBasicMaterial;
    expect(material.colorWrite).toBe(false);
    expect(material.depthWrite).toBe(false);
    surface.position.y = BUNDANG_FLOOR_SURFACE_Y;
    surface.updateMatrixWorld();
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, -1, 0));
    expect(ray.intersectObject(surface)).toHaveLength(2);
    surface.geometry.dispose(); material.dispose();
  });

  it('회전·반전되어도 한 번 적용한 로컬 실규격 UV가 이어지고 광폭의 이음매 수가 줄어든다', () => {
    for (const rotationDeg of [0, 90, 180, 270]) for (const mirrorX of [false, true]) {
      const object = { x: 12, y: 9, transform: { rotationDeg, mirrorX }, geometry: { cellSizeMeters: .5 } } as WorldObject;
      const local = [[.4, .7], [2.4, 3.7]] as [number, number][];
      const vertices = local.flatMap((p) => {
        const world = apartmentUnitWorldPoint(object, p);
        return [world.x - 32 + .5, 0, world.y - 24 + .5];
      });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      for (const finish of ['standard', 'wide'] as const) {
        applyBundangFloorUVs(geometry, object, { width: 64, height: 48 }, finish);
        const uv = geometry.getAttribute('uv'), profile = BUNDANG_FLOOR_PROFILES[finish];
        for (let i = 0; i < local.length; i++) {
          expect(uv.getX(i)).toBeCloseTo(local[i][0] / (profile.widthMeters * 4), 4);
          expect(uv.getY(i)).toBeCloseTo(local[i][1] / (profile.lengthMeters * 2), 4);
        }
      }
      geometry.dispose();
    }
  });
});
