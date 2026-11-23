import {
  BufferGeometry, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial,
  Raycaster, ShapeUtils, Vector2, Vector3,
  type Object3D,
} from 'three';
import { SITE_FACILITIES } from './facility-markers';

type XZ = readonly [number, number];
type XYZ = readonly [number, number, number];

const COLORS = {
  limestone: '#b2a895', coping: '#dbd1b9', stoneInset: '#847b6d', stoneJoint: '#7b766c',
  facadeGlass: '#28353a', facadeSash: '#454744', windowGlint: '#687778',
  roofLawn: '#8c9561', hedge: '#617546', path: '#b9ada0', deck: '#a47e5f',
  zinc: '#64615a', seams: '#827b6c', door: '#303433', entranceGlass: '#536261',
  asphalt: '#494d4e', roadPaint: '#e6e0c9', roadAmber: '#bca464',
} as const;
type Finish = keyof typeof COLORS;

const FACADE = 'SM_Rebuilt_Community_Terraces';
const DAYCARE = 'SM_Rebuilt_Daycare_Pavilion';
const DRIVE = 'SM_Rebuilt_Upper_Open_Entry';
const GUARD = 'SM_Rebuilt_Upper_Guardhouse';
const EPSILON = 1e-4;
const groundPoint = (p: XZ, y: number): XYZ => [p[0], y, p[1]];
const plan = (px: number, py: number): XZ => [(px - 490) * 0.52, (py - 540) * 0.52];
const add = (a: XZ, b: XZ, by = 1): XZ => [a[0] + b[0] * by, a[1] + b[1] * by];
const mix = (a: XZ, b: XZ, t: number): XZ => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const unit = (a: XZ, b: XZ): XZ => {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
};

/** A batch per finish keeps the extra geometry inexpensive while the original GLB stays untouched. */
class SurfaceBatch {
  private readonly positions = new Map<Finish, number[]>();

  tri(finish: Finish, a: XYZ, b: XYZ, c: XYZ): void {
    const vertices = this.positions.get(finish) ?? [];
    vertices.push(...a, ...b, ...c);
    this.positions.set(finish, vertices);
  }

  quad(finish: Finish, a: XYZ, b: XYZ, c: XYZ, d: XYZ): void {
    this.tri(finish, a, b, c);
    this.tri(finish, a, c, d);
  }

  plate(finish: Finish, outline: readonly XZ[], y: number): void {
    const polygon = outline.map(([x, z]) => new Vector2(x, z));
    for (const [ia, ib, ic] of ShapeUtils.triangulateShape(polygon, [])) {
      const [a, b, c] = [outline[ia], outline[ib], outline[ic]];
      const upwards = (b[1] - a[1]) * (c[0] - a[0]) > (b[0] - a[0]) * (c[1] - a[1]);
      this.tri(finish, groundPoint(a, y), groundPoint(upwards ? b : c, y), groundPoint(upwards ? c : b, y));
    }
  }

  wall(finish: Finish, a: XZ, b: XZ, bottom: number, top: number): void {
    if (top - bottom < EPSILON) return;
    this.quad(finish, groundPoint(a, bottom), groundPoint(a, top), groundPoint(b, top), groundPoint(b, bottom));
  }

  prism(side: Finish, top: Finish, outline: readonly XZ[], bottom: number, upper: number): void {
    this.plate(top, outline, upper);
    for (let i = 0; i < outline.length; i++) {
      this.wall(side, outline[i], outline[(i + 1) % outline.length], bottom, upper);
    }
  }

  strip(finish: Finish, a: XZ, b: XZ, width: number, y: number): void {
    const [dx, dz] = unit(a, b);
    const normal: XZ = [-dz, dx];
    this.plate(finish, [add(a, normal, width / 2), add(b, normal, width / 2),
      add(b, normal, -width / 2), add(a, normal, -width / 2)], y);
  }

  attachTo(group: Group): void {
    for (const [finish, positions] of this.positions) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      geometry.computeVertexNormals();
      const glass = finish === 'facadeGlass' || finish === 'entranceGlass';
      const material = new MeshStandardMaterial({
        color: COLORS[finish], roughness: glass ? 0.42 : 0.92, metalness: glass ? 0.18 : 0,
        side: DoubleSide,
      });
      material.name = `MAT_Rebuilt_${finish}`;
      const mesh = new Mesh(geometry, material);
      mesh.name = `${group.name}_${finish}`;
      // Lower or vertical detail doesn't create an artificial floor at roof height.
      mesh.userData.siteSurface = ['roofLawn', 'coping', 'asphalt', 'path'].includes(finish);
      group.add(mesh);
    }
  }
}

