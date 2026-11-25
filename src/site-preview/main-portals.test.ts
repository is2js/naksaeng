import { Box3, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { refineFacilityExteriors } from './facility-exteriors';

const MAIN_101_X = (711.847648526 - 490) * .52;
const MAIN_101_Z = (924.605104167 - 540) * .52;
const EAST_INWARD = new Vector3(-.953927569, 0, -.300036987);
const EAST_RIGHT = new Vector3(.300036987, 0, -.953927569);
const atLowerMain = (right: number, inward: number, y: number) => [
  MAIN_101_X + EAST_RIGHT.x * right + EAST_INWARD.x * inward, y,
  MAIN_101_Z + EAST_RIGHT.z * right + EAST_INWARD.z * inward,
];

it('gives both main entries a wide continuous ivory beam above clear vehicle lanes', () => {
  const site = new Group();
  refineFacilityExteriors(site);
  for (const [id, inward, minimumSpan] of [
    ['101', EAST_INWARD, 18.5], ['110', new Vector3(-.980, 0, -.199), 17.2],
  ] as const) {
    const portal = site.getObjectByName(`SM_Rebuilt_Main_Portal_${id}`)!;
    const beam = portal.getObjectByName(`${portal.name}_portalIvory`) as Mesh;
    const right = new Vector3(-inward.z, 0, inward.x);
    const vertices = beam.geometry.getAttribute('position');
    const lateral = Array.from({ length: vertices.count }, (_, i) => new Vector3().fromBufferAttribute(vertices, i).dot(right));
    expect(Math.max(...lateral) - Math.min(...lateral)).toBeGreaterThan(minimumSpan);
    const bounds = new Box3().setFromObject(portal);
    const center = bounds.getCenter(new Vector3());
    for (const lane of [-2.05, 2.05]) {
      const start = center.clone().addScaledVector(inward, -5).addScaledVector(right, lane);
      start.y = bounds.min.y + 2.4;
      expect(new Raycaster(start, inward, 0, 10).intersectObject(portal, true)).toHaveLength(0);
    }
  }
});

it('removes the archived 101 portal but preserves the adjoining booth and road triangles', () => {
  const model = new Group(), baked = new Group();
  baked.name = 'SM_Entry_Portals_And_Parking_Ramp';
  model.add(baked);
  const archivedBeam = [...atLowerMain(-6.5, -1.2, 4.8), ...atLowerMain(6.5, -1.2, 4.8), ...atLowerMain(-6.5, -1.2, 4.5)];
  const adjacentBooth = [...atLowerMain(-7.28, -.9, 1.25), ...atLowerMain(-9.62, -.9, 1.25), ...atLowerMain(-9.62, -.9, 2.55)];
  const road = [...atLowerMain(-1, -.9, .58), ...atLowerMain(1, -.9, .58), ...atLowerMain(0, 1.4, .58)];
  const mesh = (name: string, vertices: number[]) => {
    const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(vertices, 3));
    const material = new MeshStandardMaterial();
    material.name = name;
    const result = new Mesh(geometry, material);
    baked.add(result);
    return result;
  };
  const oldStone = mesh('MAT_Entry_Pale_Limestone', [...archivedBeam, ...adjacentBooth]);
  const oldRoad = mesh('MAT_Entry_Asphalt', road);
  refineFacilityExteriors(model);
  expect(Array.from(oldStone.geometry.getIndex()!.array)).toEqual([3, 4, 5]);
  expect(oldRoad.visible).toBe(true);
  expect(oldRoad.geometry.getIndex()).toBeNull();
});
