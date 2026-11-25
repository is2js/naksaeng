import { Box3, Group, Raycaster, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { refineFacilityExteriors } from './facility-exteriors';

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
  expect(ray.intersectObject(asphalt)[0].point.y).toBeLessThan(-.6);
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
  expect(highGrass).toBeLessThan(first-3);
  expect(highGrass-lowGrass).toBeGreaterThan(1);
});
