import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { laserPointerWorldPoint, type LaserPointerSurfaceInfo } from './laser-pointer-projection';
import { laserPointerIsTap } from './laser-pointer-gesture';

describe('laser pointer projection', () => {
  it('maps a visible wall click to the wall rather than the ground behind it', () => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(2, 2, .1), new THREE.MeshBasicMaterial());
    wall.position.set(0, 1, 0);
    wall.userData.laserObstacleId = 'wall';
    wall.updateMatrixWorld();
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 3, 3), new THREE.Vector3(0, -.6, -1).normalize());
    const info: LaserPointerSurfaceInfo = { obstacleId: '', kind: '' };
    const hit = laserPointerWorldPoint(ray, [wall], .13, new Set(['wall']), info);
    expect(hit?.z).toBeCloseTo(.05);
    expect(hit?.y).toBeGreaterThan(0.13);
    expect(info).toMatchObject({ obstacleId: 'wall', surfaceNormal: [0, 1] });
    const plane = laserPointerWorldPoint(ray, [wall], .13);
    expect(plane?.y).toBeCloseTo(.13);
    expect(plane?.z).toBeLessThan(.05);
  });

  it('does not reuse an old surface identity when the next pointer falls back to the plane', () => {
    const info: LaserPointerSurfaceInfo = { obstacleId: 'old', kind: 'wall', surfaceNormal: [1, 0] };
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, -1, 0));
    laserPointerWorldPoint(ray, [], .13, new Set(['wall']), info);
    expect(info).toEqual({ obstacleId: '', kind: '' });
  });

  it('uses 6px mouse and 10px touch slop without treating a drag as a click', () => {
    expect(laserPointerIsTap({ x: 0, y: 0 }, { x: 6, y: 0 }, 'mouse')).toBe(true);
    expect(laserPointerIsTap({ x: 0, y: 0 }, { x: 6.01, y: 0 }, 'mouse')).toBe(false);
    expect(laserPointerIsTap({ x: 0, y: 0 }, { x: 6, y: 8 }, 'touch')).toBe(true);
    expect(laserPointerIsTap({ x: 0, y: 0 }, { x: 6, y: 8.1 }, 'touch')).toBe(false);
    expect(laserPointerIsTap({ x: 0, y: 0 }, { x: Number.NaN, y: 0 }, 'touch')).toBe(false);
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
