import { DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { COMMUNITY_109_DECK, rebuild109DeckWalks } from './site-109-deck-walk';

const xyz = (x: number, z: number, y: number): Vector3 => new Vector3((x-490)*.52,y,(z-540)*.52);

it('connects the low outer walk to the E/V plinth and draws both approaches to 109 above it', () => {
  const model=new Group();
  const terrace = new Group();
  terrace.name='SM_Rebuilt_Community_Terraces_community-2';
  const surface=(label: string, x: number, z: number, y: number, size: number, segments = 2) => {
    const material=new MeshBasicMaterial({side:DoubleSide});
    material.name=label;
    const mesh=new Mesh(new PlaneGeometry(size,size,segments,segments).rotateX(-Math.PI/2),material);
    mesh.position.copy(xyz(x,z,y));
    return mesh;
  };
  const outer=surface('paver',...COMMUNITY_109_DECK.outerTie,2.63,3);
  outer.name=`${terrace.name}_courtPaver`;
  terrace.add(outer);
  const parcel=new Group();
  parcel.name='SM_Parcels_Roads_And_Stream';
  const earth=surface('MAT_Site_Grass',398,484,4.9,28,9);
  parcel.add(earth);
  model.add(terrace,parcel);
  rebuild109DeckWalks(model,7.72);
  model.updateMatrixWorld(true);
  const group=terrace.getObjectByName('SM_109_Community_Deck_Walks')!;
  expect(group.getObjectByName(`${group.name}_lower_lift_door`)).toBeTruthy();
  const mesh=group.getObjectByName(`${group.name}_paving`)!;
  const ray=new Raycaster(new Vector3(),new Vector3(0,-1,0));
  const at=(object: typeof mesh,[x,z]: readonly [number,number])=>{
    ray.ray.origin.copy(xyz(x,z,20)); return ray.intersectObject(object)[0]?.point.y;
  };
  for (const branch of [COMMUNITY_109_DECK.liftLink,COMMUNITY_109_DECK.spine,
    COMMUNITY_109_DECK.line2,COMMUNITY_109_DECK.line3]) {
    const mid=branch[Math.floor(branch.length/2)];
    expect(at(mesh,mid)).toBeGreaterThan(7.75);
    expect(at(mesh,mid)).toBeLessThan(7.84);
  }
  const low=COMMUNITY_109_DECK.approach[2];
  expect(at(mesh,low)).toBeCloseTo(2.68,1);
  expect(at(earth,low)).toBeLessThan(at(mesh,low)!);
  expect(at(mesh,[395,494])).toBeUndefined();
  rebuild109DeckWalks(model,7.72);
  expect(terrace.children.filter(({name})=>name===group.name)).toHaveLength(1);
});
