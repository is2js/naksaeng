import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial } from 'three';
import { expect, it } from 'vitest';
import { siteTerrainSampler } from './site-terrain-sampler';

it('samples transformed slope and overlapping terrace top without using vertical or hidden faces', () => {
  const group = new Group(), make = (positions: number[]) => new Mesh(
    new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3)), new MeshBasicMaterial());
  group.add(make([0,0,0, 0,0,6, 6,3,0]), make([0,2,0, 0,2,2, 2,2,0]), make([3,0,0, 3,10,0, 3,0,6]));
  const hidden = make([0,7,0,0,7,6,6,7,0]);
  hidden.visible = false;
  group.add(hidden);
  group.position.x = 4;
  group.updateMatrixWorld(true);
  const sample = siteTerrainSampler([group], [0,-1], [12,8]);
  expect(sample([4.5,.5], -1)).toBe(2);
  expect(sample([7,1], -1)).toBe(1.5);
  expect(sample([15,1], -1)).toBe(-1);
  expect(sample([9,5], -1)).toBe(-1);
});