function rectangular(out: (x: number, z: number) => XZ, x0: number, z0: number, x1: number, z1: number): XZ[] {
  return [out(x0, z0), out(x1, z0), out(x1, z1), out(x0, z1)];
}

function isMesh(object: Object3D): object is Mesh<BufferGeometry> {
  return (object as Mesh).isMesh === true;
}

/** Adjust only the baked meshes owned by the two specific amenities, not the shared terrain or towers. */
function keepTriangles(mesh: Mesh<BufferGeometry>, keep: (a: Vector3, b: Vector3, c: Vector3) => boolean): void {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const count = index?.count ?? position.count;
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  const remaining: number[] = [];
  for (let i = 0; i + 2 < count; i += 3) {
    const ia = index?.getX(i) ?? i, ib = index?.getX(i + 1) ?? i + 1, ic = index?.getX(i + 2) ?? i + 2;
    a.fromBufferAttribute(position, ia).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(position, ib).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(position, ic).applyMatrix4(mesh.matrixWorld);
    if (keep(a, b, c)) remaining.push(ia, ib, ic);
  }
  if (remaining.length === 0) mesh.visible = false;
  else if (remaining.length !== count) geometry.setIndex(remaining);
}

function finishName(mesh: Mesh): string {
  return Array.isArray(mesh.material) ? '' : mesh.material.name;
}

function retainApprovedElevators(model: Object3D): void {
  const original = model.getObjectByName('SM_Community_Grade_And_Elevators');
  const shafts = [
    { center: plan(554, 669), radius: 3.35 },
    { center: plan(641, 638), radius: 4.0 },
  ];
  original?.traverse(object => {
    if (!isMesh(object)) return;
    // Roof walks, terraces and loose decoration are replaced. The two approved vertical links remain.
    if (/(?:_walk|_leaf|_rail|_turf|_wood|Site_Grass)/i.test(finishName(object))) {
      object.visible = false;
      return;
    }
    keepTriangles(object, (...points) => shafts.some(({ center, radius }) =>
      points.every(p => Math.hypot(p.x - center[0], p.z - center[1]) < radius)));
  });
}

function removeLegacy109Podium(model: Object3D): void {
  // The old rim-retail proxy on [388,479] is part of batched GLB meshes.
  // Only replace that proxy and its footing, not the separate land/towers,
  // T202, the 110 club, or the 101 commercial wing in the same batches.
  const [x, z] = plan(388, 479);
  const angle = 49 * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const insideProxy = (p: Vector3): boolean => {
    const dx = p.x - x, dz = p.z - z;
    return Math.abs(dx * cos - dz * sin) <= 13.6
      && Math.abs(dx * sin + dz * cos) <= 6.4;
  };
  for (const name of ['SM_Terraces_And_Community', 'SM_Low_Rise_Facility_Foundations']) {
    model.getObjectByName(name)?.traverse(object => {
      if (isMesh(object)) keepTriangles(object, (...points) => !points.every(insideProxy));
    });
  }
}

