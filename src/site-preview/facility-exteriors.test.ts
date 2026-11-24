import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial } from 'three';
import { expect, it } from 'vitest';
import { DAYCARE_ENTRY_FRONTAGE, DAYCARE_ENTRY_OUTWARD } from './facility-daycare-placement';
import { refineFacilityExteriors } from './facility-exteriors';
import { SITE_FACILITIES } from './facility-markers';

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

it('aligns the 105 and 109 guardhouse roofs with their matching seam-side markers without deleting the ramp', () => {
  const model = new Group(), entries = new Group();
  entries.name = 'SM_Entry_Portals_And_Parking_Ramp';
  model.add(entries);
  const markers = ['security-105', 'security-109'].map(id => SITE_FACILITIES.find(facility => facility.id === id)!);
  const { x, z } = markers[0];
  const inside = [x - .5, 1, z, x + .5, 1, z, x, 2, z + .3];
  const outside = [x - 8, 1, z, x - 7, 1, z, x - 7, 2, z + .3];
  const mesh = (name: string, vertices: number[]) => {
    const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(vertices, 3));
    const material = new MeshStandardMaterial();
    material.name = name;
    const result = new Mesh(geometry, material);
    entries.add(result);
    return result;
  };
  const shared = mesh('MAT_Entry_Pale_Limestone', [...inside, ...outside]);
  const asphalt = mesh('MAT_Entry_Asphalt', inside);
  refineFacilityExteriors(model);
  expect(Array.from(shared.geometry.getIndex()!.array)).toEqual([3, 4, 5]);
  expect(asphalt.visible).toBe(true);
  expect(asphalt.geometry.getIndex()).toBeNull();
  for (const marker of markers) {
    const roof = model.getObjectByName(`SM_Rebuilt_Upper_Guardhouse_${marker.id}_zinc`) as Mesh;
    const points = roof.geometry.getAttribute('position');
    const { axis: [dx, dz], halfWidth, halfDepth } = marker.roofMark!;
    for (let i = 0; i < points.count; i++) {
      const x = points.getX(i) - marker.x, z = points.getZ(i) - marker.z;
      expect(Math.abs(x * dx + z * dz)).toBeCloseTo(halfWidth, 4);
      expect(Math.abs(-x * dz + z * dx)).toBeCloseTo(halfDepth, 4);
    }
    expect(dx + dz).toBeCloseTo(0, 6);
  }
});
