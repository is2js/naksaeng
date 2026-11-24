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
const UPPER_MAIN = 'SM_Rebuilt_Upper_Main_Entry';
const SEAM_PARK = 'SM_Rebuilt_Seam_Park';
const RETAIL = 'SM_Rebuilt_Upper_Retail_Frontage';
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

const smoothStep = (x: number): number => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

function polygonContains(point: XZ, outline: readonly XZ[]): boolean {
  return outline.reduce((inside, a, i) => {
    const b = outline[(i + 1) % outline.length];
    return (a[1] > point[1]) !== (b[1] > point[1])
      && point[0] < a[0] + (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) ? !inside : inside;
  }, false);
}

/** Model-gate earthwork, not a replacement for the saved parcel or arterial. */
function lowerEntryGround(model: Object3D, cut: (pos: XZ) => number | null): void {
  const world = new Vector3(), inverse = new Matrix4();
  for (const name of ['SM_Parcels_Roads_And_Stream', 'SM_East_West_Retaining_And_Main_Gate_Break', 'SM_Graded_Pedestrian_Routes']) {
    model.getObjectByName(name)?.traverse(object => {
      if (!isMesh(object)) return;
      if (name === 'SM_Parcels_Roads_And_Stream' && finishName(object) !== 'MAT_Site_Grass') return;
      const geometry = object.geometry, position = geometry.getAttribute('position');
      inverse.copy(object.matrixWorld).invert();
      let changed = false;
      for (let i = 0; i < position.count; i++) {
        world.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
        const height = cut([world.x, world.z]);
        if (height === null || world.y <= height) continue;
        changed = true;
        world.y = height;
        world.applyMatrix4(inverse);
        position.setXYZ(i, world.x, world.y, world.z);
      }
      if (!changed) return;
      position.needsUpdate = true;
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    });
  }
}

type EntryStation = readonly [depth: number, y: number, center: number, left: number, right: number];
type EntryFrame = {
  origin: XZ;
  inward: XZ;
  across: XZ;
  stations: readonly EntryStation[];
};

const upperMainFrame: EntryFrame = {
  origin: plan(370, 253), inward: [-.980, -.199], across: [-.199, .980],
  stations: [
    [4.25, .59, 0, 5.55, 5.55], [7.25, .63, -.10, 4.60, 4.60], [11.4, .85, -.30, 4.45, 4.45],
    [14.8, 1.05, -.40, 4.35, 4.65], [17.5, 1.24, 0, 5.8, 5.4], [22.6, 1.73, 1.1, 6.65, 6.50],
    [27.1, 2.78, 2.2, 4.9, 6.15], [31.6, 4.03, 3.3, 1.15, 2.60],
  ],
};
const upperAuxFrame: EntryFrame = {
  origin: plan(454.8202, 421.2464), inward: [-.588649, .808389], across: [.808389, .588649],
  stations: [
    [4.34, .58, 0, 5.6, 5.7], [7.55, .63, 1.05, 4.0, 5.45], [10.7, .84, 2.15, 3.4, 5.55],
    [14.5, 1.02, 2.25, 3.25, 8.2], [18.7, 1.18, 1.9, 3.35, 8.4], [22.05, 1.41, .85, 4.0, 7.15],
    [25.75, 1.84, .15, 3.1, 5.4], [27.1, 2.14, .3, 1.0, 1.7],
  ],
};

function entryAt(frame: EntryFrame, depth: number, across: number): XZ {
  return add(add(frame.origin, frame.inward, depth), frame.across, across);
}

function entryProfile(frame: EntryFrame, depth: number): EntryStation {
  const stations = frame.stations;
  for (let i = 1; i < stations.length; i++) {
    const a = stations[i - 1], b = stations[i];
    if (depth > b[0]) continue;
    const t = Math.max(0, (depth - a[0]) / (b[0] - a[0]));
    return [depth, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t,
      a[3] + (b[3] - a[3]) * t, a[4] + (b[4] - a[4]) * t];
  }
  return stations[stations.length - 1];
}