function lowerCommunityTwoFrontage(model: Object3D, outline: readonly XZ[]): void {
  // Page 6 shows a podium floor exposed on the stream side. In the GLB this
  // strip was graded at the 109 tower's pad, which would bury the new windows.
  // Taper only the garden-side frontage; never lower the tower pad or road.
  const frontage = [3, 4, 5, 6, 7, 8, 9].map(i => {
    const a = outline[i], b = outline[i + 1];
    const axis = unit(a, b);
    return { a, axis, outward: [axis[1], -axis[0]] as XZ, length: Math.hypot(b[0] - a[0], b[1] - a[1]) };
  });
  const ease = (n: number): number => {
    const t = Math.min(1, Math.max(0, n));
    return t * t * (3 - 2 * t);
  };
  const gradeInfluence = (x: number, z: number): number => {
    let closest = Infinity, influence = 0;
    for (const { a, axis, outward, length } of frontage) {
      const dx = x - a[0], dz = z - a[1];
      const along = dx * axis[0] + dz * axis[1];
      const out = dx * outward[0] + dz * outward[1];
      const beyond = Math.max(0, -along, along - length);
      const distance = Math.hypot(beyond, out);
      if (distance >= closest) continue;
      closest = distance;
      influence = ease((out + 3.2) / 2.8) * ease((12.2 - out) / 5.2) * ease((5 - beyond) / 5);
    }
    return influence;
  };
  const lower = (v: Vector3): number => Math.max(0, v.y - 4.42) * gradeInfluence(v.x, v.z);
  const point = new Vector3(), inverse = new Matrix4();
  const moveVertices = (mesh: Mesh, shift: (p: Vector3) => number) => {
    const position = mesh.geometry.getAttribute('position');
    inverse.copy(mesh.matrixWorld).invert();
    let changed = false;
    for (let index = 0; index < position.count; index++) {
      point.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
      const dy = shift(point);
      if (dy < EPSILON) continue;
      changed = true;
      point.y -= dy;
      point.applyMatrix4(inverse);
      position.setXYZ(index, point.x, point.y, point.z);
    }
    if (changed) {
      position.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeBoundingSphere();
    }
  };
  model.getObjectByName('SM_Parcels_Roads_And_Stream')?.traverse(node => {
    if (isMesh(node) && finishName(node) === 'MAT_Site_Grass') moveVertices(node, lower);
  });

  // Preserve the drawn path and existing trees on top of the adjusted grade.
  // A narrow buffer keeps slabs/plantings that border the cut from hovering.
  model.getObjectByName('SM_Graded_Pedestrian_Routes')?.traverse(node => {
    if (isMesh(node)) moveVertices(node, p => gradeInfluence(p.x, p.z) > 0
      ? Math.max(0, p.y - terrainAt(model, [p.x, p.z], p.y) - .105) : 0);
  });
  const instance = new Matrix4();
  model.traverse(node => {
    if (!(node instanceof InstancedMesh) || !node.parent?.name.startsWith('Courtyard_Grove_Instances')) return;
    const localShift = new Vector3();
    inverse.copy(node.matrixWorld).invert();
    let changed = false;
    for (let i = 0; i < node.count; i++) {
      node.getMatrixAt(i, instance);
      point.setFromMatrixPosition(instance).applyMatrix4(node.matrixWorld);
      const dy = lower(point);
      if (dy < EPSILON) continue;
      changed = true;
      localShift.copy(point);
      point.y -= dy;
      instance.elements[12] += point.applyMatrix4(inverse).x - localShift.applyMatrix4(inverse).x;
      instance.elements[13] += point.y - localShift.y;
      instance.elements[14] += point.z - localShift.z;
      node.setMatrixAt(i, instance);
    }
    if (changed) {
      node.instanceMatrix.needsUpdate = true;
      node.computeBoundingBox();
      node.computeBoundingSphere();
    }
  });
}

function steppedTerrace(batch: SurfaceBatch, outline: readonly XZ[], top: number, gradeLow: number): void {
  const twiceArea = outline.reduce((sum, a, i) => {
    const b = outline[(i + 1) % outline.length];
    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0);
  const orientation = Math.sign(twiceArea) || 1;
  batch.prism('limestone', 'roofLawn', outline, gradeLow, top);
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    const [dx, dz] = unit(a, b);
    const outward: XZ = [dz * orientation, -dx * orientation];
    const raisedEdgeA = add(a, outward, -0.17), raisedEdgeB = add(b, outward, -0.17);
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // A continuous masonry beam on the planted podium, and a subtle darker recessed bay above its plinth.
    batch.wall('coping', add(a, outward, 0.022), add(b, outward, 0.022), top - 0.46, top + 0.12);
    if (length < 1.7) continue;
    batch.strip('coping', raisedEdgeA, raisedEdgeB, 0.32, top + 0.12);
    batch.strip('path', add(a, outward, -0.78), add(b, outward, -0.78), 0.76, top + 0.016);
    if (length > 5) {
      batch.strip('hedge', add(mix(a, b, .14), outward, -1.52), add(mix(a, b, .86), outward, -1.52), 0.45, top + 0.04);
    }
    const bays = Math.max(1, Math.round(length / 4.05));
    const floor = Math.max(gradeLow + .14, top - 3.39);
    for (let j = 0; j < bays; j++) {
      const u = (j + 0.5) / bays;
      const half = Math.max(.08, 0.5 / bays - .27 / length);
      const starting = mix(a, b, u - half), ending = mix(a, b, u + half);
      const frontA = add(starting, outward, 0.035), frontB = add(ending, outward, 0.035);
      batch.wall('stoneInset', frontA, frontB, floor, top - .45);
      const glassHalf = Math.max(.03, half - .16 / length);
      batch.wall('facadeGlass', add(mix(a, b, u - glassHalf), outward, 0.047),
        add(mix(a, b, u + glassHalf), outward, 0.047), floor + 0.12, top - .57);
      if (length / bays > 2) {
        const sashA = add(mix(a, b, u - .041 / length), outward, .056);
        const sashB = add(mix(a, b, u + .041 / length), outward, .056);
        batch.wall('facadeSash', sashA, sashB, floor + 0.1, top - .57);
      }
      batch.wall('windowGlint', add(frontA, outward, .022), add(frontB, outward, .022),
        top - .80, top - .76);
    }
    for (let joint = 1; joint <= 2; joint++) {
      batch.wall('stoneJoint', add(a, outward, .026), add(b, outward, .026),
        top - .46 - joint * .17, top - .45 - joint * .17);
    }
  }
}

