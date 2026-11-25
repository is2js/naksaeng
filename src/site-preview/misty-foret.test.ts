import { Box3, Group, Mesh, Raycaster, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { refineFacilityExteriors } from './facility-exteriors';
import { MISTY_GARDEN } from './site-misty-foret-layout';
import { UPPER_DISTRICT_GRADE, upperDistrictStreetRise } from './site-upper-main-layout';

const name = 'SM_Rebuilt_Misty_Foret';
const point = (px: number, pz: number, y: number) => new Vector3((px-490)*.52,y,(pz-540)*.52);

it('makes the road edge a storey-high stone face and joins a flat Misty Forêt roof to the parking lid', () => {
  const scene = new Group();
  refineFacilityExteriors(scene);
  const park = scene.getObjectByName(name)!;
  const ramp = scene.getObjectByName('SM_Rebuilt_Upper_Open_Entry')!;
  const roof = park.getObjectByName(`${name}_roofLawn`)!;
  const lid = ramp.getObjectByName(`${ramp.name}_siteGrass`)!;
  const ray = new Raycaster(point(337,331,30),new Vector3(0,-1,0));
  const first = ray.intersectObject(roof)[0].point.y;
  ray.ray.origin.copy(point(381,380,30));
  expect(ray.intersectObject(roof)[0].point.y).toBeCloseTo(first,4);
  ray.ray.origin.copy(point(399,414,30));
  expect(ray.intersectObject(lid)[0].point.y).toBeCloseTo(first,4);
  const asphalt = ramp.getObjectByName(`${ramp.name}_asphalt`)!;
  expect(ray.intersectObject(asphalt)[0].point.y).toBeCloseTo(.63,1);
  const fascia = park.getObjectByName(`${name}_courtStone`)!;
  const front = new Raycaster(point(406,341,first-1.9),new Vector3(-1,0,0));
  expect(front.intersectObject(fascia).length).toBeGreaterThan(0);
  const joints = new Box3().setFromObject(park.getObjectByName(`${name}_stoneJoint`)!);
  expect(joints.max.y-joints.min.y).toBeGreaterThan(2.4);
  const verge = park.getObjectByName(`${name}_siteGrass`)!;
  ray.ray.origin.copy(point(347,320,30));
  const highGrass = ray.intersectObject(verge)[0].point.y;
  ray.ray.origin.copy(point(354,320,30));
  const lowGrass = ray.intersectObject(verge)[0].point.y;
  expect(highGrass).toBeLessThan(first-.2);
  expect(highGrass).toBeGreaterThan(lowGrass);
  expect(Math.abs(lowGrass-(UPPER_DISTRICT_GRADE.lowerRoadY+upperDistrictStreetRise(ray.ray.origin.z)))).toBeLessThan(.24);
  ray.ray.origin.copy(point(385.5,380,30));
  expect(lowGrass - ray.intersectObject(verge)[0].point.y).toBeGreaterThan(2);
});

it('holds the black road outline, including its tapered end and separate gate sidewalk', () => {
  const scene = new Group();
  refineFacilityExteriors(scene);
  const entry = scene.getObjectByName('SM_Rebuilt_Upper_Open_Entry')!;
  const asphalt = entry.getObjectByName(`${entry.name}_asphalt`)!;
  const lid = entry.getObjectByName(`${entry.name}_siteGrass`)!;
  const walk = entry.getObjectByName(`${entry.name}_path`)!;
  const ray = new Raycaster(point(451,429,30),new Vector3(0,-1,0));
  const at = (object: typeof asphalt, x: number, z: number) => {
    ray.ray.origin.copy(point(x,z,30));
    return ray.intersectObject(object)[0]?.point.y;
  };
  const exposed = [[454,431],[447,440],[436,441],[425,437],[420,432],[412,423],[406,415],
    [442,454],[444,458],[445,465],[441,467]] as const;
  for (const [x,z] of exposed) expect(at(asphalt,x,z),`${x},${z}`).toBeGreaterThanOrEqual(.54);
  const grades = exposed.map(([x,z])=>at(asphalt,x,z)!);
  expect(Math.max(...grades)-Math.min(...grades)).toBeLessThan(.17);
  const perimeter=scene.getObjectByName('SM_Rebuilt_Community_Terraces_community-2_courtPaver')!;
  for (const [x,z] of [[432,465],[429,477],[448.5,469.4],[452,464],[434,432]]) {
    expect(at(asphalt,x,z),`beyond the black line at ${x},${z}`).toBeUndefined();
    expect(at(walk,x,z)).toBeUndefined();
  }
  for (const [x,z] of [[446.4,451.4],[452.1,445.35],[458.1,442.9],[463.1,440],[464.5,443.9]]) {
    expect(at(walk,x,z),`continuous gray sidewalk at ${x},${z}`).toBeGreaterThan(.62);
  }
  for (let z=435;z<=479;z+=1) for (let x=404;x<=466;x+=1) {
    if (at(walk,x,z)!==undefined || at(perimeter,x,z)!==undefined) {
      expect(at(asphalt,x,z),`separate road and walk at ${x},${z}`).toBeUndefined();
    }
  }
  expect(at(lid,432,465)).toBeGreaterThan(.52);
  expect(at(lid,399,407)).toBeCloseTo(UPPER_DISTRICT_GRADE.mistyRoofY,4);
  expect(at(asphalt,399,407)).toBeLessThan(at(asphalt,406,415)!-.10);
});

it('uses one joint line for the road and each of the two sidewalks', () => {
  const scene = new Group();
  refineFacilityExteriors(scene);
  const vertices = (name: string) => {
    const keys=new Set<string>();
    scene.traverse(mesh=>{
      if (mesh.name!==name || !(mesh instanceof Mesh)) return;
      const points=mesh.geometry.getAttribute('position');
      for (let i=0;i<points.count;i++) keys.add([points.getX(i),points.getZ(i)].map(x=>x.toFixed(4)).join(','));
    });
    return keys;
  };
  const asphalt=vertices('SM_Rebuilt_Upper_Open_Entry_asphalt');
  for (const name of ['SM_Rebuilt_Upper_Open_Entry_coping',
    'SM_Rebuilt_Community_Terraces_community-2_coping']) {
    const exactJoins=[...vertices(name)].filter(p=>asphalt.has(p));
    expect(exactJoins.length,`curb vertices shared with ${name}`).toBeGreaterThan(5);
  }
});

it('models the plan’s interior spine and both paved pockets separately from its planting beds', () => {
  const scene = new Group();
  refineFacilityExteriors(scene);
  const park = scene.getObjectByName(name)!;
  const roof = park.getObjectByName(`${name}_roofLawn`)!;
  const pockets = park.getObjectByName(`${name}_courtPaver`)!;
  const path = park.getObjectByName(`${name}_path`)!;
  const beds = park.getObjectByName(`${name}_gardenBed`)!;
  const ray = new Raycaster(point(346,349,30),new Vector3(0,-1,0));
  const first = ray.intersectObject(roof)[0].point.y;
  expect(ray.intersectObject(path)[0].point.y).toBeCloseTo(first+.055,4);
  for (const {center: [x,z]} of MISTY_GARDEN.pockets) {
    ray.ray.origin.copy(point(x,z,30));
    expect(ray.intersectObject(pockets)[0].point.y).toBeCloseTo(first+.073,4);
    expect(ray.intersectObject(beds)).toHaveLength(0);
  }
});
