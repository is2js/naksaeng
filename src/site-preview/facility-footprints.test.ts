import { Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { createFacilityFootprint } from './facility-footprints';
import { SITE_FACILITIES, type SiteFacility } from './facility-markers';

function plane(x: number, y: number, width: number, height: number, materialName = '') {
  const mesh = new Mesh(new PlaneGeometry(width, height).rotateX(-Math.PI / 2), new MeshBasicMaterial({ name: materialName }));
  mesh.position.set(x, y, 0);
  mesh.updateMatrixWorld(true);
  return mesh;
}

function projectedArea(mesh: Mesh): number {
  const p = mesh.geometry.getAttribute('position');
  let total = 0;
  for (let i = 0; i < p.count; i += 3) {
    total += Math.abs((p.getX(i + 1) - p.getX(i)) * (p.getZ(i + 2) - p.getZ(i))
      - (p.getZ(i + 1) - p.getZ(i)) * (p.getX(i + 2) - p.getX(i))) / 2;
  }
  return total;
}

describe('facility surface masks', () => {
  it('paints only existing upward faces inside a concave boundary and preserves their levels', () => {
    const marker: SiteFacility = { id: 'test-community', kind: 'community', label: 'Test', x: 0, z: 0,
      footprint: { surface: 'terrain', outline: [[-4,-2],[4,-2],[4,0],[0,0],[0,3],[-4,3]] } };
    const left = plane(-3, 2, 6, 8), right = plane(3, 6, 6, 8);
    const mesh = createFacilityFootprint(marker, [left, right], [])!;
    expect(projectedArea(mesh)).toBeCloseTo(28, 5);
    const positions = mesh.geometry.getAttribute('position');
    expect(new Set(Array.from({ length: positions.count }, (_, i) => positions.getY(i)))).toEqual(new Set([2, 6]));
    expect(mesh.material.transparent).toBe(true);
    expect(mesh.material.depthWrite).toBe(false);
  });

  it('targets both roof rim and planted surface, without covering the wall or approach', () => {
    const daycare = SITE_FACILITIES.find(({ kind }) => kind === 'daycare')!;
    const mesh = createFacilityFootprint(daycare, [], [
      plane(0, 7, 10, 8, 'MAT_Amenity_Roof_Fascia'),
      plane(0, 7.1, 9, 7, 'MAT_Amenity_Roof_Planting'),
      plane(0, 1, 14, 9, 'MAT_Warm_Paving'),
    ])!;
    expect(projectedArea(mesh)).toBeCloseTo(80 + 63, 5); // Planting occludes the underlying fascia cap.
    expect(mesh.geometry.getAttribute('position').count).toBe(12);
    expect(mesh.material.polygonOffset).toBe(true);
  });

  it('uses two separate drawn ground outlines and a single deliberate daycare roof', () => {
    expect(SITE_FACILITIES.filter(({ footprint }) => footprint).map(({ id, footprint }) => [id, footprint?.surface])).toEqual([
      ['community-1', 'terrain'], ['community-2', 'terrain'], ['daycare-104', 'daycare-roof'],
    ]);
  });
});
