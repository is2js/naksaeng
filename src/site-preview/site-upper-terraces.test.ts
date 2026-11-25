import { Box3, DoubleSide, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { createGroundFacilities } from './facility-ground';
import { UPPER_DISTRICT_GRADE } from './site-upper-main-layout';
import { gradeUpperTerraces, upperTerraceGrade } from './site-upper-terraces';

const plan = (px:number,pz:number) => [(px-490)*.52,(pz-540)*.52] as const;
const at = (px:number,pz:number,y:number) => {
  const [x,z]=plan(px,pz);
  return new Vector3(x,y,z);
};

it('holds the 110 and 111/112 benches flat while preserving the street and southern seam', () => {
  const level = (x:number,z:number) => upperTerraceGrade(plan(x,z),3);
  for (const [x,z] of [[225,242],[257,318],[332,281],[331,366]]) {
    expect(level(x!,z!)).toBeCloseTo(UPPER_DISTRICT_GRADE.mistyRoofY,4);
  }
  for (const [x,z] of [[293,49],[302,79],[270,112],[348,151],[302,182],[216,163]]) {
    expect(level(x!,z!)).toBeCloseTo(UPPER_DISTRICT_GRADE.parkY,4);
  }
  const berm = level(247,225);
  expect(berm).toBeGreaterThan(UPPER_DISTRICT_GRADE.arrivalY);
  expect(berm).toBeLessThan(UPPER_DISTRICT_GRADE.parkY);
  expect(level(374,256)).toBe(3);
  expect(level(385,544)).toBe(3);
});

it('moves tower roots intact and re-seats paths, markers and foliage on the new terrain', () => {
  const model = new Group(), parcels = new Group(), paths = new Group(), grove = new Group();
  parcels.name = 'SM_Parcels_Roads_And_Stream';
  paths.name = 'SM_Graded_Pedestrian_Routes';
  grove.name = 'Courtyard_Grove_Instances';
  const flat = (width:number, depth:number, x:number,z:number,y:number,name:string, xDiv=1,zDiv=1) => {
    const material = new MeshBasicMaterial({side:DoubleSide});
    material.name = name;
    const surface = new Mesh(new PlaneGeometry(width,depth,xDiv,zDiv).rotateX(-Math.PI/2),material);
    surface.position.copy(at(x,z,y));
    return surface;
  };
  parcels.add(flat(143,186,302,207,3,'MAT_Site_Grass',70,90));
  const buried = flat(2,3,302,79,2.75,'MAT_Sandstone_Pedestrian_Pavers');
  paths.add(buried);
  const tree = new InstancedMesh(new PlaneGeometry(.1,.1),new MeshBasicMaterial(),1);
  tree.setMatrixAt(0,new Matrix4().setPosition(at(302,79,3.4)));
  grove.add(tree);
  model.add(parcels,paths,grove);
  const buildings = [['109',7.05,7.05],['110',6.1,7.88],['111',2.7,10.68],['112',2.35,10.68]] as const;
  for (const [id,old] of buildings) {
    const tower = new Group();
    tower.name = `BLDG_${id}`;
    tower.userData.buildingId=id;
    tower.position.y=old;
    const entrance = new Group();
    entrance.position.y=1.2;
    tower.add(entrance);
    model.add(tower);
  }
  model.updateMatrixWorld(true);
  const grade=gradeUpperTerraces(model);
  expect(grade(plan(302,79),3)).toBeCloseTo(10.68,4);
  expect(new Box3().setFromObject(buried).min.y).toBeGreaterThan(10.79);
  const moved = new Matrix4();
  tree.getMatrixAt(0,moved);
  expect(new Vector3().setFromMatrixPosition(moved).y).toBeCloseTo(11.08,4);
  for (const [id,,target] of buildings) {
    const tower=model.getObjectByName(`BLDG_${id}`)!;
    expect(tower.position.y).toBeCloseTo(target,4);
    expect(tower.children[0]?.position.y).toBe(1.2);
  }
  const facilities = createGroundFacilities(model,new Map());
  expect(facilities.anchorFor('recycling-112')?.y).toBeGreaterThan(10.68);
  facilities.dispose();
});
