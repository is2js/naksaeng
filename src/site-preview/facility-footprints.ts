import { Box3, BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, ShapeUtils, Vector2, Vector3 } from 'three';
import type { SiteFacility } from './facility-markers';

type Point = readonly [x: number, z: number];
const AREA_EPSILON = 1e-7;
const cross = (a: Point, b: Point, c: Point): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function clipToTriangle(face: Vector3[], boundary: Point[]): Vector3[] {
  const sign = Math.sign(cross(boundary[0], boundary[1], boundary[2]));
  if (!sign) return [];
  for (let edge = 0; edge < 3 && face.length; edge++) {
    const a = boundary[edge], b = boundary[(edge + 1) % 3];
    const side = (p: Vector3) => sign * cross(a, b, [p.x, p.z]);
    const clipped: Vector3[] = [];
    let start = face[face.length - 1], from = side(start);
    for (const end of face) {
      const to = side(end);
      const inside = to >= -AREA_EPSILON;
      if ((from >= -AREA_EPSILON) !== inside) clipped.push(start.clone().lerp(end, Math.max(0, Math.min(1, from / (from - to)))));
      if (inside) clipped.push(end);
      start = end;
      from = to;
    }
    face = clipped;
  }
  return face;
}

const roofMaterials = new Set(['MAT_Amenity_Roof_Fascia', 'MAT_Amenity_Roof_Planting']);

function materialName(mesh: Mesh): string | undefined {
  // The v9 GLB stores each roof / terrain material in a separate primitive.
  return Array.isArray(mesh.material) ? undefined : mesh.material.name;
}

/** Clip each existing upward surface to a plan footprint rather than putting a floating plane over it. */
export function createFacilityFootprint(facility: SiteFacility, terrain: readonly Mesh[], daycare: readonly Mesh[]): Mesh<BufferGeometry, MeshBasicMaterial> | null {
  const footprint = facility.footprint;
  if (!footprint) return null;
  const isRoof = footprint.surface === 'daycare-roof';
  const outline = footprint.surface === 'terrain' ? footprint.outline : undefined;
  const boundary = outline ? ShapeUtils.triangulateShape(outline.map(([x, z]) => new Vector2(x, z)), [])
    .map((triangle) => triangle.map((index) => outline[index])) : [];
  const limits = outline ? new Box3().setFromPoints(outline.map(([x, z]) => new Vector3(x, 0, z))) : null;
  const roofLevel = isRoof ? Math.max(...daycare.filter((mesh) => materialName(mesh) === 'MAT_Amenity_Roof_Fascia')
    .map((mesh) => new Box3().setFromObject(mesh).max.y)) : 0;
  if (isRoof && !Number.isFinite(roofLevel)) return null;
  const sources = isRoof ? daycare.filter((mesh) => {
    const name = materialName(mesh);
    return roofMaterials.has(name ?? '') || (name === 'MAT_Amenity_Limestone' && new Box3().setFromObject(mesh).max.y > roofLevel + .1);
  }) : terrain;

  const positions: number[] = [];
  const normal = new Vector3(), ab = new Vector3(), ac = new Vector3();
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  const face = [a, b, c];
  const emit = (a: Vector3, b: Vector3, c: Vector3) => {
    if (Math.abs(cross([a.x, a.z], [b.x, b.z], [c.x, c.z])) <= AREA_EPSILON) return;
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };

  for (const mesh of sources) {
    const { geometry, matrixWorld } = mesh;
    const coords = geometry.getAttribute('position');
    const indices = geometry.getIndex();
    for (let offset = 0; offset + 2 < (indices?.count ?? coords.count); offset += 3) {
      for (let i = 0; i < 3; i++) face[i].fromBufferAttribute(coords, indices?.getX(offset + i) ?? offset + i).applyMatrix4(matrixWorld);
      normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
      if (normal.y <= normal.length() * .38) continue; // Never coat walls, foliage sides or undersides.
      if (isRoof) {
        if (Math.min(a.y, b.y, c.y) >= roofLevel - .018) emit(a, b, c);
        continue;
      }
      if (!limits || Math.max(a.x, b.x, c.x) < limits.min.x || Math.min(a.x, b.x, c.x) > limits.max.x
        || Math.max(a.z, b.z, c.z) < limits.min.z || Math.min(a.z, b.z, c.z) > limits.max.z) continue;
      for (const triangle of boundary) {
        const patch = clipToTriangle(face, triangle);
        for (let vertex = 1; vertex + 1 < patch.length; vertex++) emit(patch[0], patch[vertex], patch[vertex + 1]);
      }
    }
  }
  if (!positions.length) return null;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return new Mesh(geometry, new MeshBasicMaterial({
    color: isRoof ? '#ffe267' : '#ff5765', opacity: isRoof ? .35 : .29, transparent: true,
    toneMapped: false, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
  }));
}
