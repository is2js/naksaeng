import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ThreeWorldRenderer } from './three-world';
import { createBundangWallpaperTextures } from './bundang-wall-finish';
import type { WorldObject } from './types';

/** Run the actual structure builder and fade loop without creating WebGL. */
function harness() {
  const apartment: WorldObject = {
    type: 'enterable-apartment-unit-v1', unitTypeId: '55A', originCell: { x: 16, y: 16 },
    geometry: {
      cellSizeMeters: 1, clearHeightMeters: 2.3, floorPolygon: [[0, 0], [12, 0], [12, 12], [0, 12]],
      roomZones: [], kitchenFixtures: [], solidBlocks: [], interiorProps: [],
      wallSegments: [
        { id: 'outer-east-before', kind: 'exterior', a: [12, 0], b: [12, 1], thicknessMeters: .2, baseMeters: 0, heightMeters: 2.3 },
        { id: 'outer-east-after', kind: 'exterior', a: [12, 2], b: [12, 3], thicknessMeters: .2, baseMeters: 0, heightMeters: 2.3 },
        { id: 'outer-east-sill', kind: 'exterior', a: [12, 1], b: [12, 2], thicknessMeters: .2, baseMeters: 0, heightMeters: .9 },
        { id: 'outer-east-lintel', kind: 'exterior', a: [12, 1], b: [12, 2], thicknessMeters: .2, baseMeters: 2.1, heightMeters: .2 },
      ],
      openings: [{ id: 'outer-east-window', type: 'window', a: [12, 1], b: [12, 2], baseMeters: .9, heightMeters: 1.2, frameThicknessMeters: .06 }],
    },
  };
  const source = JSON.stringify(apartment.geometry);
  const renderer = Object.create(ThreeWorldRenderer.prototype) as any;
  const camera = new THREE.OrthographicCamera();
  camera.position.set(30, 20, 2);
  Object.assign(renderer, {
    apartment, world: { width: 32, height: 32, entry: { unitType: '55A' } },
    structureRoot: new THREE.Group(), propRoot: new THREE.Group(), structureOccluders: [], finishOccluders: [],
    canvas: { dataset: {} }, selectedOptionIds: [], textureCache: new Map(), woodFloorTexture: new THREE.Texture(),
    wallpaperTextures: { common: createBundangWallpaperTextures('common'), bedroom: createBundangWallpaperTextures('bedroom') },
    camera, occlusionFocus: null, lastOcclusionTime: 0, cssWidth: 390, cssHeight: 600, ceilingMaskRevision: 0,
    scene: new THREE.Scene(), renderer: { render: vi.fn() }, ceilingActorMask: { update: vi.fn() }, resize: vi.fn(),
  });
  renderer.buildApartment(apartment);
  const entries = renderer.structureOccluders as Array<{ mesh: THREE.Mesh; baseOpacity: number; currentOpacity: number }>;
  const glass = renderer.structureRoot.children.find((mesh: THREE.Object3D) => mesh.userData.structureKind === 'window-glass') as THREE.Mesh;
  const material = glass.material as THREE.MeshPhysicalMaterial;
  let time = 0;
  const frame = (count = 1) => {
    for (let index = 0; index < count; index++) renderer.render(time += 16);
    const calls = renderer.ceilingActorMask.update.mock.calls;
    return calls[calls.length - 1][5] as Array<{ mesh: THREE.Mesh; opacity: number }>;
  };
  const focus = (x: number, y: number) => { renderer.occlusionFocus = { displayX: 16 + x, displayY: 16 + y }; };
  return { renderer, apartment, source, entries, glass, material, frame, focus };
}

function materials(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

describe('외벽·창 구조부의 actor-only fade', () => {
  it('기존 front-cutaway 위치도 불투명으로 시작하고 자연 유리만 반투명으로 유지한다', () => {
    const { renderer, apartment, source, entries, glass, material, frame, focus } = harness();
    expect(entries).toHaveLength(4);
    for (const entry of entries) {
      expect([entry.baseOpacity, entry.currentOpacity]).toEqual([1, 1]);
      for (const value of materials(entry.mesh)) {
        expect(value.opacity).toBe(1);
        expect(value.transparent).toBe(false);
        expect(value.depthWrite).toBe(true);
      }
    }
    expect(material.isMeshPhysicalMaterial).toBe(true);
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBeGreaterThan(0);
    expect(material.opacity).toBeLessThan(1);
    expect(material.transmission).toBeGreaterThan(0);
    expect(material.depthWrite).toBe(false);
    expect(entries.some(entry => entry.mesh === glass)).toBe(false);
    expect(frame()).toEqual([]); // No actor is never an occlusion.
    focus(1, 9); // Far away and outside this finite wall's sightline.
    expect(frame(80)).toEqual([]);
    expect(renderer.canvas.dataset.occludedWallCount).toBe('0');
    expect(entries.every(entry => entry.currentOpacity === 1)).toBe(true);
    expect(JSON.stringify(apartment.geometry)).toBe(source);
  });

  it('원거리라도 실제 sightline 위면 fade하고 벽 접촉에서도 배우 마스크와 같은 판정을 유지한 뒤 1로 복원한다', () => {
    const { renderer, entries, glass, material, frame, focus, apartment, source } = harness();
    const naturalGlass = { opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite };
    focus(1, 1.5); // Eleven metres away, but the finite sill/lintel is on the ray.
    const distant = frame(80);
    expect(distant.map(part => part.mesh.userData.laserObstacleId).sort()).toEqual(['outer-east-lintel', 'outer-east-sill']);
    for (const part of distant) {
      expect(part.opacity).toBeCloseTo(.28, 3);
      expect(materials(part.mesh).every(value => value.opacity === part.opacity)).toBe(true);
    }
    for (const x of [11.999, 12]) {
      focus(x, 1.5);
      const contact = frame(20);
      expect(contact.map(part => part.mesh.userData.laserObstacleId).sort()).toEqual(['outer-east-lintel', 'outer-east-sill']);
      expect(contact.every(part => part.opacity < .3)).toBe(true);
    }
    expect(distant.some(part => part.mesh === glass)).toBe(false);
    expect({ opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite }).toEqual(naturalGlass);
    focus(1, 9);
    expect(frame(120)).toEqual([]);
    for (const entry of entries) for (const value of materials(entry.mesh)) {
      expect(entry.currentOpacity).toBe(1);
      expect(value.opacity).toBe(1);
      expect(value.transparent).toBe(false);
      expect(value.depthWrite).toBe(true);
    }
    expect(renderer.canvas.dataset.wallFadeOpacity).toBe('1.000');
    expect(JSON.stringify(apartment.geometry)).toBe(source);
  });
});