function communityTwoElevator(batch: SurfaceBatch, roof: number): void {
  const marker = SITE_FACILITIES.find(item => item.id === 'elevator-community-2');
  if (!marker) return;
  const mid: XZ = [marker.x, marker.z];
  const across = unit(plan(361.8, 512.4), plan(394.6, 476.5));
  const outward: XZ = [-across[1], across[0]];
  const at = (x: number, z: number): XZ => add(add(mid, across, x), outward, z);
  const top = roof + 2.64;
  batch.prism('limestone', 'limestone', rectangular(at, -1.52, -1.44, 1.52, 1.44), roof - .25, top);
  batch.prism('coping', 'coping', rectangular(at, -1.64, -1.55, 1.64, 1.55), top - .16, top + .08);
  batch.wall('stoneInset', at(-.79, -1.455), at(.79, -1.455), roof + .035, top - .36);
  batch.wall('facadeGlass', at(-.65, -1.465), at(.65, -1.465), roof + .08, top - .48);
  batch.wall('facadeSash', at(-.035, -1.47), at(.035, -1.47), roof + .08, top - .48);
  batch.wall('facadeGlass', at(-.61, 1.455), at(.61, 1.455), roof + .54, top - .39);
}

function communityExteriors(model: Object3D): void {
  retainApprovedElevators(model);
  removeLegacy109Podium(model);
  const group = new Group();
  group.name = FACADE;
  group.userData.castsSiteShadow = true;
  // Virtual model levels, not surveyed site elevations: the lower park and the
  // 109 foundation already exist at different elevations in the accepted model.
  for (const [id, roof, low] of [['community-1', 5.08, 2.05], ['community-2', 7.72, .49]] as const) {
    const facility = SITE_FACILITIES.find(item => item.id === id);
    if (facility?.footprint?.surface !== 'terrain') continue;
    const terrace = new Group();
    terrace.name = `${FACADE}_${id}`;
    terrace.userData.castsSiteShadow = true;
    const batch = new SurfaceBatch();
    if (id === 'community-2') lowerCommunityTwoFrontage(model, facility.footprint.outline);
    steppedTerrace(batch, facility.footprint.outline, roof, low);
    if (id === 'community-2') communityTwoElevator(batch, roof);
    batch.attachTo(terrace);
    group.add(terrace);
  }
  model.add(group);
}

