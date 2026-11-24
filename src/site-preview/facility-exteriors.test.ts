import { Group, Mesh } from 'three';
import { expect, it } from 'vitest';
import { DAYCARE_ENTRY_FRONTAGE, DAYCARE_ENTRY_OUTWARD } from './facility-daycare-placement';
import { refineFacilityExteriors } from './facility-exteriors';

it('mounts the daycare door in front of the middle of the short wall, not on its corner', () => {
  const model = new Group();
  const bakedDaycare = new Group();
  bakedDaycare.name = 'SM_Public_Daycare_2F';
  model.add(bakedDaycare);
  refineFacilityExteriors(model);

  const door = model.getObjectByName('SM_Rebuilt_Daycare_Pavilion_entranceGlass');
  expect(door).toBeInstanceOf(Mesh);
  const points = (door as Mesh).geometry.getAttribute('position');
  const [nx, nz] = DAYCARE_ENTRY_OUTWARD;
  const [wallX, wallZ] = DAYCARE_ENTRY_FRONTAGE.wallMidpoint;
  const lateral: number[] = [], forward: number[] = [];
  for (let i = 0; i < points.count; i++) {
    const dx = points.getX(i) - wallX, dz = points.getZ(i) - wallZ;
    lateral.push(-nz * dx + nx * dz);
    forward.push(nx * dx + nz * dz);
  }

  expect(Math.max(...forward) - Math.min(...forward)).toBeLessThan(.02);
  expect(Math.min(...forward)).toBeGreaterThan(0);
  expect(Math.max(...forward)).toBeLessThan(5);
  // The old corner portal and side wall would both fail this span check.
  expect((Math.max(...lateral) + Math.min(...lateral)) / 2).toBeCloseTo(0, 2);
  expect(Math.max(...lateral) - Math.min(...lateral)).toBeGreaterThan(1.5);
  expect(Math.max(...lateral) - Math.min(...lateral)).toBeLessThan(3.5);
});

it('adds the Community I pavilion palette only to its own terrace', () => {
  const model = new Group();
  refineFacilityExteriors(model);
  const first = model.getObjectByName('SM_Rebuilt_Community_Terraces_community-1')!;
  const second = model.getObjectByName('SM_Rebuilt_Community_Terraces_community-2')!;
  const materials = (terrace: Group) => terrace.children.flatMap(node =>
    node instanceof Mesh && !Array.isArray(node.material) ? [node.material.name] : [],
  );

  expect(materials(first as Group)).toEqual(expect.arrayContaining(['MAT_Rebuilt_courtStone',
    'MAT_Rebuilt_courtGlass', 'MAT_Rebuilt_courtDeck', 'MAT_Rebuilt_courtPaver']));
  expect(materials(second as Group)).toContain('MAT_Rebuilt_facadeGlass');
  expect(materials(second as Group).every(name => !name.startsWith('MAT_Rebuilt_court'))).toBe(true);
});