function cutForEntry(model: Object3D, frame: EntryFrame): void {
  lowerEntryGround(model, pos => {
    const x = pos[0] - frame.origin[0], z = pos[1] - frame.origin[1];
    const depth = x * frame.inward[0] + z * frame.inward[1];
    const cross = x * frame.across[0] + z * frame.across[1];
    const last = frame.stations[frame.stations.length - 1][0];
    if (depth < 4 || depth > last + 5) return null;
    const [, y, center, left, right] = entryProfile(frame, depth);
    const shoulder = Math.max(center - left - cross, cross - center - right, 0);
    if (shoulder > 5) return null;
    return y - .10 + smoothStep((shoulder - .4) / 4.6) * 8 + smoothStep((depth - last) / 5) * 8;
  });
}

/** Cross streets remain at the original road datum; only the gate approaches gain a new plan trace. */
function paveEntry(batch: SurfaceBatch, model: Object3D, frame: EntryFrame): void {
  const arc = frame.stations.flatMap((a, i, arr) => {
    const b = arr[i + 1];
    if (!b) return [a];
    const samples = Math.ceil((b[0] - a[0]) / (a[0] >= 17.5 ? .85 : 2.5));
    return Array.from({ length: samples }, (_, index) => index === 0 ? a
      : entryProfile(frame, a[0] + (b[0] - a[0]) * index / samples));
  });
  // The archived ground is coarsely triangulated. Match its remaining slope
  // in the inner courts after the local cut, keeping painted lines and curbs
  // on the same subdivided section instead of placing flat ribbons over grass.
  const bases = new Map<string, number>();
  const surface = (station: EntryStation, lateral: number, height: number, drape: boolean): XYZ => {
    const point = entryAt(frame, station[0], lateral);
    let y = station[1];
    if (drape && station[0] >= 17.5) {
      const key = `${station[0]}:${lateral}`;
      let base = bases.get(key);
      if (base === undefined) {
        base = Math.max(y, terrainAt(model, point, y - .09) + .095);
        bases.set(key, base);
      }
      y += (base - y) * smoothStep((station[0] - 17.5) / 2.4);
    }
    return groundPoint(point, y + height);
  };
  const horizontal = (finish: Finish, a: EntryStation, b: EntryStation, l0: number, r0: number,
    l1: number, r1: number, height: number, drape = false) => batch.quad(finish,
    surface(a, l0, height, drape), surface(a, r0, height, drape),
    surface(b, r1, height, drape), surface(b, l1, height, drape));
  for (let i = 1; i < arc.length; i++) {
    const a = arc[i - 1], b = arc[i];
    // Keep the center seam consistent with the center line in the sloped court.
    const cells = 14;
    const offset = (s: EntryStation, j: number) => s[2] + (j < cells / 2
      ? -s[3] * (1 - j / (cells / 2)) : s[4] * (j / (cells / 2) - 1));
    for (let j = 1; j <= cells; j++) horizontal('asphalt', a, b, offset(a, j - 1), offset(a, j),
      offset(b, j - 1), offset(b, j), 0, true);
    for (const edge of [-1, 1]) {
      const ac = a[2] + (edge < 0 ? -a[3] : a[4]), bc = b[2] + (edge < 0 ? -b[3] : b[4]);
      horizontal('coping', a, b, ac, ac + .17 * edge, bc, bc + .17 * edge, .067, true);
      horizontal('path', a, b, ac + .17 * edge, ac + .91 * edge, bc + .17 * edge, bc + .91 * edge, .038, true);
      const start = entryAt(frame, a[0], ac + .91 * edge), end = entryAt(frame, b[0], bc + .91 * edge);
      const topStart = surface(a, ac + .91 * edge, .038, true), topEnd = surface(b, bc + .91 * edge, .038, true);
      batch.quad('stoneInset', groundPoint(start, Math.min(.53, terrainAt(model, start, .49))), topStart,
        topEnd, groundPoint(end, Math.min(.53, terrainAt(model, end, .49))));
    }
    if (a[0] > 10.65 && b[0] < 26) horizontal('roadAmber', a, b, a[2] - .057, a[2] + .057, b[2] - .057, b[2] + .057, .024, true);
  }
  const a = entryProfile(frame, 7.48), b = entryProfile(frame, 9.0);
  for (let i = -4; i < 5; i++) horizontal('roadPaint', a, b,
    a[2] + i * .79 - .22, a[2] + i * .79 + .22, b[2] + i * .79 - .22, b[2] + i * .79 + .22, .025);
}

