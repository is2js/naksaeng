import { Box3, BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial,
  Raycaster, Vector3, type Object3D } from 'three';
import { expect, it } from 'vitest';
import { DAYCARE_COURTYARD } from './daycare-courtyard-layout';
import { DAYCARE_ENTRY_OUTWARD } from './facility-daycare-placement';
import { refineFacilityExteriors } from './facility-exteriors';

const plan = ([east, south]: readonly [number, number]) => new Vector3((east - 490) * .52, 0, (south - 540) * .52);

it('replaces the displaced daycare play pad and connects its edge and paved approach without crossing the mat', () => {
  const model = new Group(), daycare = new Group(), garden = new Group();
  daycare.name = 'SM_Public_Daycare_2F';
  garden.name = 'SM_Courtyard_Lawns_And_Play';
  model.add(daycare, garden);
  const oldCenter = [462, 600] as const, outside = [581, 792] as const;
  const material = new MeshStandardMaterial({ name: 'MAT_Garden_school_ground', side: DoubleSide });
  const vertices = [oldCenter, outside].flatMap((p) => {
    const { x, z } = plan(p);
    return [x - .3, 1.2, z - .2, x + .3, 1.2, z - .2, x, 1.2, z + .3];
  });
  const baked = new Mesh(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(vertices, 3)), material);
  garden.add(baked);

  refineFacilityExteriors(model);
  const courtyard = model.getObjectByName('SM_Rebuilt_Daycare_Courtyard')!;
  const play = courtyard.getObjectByName(`${courtyard.name}_daycareRubber`)!;
  const path = courtyard.getObjectByName(`${courtyard.name}_path`)!;
  const door = model.getObjectByName('SM_Rebuilt_Daycare_Pavilion_entranceGlass')!;
  const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0));
  const surface = (object: Object3D, p: Vector3) => {
    ray.ray.origin.copy(p).y = 24;
    return ray.intersectObject(object, false)[0]?.point;
  };

  expect(surface(play, plan([481, 565]))).toBeDefined(); // P4 green court, not the displaced flyover proxy.
  expect(surface(play, plan(oldCenter))).toBeUndefined();
  expect(surface(baked, plan(oldCenter))).toBeUndefined();
  expect(surface(baked, plan(outside))?.y).toBeCloseTo(1.2);
  expect(surface(path, plan(DAYCARE_COURTYARD.playCenter))).toBeUndefined();

  const threshold = new Box3().setFromObject(door).getCenter(new Vector3());
  threshold.x += DAYCARE_ENTRY_OUTWARD[0] * 1.28;
  threshold.z += DAYCARE_ENTRY_OUTWARD[1] * 1.28;
  expect(surface(path, threshold), 'paved approach just outside the built door').toBeDefined();
  expect(surface(path, plan(DAYCARE_COURTYARD.innerJunction)), 'connection to the garden paths').toBeDefined();
  expect(surface(path, plan([488, 588])), 'play court perimeter paving').toBeDefined();
  expect(surface(path, plan([464, 565.8])), 'short paved spur from the loop to the play mat').toBeDefined();
  expect(courtyard.getObjectByName(`${courtyard.name}_gardenFlower`)).toBeInstanceOf(Mesh);
});
