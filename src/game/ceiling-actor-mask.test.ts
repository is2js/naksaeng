import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ceilingApplianceIsNear, ceilingMaskHull, ceilingMeshBounds, isCeilingActorOccluder, isFadeableCeilingAppliance, prepareCeilingFade, updateCeilingFade } from './ceiling-actor-mask';

describe('ceiling appliance actor occlusion', () => {
  it('projects a compact outer outline rather than cutting a rectangular hole around the screen', () => {
    const outline = ceilingMaskHull([
      { x: 20, y: 30 }, { x: 30, y: 20 }, { x: 40, y: 30 }, { x: 30, y: 40 },
      { x: 30, y: 30 }, { x: 20, y: 30 }, { x: Number.NaN, y: 12 },
    ]);
    expect(outline).toEqual([{ x: 20, y: 30 }, { x: 30, y: 20 }, { x: 40, y: 30 }, { x: 30, y: 40 }]);
    expect(ceilingMaskHull([{ x: 1, y: 1 }, { x: 2, y: 2 }])).toEqual([]);
  });

  it('recognizes ceiling-mounted appliances and explicit ceiling roles, but not ordinary furniture', () => {
    expect(isCeilingActorOccluder('ceiling', undefined)).toBe(true);
    expect(isCeilingActorOccluder('floor', 'ceiling-appliance')).toBe(true);
    expect(isCeilingActorOccluder('wall', 'kitchen-range-hood')).toBe(false);
  });

  it('keeps separate rotated mesh bounds separate so the gap between ducts is not masked', () => {
    const appliance = new THREE.Group();
    appliance.rotation.y = Math.PI / 2;
    for (const x of [-2, 2]) {
      const duct = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
      duct.position.x = x;
      appliance.add(duct);
    }
    const parts = ceilingMeshBounds(appliance);
    expect(parts).toHaveLength(2);
    const firstZ = parts[0].corners.map((corner) => corner.z);
    const secondZ = parts[1].corners.map((corner) => corner.z);
    expect(Math.min(...firstZ)).toBeGreaterThan(Math.max(...secondZ));
  });

  it('fades only air conditioners and ventilators, not ceiling lights', () => {
    for (const id of ['ceiling-cassette-air-conditioner', 'air-planner-ceiling-vent', 'bunfirvil-bathroom-combination-ventilator-rounded']) {
      expect(isFadeableCeilingAppliance(id)).toBe(true);
    }
    expect(isFadeableCeilingAppliance('ceiling-smart-downlight')).toBe(false);
    const bounds = new THREE.Box3(new THREE.Vector3(0, 4, 0), new THREE.Vector3(1, 5, 1));
    expect(ceilingApplianceIsNear(bounds, new THREE.Vector3(1.8, 0, .5))).toBe(true);
    expect(ceilingApplianceIsNear(bounds, new THREE.Vector3(2, 0, .5))).toBe(false);
    expect(ceilingApplianceIsNear(bounds, null)).toBe(false);
  });

  it('fades groups independently and restores their original material and shadow settings', () => {
    const source = new THREE.MeshBasicMaterial({ opacity: .6, transparent: true, depthWrite: false });
    const first = new THREE.Group();
    const second = new THREE.Group();
    const firstMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), source);
    const secondMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), source);
    firstMesh.castShadow = true;
    second.position.x = 8;
    first.add(firstMesh);
    second.add(secondMesh);
    prepareCeilingFade(first);
    prepareCeilingFade(second);
    for (let i = 0; i < 80; i++) {
      expect(updateCeilingFade(first, new THREE.Vector3(0, 0, 0), 16)).toBe(true);
      expect(updateCeilingFade(second, new THREE.Vector3(0, 0, 0), 16)).toBe(false);
    }
    expect(firstMesh.material.opacity).toBeCloseTo(.6 * .28, 3);
    expect(source.opacity).toBe(.6);
    expect(firstMesh.castShadow).toBe(false);
    expect(secondMesh.material.opacity).toBe(.6);
    for (let i = 0; i < 120; i++) updateCeilingFade(first, null, 16);
    expect(firstMesh.material.opacity).toBe(.6);
    expect(firstMesh.material.transparent).toBe(true);
    expect(firstMesh.material.depthWrite).toBe(false);
    expect(firstMesh.castShadow).toBe(true);
  });
});
