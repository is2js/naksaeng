import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ceilingMaskHull, ceilingMeshBounds, isCeilingActorOccluder } from './ceiling-actor-mask';

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
});
