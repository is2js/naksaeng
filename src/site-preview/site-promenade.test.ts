import { Box3, Group, Mesh, Raycaster, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { refineFacilityExteriors } from './facility-exteriors';
import { CAFE_PLAN, COMMUNITY_PROMENADE, PARK_PATHS } from './site-promenade-layout';

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
  expect(hit(646, 619)?.point.y).toBeGreaterThan(5.08);
  expect(hit(490, 546)?.point.y).toBeLessThan(5.08);
});

it('builds the café with an east–west ridge and joins the forecourt', () => {
  const scene = new Group();
  refineFacilityExteriors(scene);
  const cafe = scene.getObjectByName('SM_Rebuilt_DeForet_Cafe')!;
  const roof = cafe.getObjectByName(`${cafe.name}_zinc`) as Mesh;
  const bounds = new Box3().setFromObject(roof), width = bounds.getSize(new Vector3());
  expect(width.x).toBeGreaterThan(width.z * 1.5);
  const p = roof.geometry.getAttribute('position');
  const ridgeZ = Array.from({ length: p.count }, (_, i) => i)
    .filter(i => p.getY(i) > bounds.max.y - .02).map(i => p.getZ(i));
  expect(Math.max(...ridgeZ) - Math.min(...ridgeZ)).toBeLessThan(.001);
  expect(ridgeZ[0]).toBeCloseTo(z(CAFE_PLAN.center[1]));
  expect(new Box3().setFromObject(cafe).min.x).toBeLessThanOrEqual(x(PARK_PATHS.at(-1)!.at(-1)![0]));
});
