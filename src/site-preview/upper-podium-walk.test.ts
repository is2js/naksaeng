import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { refineFacilityExteriors } from './facility-exteriors';

const point = (x: number, z: number, y: number): [number,number,number] => [(x - 490) * .52, y, (z - 540) * .52];

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
  for (const [x,z] of [[279.7,414.8],[307.6,456],[335.4,503],[363.3,521.5],[401.8,501],[428.2,478.0]]) {
    expect(new Set(surfacesAt(paving,x,z)).size, `one floor at ${x}, ${z}`).toBe(1);
  }
  for (const [x,z] of [[310,430],[336,467],[365,489]]) {
    expect(surfacesAt(paving,x,z), `no path beneath podium at ${x}, ${z}`).toHaveLength(0);
  }
  expect(surfacesAt(archived,294,416)).toHaveLength(0);
  expect(surfacesAt(archived,245,325).length).toBeGreaterThan(0);
});
