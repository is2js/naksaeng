import { Box3, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial } from 'three';
import { expect, it } from 'vitest';
import { raiseUpperTerraceAmenities } from './upper-terrace-amenities';
import { UPPER_DISTRICT_GRADE } from './site-upper-main-layout';

const plan = (x: number, y: number, z: number) => [(x - 490) * .52, y, (z - 540) * .52];
function archivedBatch(name: string, points: number[][]): Mesh<BufferGeometry> {
  const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(points.flat(), 3));
  const mesh = new Mesh(geometry, new MeshBasicMaterial());
  mesh.name = name;
  return mesh;
}

it('moves the selected low-rise buildings rigidly without moving other geometry in the shared batch', () => {
  const model = new Group();
  const archived = archivedBatch('SM_Terraces_And_Community', [
    plan(257, 6.77, 318), plan(257, 9.48, 318), plan(266, 8.2, 332),
    plan(216, 4.02, 163), plan(216, 9.45, 163), plan(207, 7.8, 145),
    plan(333, 5.3, 236), plan(366, 7.1, 490), plan(231, 4.0, 164),
  ]);
  model.add(archived);
  model.updateMatrixWorld(true);
  const points = archived.geometry.getAttribute('position');
  const before = Array.from(points.array);
  raiseUpperTerraceAmenities(model);
  const { arrivalY, parkY } = UPPER_DISTRICT_GRADE;
  expect(points.getY(0)).toBeCloseTo(arrivalY + .07, 4);
  expect(points.getY(1) - points.getY(0)).toBeCloseTo(2.71, 4);
  expect(points.getY(2) - points.getY(0)).toBeCloseTo(1.43, 4);
  expect(points.getY(3)).toBeCloseTo(parkY + .07, 4);
  expect(points.getY(4) - points.getY(3)).toBeCloseTo(5.43, 4);
  expect(points.getY(5) - points.getY(3)).toBeCloseTo(3.78, 4);
  for (let i = 0; i < points.count; i++) {
    expect(points.getX(i)).toBe(before[i*3]);
    expect(points.getZ(i)).toBe(before[i*3+2]);
    if (i >= 6) expect(points.getY(i)).toBe(before[i*3+1]);
  }
});

it('seats the skirt foot into the new terrain and preserves the contact with the rigid plinth', () => {
  const model = new Group();
  const archived = archivedBatch('SM_Low_Rise_Facility_Foundations', [
    plan(216, 3.855, 163), plan(217, 3.855, 164), plan(217, 3.1, 164),
    plan(366, 5.8, 490), plan(366, 5.1, 490), plan(367, 6.0, 491),
  ]);
  model.add(archived);
  model.updateMatrixWorld(true);
  const points = archived.geometry.getAttribute('position');
  const before = Array.from(points.array);
  raiseUpperTerraceAmenities(model, (_p, fallback) => fallback - .65);
  const { parkY } = UPPER_DISTRICT_GRADE;
  expect(points.getY(0)).toBeCloseTo(parkY - .12 + .025, 4);
  expect(points.getY(2)).toBeCloseTo(parkY - .65 - .06, 4);
  expect(Array.from(points.array).slice(9)).toEqual(before.slice(9));
});

it('fills a new terraced shoulder below a building only when there is room under the plinth', () => {
  const fixture = () => {
    const group = new Group();
    group.add(archivedBatch('SM_Terraces_And_Community', [
      plan(216, 4.02, 163), plan(216, 9.45, 163), plan(207, 7.8, 145),
    ]));
    group.updateMatrixWorld(true);
    return group;
  };
  const flat = fixture(), shoulder = fixture();
  raiseUpperTerraceAmenities(flat, (_point, tier) => tier);
  raiseUpperTerraceAmenities(shoulder, (_point, tier) => tier - 1.2);
  expect(flat.getObjectByName('SM_Upper_Terrace_Amenity_Supports')).toBeUndefined();
  const support = new Box3().setFromObject(shoulder.getObjectByName('SM_Upper_Terrace_Amenity_Supports')!);
  expect(support.min.y).toBeCloseTo(UPPER_DISTRICT_GRADE.parkY - 1.26, 4);
  expect(support.max.y).toBeLessThan(UPPER_DISTRICT_GRADE.parkY);
});