function entryPortal(batch: SurfaceBatch, frame: EntryFrame, station: number, width: number, major: boolean): void {
  const [, base, center] = entryProfile(frame, station);
  const at = (x: number, z: number): XZ => entryAt(frame, station + z, center + x);
  const post = width / 2;
  const roof = base + (major ? 4.45 : 3.87);
  for (const side of [-1, 1]) {
    const h = side > 0 && major ? roof + 1.48 : roof + .14;
    const x = side * post;
    batch.prism('door', 'zinc', rectangular(at, x - .43, -.62, x + .43, .77), .47, h);
    if (side > 0 && major) batch.prism('zinc', 'door', rectangular(at, x - .28, -.67, x + .10, -.59), base + .29, h - .18);
  }
  batch.prism('coping', 'coping', rectangular(at, -post - .72, -.80, post + .84, .83), roof -.39, roof + .12);
  if (major) batch.prism('limestone', 'coping', rectangular(at, -post + .8, -.88, post - .66, .78), roof + .11, roof + .22);
  batch.wall('stoneInset', at(-1.02, -.809), at(1.02, -.809), roof -.24, roof -.14);
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
  removeBakedFacilityProxy(model, plan(388, 479), 49, 13.6, 6.4);
}

function removeBakedFacilityProxy(model: Object3D, center: XZ, angleDegrees: number, halfW: number, halfD: number): void {
  const [x, z] = center;
  const angle = angleDegrees * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const insideProxy = (p: Vector3): boolean => {
    const dx = p.x - x, dz = p.z - z;
    return Math.abs(dx * cos - dz * sin) <= halfW
      && Math.abs(dx * sin + dz * cos) <= halfD;
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
  const longSide: XZ = [Math.cos(angle), -Math.sin(angle)];
  const southFace: XZ = [Math.sin(angle), Math.cos(angle)];
  const halfWidth = 53 * .52 / 2, halfDepth = 30 * .52 / 2;
  original.traverse(object => {
    if (!isMesh(object)) return;
    const name = finishName(object);
    if (/Gable_Cladding|Deep_Frames/.test(name)) object.visible = false;
    if (/Amenity_Limestone/.test(name)) {
      // Suppress only the old south-side flat canopy. The solid stone body
      // behind it and the complete two-floor roof remain as baked.
      keepTriangles(object, (...points) => !points.every(p => {
        const x = p.x - mid[0], z = p.z - mid[1];
        const depth = x * southFace[0] + z * southFace[1];
        const along = x * longSide[0] + z * longSide[1];
        return p.y >= 4.60 && p.y <= 4.94 && depth >= 5.42 && depth <= 11.82
          && along >= -7.22 && along <= -3.24;
      }));
    }
  });
  const group = new Group();
  group.name = DAYCARE;
  group.userData.castsSiteShadow = true;
  const batch = new SurfaceBatch();
  // In north-up coordinates X is east and Z is south. Chamfer the junction
  // into the diagonal limestone body, but set the entry/front span along
  // north–south so the actual threshold faces +X, not the old south wing.
  const east = add(add(mid, longSide, halfWidth), southFace, halfDepth);
  const at = (offset: number, depth: number): XZ => [east[0] + depth, east[1] + offset];
  const rear = (offset: number): number => Math.min(
    -offset * longSide[1] / longSide[0], -offset * southFace[1] / southFace[0],
  ) - .24;
  const center = 0, x0 = -3.10, x1 = 3.10;
  const front = 2.74, eave = 5.22, ridge = 6.63;
  const sill = terrainAt(model, mid, 1.63) + .27;
  const level = (x: number): number => eave + (ridge - eave) * (1 - Math.abs(x) / x1);
  const landing: XZ[] = [at(x0 - .18, rear(x0 - .18)), at(center, rear(center)), at(x1 + .18, rear(x1 + .18)),
    at(x1 + .18, front + .21), at(x0 - .18, front + .21)];
  batch.prism('limestone', 'path', landing, sill - .28, sill);
  // The existing graded promenade skirts the toddler playground. Tie into
  // that promenade without putting a separate path through the play surface.
  const pathEnd = plan(467, 574);
  const promenade = model.getObjectByName('SM_Graded_Pedestrian_Routes');
  const down = new Raycaster(new Vector3(pathEnd[0], 25, pathEnd[1]), new Vector3(0, -1, 0));
  const join = (promenade && down.intersectObject(promenade, true)[0]?.point.y)
    || terrainAt(model, pathEnd, sill) + .13;
  const walk: { center: XZ; half: number; y: number }[] = [
    {center: at(0, front + .20), half: 1.45, y: sill + .008},
    {center: mix(at(0, front + .20), pathEnd, .52), half: 1.22, y: (sill + join) * .5 + .009},
    {center: pathEnd, half: 1.38, y: join - .008},
  ];
  for (let i = 1; i < walk.length; i++) {
    const a = walk[i - 1], b = walk[i];
    batch.quad('path', groundPoint(add(a.center, [0, -1], a.half), a.y),
      groundPoint(add(a.center, [0, 1], a.half), a.y), groundPoint(add(b.center, [0, 1], b.half), b.y),
      groundPoint(add(b.center, [0, -1], b.half), b.y));
  }
  for (const x of [x0, x1]) batch.wall('zinc', at(x, rear(x)), at(x, front), sill, eave);
  const portalLeft = -1.43, portalRight = 1.43, lintel = sill + 2.38;
  batch.wall('zinc', at(x0, front), at(portalLeft, front), sill, eave);
  batch.wall('zinc', at(portalRight, front), at(x1, front), sill, eave);
  batch.wall('zinc', at(portalLeft, front), at(portalRight, front), lintel, eave);
  batch.tri('zinc', groundPoint(at(x0, front), eave),
    groundPoint(at(center, front), ridge), groundPoint(at(x1, front), eave));
  for (const [a, b] of [[x0, center], [center, x1]]) {
    batch.quad('zinc', groundPoint(at(a, rear(a) - .13), level(a) + .072),
      groundPoint(at(a, front + .19), level(a) + .072),
      groundPoint(at(b, front + .19), level(b) + .072),
      groundPoint(at(b, rear(b) - .13), level(b) + .072));
    batch.quad('door', groundPoint(at(a, front + .19), level(a) - .05),
      groundPoint(at(b, front + .19), level(b) - .05), groundPoint(at(b, front + .19), level(b) + .09),
      groundPoint(at(a, front + .19), level(a) + .09));
  }
  // Dark reveals and retained glass outline are visible at ground level.
  for (const jamb of [portalLeft, portalRight]) {
    batch.wall('door', at(jamb, front - .64), at(jamb, front), sill, lintel);
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

function mainUpperEntry(model: Object3D): void {
  const baked = model.getObjectByName('SM_Northwest_Entry_Portals_And_Guardhouses');
  if (baked) baked.visible = false;
  // P4 shows dark, open paving behind the gate; the earlier interpretation
  // put an enclosed glazed "club" over both the entry and turnaround.
  removeBakedFacilityProxy(model, plan(333, 236), 81, 12.45, 8.15);
  // The named primitives are solely the former 110 approach. Keep the
  // arterial, stream, public trails and 105 parking ramp in their original batches.
  for (const name of ['SM_Parcels_Roads_And_Stream', 'SM_East_West_Retaining_And_Main_Gate_Break']) {
    model.getObjectByName(name)?.traverse(node => {
      if (isMesh(node) && /^(?:MAT_Perimeter_Road|MAT_Promenade_Paver_Coping)$/.test(finishName(node))) node.visible = false;
    });
  }
  cutForEntry(model, upperMainFrame);
  const group = new Group();
  group.name = UPPER_MAIN;
  group.userData.castsSiteShadow = true;
  const batch = new SurfaceBatch();
  paveEntry(batch, model, upperMainFrame);
  entryPortal(batch, upperMainFrame, 14.15, 8.45, true);
  // The old cut left a hole in the street's raised sidewalk. A short strip
  // restores continuity south of the relocated throat without touching the lanes.
  const a = plan(355.4, 260.0), b = plan(354.8, 279.2);
  batch.strip('path', a, b, 1.28, .584);
  batch.strip('coping', add(a, [1, 0], .70), add(b, [1, 0], .70), .16, .619);
  const approachDepth = 31.5;
  const mouth = entryAt(upperMainFrame, approachDepth, 3.3);
  const turn = [mouth, mix(mouth, plan(311, 243.5), .5), plan(311, 243.5), plan(308, 249.5)] as const;
  const turnY = turn.map((point, index) => index === 0 ? entryProfile(upperMainFrame, approachDepth)[1] + .07
    : terrainAt(model, point, 2.13) + .10);
  const turnNorm = (index: number): XZ => {
    const axis = unit(turn[Math.max(0, index - 1)], turn[Math.min(turn.length - 1, index + 1)]);
    return [axis[1], -axis[0]];
  };
  for (let i = 1; i < turn.length; i++) {
    const c = turn[i], j = turn[i - 1], n0 = turnNorm(i - 1), n1 = turnNorm(i);
    batch.quad('path', groundPoint(add(j, n0, .84), turnY[i - 1]), groundPoint(add(j, n0, -.84), turnY[i - 1]),
      groundPoint(add(c, n1, -.84), turnY[i]), groundPoint(add(c, n1, .84), turnY[i]));
  }
  batch.attachTo(group);
  model.add(group);
}

/** A surface site entrance beside 109, not a second copy of the 105 underground parking canopy. */
function upperOpenEntry(model: Object3D): void {
  const oldRamp = model.getObjectByName('SM_Seam_North_Covered_Parking_Ramp');
  if (oldRamp) oldRamp.visible = false;
  cutForEntry(model, upperAuxFrame);
  const group = new Group();
  group.name = DRIVE;
  group.userData.castsSiteShadow = true;
  const batch = new SurfaceBatch();
  paveEntry(batch, model, upperAuxFrame);
  entryPortal(batch, upperAuxFrame, 10.25, 7.65, false);
  // Crescent-shaped planted shoulder, following the gray turnout around it.
  const island = [[8.4,-3.51],[10.7,-3.81],[13.55,-3.94],[16.3,-3.42],[19.0,-3.13],[21.65,-3.39],
    [20.95,-4.5],[17.8,-5.52],[14.2,-5.64],[11.03,-4.96]].map(([d, x]) => entryAt(upperAuxFrame, d, x));
  batch.prism('limestone', 'roofLawn', island, .55, 1.57);
  // The driveway curves back towards the west terrace. The last light
  // section connects to the pedestrian path; do not pave into 109's pad.
  const lead = entryAt(upperAuxFrame, 23.0, 2.0);
  const walk = [[lead, 1.56, 2.7],[plan(429.0,449), 1.84, 2.35],[plan(424,445), 2.29, 2.14],
    [plan(421,440), 2.91, 1.60],[plan(417.5,433), 3.80, 1.24],[plan(412.5,425.0), 5.04, 1.15]] as const;
  lowerEntryGround(model, position => {
    let cap: number | null = null;
    for (let i = 1; i < walk.length; i++) {
      const [a, y0, w0] = walk[i-1], [b, y1, w1] = walk[i];
      const len = Math.hypot(b[0]-a[0],b[1]-a[1]);
      const [dx,dz] = unit(a,b);
      const t = Math.min(1,Math.max(0,((position[0]-a[0])*dx+(position[1]-a[1])*dz)/len));
      const mid = mix(a,b,t);
      const offset = Math.hypot(position[0]-mid[0],position[1]-mid[1]) - (w0 + (w1-w0)*t);
      if (offset > 3.4) continue;
      const height = y0 + (y1-y0)*t - .05 + 5.8*smoothStep(offset/3.4);
      cap = cap === null ? height : Math.min(cap,height);
    }
    return cap;
  });
  for (let i = 1; i < walk.length; i++) {
    const [a,h0,w0] = walk[i-1], [b,h1,w1] = walk[i];
    const y0 = i <= 3 ? h0 : Math.max(h0, terrainAt(model, a, h0) + .07);
    const y1 = i < 3 ? h1 : Math.max(h1, terrainAt(model, b, h1) + .07);
    const norm = (pointIndex: number): XZ => {
      const left = walk[Math.max(0,pointIndex-1)][0], right = walk[Math.min(walk.length-1,pointIndex+1)][0];
      const tangent = unit(left,right);
      return [tangent[1],-tangent[0]];
    };
    const n0 = norm(i-1), n1=norm(i);
    batch.quad(i <= 3 ? 'asphalt' : 'path', groundPoint(add(a,n0,w0),y0), groundPoint(add(a,n0,-w0),y0),
      groundPoint(add(b,n1,-w1),y1), groundPoint(add(b,n1,w1),y1));
    for (const s of [-1,1]) {
      const p = add(a,n0,w0*s), q=add(b,n1,w1*s);
      batch.quad('limestone', groundPoint(p,y0-.24), groundPoint(p,y0+.035), groundPoint(q,y1+.035), groundPoint(q,y1-.24));
    }
  }
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
  const group = new Group();
  group.name = GUARD;
  group.userData.castsSiteShadow = true;
  const batch = new SurfaceBatch();
  for (const [id, axis, preferred] of [
    ['security-109', [.715, -.699], 1.23], // parallel to the two-block park seam, not to the public street.
    ['security-110', [-.195, .981], null],
  ] as const) {
    const security = SITE_FACILITIES.find(item => item.id === id);
    if (!security) continue;
    const mid: XZ = [security.x, security.z];
    const cross: XZ = [-axis[1], axis[0]];
    const at = (x: number, z: number): XZ => add(add(mid, axis, x), cross, z);
    if (preferred !== null) lowerEntryGround(model, position => {
      const dx = position[0] - mid[0], dz = position[1] - mid[1];
      const distance = Math.hypot(dx, dz);
      return distance < 5.95 ? preferred - .08 + 7 * smoothStep((distance - 2.5) / 3.45) : null;
    });
    const base = preferred ?? terrainAt(model, mid, .65);
    const body = rectangular(at, -1.68, -1.27, 1.68, 1.27);
    batch.prism('stoneInset', 'path', rectangular(at, -2.30, -1.88, 2.30, 1.88), Math.min(.52, base - .40), base + .08);
    batch.prism('limestone', 'limestone', body, base + .08, base + 2.23);
    for (const [a, b] of [
      [at(-1.69, -1.05), at(-1.69, 1.05)], [at(1.69, -1.05), at(1.69, 1.05)],
      [at(-1.44, -1.28), at(1.44, -1.28)], [at(-1.44, 1.28), at(1.44, 1.28)],
    ]) batch.wall('facadeGlass', a, b, base + 1.0, base + 1.74);
    batch.wall('door', at(-.61, 1.288), at(.07, 1.288), base + .09, base + 1.68);
    batch.prism('zinc', 'limestone', rectangular(at, -1.89, -1.48, 1.89, 1.48), base + 2.16, base + 2.36);
  }
  batch.attachTo(group);
  model.add(group);
}

function rebuildSeamPark(model: Object3D): void {
  // This whole strip is parkland: the road runs along its east edge and the
  // stream bounds its west end. Trace both parcel edges rather than repeating
  // the original isolated green rectangle.
  const outline = [[467.9,446.5],[494,463],[498.5,465.2],[504,471.7],[507,475.2],[489,483],[482,489],
    [451,515],[404,556],[376,583],[372.5,602],
    [352,617],[340,594],[326,569],[312,546],[327,544],[348,539.4],[365,545],[377,535],
    [408,506],[439,478]].map(([x,z]) => plan(x,z));
  const group = new Group();
  group.name = SEAM_PARK;
  const batch = new SurfaceBatch();
  const polygon = outline.map(([x,z]) => new Vector2(x,z));
  const swell = (point: XZ): number => {
    const distance = Math.hypot((point[0] + 36) / 43, (point[1] - 2) / 38);
    return .56 + .53 * smoothStep(1 - distance);
  };
  for (const [ia, ib, ic] of ShapeUtils.triangulateShape(polygon, [])) {
    const a = outline[ia], b = outline[ib], c = outline[ic];
    const upwards = (b[1] - a[1]) * (c[0] - a[0]) > (b[0] - a[0]) * (c[1] - a[1]);
    const mid: XZ = [(a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3];
    const corners = upwards ? [a,b,c] : [a,c,b];
    for (let i = 0; i < 3; i++) {
      const p = corners[i], q = corners[(i+1)%3];
      batch.tri('roofLawn', groundPoint(p, swell(p)), groundPoint(q, swell(q)), groundPoint(mid, swell(mid)));
    }
  }
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i+1)%outline.length];
    batch.quad('hedge', groundPoint(a, -1.39), groundPoint(a, swell(a)), groundPoint(b, swell(b)), groundPoint(b, -1.39));
  }
  // Two irregular low planting bands, set inward so no trees are scattered
  // across the entry line or extend above the separated parcel retaining walls.
  for (const [start, end, count] of [[plan(421,518),plan(365,569),18], [plan(401,526),plan(338,579),19]] as const) {
    for (let i = 0; i < count; i++) {
      const p = add(mix(start, end, i/count), [1,.54], Math.sin(i*1.8)*1.2);
      if (!polygonContains(p, outline)) continue;
      const y = swell(p) + .04, r = .38 + (i%3) * .16;
      for (let q = 0; q < 6; q++) {
        const a = add(p, [Math.sin(q*Math.PI/3),Math.cos(q*Math.PI/3)], r);
        const b = add(p, [Math.sin((q+1)*Math.PI/3),Math.cos((q+1)*Math.PI/3)], r);
        batch.tri(i%2 ? 'roofLawn' : 'hedge', groundPoint(a,y), groundPoint(b,y), groundPoint(p,y + r*.76));
      }
    }
  }
  batch.attachTo(group);
  model.add(group);
}

function rebuildUpperRetail(model: Object3D): void {
  // The plan separates commercial strip 3 from Community II by a divider.
  // Preserve that notch, and keep its pale coping continuous with the podium.
  const outline = [[393.0,442.2],[405.0,429.8],[426.5,455.7],[415.1,470.0]]
    .map(([x,z]) => plan(x,z));
  const group = new Group();
  group.name = RETAIL;
  group.userData.castsSiteShadow = true;
  const batch = new SurfaceBatch();
  steppedTerrace(batch, outline, 7.58, 2.35);
  batch.attachTo(group);
  model.add(group);
}

/** Idempotent overlay for the checked-in v9 model. All children are owned by the viewer's model lifecycle. */
export function refineFacilityExteriors(model: Object3D): void {
  if (model.getObjectByName(FACADE)) return;
  model.updateMatrixWorld(true);
  communityExteriors(model);
  daycareEntrance(model);
  mainUpperEntry(model);
  upperOpenEntry(model);
  missingGuardhouse(model);
  rebuildSeamPark(model);
  rebuildUpperRetail(model);
  model.updateMatrixWorld(true);
}