function daycareEntrance(model: Object3D): void {
  const original = model.getObjectByName('SM_Public_Daycare_2F');
  if (!original) return;
  const mid = plan(428, 581);
  const angle = 46 * Math.PI / 180;
  const across: XZ = [Math.cos(angle), -Math.sin(angle)];
  const outward: XZ = [Math.sin(angle), Math.cos(angle)];
  const at = (x: number, z: number): XZ => add(add(mid, across, x), outward, z);
  original.traverse(object => {
    if (!isMesh(object)) return;
    const name = finishName(object);
    if (/Gable_Cladding|Deep_Frames/.test(name)) object.visible = false;
    if (/Amenity_Limestone/.test(name)) {
      // The baked shallow flat canopy alone occupies this narrow height/projecting band.
      keepTriangles(object, (...points) => !points.every(p => {
        const x = p.x - mid[0], z = p.z - mid[1];
        const depth = x * outward[0] + z * outward[1];
        return p.y >= 4.60 && p.y <= 4.94 && depth >= 6.3 && depth <= 12.1;
      }));
    }
  });
  const group = new Group();
  group.name = DAYCARE;
  group.userData.castsSiteShadow = true;
  const batch = new SurfaceBatch();
  const center = -5.1, x0 = center - 4.20, x1 = center + 4.20;
  const front = 10.62, rear = 6.35, eave = 5.49, ridge = 6.9, ground = 1.65;
  const level = (x: number): number => eave + (ridge - eave) * (1 - Math.abs(x - center) / (x1 - center));
  batch.prism('limestone', 'path', rectangular(at, x0 - .20, rear, x1 + .20, front + 1.08), ground, ground + .14);
  const sill = ground + .15;
  // Projecting charcoal standing-seam gable. The two-storey limestone body stays intact.
  for (const x of [x0, x1]) batch.wall('zinc', at(x, rear), at(x, front), sill, eave);
  const portalLeft = center - 1.67, portalRight = center + 1.67, lintel = 4.09;
  batch.wall('zinc', at(x0, front), at(portalLeft, front), sill, eave);
  batch.wall('zinc', at(portalRight, front), at(x1, front), sill, eave);
  batch.wall('zinc', at(portalLeft, front), at(portalRight, front), lintel, eave);
  batch.tri('zinc', groundPoint(at(x0, front), eave),
    groundPoint(at(center, front), ridge), groundPoint(at(x1, front), eave));
  for (const [a, b] of [[x0, center], [center, x1]]) {
    batch.quad('zinc', groundPoint(at(a, rear - .12), level(a) + .072),
      groundPoint(at(a, front + .19), level(a) + .072),
      groundPoint(at(b, front + .19), level(b) + .072),
      groundPoint(at(b, rear - .12), level(b) + .072));
    batch.quad('door', groundPoint(at(a, front + .19), level(a) - .05),
      groundPoint(at(b, front + .19), level(b) - .05), groundPoint(at(b, front + .19), level(b) + .09),
      groundPoint(at(a, front + .19), level(a) + .09));
  }
  batch.wall('door', at(portalLeft, front - .65), at(portalRight, front - .65), sill, lintel);
  for (const [a, b] of [[portalLeft + .12, center - .042], [center + .042, portalRight - .12]]) {
    batch.wall('entranceGlass', at(a, front - .62), at(b, front - .62), sill + .08, lintel - .09);
    batch.wall('door', at(b - .075, front - .61), at(b, front - .61), sill + .83, sill + 1.14);
  }
  for (let row = 1; row < 38; row++) {
    const x = x0 + (x1 - x0) * row / 38;
    const bottom = x > portalLeft && x < portalRight ? lintel : sill;
    batch.wall('seams', at(x, front + .016), at(x + .016, front + .016), bottom, level(x) - .02);
  }
  batch.attachTo(group);
  model.add(group);
}

