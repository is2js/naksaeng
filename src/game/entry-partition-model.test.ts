import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createEntrySlidingPanel, createEntrySlidingRail } from './entry-partition-model';

function size(mesh: THREE.Object3D): THREE.Vector3 {
  return new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
}

describe('실사형 검은 프레임 슬라이딩 중문', () => {
  it('문짝 전체는 실치수를 유지하며 18mm frame/12mm mullion/6mm 실제 투명 유리만 구성한다', () => {
    const group = createEntrySlidingPanel({ dimensionsMeters: [1.1, .04, 2.2] }, .5);
    size(group).toArray().forEach((value, index) => expect(value).toBeCloseTo([2.2, 4.4, .08][index], 6));
    const frames = group.children.filter(child => child.name.includes('frame-'));
    expect(frames).toHaveLength(4);
    expect(size(frames[0]).x).toBeCloseTo(.018 / .5);
    expect(size(group.getObjectByName('entry-partition-mullion')!).x).toBeCloseTo(.012 / .5);
    const glass = group.children.filter(child => child.name.includes('smoked-glass')) as THREE.Mesh[];
    expect(glass).toHaveLength(2);
    for (const pane of glass) {
      expect(size(pane).z).toBeCloseTo(.006 / .5);
      const material = pane.material as THREE.MeshStandardMaterial;
      expect(material.transparent).toBe(true);
      expect(material.opacity).toBeGreaterThan(.3);
      expect(material.opacity).toBeLessThan(.6);
      expect(material.depthWrite).toBe(false);
      expect(material.metalness).toBe(0);
      expect(material.roughness).toBeGreaterThan(.5);
    }
  });

  it('손잡이 선행 방향과 mirrored는 한 번만 반영하고 객체형 치수도 받는다', () => {
    for (const side of [-1, 1]) for (const mirrored of [false, true]) {
      const group = createEntrySlidingPanel({ dimensionsMeters: { width: 1.1, depth: .04, height: 2.2 },
        partitionHandleSide: side, mirrored }, 1);
      const handle = group.getObjectByName('entry-partition-handle-1')!;
      group.updateMatrixWorld(true);
      const position = handle.getWorldPosition(new THREE.Vector3());
      expect(Math.sign(position.x)).toBe(side * (mirrored ? -1 : 1));
      expect(group.scale.toArray()).toEqual([mirrored ? -1 : 1, 1, 1]);
      expect(size(group).x).toBeCloseTo(1.1);
    }
  });

  it('상하 레일과 최소1mm 부품은 generic10mm 제한 없이 실치수로 생성한다', () => {
    for (const [depth, height] of [[.048, .028], [.024, .010], [.001, .001]]) {
      const group = createEntrySlidingRail({ dimensionsMeters: [2.2, depth, height] }, .5);
      expect(group.children).toHaveLength(1);
      expect(size(group).x).toBeCloseTo(2.2 / .5);
      expect(size(group).y).toBeCloseTo(height / .5);
      expect(size(group).z).toBeCloseTo(depth / .5);
    }
  });
});
