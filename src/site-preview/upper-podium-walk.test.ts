import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, Vector3, type Object3D } from 'three';
import { expect, it } from 'vitest';
import { refineFacilityExteriors } from './facility-exteriors';
import { podiumAxis } from './site-109-podium-layout';

const point = (x: number, z: number, y: number): [number,number,number] => [(x - 490) * .52, y, (z - 540) * .52];
const [a,b]=podiumAxis;
const retail = (u: number,v: number): [number, number] => [415.8+u*a-v*b,475.8+u*b+v*a];

it('replaces the two archived paving layers with one continuous Community II exterior walk', () => {
  const site = new Group(), paths = new Group();
  paths.name = 'SM_Graded_Pedestrian_Routes';
  const old = new BufferGeometry();
  const square = (x: number, z: number, height: number) => [
    ...point(x - 1,z - 1,height), ...point(x + 1,z - 1,height), ...point(x + 1,z + 1,height),
    ...point(x - 1,z - 1,height), ...point(x + 1,z + 1,height), ...point(x - 1,z + 1,height),
  ];
  old.setAttribute('position', new Float32BufferAttribute([
    ...square(294,416,6), ...square(294,416,6.08), ...square(245,325,5),
  ], 3));
  const tiles = new MeshBasicMaterial({ side: DoubleSide });
  tiles.name = 'MAT_Sandstone_Pedestrian_Pavers';
  const archived = new Mesh(old, tiles);
  paths.add(archived);
  site.add(paths);
  refineFacilityExteriors(site);

  const paving = site.getObjectByName('SM_Rebuilt_Community_Terraces_community-2_courtPaver') as Mesh;
  expect(paving.material).toBe(tiles);
  expect(paving.geometry.getAttribute('uv').count).toEqual(paving.geometry.getAttribute('position').count);
  const ray = new Raycaster(new Vector3(), new Vector3(0,-1,0));
  const surfacesAt = (mesh: Mesh, x: number, z: number) => {
    ray.ray.origin.set(...point(x,z,16));
    return ray.intersectObject(mesh).map(hit => hit.point.y.toFixed(4));
  };
  for (const [x,z] of [[279.7,414.8],[307.6,456],[335.4,503],[363.3,521.5],[386.4,504],[398.3,493.4],
    [408.7,485],retail(4.3,3.5),retail(20.45,5.1),retail(18.8,-8),retail(18.8,-25)]) {
    expect(new Set(surfacesAt(paving,x,z)).size, `one floor at ${x}, ${z}`).toBe(1);
  }
  for (const [x,z] of [[310,430],[336,467],[365,489],retail(16.45,-8),retail(21.15,-25)]) {
    expect(surfacesAt(paving,x,z), `outside the path at ${x}, ${z}`).toHaveLength(0);
  }
  expect(surfacesAt(archived,294,416)).toHaveLength(0);
  expect(surfacesAt(archived,245,325).length).toBeGreaterThan(0);
});

it('levels the long west frontage and blends one supported walk down to the auxiliary apron', () => {
  const site = new Group(), parcels = new Group();
  parcels.name = 'SM_Parcels_Roads_And_Stream';
  const turf = new MeshBasicMaterial({ side: DoubleSide });
  turf.name = 'MAT_Site_Grass';
  const mesh = new Mesh(new PlaneGeometry(122,112,15,12).rotateX(-Math.PI/2), turf);
  const source = mesh.geometry.getAttribute('position');
  // Deliberately coarse, alternating grass peaks used to lift the pavers
  // in steps when every cross section picked its highest edge.
  for (let i = 0; i < source.count; i++) source.setY(i, .85 * Math.sin(i * 3.2));
  mesh.position.set(...point(353,465,5.35));
  parcels.add(mesh);
  site.add(parcels);
  refineFacilityExteriors(site);
  const paving = site.getObjectByName('SM_Rebuilt_Community_Terraces_community-2_courtPaver')!;
  const apronTurf = site.getObjectByName('SM_Rebuilt_Upper_Open_Entry_siteGrass')!;
  const ray = new Raycaster(new Vector3(),new Vector3(0,-1,0));
  const surface = (object: Object3D,x: number,z: number) => {
    ray.ray.origin.set(...point(x,z,18));
    return ray.intersectObject(object)[0]?.point.y ?? NaN;
  };
  const west = [[271.5,394],[279.9,415],[285.1,423],[297.4,441],[307.6,456],[316,470],[327.9,489],[335.4,503]];
  const returnWalk = [[344,515],[352.3,520.4],[363.3,522],[373.5,520.1],[385,514],
    [386.4,504],[398.3,493.4],[408.7,485],retail(4.3,3.5),retail(17,3.5),retail(18.8,-8)];
  for (const [x,z] of [...west,...returnWalk]) {
    const height = surface(paving,x,z);
    const pad = surface(apronTurf,x,z);
    const lawn = surface(mesh,x,z) || pad;
    expect(height-lawn,`supported center at ${x}, ${z}`).toBeGreaterThan(.031);
    expect(height-lawn,`flush beside turf at ${x}, ${z}`).toBeLessThan(.175);
  }
  for (const route of [west,returnWalk]) {
    for (let i = 1; i < route.length; i++) {
      const [x0,z0] = route[i-1], [x1,z1] = route[i];
      const run = .52*Math.hypot(x1-x0,z1-z0);
      const drop = surface(paving,x0,z0)-surface(paving,x1,z1);
      expect(drop).toBeGreaterThanOrEqual(-.005);
      expect(drop/run).toBeLessThan(.105);
    }
  }
  expect(surface(paving,327.9,489)).toBeCloseTo(4.73,2);
  expect(surface(paving,...retail(18.8,-8))).toBeCloseTo(.76,2);
});