/** Connect the existing arterial to the open 109 driveway instead of erecting a second 105-style canopy. */
function upperOpenEntry(model: Object3D): void {
  const oldRamp = model.getObjectByName('SM_Seam_North_Covered_Parking_Ramp');
  if (oldRamp) oldRamp.visible = false;
  const group = new Group();
  group.name = DRIVE;
  const batch = new SurfaceBatch();
  const start = plan(454.8202, 421.2464);
  const inward: XZ = [-.588649, .808389];
  const across: XZ = [.808389, .588649];
  const at = (offset: number, distance: number): XZ => add(add(start, inward, distance), across, offset);
  // The open court ends at the bank before it reaches the raised gardens.
  // The last 4.6 m form a rounded end, not a branch below the podium.
  const profile = [[4.34, .57], [7.0, .62], [9.70, .75], [14.75, 1.05], [20.6, 1.67],
    [23.60, 2.00], [25.45, 2.34], [26.82, 2.57], [27.59, 2.70], [28.20, 2.76]] as const;
  const widths = [6.45, 5.67, 4.45, 3.72, 3.68, 3.72, 3.49, 2.95, 2.04, 0.42];
  const yAt = (station: number): number => {
    for (let i = 0; i < profile.length - 1; i++) {
      const [s0, y0] = profile[i], [s1, y1] = profile[i + 1];
      if (station <= s1) return y0 + (y1 - y0) * (station - s0) / (s1 - s0);
    }
    return profile[profile.length - 1][1];
  };
  const band = (finish: Finish, first: number, last: number, startLeft: number, startRight: number,
    endLeft: number, endRight: number, elevation: number): void => {
    batch.quad(finish, groundPoint(at(startLeft, first), yAt(first) + elevation),
      groundPoint(at(startRight, first), yAt(first) + elevation),
      groundPoint(at(endRight, last), yAt(last) + elevation),
      groundPoint(at(endLeft, last), yAt(last) + elevation));
  };
  for (let i = 0; i < profile.length - 1; i++) {
    const [s0, y0] = profile[i], [s1, y1] = profile[i + 1];
    const a = widths[i], b = widths[i + 1];
    band('asphalt', s0, s1, -a, a, -b, b, 0);
    for (const side of [-1, 1]) {
      const innerA = a * side, innerB = b * side, outerA = (a + .67) * side, outerB = (b + .67) * side;
      band('path', s0, s1, innerA, outerA, innerB, outerB, .055);
      band('coping', s0, s1, innerA, innerA + .17 * side, innerB, innerB + .17 * side, .085);
      const edgeA = at(outerA, s0), edgeB = at(outerB, s1);
      // Replace the inherited parking cut with a supported open road surface.
      // End walls reach the adjacent grade without changing the parcel itself.
      const footA = Math.min(y0 - .07, terrainAt(model, edgeA, .48) - .05);
      const footB = Math.min(y1 - .07, terrainAt(model, edgeB, .48) - .05);
      batch.quad('stoneInset', groundPoint(edgeA, footA), groundPoint(edgeA, y0 + .055),
        groundPoint(edgeB, y1 + .055), groundPoint(edgeB, footB));
    }
    if (s0 >= 9.70 && s1 <= 23.60) band('roadAmber', s0, s1, -.07, .07, -.07, .07, .014);
  }
  for (let i = 0; i < 8; i++) {
    const x = -4.12 + i * 1.06;
    band('roadPaint', 7.45, 9.55, x, x + .50, x, x + .50, .022);
  }
  band('path', 27.59, 28.20, -1.75, 1.75, -.45, .45, .054);
  const endA = at(-1.09, 28.20), endB = at(1.09, 28.20);
  batch.wall('stoneInset', endA, endB, Math.min(terrainAt(model, endA, .48),
    terrainAt(model, endB, .48)) - .05, yAt(28.20) + .055);
  batch.attachTo(group);
  model.add(group);
}

function terrainAt(model: Object3D, point: XZ, otherwise: number): number {
  const terrain = model.getObjectByName('SM_Parcels_Roads_And_Stream');
  if (!terrain) return otherwise;
  const ray = new Raycaster(new Vector3(point[0], 65, point[1]), new Vector3(0, -1, 0));
  return ray.intersectObject(terrain, true)[0]?.point.y ?? otherwise;
}

function missingGuardhouse(model: Object3D): void {
  const security = SITE_FACILITIES.find(item => item.id === 'security-109');
  if (!security) return;
  const mid: XZ = [security.x, security.z];
  const roofAxis: XZ = [.808389, .588649], depthAxis: XZ = [-.588649, .808389];
  const at = (x: number, z: number): XZ => add(add(mid, roofAxis, x), depthAxis, z);
  const group = new Group();
  group.name = GUARD;
  group.userData.castsSiteShadow = true;
  const batch = new SurfaceBatch();
  const base = terrainAt(model, mid, 7.78);
  const body = rectangular(at, -1.78, -1.36, 1.78, 1.36);
  batch.prism('stoneInset', 'path', rectangular(at, -2.28, -1.77, 2.28, 1.77), base - .42, base + .08);
  batch.prism('limestone', 'limestone', body, base + .08, base + 2.40);
  for (const [a, b] of [
    [at(-1.79, -1.13), at(-1.79, 1.13)], [at(1.79, -1.13), at(1.79, 1.13)],
    [at(-1.56, -1.37), at(1.56, -1.37)], [at(-1.56, 1.37), at(1.56, 1.37)],
  ]) {
    batch.wall('facadeGlass', a, b, base + 1.17, base + 1.92);
  }
  batch.prism('coping', 'limestone', rectangular(at, -1.98, -1.55, 1.98, 1.55), base + 2.20, base + 2.60);
  batch.attachTo(group);
  model.add(group);
}

/** Idempotent overlay for the checked-in v9 model. All children are owned by the viewer's model lifecycle. */
export function refineFacilityExteriors(model: Object3D): void {
  if (model.getObjectByName(FACADE)) return;
  model.updateMatrixWorld(true);
  communityExteriors(model);
  daycareEntrance(model);
  upperOpenEntry(model);
  missingGuardhouse(model);
  model.updateMatrixWorld(true);
}
