import { BufferGeometry, Float32BufferAttribute, Matrix4, Mesh, MeshStandardMaterial, Vector3, type Material, type Object3D } from 'three';
import { UPPER_DISTRICT_GRADE } from './site-upper-main-layout';

type XZ = readonly [number, number];
type TerrainHeight = (point: XZ, fallback: number) => number;

// The archived GLB packs these low-rise buildings into shared material
// batches. Their oriented footprints and old bases come from layout.v1 and
// the Blender grading/build_amenities source, not a guess at mesh bounds.
const PLAN_SCALE = .52;
const TERRACES = [
  { center: [257, 318], size: [120, 18], angle: 58, oldBase: .48 + 6.10, tier: UPPER_DISTRICT_GRADE.arrivalY },
  { center: [216, 163], size: [63, 18], angle: 65, oldBase: .48 + 3.35, tier: UPPER_DISTRICT_GRADE.parkY },
] as const;
const FOOTPRINTS = TERRACES.map(({ center, size, angle, ...levels }) => ({
  ...levels, x: (center[0] - 490) * PLAN_SCALE, z: (center[1] - 540) * PLAN_SCALE,
  halfW: size[0] * PLAN_SCALE / 2 + .21, halfD: size[1] * PLAN_SCALE / 2 + .21,
  c: Math.cos(angle * Math.PI / 180), s: Math.sin(angle * Math.PI / 180),
  // The .19m paving plinth should read slightly proud of the new lawn.
  newBase: levels.tier - .12,
}));

/** Translate T202 and T203 without warping their windows, roof slabs or planters. */
export function raiseUpperTerraceAmenities(model: Object3D, gradeAt?: TerrainHeight): void {
  const point = new Vector3(), inverse = new Matrix4();
  const buildings = new Set<(typeof FOOTPRINTS)[number]>(), skirts = new Set<(typeof FOOTPRINTS)[number]>();
  let stone: Material | undefined;
  for (const [rootName, foundation] of [
    ['SM_Terraces_And_Community', false], ['SM_Low_Rise_Facility_Foundations', true],
  ] as const) {
    model.getObjectByName(rootName)?.traverseVisible(object => {
      if (!(object instanceof Mesh)) return;
      if (foundation && !Array.isArray(object.material)) stone ??= object.material;
      const geometry = object.geometry, positions = geometry.getAttribute('position');
      inverse.copy(object.matrixWorld).invert();
      let changed = false;
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
        const wing = FOOTPRINTS.find(({ x, z, c, s, halfW, halfD }) => {
          const dx = point.x - x, dz = point.z - z;
          return Math.abs(dx * c + dz * s) <= halfW && Math.abs(dz * c - dx * s) <= halfD;
        });
        if (!wing) continue;
        (foundation ? skirts : buildings).add(wing);
        if (!foundation || point.y >= wing.oldBase + .015) {
          point.y += wing.newBase - wing.oldBase;
        } else {
          // Keep the skirt top tied to the shifted structure but run its
          // bottom to the new grade rather than carrying the old slope up.
          const ground = gradeAt?.([point.x, point.z], wing.tier) ?? wing.tier;
          point.y = Math.min(wing.newBase + .008, ground - .06);
        }
        point.applyMatrix4(inverse);
        positions.setXYZ(i, point.x, point.y, point.z);
        changed = true;
      }
      if (!changed) return;
      positions.needsUpdate = true;
      if (foundation) geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    });
  }

  // The checked-in revision has no baked foundation triangles on these two
  // pads. Close any newly exposed gaps, but only below the slab and only
  // where the new terrain sampler actually reports a lower shoulder.
  if (!gradeAt || !buildings.size) return;
  const vertices: number[] = [];
  inverse.copy(model.matrixWorld).invert();
  for (const wing of buildings) {
    if (skirts.has(wing)) continue;
    const { x, z, c, s, halfW, halfD, newBase, tier } = wing;
    const w = halfW - .19, d = halfD - .19;
    const at = (u: number, v: number): XZ => [x + c * u - s * v, z + s * u + c * v];
    const corners = [at(-w, -d), at(w, -d), at(w, d), at(-w, d)];
    const top = newBase + .028;
    const vertex = (p: XZ, y: number) => point.set(p[0], y, p[1]).applyMatrix4(inverse).toArray(vertices, vertices.length);
    corners.forEach((a, edge) => {
      const b = corners[(edge + 1) % corners.length];
      const segments = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.5);
      const sample = (i: number): XZ => [a[0] + (b[0] - a[0]) * i / segments, a[1] + (b[1] - a[1]) * i / segments];
      for (let i = 1; i <= segments; i++) {
        const p = sample(i - 1), q = sample(i);
        const gp = gradeAt(p, tier), gq = gradeAt(q, tier);
        if (Math.min(gp, gq) > newBase - .045) continue;
        const yp = Math.min(top - .015, gp - .06), yq = Math.min(top - .015, gq - .06);
        vertex(p, yp); vertex(p, top); vertex(q, top);
        vertex(p, yp); vertex(q, top); vertex(q, yq);
      }
    });
  }
  if (!vertices.length) return;
  const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  const support = new Mesh(geometry, stone ?? new MeshStandardMaterial({ color: '#8b938f', roughness: .79 }));
  support.name = 'SM_Upper_Terrace_Amenity_Supports';
  model.add(support);
}
