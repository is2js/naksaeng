import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { pickSceneSelectionRay } from './scene-selection-ray';

function scene() {
  const root = new THREE.Group();
  const propRoot = new THREE.Group();
  const structureRoot = new THREE.Group();
  root.add(propRoot, structureRoot);
  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 10), new THREE.Vector3(0, 0, -1));
  return {
    root, propRoot, structureRoot,
    pick(allowedIds?: ReadonlySet<string>) {
      root.updateMatrixWorld(true);
      return pickSceneSelectionRay(raycaster, propRoot, structureRoot, allowedIds);
    },
  };
}

function box(parent: THREE.Object3D, z: number, data: Record<string, unknown> = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 1), new THREE.MeshBasicMaterial());
  mesh.position.z = z;
  Object.assign(mesh.userData, data);
  parent.add(mesh);
  return mesh;
}

describe('직접 ray 선택과 구조 배경 우선순위', () => {
  it('벽 앞 가구를 선택하며 중첩된 부모의 editorPropId를 root까지 찾는다', () => {
    const view = scene();
    view.propRoot.userData.editorPropId = 'front-furniture';
    const nested = new THREE.Group();
    view.propRoot.add(nested);
    box(nested, 5);
    box(view.structureRoot, 0, { laserObstacleKind: 'wall' });
    expect(view.pick()).toBe('front-furniture');
  });

  it.each([
    { laserObstacleKind: 'wall' },
    { laserObstacleKind: 'structure' },
    { laserFloor: true },
  ])('가구보다 가까운 구조 배경 %j 뒤의 가구는 선택하지 않는다', (metadata) => {
    const view = scene();
    box(view.propRoot, 0, { editorPropId: 'behind' });
    box(view.structureRoot, 4, metadata);
    expect(view.pick()).toBe('');
  });

  it('재질이 투명해진 벽도 배경 차단을 유지한다', () => {
    const view = scene();
    box(view.propRoot, 0, { editorPropId: 'behind' });
    const wall = box(view.structureRoot, 4, { laserObstacleKind: 'wall' });
    wall.material.transparent = true;
    wall.material.opacity = .01;
    expect(view.pick()).toBe('');
  });

  it('동일 면의 0.0001 이내 오차만 허용한다', () => {
    const view = scene();
    box(view.propRoot, 0, { editorPropId: 'surface-proxy' });
    const wall = box(view.structureRoot, .00005, { laserObstacleKind: 'wall' });
    expect(view.pick()).toBe('surface-proxy');
    wall.position.z = .0002;
    expect(view.pick()).toBe('');
  });

  it('숨긴 object와 숨긴 ancestor의 ray 교차는 제외한다', () => {
    const view = scene();
    const wall = box(view.structureRoot, 4, { laserObstacleKind: 'wall' });
    const prop = box(view.propRoot, 0, { editorPropId: 'furniture' });
    wall.visible = false;
    expect(view.pick()).toBe('furniture');
    wall.visible = true;
    view.structureRoot.visible = false;
    expect(view.pick()).toBe('furniture');
    prop.visible = false;
    expect(view.pick()).toBeNull();
    prop.visible = true;
    view.propRoot.visible = false;
    expect(view.pick()).toBeNull();
  });

  it('빈 ray와 배경이 아닌 구조물은 bbox fallback을 허용한다', () => {
    const view = scene();
    expect(view.pick()).toBeNull();
    box(view.structureRoot, 3, { laserObstacleKind: 'fixture' });
    const missedProp = box(view.propRoot, 0, { editorPropId: 'bbox-only' });
    missedProp.position.x = 3;
    expect(view.pick()).toBeNull();
  });

  it('allowedIds에서 제외된 가구를 건너뛰고 허용된 가구 또는 배경을 고른다', () => {
    const view = scene();
    box(view.propRoot, 5, { editorPropId: 'excluded' });
    box(view.propRoot, 0, { editorPropId: 'allowed' });
    expect(view.pick(new Set(['allowed']))).toBe('allowed');
    expect(view.pick(new Set())).toBeNull();
    box(view.structureRoot, 3, { laserObstacleKind: 'wall' });
    expect(view.pick(new Set(['allowed']))).toBe('');
  });
});
