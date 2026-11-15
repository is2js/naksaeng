import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { doorVisualOpenAngleDeg, INTERIOR_DOOR_VISUAL_OPEN_ANGLE_DEG } from './door-visual-pose';
import { ThreeWorldRenderer } from './three-world';
import type { WorldObject } from './types';

function renderDoor(opening: Record<string, unknown>, transform: WorldObject['transform'] = {}) {
  const renderer = Object.create(ThreeWorldRenderer.prototype) as any;
  renderer.structureRoot = new THREE.Group();
  const apartment: WorldObject = { originCell: { x: 8, y: 12 },
    geometry: { cellSizeMeters: .5 }, transform };
  const start = renderer.localPoint(apartment, [1.2, 2.4]) as THREE.Vector3;
  const end = renderer.localPoint(apartment, [2.2, 2.4]) as THREE.Vector3;
  const before = JSON.stringify({ apartment, opening });
  renderer.addDoor(apartment, opening, start, end, .5);
  expect(JSON.stringify({ apartment, opening })).toBe(before);
  return { leaves: renderer.structureRoot.children as THREE.Mesh[], start, end };
}

function angleFromClosed(panel: THREE.Mesh, hinge: THREE.Vector3, handle: THREE.Vector3): number {
  const closed = new THREE.Vector2(handle.x - hinge.x, handle.z - hinge.z);
  const posed = new THREE.Vector2(panel.position.x - hinge.x, panel.position.z - hinge.z);
  return Math.atan2(closed.cross(posed), closed.dot(posed)) * 180 / Math.PI;
}

describe('실내 여닫이문 30% 시각 열림', () => {
  it('회전·반사된 평면과 양쪽 힌지에서 기존 82°/30°를 27°로만 보여 준다', () => {
    const transforms: WorldObject['transform'][] = [{}, { rotationDeg: 90 },
      { rotationDeg: 270, mirrorX: true }, { rotationDeg: 180, mirrorY: true }];
    for (const transform of transforms) for (const hingeEndpoint of ['a', 'b']) for (const authored of [82, 30]) {
      const { leaves, start, end } = renderDoor({ type: 'interior-door', leafState: 'open',
        leafOpenAngleDeg: authored, hingeEndpoint }, transform);
      expect(leaves).toHaveLength(1);
      const hinge = hingeEndpoint === 'a' ? start : end;
      const handle = hingeEndpoint === 'a' ? end : start;
      expect(angleFromClosed(leaves[0], hinge, handle)).toBeCloseTo(INTERIOR_DOOR_VISUAL_OPEN_ANGLE_DEG);
      const vector = new THREE.Vector2(leaves[0].position.x - hinge.x, leaves[0].position.z - hinge.z);
      expect(leaves[0].rotation.y).toBeCloseTo(-Math.atan2(vector.y, vector.x));
    }
  });

  it('팬트리 양짝은 두 힌지를 유지하면서 서로 반대 부호의 27°로 열린다', () => {
    const { leaves, start, end } = renderDoor({ type: 'interior-door', leafState: 'open',
      leafCount: 2, leafOpenAngleDeg: 30 }, { rotationDeg: 90, mirrorX: true });
    const center = start.clone().add(end).multiplyScalar(.5);
    expect(leaves).toHaveLength(2);
    expect(angleFromClosed(leaves[0], start, center)).toBeCloseTo(27);
    expect(angleFromClosed(leaves[1], end, center)).toBeCloseTo(-27);
  });

  it('닫힘·통행형 닫힘·숨김을 보존하고 열린 현관도 27°로 보여 준다', () => {
    for (const leafState of ['closed', 'closed-passable']) {
      const { leaves, start, end } = renderDoor({ type: 'interior-door', leafState, hingeEndpoint: 'a' });
      expect(angleFromClosed(leaves[0], start, end)).toBeCloseTo(0);
    }
    expect(renderDoor({ type: 'interior-door', leafState: 'none' }).leaves).toHaveLength(0);
    expect(renderDoor({ type: 'interior-door', leafVisible: false }).leaves).toHaveLength(0);
    const { leaves, start, end } = renderDoor({ type: 'entry-door', leafState: 'open',
      leafOpenAngleDeg: 82, hingeEndpoint: 'a' });
    expect(angleFromClosed(leaves[0], start, end)).toBeCloseTo(27);
    expect(doorVisualOpenAngleDeg({ type: 'entry-door' })).toBe(27);
  });
});
