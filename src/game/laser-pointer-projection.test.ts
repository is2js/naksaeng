import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { laserPointerWorldPoint } from './laser-pointer-projection';

describe('laser pointer projection', () => {
  it('maps a visible wall click to the wall rather than the ground behind it', () => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(2, 2, .1), new THREE.MeshBasicMaterial());
    wall.position.set(0, 1, 0);
    wall.userData.laserObstacleId = 'wall';
    wall.updateMatrixWorld();
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 3, 3), new THREE.Vector3(0, -.6, -1).normalize());
    const hit = laserPointerWorldPoint(ray, [wall], .13, new Set(['wall']));
    expect(hit?.z).toBeCloseTo(.05);
    expect(hit?.y).toBeGreaterThan(0.13);
    const plane = laserPointerWorldPoint(ray, [wall], .13);
    expect(plane?.y).toBeCloseTo(.13);
    expect(plane?.z).toBeLessThan(.05);
  });

  it('uses the laser-height plane when the visible floor is in front of a wall', () => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    wall.position.set(0, -2, 0);
    wall.userData.laserObstacleId = 'wall';
    const floor = new THREE.Mesh(new THREE.BoxGeometry(4, .02, 4), new THREE.MeshBasicMaterial());
    floor.userData.laserFloor = true;
    const root = new THREE.Group();
    root.add(wall, floor);
    root.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 3, 0), new THREE.Vector3(0, -1, 0));
    expect(laserPointerWorldPoint(ray, [root], .13, new Set(['wall']))?.y).toBeCloseTo(.13);
  });

  it('ignores invisible or non-measurable meshes and falls back to the measurement plane', () => {
    const root = new THREE.Group();
    const invisible = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    invisible.position.y = 1;
    invisible.userData.editorPropId = 'invisible';
    invisible.visible = false;
    const visualOnly = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    visualOnly.position.y = 2;
    visualOnly.userData.editorPropId = 'visual-only';
    root.add(invisible, visualOnly);
    root.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 4, 0), new THREE.Vector3(0, -1, 0));
    expect(laserPointerWorldPoint(ray, [root], .13, new Set(['invisible']))?.y).toBeCloseTo(.13);
  });
});
