import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { refineFacilityExteriors } from './facility-exteriors';

const xyz = (x: number, z: number, height: number) => new Vector3((x-490)*.52,height,(z-540)*.52);
const quad = (name: string, a: Vector3, b: Vector3, c: Vector3, d: Vector3) => {
  const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([a,b,c,a,c,d].flatMap(p => p.toArray()),3));
  const material = new MeshBasicMaterial({ side: DoubleSide });
  material.name = name;
  return new Mesh(geometry,material);
};

it('joins the actual sloping 109 parcel rim without keeping the old vertical face', () => {
  const site = new Group(), parcels = new Group(), walls = new Group();
  parcels.name = 'SM_Parcels_Roads_And_Stream';
  walls.name = 'SM_East_West_Retaining_And_Main_Gate_Break';
  const a = xyz(408,506,5.4), b = xyz(377,535,6.05);
  const out = new Vector3(b.z-a.z,0,a.x-b.x).normalize();
  const grass = quad('MAT_Site_Grass',a,b,b.clone().addScaledVector(out,-1.3),a.clone().addScaledVector(out,-1.3));
  const oldFace = quad('MAT_Retaining_Edge',a,b,b.clone().setY(-1),a.clone().setY(-1));
  const unrelated = quad('MAT_Retaining_Edge',xyz(284,440,6),xyz(287,444,6),xyz(287,444,-1),xyz(284,440,-1));
  parcels.add(grass);
  walls.add(oldFace,unrelated);
  site.add(parcels,walls);
  refineFacilityExteriors(site);

  const park = site.getObjectByName('SM_Rebuilt_Seam_Park')!;
  const turf = park.getObjectByName(`${park.name}_siteGrass`)!;
  const ray = new Raycaster(new Vector3(),new Vector3(0,-1,0));
  const at = (root: Group | Mesh | typeof turf, base: Vector3, offset: number) => {
    ray.ray.origin.copy(base).addScaledVector(out,offset).setY(20);
    return ray.intersectObject(root)[0]?.point.y;
  };
  for (const t of [.25,.5,.75]) {
    const p = a.clone().lerp(b,t);
    const old = at(grass,p,-.10), joined = at(turf,p,.08), parkInterior = at(turf,p,4);
    expect(old).toBeDefined();
    expect(joined).toBeCloseTo(old!,1);
    expect(parkInterior).toBeLessThan(joined!);
  }
  expect(at(turf,a.clone().lerp(b,.5),-.54)).toBeUndefined();
  expect(oldFace.visible).toBe(false);
  expect(unrelated.visible).toBe(true);
});

it('keeps both source turf and the rebuilt seam low around the 109 guardhouse and turn', () => {
  const scene=new Group(), parcels=new Group(), edge=new Group();
  parcels.name='SM_Parcels_Roads_And_Stream';
  edge.name='SM_East_West_Retaining_And_Main_Gate_Break';
  const mat=new MeshBasicMaterial({side:DoubleSide});
  mat.name='MAT_Site_Grass';
  const bakedHill=new Mesh(new PlaneGeometry(81,67,16,14).rotateX(-Math.PI/2),mat);
  bakedHill.position.copy(xyz(444,465,7.45));
  const a=xyz(466,446,7.1), b=xyz(439,478,6.6);
  const bakedBlade=quad('MAT_Retaining_Edge',a,b,b.clone().setY(-1.0),a.clone().setY(-1.0));
  parcels.add(bakedHill); edge.add(bakedBlade); scene.add(parcels,edge);
  refineFacilityExteriors(scene);
  expect(bakedBlade.visible).toBe(false);
  const root='SM_Rebuilt_Upper_Open_Entry';
  const surfaces=[bakedHill,scene.getObjectByName(`${root}_siteGrass`)!,
    scene.getObjectByName(`${root}_asphalt`)!,scene.getObjectByName('SM_Rebuilt_Seam_Park_siteGrass')!];
  const down=new Raycaster(new Vector3(),new Vector3(0,-1,0));
  const floor=(x:number,z:number)=>{
    down.ray.origin.copy(xyz(x,z,20));
    return down.intersectObjects(surfaces)[0]?.point.y;
  };
  for (const [x,z] of [[452,454],[455,457],[448,462],[452,464],[448,468]]) {
    expect(floor(x,z),`${x},${z}`).toBeGreaterThan(.48);
    expect(floor(x,z),`${x},${z}`).toBeLessThan(1.14);
  }
  down.ray.origin.copy(xyz(448.5,469.4,20));
  expect(down.intersectObjects(surfaces)[0]?.object.name).toBe(`${root}_asphalt`);
  expect(floor(432,489)).toBeGreaterThan(floor(448,468)!);
});
