import { Box3, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Raycaster, Texture, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { refineFacilityExteriors } from './facility-exteriors';
import { CAFE_PLAN, COMMUNITY_PROMENADE, PARK_PATHS } from './site-promenade-layout';
import { createFacilityFootprint } from './facility-footprints';
import { SITE_FACILITIES } from './facility-markers';

const x = (u: number) => (u - 490) * .52;
const z = (v: number) => (v - 540) * .52;

it('connects the 106 junction, Community I roof, 105 frontage and park branch with continuous paving', () => {
  const scene = new Group();
  refineFacilityExteriors(scene);
  const walks = scene.getObjectByName('SM_Rebuilt_South_Promenades')!;
  expect(walks).toBeDefined();
  const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0));
  const hit = (u: number, v: number) => {
    ray.ray.origin.set(x(u), 20, z(v));
    return ray.intersectObject(walks, true).find(({ object }) => /promenade(?:Stone|Band|Trim)$/.test(object.name));
  };
  for (const [u, v] of [...COMMUNITY_PROMENADE.slice(1, -1), ...PARK_PATHS.flatMap(points => points.slice(1, -1))]) {
    expect(hit(u, v), `${u}, ${v}`).toBeDefined();
  }
  const paved = hit(646, 619)!;
  expect(paved.point.y).toBeGreaterThan(5.08);
  expect(hit(490, 546)?.point.y).toBeLessThan(5.08);
  const redMark = createFacilityFootprint(SITE_FACILITIES.find(({ id }) => id === 'community-1')!,
    walks.children.filter((o): o is Mesh => o instanceof Mesh), [])!;
  expect(redMark).toBeInstanceOf(Mesh);
  ray.ray.origin.copy(paved.point).y = 20;
  expect(ray.intersectObject(redMark)[0]?.point.y).toBeCloseTo(paved.point.y, 5);
});

it('drops superseded paving only and uses the baked sandstone appearance on garden links', () => {
  const scene = new Group(), graded = new Group(), garden = new Group();
  graded.name = 'SM_Graded_Pedestrian_Routes';
  garden.name = 'SM_Courtyard_Lawns_And_Play';
  scene.add(graded, garden);
  const texture = new Texture();
  const material = new MeshStandardMaterial({ map: texture });
  material.name = 'MAT_Sandstone_Pedestrian_Pavers';
  const bakedStrip = (group: Group, points: readonly (readonly [number, number])[]) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(points.flatMap(([u, v]) => [
      x(u) - .1, 1, z(v) - .1, x(u), 1, z(v) + .2, x(u) + .1, 1, z(v) - .1,
    ]), 3));
    const mesh = new Mesh(geometry, material);
    group.add(mesh);
    return mesh;
  };
  const westBranch = bakedStrip(graded, [[541, 596], [552, 776]]);
  const oldShore = bakedStrip(garden, [[565, 761], [579, 744]]);
  refineFacilityExteriors(scene);
  expect(Array.from(westBranch.geometry.index!.array)).toEqual([3, 4, 5]);
  expect(Array.from(oldShore.geometry.index!.array)).toEqual([3, 4, 5]);
  const rebuilt = scene.getObjectByName('SM_Rebuilt_South_Promenades')!;
  const quietPaving = rebuilt.children.filter((node): node is Mesh<BufferGeometry, MeshStandardMaterial> =>
    node instanceof Mesh && !Array.isArray(node.material) && node.material.map === texture);
  expect(quietPaving).toHaveLength(PARK_PATHS.length);
  expect(quietPaving.every(mesh => !!mesh.geometry.getAttribute('uv'))).toBe(true);
});

it('aligns the café gable toward the fountain and joins the forecourt', () => {
  const scene = new Group();
  refineFacilityExteriors(scene);
  const cafe = scene.getObjectByName('SM_Rebuilt_DeForet_Cafe')!;
  const roof = cafe.getObjectByName(`${cafe.name}_zinc`) as Mesh;
  const bounds = new Box3().setFromObject(roof);
  const p = roof.geometry.getAttribute('position');
  const [dx, dz] = CAFE_PLAN.axis, [u, v] = CAFE_PLAN.center;
  const center = new Vector3(x(u), 0, z(v));
  const forward = new Vector3(dx, 0, dz), cross = new Vector3(-dz, 0, dx);
  const ridge = Array.from({ length: p.count }, (_, i) => i).filter(i => p.getY(i) > bounds.max.y - .02)
    .map(i => new Vector3(p.getX(i), 0, p.getZ(i)).sub(center));
  expect(ridge.every(point => Math.abs(point.dot(cross)) < .001)).toBe(true);
  const [fu, fv] = CAFE_PLAN.fountain;
  expect(forward.dot(new Vector3(fu - u, 0, fv - v).normalize())).toBeGreaterThan(.9);
  const [pu, pv] = PARK_PATHS.at(-1)!.at(-1)!;
  const threshold = new Vector3(x(pu), 0, z(pv)).sub(center);
  expect(threshold.dot(forward)).toBeGreaterThan(-CAFE_PLAN.length / 2 - .48);
  expect(Math.abs(threshold.dot(cross))).toBeLessThan(CAFE_PLAN.depth / 2);
});
