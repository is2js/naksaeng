import { Group, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { expect, it } from 'vitest';
import { createGroundFacilities } from './facility-ground';
import { SITE_FACILITIES } from './facility-markers';

it('raises recycling and stair marks above the visible paving or terrace without using tower roofs', () => {
  const site = new Group();
  const recycling = SITE_FACILITIES.find(({ id }) => id === 'recycling-106')!;
  const stairs = SITE_FACILITIES.find(({ id }) => id === 'stairs-106')!;
  const slab = (name: string, x: number, y: number, z: number, width = 2) => {
    const mesh = new Mesh(new PlaneGeometry(width, 2).rotateX(-Math.PI / 2), new MeshBasicMaterial());
    mesh.name = name;
    mesh.position.set(x, y, z);
    site.add(mesh);
    return mesh;
  };
  // The path just beside the pentagon reaches above the terrace at its center.
  slab('SM_Rebuilt_Community_Terraces', recycling.x, 5, recycling.z);
  slab('SM_Rebuilt_South_Promenades', recycling.x + .75, 5.5, recycling.z, .5);
  slab('SM_Rebuilt_Community_Terraces', stairs.x, 4, stairs.z);
  const tower = slab('SM_Housing_106', recycling.x, 25, recycling.z);
  site.updateMatrixWorld(true);
  const facilities = createGroundFacilities(site, new Map([[tower, '106']]));
  expect(facilities.anchorFor(recycling.id)?.y).toBeCloseTo(5.8);
  expect(facilities.anchorFor(stairs.id)?.y).toBeCloseTo(4.3);
  facilities.dispose();
  for (const mesh of site.children as Mesh<PlaneGeometry, MeshBasicMaterial>[]) {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
});
