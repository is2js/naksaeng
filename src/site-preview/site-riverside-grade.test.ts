import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import { expect, it } from 'vitest';
import { rebuildRiversideGrade } from './site-riverside-grade';
import { siteTerrainSampler } from './site-terrain-sampler';

const at = (x: number, z: number) => [(x-490)*.52,(z-540)*.52] as const;
const flat = (name: string, y: number) => {
  const material = new MeshStandardMaterial({side:DoubleSide});
  material.name = name;
  const mesh = new Mesh(new PlaneGeometry(650,650).rotateX(-Math.PI/2), material);
  mesh.position.y = y;
  return mesh;
};

it('joins both west parcels to a shallow, raised river without changing the original site or road grades', () => {
  const model = new Group(), parcels = new Group();
  parcels.name = 'SM_Parcels_Roads_And_Stream';
  const grass = flat('MAT_Site_Grass', 4.5), stream = flat('MAT_Stream', -.16), road = flat('MAT_Perimeter_Road', .50);
  parcels.add(grass, stream, road);
  const woods = flat('MAT_ForestGround_2', -3);
  woods.name = 'SM_Woodland_Terrain';
  const retaining = new Group();
  retaining.name = 'SM_East_West_Retaining_And_Main_Gate_Break';
  const wallAt = (x: number,z: number, xEnd: number,zEnd: number) => {
    const [a,b] = [at(x,z),at(xEnd,zEnd)];
    const material = new MeshStandardMaterial();
    material.name = 'MAT_Retaining_Edge';
    return new Mesh(new BufferGeometry().setAttribute('position', new Float32BufferAttribute([
      a[0],-3,a[1], a[0],4.5,a[1], b[0],4.5,b[1],
    ],3)),material);
  };
  const removedBankWall = wallAt(203,306,228,350);
  const keptStreetWall = wallAt(374,178,362,217);
  retaining.add(removedBankWall,keptStreetWall);
  model.add(woods, parcels, retaining);
  rebuildRiversideGrade(model);

  const river = model.getObjectByName('SM_Rebuilt_Riverside_Grade_water')!;
  const bank = model.getObjectByName('SM_Rebuilt_Riverside_Grade_land')!;
  const bounds = [at(20,15),at(720,1070)] as const;
  const waterAt = siteTerrainSampler([river], ...bounds), bankAt = siteTerrainSampler([bank], ...bounds);
  expect(waterAt(at(183,319), -9)).toBeCloseTo(4.22,2);
  expect(waterAt(at(434,811), -9)).toBeCloseTo(4.22,2);
  expect(bankAt(at(215,340),-9)).toBeGreaterThan(4.2);
  expect(bankAt(at(475,824),-9)).toBe(-9);
  expect(stream.visible).toBe(false);
  expect(removedBankWall.visible).toBe(false);
  expect(keptStreetWall.visible).toBe(true);
  expect(road.visible).toBe(true);
  expect(road.position.y).toBe(.5);
  expect(grass.position.y).toBe(4.5);
});
