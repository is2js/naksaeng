import { Box3, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { refineBrochureGround } from './facility-brochure-ground';

const x = (u: number) => (u - 490) * .52;
const z = (v: number) => (v - 540) * .52;
const triangle = (position: [number, number, number]) => [
  ...position, position[0] + .3, position[1], position[2], position[0], position[1], position[2] + .3,
];

it('builds the pale podium directly into the 101 selector without replacing its tower mesh', () => {
  const model = new Group();
  const tower = new Group();
  tower.userData.buildingId = '101';
  tower.position.set(x(650), 3, z(966));
  const wing = new Mesh();
  tower.add(wing);
  model.add(tower);
  refineBrochureGround(model);
  model.updateMatrixWorld(true);
  const podium = tower.getObjectByName('SM_Brochure_101_Retail_Platform')!;
  const bounds = new Box3().setFromObject(podium);
  expect(bounds.containsPoint(new Vector3(x(650), 5, z(966)))).toBe(true);
  expect(podium.getObjectByName(`${podium.name}_light`)).toBeDefined();
  expect(wing.parent).toBe(tower);
  refineBrochureGround(model);
  expect(tower.children.filter(object => object.name === podium.name)).toEqual([podium]);
});

it('keeps lower blue play paving while replacing the upper play figure and raising the park lawn', () => {
  const model = new Group(), oldGarden = new Group(), material = new MeshStandardMaterial();
  oldGarden.name = 'SM_Courtyard_Lawns_And_Play';
  material.name = 'MAT_Garden_blue';
  const positions = [...triangle([x(289), 3, z(166)]), ...triangle([x(604), 3, z(665)])];
  const oldPlay = new Mesh(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3)), material);
  model.add(oldGarden);
  oldGarden.add(oldPlay);
  refineBrochureGround(model);
  expect(Array.from(oldPlay.geometry.getIndex()!.array)).toEqual([3, 4, 5]);
  const play = model.getObjectByName('SM_Brochure_DeForet_Play')!;
  expect(new Box3().setFromObject(play).max.y).toBeGreaterThan(8);
  const park = model.getObjectByName('SM_Brochure_DeForet_Park')!;
  const ray = new Raycaster(new Vector3(x(604), 10, z(837)), new Vector3(0, -1, 0));
  expect(ray.intersectObject(park, true)[0]?.point.y).toBeCloseTo(4.78);
});
