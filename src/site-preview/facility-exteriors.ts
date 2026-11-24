import {
  BufferGeometry, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial,
  Raycaster, ShapeUtils, Vector2, Vector3,
  type Object3D,
} from 'three';
import { SITE_FACILITIES } from './facility-markers';
import { MAIN_GATE_101 } from './facility-gate101-layout';
import { DAYCARE_ENTRY_FRONTAGE, DAYCARE_ENTRY_OUTWARD } from './facility-daycare-placement';
import { CAFE_PLAN, COMMUNITY_PROMENADE, PARK_PATHS, SUPERSEDED_WALK_SECTIONS } from './site-promenade-layout';
import { refineBrochureGround } from './facility-brochure-ground';

type XZ = readonly [number, number];
type XYZ = readonly [number, number, number];

const COLORS = {
  limestone: '#b2a895', coping: '#dbd1b9', stoneInset: '#847b6d', stoneJoint: '#7b766c',
  facadeGlass: '#28353a', facadeSash: '#454744', windowGlint: '#687778',
  roofLawn: '#8c9561', siteGrass: '#8a9f76', hedge: '#617546', path: '#b9ada0', deck: '#a47e5f',
  zinc: '#64615a', seams: '#827b6c', door: '#303433', entranceGlass: '#536261',
  asphalt: '#494d4e', roadPaint: '#e6e0c9', roadAmber: '#bca464',
  courtStone: '#cec3af', courtGlass: '#3a3e39', courtGlassShade: '#2c302f',
  courtFrame: '#676259', courtDeck: '#aa805f', courtDeckJoint: '#8a684f', courtPaver: '#b69f87',
  promenadeStone: '#bdb2a0', promenadeBand: '#716d64', promenadeTrim: '#e0d7c4',
  cafeGlass: '#62746f', cafeGlassLow: '#435651',
} as const;
type Finish = keyof typeof COLORS;

const FACADE = 'SM_Rebuilt_Community_Terraces';
const DAYCARE = 'SM_Rebuilt_Daycare_Pavilion';
const DRIVE = 'SM_Rebuilt_Upper_Open_Entry';
const GUARD = 'SM_Rebuilt_Upper_Guardhouse';
const UPPER_MAIN = 'SM_Rebuilt_Upper_Main_Entry';
const SEAM_PARK = 'SM_Rebuilt_Seam_Park';
const RETAIL = 'SM_Rebuilt_Upper_Retail_Frontage';
const PROMENADE = 'SM_Rebuilt_South_Promenades';
const CAFE = 'SM_Rebuilt_DeForet_Cafe';
const EPSILON = 1e-4;
const COMMUNITY_TWO_ROOF = 7.72;
const UPPER_RETAIL_ROOF = 7.58;
const PODIUM_VISIBLE_FLOOR = 3.05; // Same single-storey exposure as Community I.
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
      const cafeGlass = finish === 'cafeGlass' || finish === 'cafeGlassLow';
      const glass = cafeGlass || finish === 'facadeGlass' || finish === 'entranceGlass'
        || finish === 'courtGlass' || finish === 'courtGlassShade';
      const material = new MeshStandardMaterial({
        color: COLORS[finish], roughness: glass ? 0.42 : 0.92, metalness: glass ? 0.18 : 0,
        side: DoubleSide, ...(cafeGlass ? { emissive: COLORS[finish], emissiveIntensity: .14 } : {}),
      });
      material.name = `MAT_Rebuilt_${finish}`;
      const mesh = new Mesh(geometry, material);
      mesh.name = `${group.name}_${finish}`;
      // Lower or vertical detail doesn't create an artificial floor at roof height.
      mesh.userData.siteSurface = ['roofLawn', 'siteGrass', 'coping', 'asphalt', 'path', 'courtPaver'].includes(finish);
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
    [4.25, .59, 0, 5.55, 5.55], [7.25, .61, -.10, 4.60, 4.60], [11.4, .58, -.30, 4.45, 4.45],
    [14.8, .54, -.40, 4.35, 4.65], [17.5, .38, 0, 4.64, 4.70], [22.6, -.23, .30, 4.36, 4.60],
    [27.1, -.85, .94, 4.28, 4.42], [31.6, -1.41, 1.43, 4.24, 4.28],
  ],
};
const upperAuxFrame: EntryFrame = {
  origin: plan(454.8202, 421.2464), inward: [-.588649, .808389], across: [.808389, .588649],
  stations: [
    [4.34, .58, 0, 5.6, 5.7], [7.55, .63, 1.05, 4.0, 5.45], [10.7, .84, 2.15, 3.4, 5.55],
    [14.5, 1.02, 2.25, 3.25, 8.2], [18.7, 1.14, 1.9, 3.35, 7.4], [20.9, 1.19, 1.75, 3.30, 3.30],
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
function paveEntry(batch: SurfaceBatch, model: Object3D, frame: EntryFrame, drapeOnSlope = true): void {
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
    if (drapeOnSlope && drape && station[0] >= 17.5) {
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

const communityTwoGlazedEdges = [2, 3, 4, 5, 6, 7, 8, 9];
const retailGlazedEdges = [1, 2];
const upperRetailOutline: readonly XZ[] = [[393.0,442.2],[405.0,429.8],[426.5,455.7],[415.1,470.0]]
  .map(([x,z]) => plan(x,z));
const upperPodiumWalk = [[290,410], [298,422], [320,459], [342,493], [358,517],
  [368,523], [377,520], [390,511], [416,488], [430,474], [432,466]]
  .map(([x, z]) => plan(x, z));

function podiumFrontage(outline: readonly XZ[], edges: readonly number[], roof: number) {
  const orientation = Math.sign(outline.reduce((area, a, i) => {
    const b = outline[(i + 1) % outline.length];
    return area + a[0] * b[1] - b[0] * a[1];
  }, 0)) || 1;
  return edges.map(i => {
    const a = outline[i], b = outline[(i + 1) % outline.length], axis = unit(a, b);
    return { a, axis, outward: [axis[1] * orientation, -axis[0] * orientation] as XZ,
      length: Math.hypot(b[0] - a[0], b[1] - a[1]), floor: roof - PODIUM_VISIBLE_FLOOR };
  });
}

function levelUpperPodiumFrontage(model: Object3D, outline: readonly XZ[]) {
  const frontage = [...podiumFrontage(outline, communityTwoGlazedEdges, COMMUNITY_TWO_ROOF),
    ...podiumFrontage(upperRetailOutline, retailGlazedEdges, UPPER_RETAIL_ROOF)];
  const route = roundedRoute(upperPodiumWalk);
  const stations = [0];
  for (let i = 1; i < route.length; i++) {
    stations.push(stations[i - 1] + Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]));
  }
  const total = stations.at(-1)!;
  const level = COMMUNITY_TWO_ROOF - PODIUM_VISIBLE_FLOOR;
  const endGrade = terrainAt(model, route.at(-1)!, UPPER_RETAIL_ROOF - PODIUM_VISIBLE_FLOOR) + .16;
  const startGrade = terrainAt(model, route[0], level) + .18;
  const pavingY = (station: number) => level + (startGrade - level) * (1 - smoothStep(station / 4.9))
    + (endGrade - level) * smoothStep((station - total + 14.1) / 14.1);
  const segments = route.slice(1).map((b, i) => ({ a: route[i], axis: unit(route[i], b), station: stations[i],
    length: stations[i + 1] - stations[i] }));
  const bounds = { xMin: Math.min(...route.map(p => p[0])) - 7, xMax: Math.max(...route.map(p => p[0])) + 7,
    zMin: Math.min(...route.map(p => p[1])) - 7, zMax: Math.max(...route.map(p => p[1])) + 7 };
  const nearest = (x: number, z: number) => {
    let distance = Infinity, station = 0;
    if (x < bounds.xMin || x > bounds.xMax || z < bounds.zMin || z > bounds.zMax) return { distance, station };
    for (const { a, axis, station: start, length } of segments) {
      const dx = x - a[0], dz = z - a[1];
      const t = Math.min(length, Math.max(0, dx * axis[0] + dz * axis[1]));
      const d = (dx - t * axis[0]) ** 2 + (dz - t * axis[1]) ** 2;
      if (d < distance) {
        distance = d;
        station = start + t;
      }
    }
    return { distance: Math.sqrt(distance), station };
  };
  // Set the low street face independently from the tower pad. Only the visible
  // wing and its path are cut back; the surrounding grade and roof stay put.
  const floorLimit = (p: XZ): number => {
    let allowed = Infinity;
    for (const { a, axis, outward, length, floor } of frontage) {
      const dx = p[0] - a[0], dz = p[1] - a[1];
      const along = dx * axis[0] + dz * axis[1];
      const out = dx * outward[0] + dz * outward[1];
      const beyond = Math.max(0, -along, along - length);
      const distance = Math.hypot(beyond, Math.max(0, out - 7, -out - 1.20));
      if (distance >= 7 || out < -3.05) continue;
      // Rejoin the hillside miter at the wall ends; don't pull down either
      // the inside of the park roof or the artery at the foot of the ramp.
      const fade = Math.max(smoothStep(distance / 7), smoothStep((-out - 1.2) / 1.85));
      allowed = Math.min(allowed, floor - .16 + 5.25 * fade);
    }
    return allowed;
  };
  const lower = (v: Vector3): number => {
    const capped = Math.min(v.y, floorLimit([v.x, v.z]));
    const { distance, station } = nearest(v.x, v.z);
    const weight = (1 - smoothStep((distance - 2.65) / 3.4))
      * smoothStep(station / 4.2) * smoothStep((total - station) / 4.2);
    return v.y - (capped + (pavingY(station) - .105 - capped) * weight);
  };
  const point = new Vector3(), inverse = new Matrix4();
  const moveVertices = (mesh: Mesh, shift: (p: Vector3) => number) => {
    const position = mesh.geometry.getAttribute('position');
    inverse.copy(mesh.matrixWorld).invert();
    let changed = false;
    for (let index = 0; index < position.count; index++) {
      point.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
      const dy = shift(point);
      if (Math.abs(dy) < EPSILON) continue;
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

  // The two historical routes share this arc. Remove both facelift sections
  // before putting the centreline down once, rather than lowering two skins.
  const withinRebuiltWalk = (p: Vector3) => {
    const { distance, station } = nearest(p.x, p.z);
    return distance < 3.5 && station > .02 && station < total - .02;
  };
  const midpoint = new Vector3();
  model.getObjectByName('SM_Graded_Pedestrian_Routes')?.traverse(node => {
    if (!isMesh(node)) return;
    keepTriangles(node, (a, b, c) => !withinRebuiltWalk(midpoint.copy(a).add(b).add(c).multiplyScalar(1/3)));
    moveVertices(node, p => {
      const limit = floorLimit([p.x, p.z]);
      return p.y > limit ? Math.max(0, p.y - terrainAt(model, [p.x, p.z], p.y) - .105) : 0;
    });
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
      if (Math.abs(dy) < EPSILON) continue;
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
  return route.map((p, i) => ({ position: p, y: pavingY(stations[i]) }));
}

function steppedTerrace(batch: SurfaceBatch, outline: readonly XZ[], top: number, gradeLow: number,
  glazedEdges: readonly number[]): void {
  const twiceArea = outline.reduce((sum, a, i) => {
    const b = outline[(i + 1) % outline.length];
    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0);
  const orientation = Math.sign(twiceArea) || 1;
  batch.prism('courtStone', 'roofLawn', outline, gradeLow, top);
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
    if (!glazedEdges.includes(i)) continue;
    const bays = Math.max(1, Math.round(length / 4.75));
    const floor = top - PODIUM_VISIBLE_FLOOR;
    for (let j = 0; j < bays; j++) {
      const u = (j + 0.5) / bays;
      const half = Math.max(.08, 0.5 / bays - .27 / length);
      const starting = mix(a, b, u - half), ending = mix(a, b, u + half);
      const frontA = add(starting, outward, 0.035), frontB = add(ending, outward, 0.035);
      batch.wall('courtGlassShade', frontA, frontB, floor + .12, top - .45);
      const glassHalf = Math.max(.03, half - .16 / length);
      batch.wall('courtGlass', add(mix(a, b, u - glassHalf), outward, 0.047),
        add(mix(a, b, u + glassHalf), outward, 0.047), floor + .17, top - .94);
      if (length / bays > 2.2) {
        for (const offset of [-glassHalf / 3, glassHalf / 3]) {
          const sashA = add(mix(a, b, u + offset - .033 / length), outward, .057);
          const sashB = add(mix(a, b, u + offset + .033 / length), outward, .057);
          batch.wall('courtFrame', sashA, sashB, floor + .15, top - .94);
        }
        const x = j * length / bays;
        const at = (l: number, d: number) => add(add(a, [dx, dz], l), outward, d);
        batch.prism('courtStone', 'courtStone', rectangular(at, Math.max(0, x - .19), -.055, x + .23, .15),
          floor - .04, top - .33);
      }
    }
  }
}

/** The two approved lift locations stay put; only their square enclosures change. */
const COMMUNITY_ONE_LIFTS = [
  { center: plan(554, 669), facing: 4, width: 4.12, depth: 3.66, rise: 2.65 },
  { center: plan(641, 638), facing: 1, width: 3.32, depth: 3.03, rise: 2.34 },
] as const;

function communityOneLift(batch: SurfaceBatch, outline: readonly XZ[], lift: typeof COMMUNITY_ONE_LIFTS[number], low: number, roof: number): void {
  const direction = unit(outline[lift.facing], outline[lift.facing + 1]);
  const outward: XZ = [direction[1], -direction[0]];
  const at = (x: number, depth: number): XZ => add(add(lift.center, direction, x), outward, depth);
  const w = lift.width / 2, d = lift.depth / 2, top = roof + lift.rise;
  batch.prism('courtStone', 'coping', rectangular(at, -w, -d, w, d), low, top);
  batch.plate('courtDeck', rectangular(at, -w + .13, -d + .13, w - .13, d - .13), top + .012);
  batch.plate('courtGlassShade', rectangular(at, -w + .28, -d + .3, -w + 1.61, -d + 1.39), top + .026);
  // The nearly full-height dark panel on the park side is the lift tower's visual cue.
  const lowerGlassWidth = w * .54;
  batch.wall('courtGlassShade', at(-lowerGlassWidth, d + .021), at(lowerGlassWidth, d + .021), low + .07, top - .40);
  batch.wall('courtGlass', at(-lowerGlassWidth + .18, d + .031), at(lowerGlassWidth - .18, d + .031), low + .08, low + 2.09);
  batch.wall('courtFrame', at(-.036, d + .04), at(.036, d + .04), low + .08, top - .40);
  batch.wall('courtGlassShade', at(-.71, -d - .021), at(.71, -d - .021), roof + .035, top - .34);
}

function communityOneRoofRectangle(batch: SurfaceBatch, outline: readonly XZ[], center: XZ, direction: XZ, width: number, depth: number, roof: number, deck = false): void {
  const normal: XZ = [-direction[1], direction[0]];
  const at = (x: number, z: number): XZ => add(add(center, direction, x), normal, z);
  const w = width / 2, d = depth / 2;
  const patch = rectangular(at, -w, -d, w, d);
  if (!patch.every(p => polygonContains(p, outline))) return;
  if (deck) {
    batch.plate('courtDeck', patch, roof + .035);
    for (let x = -w + .34; x < w; x += .44) batch.strip('courtDeckJoint', at(x, -d), at(x, d), .022, roof + .045);
  } else {
    batch.prism('courtStone', 'hedge', patch, roof + .014, roof + .22);
    for (let x = -w + .45; x < w - .23; x += .79) {
      const canopy = at(x, 0);
      const perimeter = Array.from({ length: 6 }, (_, i) => {
        const a = i * Math.PI / 3;
        return at(x + .39 * Math.cos(a), .37 * Math.sin(a));
      });
      for (let i = 0; i < perimeter.length; i++) batch.tri(i % 3 ? 'hedge' : 'roofLawn',
        groundPoint(perimeter[i], roof + .22), groundPoint(perimeter[(i + 1) % perimeter.length], roof + .22),
        groundPoint(canopy, roof + .61 + .09 * Math.cos(x * 3)));
    }
  }
}

function communityOnePavers(batch: SurfaceBatch, model: Object3D, points: readonly XZ[], width: number, low: number): void {
  // No bridge, ramp, or stair connects the top here. These walks follow the existing lower garden grade.
  const sections = points.map((p, i) => {
    const [dx, dz] = unit(points[Math.max(0, i - 1)], points[Math.min(points.length - 1, i + 1)]);
    const across: XZ = [dz, -dx];
    const y = terrainAt(model, p, low) + .046;
    return [groundPoint(add(p, across, -width / 2), y), groundPoint(add(p, across, width / 2), y)] as const;
  });
  for (let i = 1; i < sections.length; i++) {
    const [a, b] = sections[i - 1], [d, c] = sections[i];
    batch.quad('courtPaver', a, b, c, d);
    const length = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    const rows = Math.ceil(length / .85);
    const along = (from: XYZ, to: XYZ, t: number): XYZ => [from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t + .009, from[2] + (to[2] - from[2]) * t];
    for (let row = 1; row < rows; row++) {
      const t = row / rows;
      batch.quad('path', along(a, d, t), along(b, c, t), along(b, c, t + .022 / length), along(a, d, t + .022 / length));
    }
  }
}

function communityOneExterior(batch: SurfaceBatch, model: Object3D, outline: readonly XZ[], roof: number, low: number): void {
  // The red outline in the site plan fixes the two legs. The model-house photo
  // and PDF park view inform the pavilion bays, dark lift and planted/deck areas.
  batch.prism('courtStone', 'roofLawn', outline, low, roof);
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    const forward = unit(a, b), outward: XZ = [forward[1], -forward[0]];
    const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const at = (x: number, depth: number): XZ => add(add(a, forward, x), outward, depth);
    batch.wall('coping', at(0, .14), at(span, .14), roof - .44, roof + .10);
    batch.strip('coping', at(0, -.03), at(span, -.03), .34, roof + .10);
    if (i !== 1 && i !== 2 && i !== 4) continue;
    // The tall glazed bays are independent panels. Their pale square mullions
    // are physical trim so dark glass never becomes a single continuous stripe.
    const count = Math.round(span / 4.75), step = span / count;
    for (let j = 0; j < count; j++) {
      const left = j * step + .34, right = (j + 1) * step - .34;
      const glassTop = roof - .46, glassLow = low + .12;
      batch.wall(j % 3 === 2 ? 'courtGlass' : 'courtGlassShade', at(left, .025), at(right, .025), glassLow, glassTop);
      batch.wall('courtGlass', at(left, .038), at(right, .038), glassLow + .03, roof - .94);
      for (let k = 1; k < 3; k++) {
        const x = left + (right - left) * k / 3;
        batch.wall('courtFrame', at(x - .038, .05), at(x + .038, .05), glassLow, roof - .94);
      }
      const x = left - .33;
      batch.prism('courtStone', 'courtStone', rectangular(at, Math.max(0, x - .24), -.06, x + .25, .15), low, roof - .35);
    }
    // Subtle metal rails on the park edge. They do not cross the lift enclosure.
    for (let x = .4; x < span - .33; x += 1.06) {
      const p = at(x, -.13);
      if (COMMUNITY_ONE_LIFTS.some(({ center, width }) => Math.hypot(p[0] - center[0], p[1] - center[1]) < width * .65)) continue;
      batch.wall('courtFrame', at(x - .025, -.13), at(x + .025, -.13), roof + .10, roof + .65);
      batch.wall('courtFrame', p, at(Math.min(x + 1.06, span - .25), -.13), roof + .608, roof + .65);
    }
  }
  for (const lift of COMMUNITY_ONE_LIFTS) communityOneLift(batch, outline, lift, low, roof);
  const mainWing = unit(plan(530, 685), plan(620, 605));
  const returnWing = unit(plan(623, 618), plan(687, 687));
  communityOneRoofRectangle(batch, outline, plan(580.5, 635.5), mainWing, 12.25, 4.6, roof, true);
  for (const [center, along, width] of [
    [plan(528, 689), mainWing, 7.5], [plan(564, 651), mainWing, 6.4], [plan(603, 617), mainWing, 6.3],
    [plan(645, 626), returnWing, 9.4], [plan(677, 663), returnWing, 8.1],
  ] as const) communityOneRoofRectangle(batch, outline, center, along, width, 1.07, roof);
  // End at the existing 104 approach; an earlier extension went beyond the
  // junction and surfaced as an isolated paver stub out on the west lawn.
  communityOnePavers(batch, model, [plan(550, 684), plan(572, 668), plan(609, 637)], 1.66, low);
  communityOnePavers(batch, model, [plan(572, 668), plan(583, 675), plan(591, 671)], 1.40, low);
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

type PodiumWalkPoint = { position: XZ; y: number };

function upperPodiumPavers(model: Object3D, route: readonly PodiumWalkPoint[]): void {
  const terrace = model.getObjectByName(`${FACADE}_community-2`);
  if (!(terrace instanceof Group)) return;
  const batch = new SurfaceBatch();
  const seam = model.getObjectByName(`${SEAM_PARK}_siteGrass`);
  const ray = new Raycaster(new Vector3(0, 40, 0), new Vector3(0, -1, 0));
  const groundY = (p: XZ, fallback: number): number => {
    ray.ray.origin.set(p[0], 40, p[1]);
    return Math.max(terrainAt(model, p, fallback), (seam && ray.intersectObject(seam)[0]?.point.y) ?? -Infinity);
  };
  const course = route.flatMap((a, i) => {
    const b = route[i + 1];
    if (!b) return [a];
    const count = Math.ceil(Math.hypot(b.position[0] - a.position[0], b.position[1] - a.position[1]) / .55);
    return Array.from({ length: count }, (_, j) => ({ position: mix(a.position, b.position, j/count), y: a.y + (b.y - a.y) * j/count }));
  });
  const sections = course.map(({ position: p, y }, i) => {
    const [dx, dz] = unit(course[Math.max(0, i - 1)].position, course[Math.min(course.length - 1, i + 1)].position);
    const offsets = [-1.91, -1.79, -1.18, -.59, 0, .59, 1.18, 1.79, 1.91];
    return offsets.map(offset => {
      const edge = add(p, [dz, -dx], offset);
      return groundPoint(edge, Math.max(y, groundY(edge, y - .1) + .10));
    });
  });
  for (let i = 1; i < sections.length; i++) {
    for (let j = 1; j < sections[i].length; j++) {
      const edge = j === 1 || j === sections[i].length - 1;
      batch.quad(edge ? 'coping' : 'courtPaver', sections[i - 1][j - 1], sections[i - 1][j], sections[i][j], sections[i][j - 1]);
    }
    for (const j of [0, sections[i].length - 1]) {
      const [a, b] = [sections[i - 1][j], sections[i][j]];
      const foot = (p: XYZ): XYZ => [p[0], Math.min(p[1] - .035, groundY([p[0], p[2]], p[1] - .05)), p[2]];
      batch.quad('stoneInset', a, foot(a), foot(b), b);
    }
  }
  batch.attachTo(terrace);
}

function communityExteriors(model: Object3D): readonly PodiumWalkPoint[] {
  // Only the Community I baked terrace, lifts and stale detailing are superseded.
  // Hide its meshes individually so visibility-independent terrain probes don’t use old roofs.
  model.getObjectByName('SM_Community_Grade_And_Elevators')?.traverse(object => {
    if (isMesh(object)) object.visible = false;
  });
  removeLegacy109Podium(model);
  const group = new Group();
  group.name = FACADE;
  group.userData.castsSiteShadow = true;
  let podiumWalk: readonly PodiumWalkPoint[] = [];
  // Virtual model levels, not surveyed site elevations: the lower park and the
  // 109 foundation already exist at different elevations in the accepted model.
  for (const [id, roof, low] of [['community-1', 5.08, 2.05], ['community-2', COMMUNITY_TWO_ROOF, .49]] as const) {
    const facility = SITE_FACILITIES.find(item => item.id === id);
    if (facility?.footprint?.surface !== 'terrain') continue;
    const terrace = new Group();
    terrace.name = `${FACADE}_${id}`;
    terrace.userData.castsSiteShadow = true;
    const batch = new SurfaceBatch();
    if (id === 'community-1') communityOneExterior(batch, model, facility.footprint.outline, roof, low);
    else {
      podiumWalk = levelUpperPodiumFrontage(model, facility.footprint.outline);
      steppedTerrace(batch, facility.footprint.outline, roof, low, communityTwoGlazedEdges);
      communityTwoElevator(batch, roof);
    }
    batch.attachTo(terrace);
    group.add(terrace);
  }
  model.add(group);
  return podiumWalk;
}

function daycareTerraceRail(batch: SurfaceBatch, a: XZ, b: XZ, floor: number): void {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const [dx, dz] = unit(a, b), along: XZ = [dx, dz], across: XZ = [-dz, dx];
  const at = (x: number, z: number): XZ => add(add(a, along, x), across, z);
  batch.prism('stoneInset', 'coping', rectangular(at, 0, -.074, length, .074), floor, floor + .116);
  batch.prism('facadeSash', 'coping', rectangular(at, 0, -.047, length, .047), floor + .846, floor + .912);
  const divisions = Math.ceil(length / .27);
  for (let i = 0; i <= divisions; i++) {
    const x = Math.max(.02, Math.min(length - .02, length * i / divisions));
    batch.prism('facadeSash', 'facadeSash', rectangular(at, x - .019, -.022, x + .019, .022), floor + .114, floor + .852);
  }
}

function daycareEntrance(model: Object3D): void {
  const original = model.getObjectByName('SM_Public_Daycare_2F');
  if (!original) return;
  const { centerPlanPx, lengthMeters, widthMeters, wallMidpoint, gableCenterOffsetMeters } = DAYCARE_ENTRY_FRONTAGE;
  const mid = plan(...centerPlanPx);
  const outward: XZ = DAYCARE_ENTRY_OUTWARD;
  const across: XZ = [-outward[1], outward[0]];
  original.traverse(object => {
    if (!isMesh(object)) return;
    const name = finishName(object);
    if (/Gable_Cladding|Deep_Frames/.test(name)) object.visible = false;
    if (/Amenity_Limestone/.test(name)) {
      // Suppress only the old south-side flat canopy. The solid stone body
      // behind it and the complete two-floor roof remain as baked.
      keepTriangles(object, (...points) => !points.every(p => {
        const x = p.x - mid[0], z = p.z - mid[1];
        const depth = x * across[0] + z * across[1];
        const along = x * outward[0] + z * outward[1];
        return p.y >= 4.60 && p.y <= 4.94 && depth >= 5.42 && depth <= 11.82
          && along >= -7.22 && along <= -3.24;
      }));
    }
  });
  const group = new Group();
  group.name = DAYCARE;
  group.userData.castsSiteShadow = true;
  const batch = new SurfaceBatch();
  // The mock-up and P5 show a centered portal on the diagonal body's SHORT
  // end. Use that end's outward normal, not a due-east cut at its corner.
  const at = (offset: number, depth: number): XZ => add(add(wallMidpoint, across, offset), outward, depth);
  const center = gableCenterOffsetMeters, halfGable = 2.54;
  const x0 = center - halfGable, x1 = center + halfGable, shelfHalf = widthMeters / 2 - .17;
  const back = -.18, shelfFront = 2.20, front = 3.54;
  const sill = terrainAt(model, wallMidpoint, 1.63) + .20;
  const shelfTop = sill + 2.80, eave = sill + 2.44, ridge = sill + 3.57;
  const level = (x: number): number => eave + (ridge - eave) * (1 - Math.abs(x - center) / halfGable);
  // The brochure's broad pale upper storey reads as a rectangular masonry
  // grid with separately inset windows, above the contrasting ribbed gable.
  // This is applied to the east frontage only; preserve the baked main roof
  // used as the playable facility marker, and the other three elevations.
  const bodyBase = terrainAt(model, mid, sill - .20) + .17;
  const upperFloor = bodyBase + 3.05, upperTop = bodyBase + 6.08;
  const width = widthMeters / 2, face = .139;
  batch.wall('coping', at(-width, face), at(width, face), upperFloor + .04, upperTop);
  for (let height = upperFloor + .50; height < upperTop - .1; height += .57) {
    batch.wall('limestone', at(-width, face + .011), at(width, face + .011), height, height + .019);
  }
  for (let offset = -width + .65; offset < width - .25; offset += 1.06) {
    batch.wall('limestone', at(offset, face + .015), at(offset + .022, face + .015), upperFloor + .04, upperTop);
  }
  for (const x of [-5.74, -2.87, 0, 2.87, 5.74]) {
    batch.wall('stoneInset', at(x - .93, face + .027), at(x + .93, face + .027), upperFloor + .46, upperFloor + 2.39);
    batch.wall('facadeGlass', at(x - .81, face + .038), at(x + .81, face + .038), upperFloor + .56, upperFloor + 2.30);
    batch.wall('windowGlint', at(x - .73, face + .045), at(x + .73, face + .045), upperFloor + 1.97, upperFloor + 2.18);
    batch.wall('facadeSash', at(x - .027, face + .051), at(x + .027, face + .051), upperFloor + .57, upperFloor + 2.29);
  }
  for (const side of [-1, 1]) {
    batch.wall('coping', at(side * (width + .018), .06), at(side * (width + .018), -.46), upperTop - .21, upperTop + .045);
    // The brochure shows a light band running under the planted cap rather
    // than a second pitched roof on the long, two-storey volume.
    batch.wall('coping', at(side * (width + .021), -.45), at(side * (width + .021), -lengthMeters + .18),
      upperTop - .19, upperTop + .033);
  }
  batch.prism('limestone', 'path', rectangular(at, -shelfHalf - .12, back, shelfHalf + .12, shelfFront + .42), sill - .21, sill);
  batch.prism('stoneInset', 'path', rectangular(at, x0 - .15, shelfFront + .39, x1 + .15, front + .40), sill - .16, sill);
  // P5 shows a shallow 2F terrace on this short side, not a guard around
  // the green main roof. Its three exposed sides stop at the wall / gable.
  batch.prism('limestone', 'path', rectangular(at, -shelfHalf, back, shelfHalf, shelfFront), shelfTop - .25, shelfTop);
  const railX = shelfHalf - .10, railFront = shelfFront - .092;
  for (const side of [-1, 1]) {
    daycareTerraceRail(batch, at(side * railX, .06), at(side * railX, railFront), shelfTop);
    daycareTerraceRail(batch, at(side * railX, railFront), at(center + side * (halfGable - .67), railFront), shelfTop);
  }
  for (const [a, b] of [[-shelfHalf, x0 + .06], [x1 - .06, shelfHalf]]) {
    batch.wall('limestone', at(a, shelfFront), at(b, shelfFront), sill, shelfTop - .16);
  }
  for (const edge of [-shelfHalf, shelfHalf]) batch.wall('limestone', at(edge, back), at(edge, shelfFront), sill, shelfTop - .16);
  for (const offset of [-6.38, -3.82, 3.82, 6.38]) {
    batch.wall('stoneInset', at(center + offset - .63, shelfFront + .007), at(center + offset + .63, shelfFront + .007), sill + .34, sill + 1.79);
    batch.wall('facadeGlass', at(center + offset - .55, shelfFront + .015), at(center + offset + .55, shelfFront + .015), sill + .41, sill + 1.71);
  }
  for (let x = -shelfHalf + .24; x < shelfHalf; x += .45) {
    batch.plate('stoneJoint', rectangular(at, x, back + .12, x + .017, shelfFront - .07), shelfTop + .007);
  }
  // Follow the playground edge rather than drawing across the play surface.
  const pathEnd = plan(455, 554);
  const promenade = model.getObjectByName('SM_Graded_Pedestrian_Routes');
  const down = new Raycaster(new Vector3(pathEnd[0], 25, pathEnd[1]), new Vector3(0, -1, 0));
  const join = (promenade && down.intersectObject(promenade, true)[0]?.point.y)
    || terrainAt(model, pathEnd, sill) + .13;
  const threshold = at(center, front + .34);
  const walk = [[threshold, 1.43, sill + .009],
    [mix(threshold, pathEnd, .52), 1.31, (sill + join) * .5 + .009], [pathEnd, 1.32, join + .009]] as const;
  for (let i = 1; i < walk.length; i++) {
    const [a, aWidth, aY] = walk[i - 1], [b, bWidth, bY] = walk[i];
    batch.quad('path', groundPoint(add(a, across, -aWidth), aY), groundPoint(add(a, across, aWidth), aY),
      groundPoint(add(b, across, bWidth), bY), groundPoint(add(b, across, -bWidth), bY));
  }
  for (const x of [x0, x1]) batch.wall('zinc', at(x, shelfFront - .12), at(x, front), sill, eave);
  const portalLeft = center - 1.16, portalRight = center + 1.16, lintel = sill + 2.12;
  batch.wall('zinc', at(x0, front), at(portalLeft, front), sill, eave);
  batch.wall('zinc', at(portalRight, front), at(x1, front), sill, eave);
  batch.wall('zinc', at(portalLeft, front), at(portalRight, front), lintel, eave);
  batch.tri('zinc', groundPoint(at(x0, front), eave),
    groundPoint(at(center, front), ridge), groundPoint(at(x1, front), eave));
  for (const [a, b] of [[x0, center], [center, x1]]) {
    batch.quad('zinc', groundPoint(at(a, shelfFront - .44), level(a) + .072),
      groundPoint(at(a, front + .19), level(a) + .072),
      groundPoint(at(b, front + .19), level(b) + .072),
      groundPoint(at(b, shelfFront - .44), level(b) + .072));
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

/** Local model relief, traced as two park platforms without lifting either road or tower pads. */
function raiseNorthernParks(model: Object3D): void {
  const playCenter = plan(289, 166);
  const mistyStart = plan(316, 305), mistyEnd = plan(401, 415);
  const axis = unit(mistyStart, mistyEnd), span = Math.hypot(mistyEnd[0] - mistyStart[0], mistyEnd[1] - mistyStart[1]);
  const world = new Vector3(), inverse = new Matrix4(), instance = new Matrix4(), original = new Vector3();
  const rise = (x: number, z: number): number => {
    const playRadius = Math.hypot((x - playCenter[0]) / 30, (z - playCenter[1]) / 32);
    const px = x - mistyStart[0], pz = z - mistyStart[1];
    const depth = px * axis[0] + pz * axis[1];
    const side = px * axis[1] - pz * axis[0];
    // The northern end is a soft join. The outer eastern brow is much shorter
    // so the wooded verge is recognizably below the raised park and ramp roof.
    const misty = 1.05 * smoothStep((depth + 5) / 14) * smoothStep((span + 6 - depth) / 7)
      * smoothStep((side + 15) / 5) * smoothStep((9.2 - side) / 2.7);
    return Math.max(misty, 1.26 * smoothStep((1.18 - playRadius) / .32));
  };
  for (const name of ['SM_Parcels_Roads_And_Stream', 'SM_Graded_Pedestrian_Routes', 'SM_Courtyard_Lawns_And_Play']) {
    model.getObjectByName(name)?.traverse(object => {
      if (!isMesh(object) || (name === 'SM_Parcels_Roads_And_Stream' && finishName(object) !== 'MAT_Site_Grass')) return;
      const position = object.geometry.getAttribute('position');
      inverse.copy(object.matrixWorld).invert();
      let changed = false;
      for (let i = 0; i < position.count; i++) {
        world.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
        const dy = rise(world.x, world.z);
        if (dy < EPSILON) continue;
        world.y += dy;
        world.applyMatrix4(inverse);
        position.setXYZ(i, world.x, world.y, world.z);
        changed = true;
      }
      if (!changed) return;
      position.needsUpdate = true;
      object.geometry.computeVertexNormals();
      object.geometry.computeBoundingBox();
      object.geometry.computeBoundingSphere();
    });
  }
  model.traverse(node => {
    if (!(node instanceof InstancedMesh) || !node.parent?.name.startsWith('Courtyard_Grove_Instances')) return;
    inverse.copy(node.matrixWorld).invert();
    let changed = false;
    for (let i = 0; i < node.count; i++) {
      node.getMatrixAt(i, instance);
      original.setFromMatrixPosition(instance);
      world.copy(original).applyMatrix4(node.matrixWorld);
      const dy = rise(world.x, world.z);
      if (dy < EPSILON) continue;
      world.y += dy;
      instance.setPosition(world.applyMatrix4(inverse));
      node.setMatrixAt(i, instance);
      changed = true;
    }
    if (changed) {
      node.instanceMatrix.needsUpdate = true;
      node.computeBoundingBox();
      node.computeBoundingSphere();
    }
  });
}

function upperParkRim(batch: SurfaceBatch, model: Object3D, points: readonly XZ[], parkSide: -1 | 1): void {
  const course = points.map(p => plan(...p));
  for (let i = 1; i < course.length; i++) {
    const a = course[i - 1], b = course[i], tangent = unit(a, b);
    const normal: XZ = [tangent[1] * parkSide, -tangent[0] * parkSide];
    const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2);
    const section = (p: XZ) => {
      const high = terrainAt(model, add(p, normal, .68), 4.1) + .12;
      const low = Math.min(high - .18, terrainAt(model, add(p, normal, -1.8), high - .7) - .14);
      return { high, low, p };
    };
    for (let j = 1; j <= steps; j++) {
      const q0 = section(mix(a, b, (j - 1) / steps)), q1 = section(mix(a, b, j / steps));
      batch.quad('courtFrame', groundPoint(q0.p, q0.low), groundPoint(q0.p, q0.high),
        groundPoint(q1.p, q1.high), groundPoint(q1.p, q1.low));
      batch.quad('stoneInset', groundPoint(q0.p, q0.high), groundPoint(q1.p, q1.high),
        groundPoint(add(q1.p, normal, .23), q1.high), groundPoint(add(q0.p, normal, .23), q0.high));
    }
  }
}

function upperParkPavers(batch: SurfaceBatch, model: Object3D, planPoints: readonly XZ[], width: number,
  level?: (point: XZ) => number): void {
  const course = planPoints.map(([x, z]) => plan(x, z));
  const points = course.flatMap((a, i) => {
    const b = course[i + 1];
    if (!b) return [a];
    const pieces = Math.ceil(Math.hypot(a[0] - b[0], a[1] - b[1]) / .71);
    return Array.from({ length: pieces }, (_, j) => mix(a, b, j / pieces));
  });
  const edges = points.map((p, i) => {
    const [dx, dz] = unit(points[Math.max(0, i - 1)], points[Math.min(i + 1, points.length - 1)]);
    return [-1, 1].map(side => {
      const edge = add(p, [dz, -dx], side * width / 2);
      return groundPoint(edge, level?.(edge) ?? terrainAt(model, edge, 3.3) + .245);
    });
  });
  for (let i = 1; i < edges.length; i++) {
    const [a, b] = edges[i - 1], [d, c] = edges[i];
    batch.quad('path', a, b, c, d);
  }
}

function upperParkElevator(batch: SurfaceBatch, model: Object3D): void {
  const marker = SITE_FACILITIES.find(item => item.id === 'elevator-110');
  if (!marker) return;
  const center: XZ = [marker.x, marker.z];
  // P4 locates the external lift at the De Forêt Play / Kids Station corner;
  // the glazed face reads from the low arrival, with a second door to the park.
  const approach = unit(center, plan(346, 241)), tangent: XZ = [approach[1], -approach[0]];
  const at = (x: number, depth: number): XZ => add(add(center, tangent, x), approach, depth);
  const upper = terrainAt(model, at(0, -2.4), 4.2) + .245;
  const lower = Math.min(upper - 1.55, terrainAt(model, at(0, 3.1), .65) + .145);
  const top = upper + 2.56;
  batch.prism('courtStone', 'coping', rectangular(at, -1.34, -1.31, 1.34, 1.31), lower - .24, top);
  batch.plate('stoneInset', rectangular(at, -1.08, -.99, 1.08, .99), top + .011);
  for (const [side, sill, glassTop] of [[1, lower, top - .28], [-1, upper, top - .28]] as const) {
    const face = 1.328 * side;
    batch.wall('courtGlassShade', at(-.78, face), at(.78, face), sill + .02, glassTop);
    batch.wall('entranceGlass', at(-.70, face + .018 * side), at(.70, face + .018 * side), sill + .035, sill + 2.13);
    batch.wall('courtFrame', at(-.026, face + .025 * side), at(.026, face + .025 * side), sill + .03, glassTop);
    batch.prism('stoneInset', 'path', rectangular(at, -1.15, side * 1.305, 1.15, side * 2.42), sill - .18, sill);
  }
  const upperWalk: XZ[] = [at(0, -2.34), at(0, -3.75), plan(312, 202), plan(307, 198), plan(301, 193)];
  upperParkPavers(batch, model, upperWalk.map(([x, z]) => [490 + x / .52, 540 + z / .52]), 1.76, point => {
    const fromLanding = Math.hypot(point[0] - upperWalk[0][0], point[1] - upperWalk[0][1]);
    const mixToTrail = smoothStep(fromLanding / 3.3);
    return upper + (terrainAt(model, point, upper - .245) + .245 - upper) * mixToTrail;
  });
  // A low apron leads to the street-side door, not across the car ramp.
  // Clip the terrain at its exact edges; a raised grass triangle used to
  // obscure the landing even though the lift tower itself remained visible.
  const landingEnd = 8.28, endY = terrainAt(model, at(0, landingEnd), lower) + .14;
  const lowerY = (depth: number) => lower + (endY - lower) * smoothStep((depth - 2.5) / (landingEnd - 2.5));
  const stations = [1.26, 2.42, 3.6, 4.9, 6.2, 7.45, landingEnd];
  const shoulderHeights = stations.map(depth => [-1, 1].map(side => terrainAt(model, at(side * 1.23, depth), lowerY(depth))));
  cutUpperBasementApproach(model, {
    origin: center, inward: approach, across: tangent,
    stations: stations.map(depth => [depth, lowerY(depth), 0, 1.12, 1.12]),
  }, false);
  for (let i = 1; i < stations.length; i++) {
    const a = stations[i - 1], b = stations[i];
    for (const [edge, side] of [[0, -1], [1, 1]] as const) {
      const p = at(side * 1.16, a), q = at(side * 1.16, b);
      batch.quad('courtFrame', groundPoint(p, lowerY(a) - .09), groundPoint(p, shoulderHeights[i - 1][edge] + .04),
        groundPoint(q, shoulderHeights[i][edge] + .04), groundPoint(q, lowerY(b) - .09));
    }
    if (i > 1) batch.quad('path', groundPoint(at(-1.18, a), lowerY(a)), groundPoint(at(-1.18, b), lowerY(b)),
      groundPoint(at(1.18, b), lowerY(b)), groundPoint(at(1.18, a), lowerY(a)));
  }
  const lowerWalk: XZ[] = [at(0, landingEnd), plan(331, 221), plan(335, 225), plan(338, 231), plan(339, 237)];
  upperParkPavers(batch, model, lowerWalk.map(([x, z]) => [490 + x / .52, 540 + z / .52]), 1.67, point => {
    const d = Math.hypot(point[0] - lowerWalk[0][0], point[1] - lowerWalk[0][1]);
    return endY + (terrainAt(model, point, endY - .14) + .14 - endY) * smoothStep(d / 2.4);
  });
}

function upperBasementPortal(batch: SurfaceBatch, model: Object3D, frame: EntryFrame): void {
  const end = frame.stations[frame.stations.length - 1];
  const at = (depth: number, cross: number): XZ => entryAt(frame, depth, end[2] + cross);
  const face = 27.4, back = 34.65, halfWidth = 4.5;
  const sill = end[1] - .08;
  const roof = Math.max(3.25, terrainAt(model, at(back + 1.0, 0), 3.25));
  batch.prism('courtStone', 'siteGrass', rectangular(at, face, -halfWidth - .31, back, halfWidth + .31), roof - .34, roof);
  batch.prism('courtStone', 'coping', rectangular(at, face - .11, -halfWidth - .38, face + .48, halfWidth + .38),
    roof - .47, roof + .03);
  for (const side of [-1, 1]) {
    batch.prism('courtFrame', 'coping', rectangular(at, face - .19, side * (halfWidth - .05), back, side * (halfWidth + .30)), sill, roof - .33);
    batch.prism('courtStone', 'coping', rectangular(at, face - .13, side * (halfWidth - .09), face + .64, side * (halfWidth + .39)),
      entryProfile(frame, face)[1] - .10, roof - .32);
    // Complete the outer walls where the downslope cuts the plaza. It reads
    // from several directions as a sunken car ramp under the park apron.
    const prefix = frame.stations.filter(station => station[0] >= 15.0 && station[0] <= 27.4);
    const profile = [entryProfile(frame, 15.0), ...prefix, entryProfile(frame, face)];
    for (let i = 1; i < profile.length; i++) {
      const edge = (s: EntryStation) => entryAt(frame, s[0], s[2] + (side < 0 ? -s[3] : s[4]) + .93 * side);
      const a = profile[i - 1], b = profile[i], p = edge(a), q = edge(b);
      const top = (r: XZ, floor: number) => Math.max(floor + .17, Math.min(roof - .065,
        terrainAt(model, add(r, frame.across, .45 * side), floor + .21) + .05));
      const pTop = top(p, a[1]), qTop = top(q, b[1]);
      batch.quad('courtFrame', groundPoint(p, a[1] - .18), groundPoint(p, pTop), groundPoint(q, qTop), groundPoint(q, b[1] - .18));
      batch.quad('stoneInset', groundPoint(p, pTop), groundPoint(q, qTop),
        groundPoint(add(q, frame.across, .17 * side), qTop), groundPoint(add(p, frame.across, .17 * side), pTop));
    }
  }
  batch.wall('coping', at(face - .03, -halfWidth - .31), at(face - .03, halfWidth + .31), roof - .39, roof + .045);
  batch.wall('door', at(back, -halfWidth), at(back, halfWidth), sill, roof - .3);
  batch.plate('asphalt', rectangular(at, end[0] - .013, -4.23, back, 4.23), end[1]);
}

/** Cut coarse archived triangles at the drive edges; moving only their vertices would leave grass over the ramp. */
function cutUpperBasementApproach(model: Object3D, frame: EntryFrame, extendToRoof = true): void {
  const stations = extendToRoof ? [...frame.stations, [34.66, -1.41, 1.43, 4.24, 4.28] as const] : frame.stations;
  const sections = stations.slice(1).map((b, i) => {
    const a = stations[i], incline = (y0: number, y1: number) => (d: number) => y0 + (y1 - y0) * (d - a[0]) / (b[0] - a[0]);
    return { start: a[0], end: b[0], left: incline(a[2] - a[3] - .06, b[2] - b[3] - .06),
      right: incline(a[2] + a[4] + .06, b[2] + b[4] + .06) };
  });
  type Vertex = { id: number; depth: number; cross: number };
  const world = new Vector3();
  for (const name of ['SM_Parcels_Roads_And_Stream', 'SM_Graded_Pedestrian_Routes']) {
    model.getObjectByName(name)?.traverse(object => {
      if (!isMesh(object) || !object.visible || (name === 'SM_Parcels_Roads_And_Stream' && finishName(object) !== 'MAT_Site_Grass')) return;
      const geometry = object.geometry, vertices = geometry.getAttribute('position');
      const attributes = Object.entries(geometry.attributes).map(([key, attribute]) => ({ key, attribute, values: [] as number[] }));
      const coordinates = Array.from({ length: vertices.count }, (_, id): Vertex => {
        world.fromBufferAttribute(vertices, id).applyMatrix4(object.matrixWorld);
        const x = world.x - frame.origin[0], z = world.z - frame.origin[1];
        return { id, depth: x * frame.inward[0] + z * frame.inward[1], cross: x * frame.across[0] + z * frame.across[1] };
      });
      let vertexCount = vertices.count;
      const between = (a: Vertex, b: Vertex, t: number): Vertex => {
        const component = (row: typeof attributes[number], id: number, k: number) => id < vertices.count
          ? row.attribute.getComponent(id, k) : row.values[(id - vertices.count) * row.attribute.itemSize + k];
        for (const row of attributes) for (let k = 0; k < row.attribute.itemSize; k++) {
          const v = component(row, a.id, k);
          row.values.push(v + (component(row, b.id, k) - v) * t);
        }
        return { id: vertexCount++, depth: a.depth + (b.depth - a.depth) * t, cross: a.cross + (b.cross - a.cross) * t };
      };
      const split = (polygon: Vertex[], plane: (p: Vertex) => number): [outside: Vertex[], inside: Vertex[]] => {
        const outside: Vertex[] = [], inside: Vertex[] = [];
        let a = polygon[polygon.length - 1], valueA = plane(a);
        for (const b of polygon) {
          const valueB = plane(b);
          if ((valueA >= 0) !== (valueB >= 0)) {
            const edge = between(a, b, valueA / (valueA - valueB));
            outside.push(edge);
            inside.push(edge);
          }
          (valueB >= 0 ? inside : outside).push(b);
          a = b;
          valueA = valueB;
        }
        return [outside, inside];
      };
      const topology = geometry.getIndex(), count = topology?.count ?? vertices.count, result: number[] = [];
      let changed = false;
      for (let i = 0; i < count; i += 3) {
        const triangle = [0, 1, 2].map(j => coordinates[topology?.getX(i + j) ?? i + j]);
        let fragments = [triangle];
        for (const { start, end, left, right } of sections) {
          if (triangle.every(p => p.depth <= start) || triangle.every(p => p.depth >= end)
            || triangle.every(p => p.cross < -6.1) || triangle.every(p => p.cross > 6.1)) continue;
          fragments = fragments.flatMap(polygon => {
            let remains = polygon;
            const outside: Vertex[][] = [];
            for (const plane of [(p: Vertex) => p.depth - start, (p: Vertex) => end - p.depth,
              (p: Vertex) => p.cross - left(p.depth), (p: Vertex) => right(p.depth) - p.cross]) {
              const [strip, inner] = split(remains, plane);
              if (strip.length >= 3) outside.push(strip);
              if (inner.length < 3) return [polygon];
              remains = inner;
            }
            changed = true;
            return outside;
          });
        }
        for (const poly of fragments) for (let j = 2; j < poly.length; j++) result.push(poly[0].id, poly[j - 1].id, poly[j].id);
      }
      if (!changed) return;
      for (const { key, attribute, values } of attributes) {
        const composed = new Float32Array(vertexCount * attribute.itemSize);
        for (let i = 0; i < vertices.count; i++) for (let k = 0; k < attribute.itemSize; k++) {
          composed[i * attribute.itemSize + k] = attribute.getComponent(i, k);
        }
        composed.set(values, vertices.count * attribute.itemSize);
        geometry.setAttribute(key, new Float32BufferAttribute(composed, attribute.itemSize));
      }
      geometry.setIndex(result);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    });
  }
}

function mainUpperEntry(model: Object3D): void {
  const baked = model.getObjectByName('SM_Northwest_Entry_Portals_And_Guardhouses');
  if (baked) baked.visible = false;
  // P4's dark apron is a below-park approach, not a freestanding surface club.
  removeBakedFacilityProxy(model, plan(333, 236), 81, 12.45, 8.15);
  // The named primitives are solely the former 110 approach. Keep the
  // arterial, stream, public trails and 105 parking ramp in their original batches.
  for (const name of ['SM_Parcels_Roads_And_Stream', 'SM_East_West_Retaining_And_Main_Gate_Break']) {
    model.getObjectByName(name)?.traverse(node => {
      if (isMesh(node) && /^(?:MAT_Perimeter_Road|MAT_Promenade_Paver_Coping)$/.test(finishName(node))) node.visible = false;
    });
  }
  cutUpperBasementApproach(model, upperMainFrame);
  const group = new Group();
  group.name = UPPER_MAIN;
  group.userData.castsSiteShadow = true;
  const batch = new SurfaceBatch();
  paveEntry(batch, model, upperMainFrame, false);
  entryPortal(batch, upperMainFrame, 14.15, 8.45, true);
  // The old cut left a hole in the street's raised sidewalk. A short strip
  // restores continuity south of the relocated throat without touching the lanes.
  const a = plan(355.4, 260.0), b = plan(354.8, 279.2);
  batch.strip('path', a, b, 1.28, .584);
  batch.strip('coping', add(a, [1, 0], .70), add(b, [1, 0], .70), .16, .619);
  upperBasementPortal(batch, model, upperMainFrame);
  upperParkElevator(batch, model);
  // Parallel to the approach's park side, with a break around the E/V landings.
  upperParkRim(batch, model, [[344, 191], [339, 201], [333, 212], [327, 220]], -1);
  upperParkRim(batch, model, [[314, 224], [304, 222], [294, 216], [286, 209]], -1);
  // Retain the wide park loop. Short links shown behind 111/112 meet its
  // pale pedestrian pavement rather than extending the vehicular entrance.
  upperParkPavers(batch, model, [[301, 52], [305, 66], [306, 78], [304, 91], [303, 99]], 2.05);
  upperParkPavers(batch, model, [[223, 50], [222, 60], [229, 69], [238, 78]], 1.60);
  upperParkPavers(batch, model, [[398, 88], [392, 100], [385, 106], [378, 113]], 1.74);
  batch.attachTo(group);
  model.add(group);
}

/** 109 line 1 has a recessed B1 throat below the Misty Forêt park, beyond the street gate. */
function upperOpenEntry(model: Object3D): void {
  const oldRamp = model.getObjectByName('SM_Seam_North_Covered_Parking_Ramp');
  if (oldRamp) oldRamp.visible = false;
  cutForEntry(model, upperAuxFrame);
  const group = new Group();
  group.name = DRIVE;
  group.userData.castsSiteShadow = true;
  const batch = new SurfaceBatch();
  paveEntry(batch, model, upperAuxFrame, false);
  entryPortal(batch, upperAuxFrame, 10.25, 7.65, false);
  // Crescent-shaped planted shoulder, following the gray turnout around it.
  const island = [[439.2,424.2],[435.7,426.2],[430.0,429.2],[428.0,432.7],[429.5,434.5],
    [435.4,436.0],[439.0,436.0],[441.0,431.4]].map(([x, z]) => plan(x, z));
  batch.prism('limestone', 'siteGrass', island, .55, 1.57);
  // New PDF detail locates the dark end behind the planted island, beside
  // 109's first line. Use the demonstrated surface curve, then descend.
  const terminal = upperAuxFrame.stations.at(-1)!;
  const lead = entryAt(upperAuxFrame, terminal[0], terminal[2]);
  const face = plan(405.7, 414.6), axis = unit(plan(412, 423), face);
  const cross: XZ = [axis[1], -axis[0]];
  const portalAt = (depth: number, lateral: number): XZ => add(add(face, axis, depth), cross, lateral);
  const rear = portalAt(7.4, 0);
  const course: readonly (readonly [XZ, number, number])[] = [
    [lead, terminal[1], 3.30], [plan(432,450), 1.13, 3.45], [plan(427,444), .95, 3.40],
    [plan(420,434.5), .49, 3.34], [plan(412,423), -.17, 3.27], [face, -.74, 3.23],
    [rear, -1.38, 3.23],
  ];
  const deckHeight = Math.max(4.05, Math.min(7.4, terrainAt(model, portalAt(7.55, -1.35), 5.15) + .035));
  const norm = (pointIndex: number): XZ => {
    if (pointIndex === 0) return [-upperAuxFrame.across[0], -upperAuxFrame.across[1]];
    const left = course[Math.max(0,pointIndex-1)][0], right = course[Math.min(course.length-1,pointIndex+1)][0];
    const tangent = unit(left,right);
    return [tangent[1],-tangent[0]];
  };
  const cutSections = course.slice(1).map(([b, , w1], i) => {
    const [a, , w0] = course[i], n0 = norm(i), n1 = norm(i+1);
    return [add(a,n0,w0),add(a,n0,-w0),add(b,n1,-w1),add(b,n1,w1)] as const;
  });
  // Trim the decoded grass triangles on the exact corridor edges. Lowering
  // the corners of the coarse source triangles instead drapes grass across
  // the asphalt (and would also pull the upper park's path into the tunnel).
  const grass = model.getObjectByName('SM_Parcels_Roads_And_Stream')?.children.find((node): node is Mesh =>
    isMesh(node) && finishName(node) === 'MAT_Site_Grass');
  if (grass) {
    type ClipVertex = { readonly x: number; readonly z: number; readonly attrs: readonly (readonly number[])[] };
    const source = grass.geometry, position = source.getAttribute('position');
    const attributes = Object.entries(source.attributes);
    const index = source.getIndex(), vertex = new Vector3();
    const cut = cutSections.map(polygon => {
      const [a,b,c] = polygon;
      const winding = Math.sign((b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]));
      return {
        xmin: Math.min(...polygon.map(p=>p[0])), xmax: Math.max(...polygon.map(p=>p[0])),
        zmin: Math.min(...polygon.map(p=>p[1])), zmax: Math.max(...polygon.map(p=>p[1])),
        edges: polygon.map((p,i) => {
          const q = polygon[(i+1)%polygon.length];
          return (v: ClipVertex) => winding*((q[0]-p[0])*(v.z-p[1]) - (q[1]-p[1])*(v.x-p[0]));
        }),
      };
    });
    const read = (i: number): ClipVertex => {
      const n = index ? index.getX(i) : i;
      vertex.fromBufferAttribute(position, n).applyMatrix4(grass.matrixWorld);
      return { x: vertex.x, z: vertex.z, attrs: attributes.map(([, attr]) => Array.from({length: attr.itemSize}, (_, j) => attr.getComponent(n,j))) };
    };
    const split = (a: ClipVertex, b: ClipVertex, t: number): ClipVertex => ({
      x: a.x + t*(b.x-a.x), z: a.z + t*(b.z-a.z),
      attrs: a.attrs.map((attr,i)=>attr.map((v,j)=>v+t*(b.attrs[i][j]-v))),
    });
    const result: number[][] = attributes.map(()=>[]);
    for (let i = 0; i < (index?.count ?? position.count); i += 3) {
      const triangle = [read(i), read(i+1), read(i+2)];
      let rings = [triangle];
      for (const {xmin,xmax,zmin,zmax,edges} of cut) {
        if (triangle.every(v=>v.x < xmin) || triangle.every(v=>v.x > xmax)
          || triangle.every(v=>v.z < zmin) || triangle.every(v=>v.z > zmax)) continue;
        rings = rings.flatMap(ring => {
          let inside = ring;
          const saved: ClipVertex[][] = [];
          for (const plane of edges) {
            if (inside.length < 3) break;
            const positive: ClipVertex[] = [], negative: ClipVertex[] = [];
            for (let j = 0; j < inside.length; j++) {
              const a = inside[j], b = inside[(j+1)%inside.length], da = plane(a), db = plane(b);
              (da >= 0 ? positive : negative).push(a);
              if ((da >= 0) !== (db >= 0)) {
                const v = split(a,b,da/(da-db));
                positive.push(v); negative.push(v);
              }
            }
            if (negative.length >= 3) saved.push(negative);
            inside = positive;
          }
          return saved;
        });
      }
      for (const ring of rings) for (let j = 1; j+1 < ring.length; j++) {
        for (const v of [ring[0],ring[j],ring[j+1]]) v.attrs.forEach((attr,k)=>result[k].push(...attr));
      }
    }
    const clipped = new BufferGeometry();
    attributes.forEach(([name, attr], i)=>clipped.setAttribute(name, new Float32BufferAttribute(result[i], attr.itemSize)));
    clipped.computeBoundingBox(); clipped.computeBoundingSphere();
    grass.geometry = clipped;
    source.dispose();
  }
  for (let i = 1; i < course.length; i++) {
    const [a, y0, w0] = course[i-1], [b, y1, w1] = course[i];
    const n0 = norm(i-1), n1=norm(i);
    batch.quad('asphalt', groundPoint(add(a,n0,w0),y0), groundPoint(add(a,n0,-w0),y0),
      groundPoint(add(b,n1,-w1),y1), groundPoint(add(b,n1,w1),y1));
    batch.quad('roadAmber', groundPoint(add(a,n0,.055), y0+.022), groundPoint(add(a,n0,-.055),y0+.022),
      groundPoint(add(b,n1,-.055),y1+.022), groundPoint(add(b,n1,.055),y1+.022));
    for (const s of [-1,1]) {
      const p = add(a,n0,w0*s), q = add(b,n1,w1*s);
      const wallTop = (point: XZ, base: number, index: number): number => index >= course.length-2 ? deckHeight
        : Math.min(deckHeight, Math.max(base+.18, terrainAt(model, point, base)+.08));
      const pTop = wallTop(add(p,n0,s*.4),y0,i-1) - .06, qTop = wallTop(add(q,n1,s*.4),y1,i) - .06;
      batch.quad('stoneInset', groundPoint(p,y0-.22), groundPoint(p,pTop), groundPoint(q,qTop), groundPoint(q,y1-.22));
      batch.quad('coping', groundPoint(p,pTop), groundPoint(q,qTop), groundPoint(add(q,n1,s*.24),qTop+.02), groundPoint(add(p,n0,s*.24),pTop+.02));
    }
  }
  // White structural entrance face as on 105; above it the same park turf
  // carries to Misty Forêt, rather than capping the opening with an island.
  batch.prism('courtStone', 'siteGrass', rectangular(portalAt, .03, -3.49, 7.43, 3.49), deckHeight-.37, deckHeight);
  batch.prism('courtStone', 'coping', rectangular(portalAt, -.19, -3.61, .47, 3.61), deckHeight - .59, deckHeight + .018);
  for (const side of [-1, 1]) {
    batch.prism('courtStone', 'coping', rectangular(portalAt, -.20, side * 3.19, .62, side * 3.61), -.84, deckHeight - .55);
    batch.wall('courtFrame', portalAt(.48, side * 3.53), portalAt(7.46, side * 3.53), deckHeight - .56, deckHeight - .28);
  }
  batch.wall('door', portalAt(7.44,-3.23), portalAt(7.44,3.23), -1.38, deckHeight-.37);
  upperParkRim(batch, model, [[323, 296], [335, 319], [353, 345], [376, 377], [396, 402]], -1);
  // Continue a short pedestrian link over the planted lid into the park.
  const parkWalk: XZ[] = [portalAt(2.7, -.55), portalAt(5.2, -.55), portalAt(7.5, -.68), plan(391, 395), plan(382, 385)];
  upperParkPavers(batch, model, parkWalk.map(([x, z]) => [490 + x / .52, 540 + z / .52]), 1.64, point => {
    const d = (point[0] - face[0]) * axis[0] + (point[1] - face[1]) * axis[1];
    const attach = smoothStep((d - 7.45) / 3.7);
    return deckHeight + .055 + (terrainAt(model, point, deckHeight) + .19 - deckHeight - .055) * attach;
  });
  batch.attachTo(group);
  model.add(group);
}

function terrainAt(model: Object3D, point: XZ, otherwise: number): number {
  const terrain = model.getObjectByName('SM_Parcels_Roads_And_Stream');
  if (!terrain) return otherwise;
  const ray = new Raycaster(new Vector3(point[0], 65, point[1]), new Vector3(0, -1, 0));
  return ray.intersectObject(terrain, true)[0]?.point.y ?? otherwise;
}

/** The v9 105 cabin is merged per material with both the main gate and parking ramp. */
function removeAngled105Guardhouse(model: Object3D): void {
  const center = plan(608, 531);
  const along = unit(center, plan(625, 540)); // Frozen Blender v9 rear-105 cabin orientation.
  const finishes = new Set(['MAT_Entry_Clad_Guardhouse_Stone', 'MAT_Entry_Pale_Limestone',
    'MAT_Entry_Smoked_Glazing', 'MAT_Entry_Ramp_Charcoal_Lattice']);
  const inCabin = ({ x, z }: Vector3): boolean => {
    const dx = x - center[0], dz = z - center[1];
    return Math.abs(dx * along[0] + dz * along[1]) < 1.82 && Math.abs(-dx * along[1] + dz * along[0]) < 1.46;
  };
  model.getObjectByName('SM_Entry_Portals_And_Parking_Ramp')?.traverse(object => {
    if (isMesh(object) && finishes.has(finishName(object))) keepTriangles(object, (...points) => !points.every(inCabin));
  });
}

function rebuildGuardhouses(model: Object3D): void {
  removeAngled105Guardhouse(model);
  const group = new Group();
  group.name = GUARD;
  group.userData.castsSiteShadow = true;
  for (const [id, preferred] of [
    ['security-105', null], ['security-109', 1.23], ['security-110', null],
  ] as const) {
    const security = SITE_FACILITIES.find(item => item.id === id);
    if (!security) continue;
    const axis = security.roofMark?.axis ?? [-.195, .981];
    const halfWidth = (security.roofMark?.halfWidth ?? 1.89) - .21;
    const halfDepth = (security.roofMark?.halfDepth ?? 1.48) - .21;
    const mid: XZ = [security.x, security.z];
    const cross: XZ = [-axis[1], axis[0]];
    const at = (x: number, z: number): XZ => add(add(mid, axis, x), cross, z);
    if (preferred !== null) lowerEntryGround(model, position => {
      const dx = position[0] - mid[0], dz = position[1] - mid[1];
      const distance = Math.hypot(dx, dz);
      return distance < 5.95 ? preferred - .08 + 7 * smoothStep((distance - 2.5) / 3.45) : null;
    });
    const base = preferred ?? terrainAt(model, mid, .65);
    const body = rectangular(at, -halfWidth, -halfDepth, halfWidth, halfDepth);
    const batch = new SurfaceBatch();
    batch.prism('stoneInset', 'path', rectangular(at, -halfWidth - .62, -halfDepth - .61, halfWidth + .62, halfDepth + .61),
      Math.min(.52, base - .40), base + .08);
    batch.prism('limestone', 'limestone', body, base + .08, base + 2.23);
    const glassX = halfWidth + .01, glassZ = halfDepth + .01;
    for (const [a, b] of [
      [at(-glassX, .22 - halfDepth), at(-glassX, halfDepth - .22)], [at(glassX, .22 - halfDepth), at(glassX, halfDepth - .22)],
      [at(.24 - halfWidth, -glassZ), at(halfWidth - .24, -glassZ)], [at(.24 - halfWidth, glassZ), at(halfWidth - .24, glassZ)],
    ]) batch.wall('facadeGlass', a, b, base + 1.0, base + 1.74);
    batch.wall('door', at(-.61, halfDepth + .018), at(.07, halfDepth + .018), base + .09, base + 1.68);
    batch.prism('zinc', 'limestone', rectangular(at, -halfWidth - .21, -halfDepth - .21, halfWidth + .21, halfDepth + .21),
      base + 2.16, base + 2.36);
    const cabin = new Group();
    cabin.name = `${GUARD}_${id}`;
    cabin.userData.castsSiteShadow = true;
    batch.attachTo(cabin);
    group.add(cabin);
  }
  model.add(group);
}

function rebuildSeamPark(model: Object3D): void {
  // The boundary reserve is a sloping park, not a low platform between two
  // retaining walls. Interpolate between the existing parcel surfaces and
  // let their slightly raised pedestrian edges continue to define each site.
  const outline = [[467.9,446.5],[494,463],[498.5,465.2],[504,471.7],[507,475.2],[489,483],[482,489],
    [451,515],[404,556],[376,583],[372,602],
    // Join the 104 and 109 banks just inboard of their shared outer line.
    // Middle stations are deliberately landward, never a bulge into the river.
    [371,590],[367,575],[360,557],[348,539],[365,545],[377,535],
    [408,506],[439,478]].map(([x,z]) => plan(x,z));
  const group = new Group();
  group.name = SEAM_PARK;
  const batch = new SurfaceBatch();
  const polygon = outline.map(([x,z]) => new Vector2(x,z));
  const origin = plan(478, 463), along = unit(origin, plan(464, 475));
  const across: XZ = [along[1], -along[0]], step = Math.hypot(14, 12) * .52;
  const parcel = model.getObjectByName('SM_Parcels_Roads_And_Stream');
  const grass = parcel?.children.find((node): node is Mesh => isMesh(node) && finishName(node) === 'MAT_Site_Grass');
  // The original v9 green spine is a separate flat slab. Leaving it visible
  // would still leak a thin tongue towards the bank after clipping the new park.
  parcel?.traverse(object => {
    if (!isMesh(object)) return;
    if (finishName(object) === 'MAT_Separation_Lawn') object.visible = false;
    if (finishName(object) !== 'MAT_Retaining_Edge') return;
    keepTriangles(object, (...points) => !(points.every(p => p.y <= .510 && p.y >= -1.47
      && p.x >= plan(334, 0)[0] && p.x <= plan(499, 0)[0] && p.z >= plan(0, 445)[1] && p.z <= plan(0, 601)[1])
      && points.some(p => Math.abs(p.y + 1.45) < .020)));
  });
  const findGrade = (station: number, offset: number, fallback: number): number => {
    const at = add(add(origin, along, step * station), across, offset * .52);
    const down = new Raycaster(new Vector3(at[0], 18, at[1]), new Vector3(0, -1, 0));
    return grass ? down.intersectObject(grass)[0]?.point.y ?? fallback : fallback;
  };
  // [northwest/southeast offset in plan pixels, fallback when a retaining
  // mesh has no upward-facing ground here]. Road and creek caps stay low.
  const rims = [
    [-24, 24, .54, .54], [-19, 24, 1.65, 1.57], [-18, 24, 5.65, 1.69],
    [-18, 24, 7.15, 1.78], [-18, 24, 6.97, 1.83], [-18, 24, 6.66, 1.82],
    [-16, 24, 6.20, 1.88], [-14, 24, 6.04, 1.93], [-17, 24, 5.25, 1.96],
    [-14, 23, 2.20, 1.90], [-12, 23, .57, 1.60], [-12, 22, .53, .62],
  ].map(([left, right, low, high], station) => ({
    left, right,
    // The northwest edge coincides with the crest, not the depressed road.
    low: station > 0 && station < 8 ? findGrade(station, left, low) : low,
    high: station > 0 && station < 8 ? findGrade(station, right, high) : high,
  }));
  const grade = (p: XZ): number => {
    const dx = p[0] - origin[0], dz = p[1] - origin[1];
    const t = Math.max(0, Math.min(rims.length - 1.001, (dx * along[0] + dz * along[1]) / step));
    const station = Math.floor(t), q = t - station, a = rims[station], b = rims[station + 1];
    const blend = (x: number, y: number) => x + (y - x) * q;
    const x = (dx * across[0] + dz * across[1]) / .52;
    const left = blend(a.left, b.left), right = blend(a.right, b.right);
    const u = smoothStep((x - left) / (right - left));
    return blend(a.low, b.low) * (1 - u) + blend(a.high, b.high) * u + .028;
  };
  const span = (p: XZ, q: XZ) => Math.hypot(q[0] - p[0], q[1] - p[1]);
  const gradeTriangle = (a: XZ, b: XZ, c: XZ): void => {
    if (Math.max(span(a, b), span(b, c), span(a, c)) <= 3.4) {
      batch.tri('siteGrass', groundPoint(a, grade(a)), groundPoint(b, grade(b)), groundPoint(c, grade(c)));
      return;
    }
    const ab = mix(a, b, .5), bc = mix(b, c, .5), ca = mix(c, a, .5);
    gradeTriangle(a, ab, ca); gradeTriangle(ab, b, bc);
    gradeTriangle(ca, bc, c); gradeTriangle(ab, bc, ca);
  };
  for (const [ia, ib, ic] of ShapeUtils.triangulateShape(polygon, [])) {
    const a = outline[ia], b = outline[ib], c = outline[ic];
    const upwards = (b[1] - a[1]) * (c[0] - a[0]) > (b[0] - a[0]) * (c[1] - a[1]);
    gradeTriangle(a, upwards ? b : c, upwards ? c : b);
  }
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i+1)%outline.length];
    const steps = Math.ceil(span(a, b) / 1.8);
    for (let j = 1; j <= steps; j++) {
      const p = mix(a,b,(j-1)/steps), q = mix(a,b,j/steps);
      batch.quad('hedge', groundPoint(p, -.45), groundPoint(p, grade(p)), groundPoint(q, grade(q)), groundPoint(q, -.45));
    }
  }
  // Two irregular low planting bands, set inward so no trees are scattered
  // across the entry line or extend above the separated parcel retaining walls.
  for (const [start, end, count] of [[plan(421,518),plan(365,569),18], [plan(401,526),plan(338,579),19]] as const) {
    for (let i = 0; i < count; i++) {
      const p = add(mix(start, end, i/count), [1,.54], Math.sin(i*1.8)*1.2);
      if (!polygonContains(p, outline)) continue;
      const y = grade(p) + .025, r = .38 + (i%3) * .16;
      for (let q = 0; q < 6; q++) {
        const a = add(p, [Math.sin(q*Math.PI/3),Math.cos(q*Math.PI/3)], r);
        const b = add(p, [Math.sin((q+1)*Math.PI/3),Math.cos((q+1)*Math.PI/3)], r);
        batch.tri('hedge', groundPoint(a,y), groundPoint(b,y), groundPoint(p,y + r*.76));
      }
    }
  }
  batch.attachTo(group);
  const turf = group.getObjectByName(`${SEAM_PARK}_siteGrass`);
  if (turf && isMesh(turf)) {
    if (grass && grass.material instanceof MeshStandardMaterial && turf.material instanceof MeshStandardMaterial) {
      turf.material.color.copy(grass.material.color);
      turf.material.roughness = grass.material.roughness;
      turf.material.metalness = grass.material.metalness;
    }
    const p = turf.geometry.getAttribute('position'), n = turf.geometry.getAttribute('normal');
    const normal = new Vector3();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), eps = .42;
      normal.set(grade([x-eps,z])-grade([x+eps,z]), eps*2, grade([x,z-eps])-grade([x,z+eps])).normalize();
      n.setXYZ(i, normal.x, normal.y, normal.z);
    }
  }
  model.add(group);
}

function rebuildUpperRetail(model: Object3D): void {
  // The plan separates commercial strip 3 from Community II by a divider.
  // Preserve that notch, and keep its pale coping continuous with the podium.
  const group = new Group();
  group.name = RETAIL;
  group.userData.castsSiteShadow = true;
  const batch = new SurfaceBatch();
  steppedTerrace(batch, upperRetailOutline, UPPER_RETAIL_ROOF, 2.35, retailGlazedEdges);
  batch.attachTo(group);
  model.add(group);
}

function roundedRoute(points: readonly XZ[]): XZ[] {
  let route = [...points];
  for (let pass = 0; pass < 2; pass++) {
    route = [route[0], ...route.slice(1).flatMap((b, i) => [mix(route[i], b, .23), mix(route[i], b, .77)]), route.at(-1)!];
  }
  return route.slice(1).reduce<XZ[]>((out, b, i) => {
    const a = route[i], count = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.55);
    for (let step = 1; step <= count; step++) out.push(mix(a, b, step / count));
    return out;
  }, [route[0]]);
}

function southPromenades(model: Object3D): void {
  model.updateMatrixWorld(true);
  const garden = 'SM_Courtyard_Lawns_And_Play';
  const distanceToRoute = (p: XZ, points: readonly XZ[]) => points.slice(1).reduce((best, b, i) => {
    const a = points[i], dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)));
    return Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz));
  }, Infinity);
  // Protect the adjacent broad 103 walkway while removing the unneeded spur
  // from it. The rest of the baked network (including all vehicle routes) stays.
  const broad103: readonly XZ[] = [[531, 754], [550, 773], [563, 787], [565, 800], [556, 816]];
  const turnout104: readonly XZ[] = [[494, 617], [501, 629], [511, 639], [517, 645]];
  for (const [layer, name, finishes] of [
    ['graded', 'SM_Graded_Pedestrian_Routes', /^(?:MAT_Sandstone_Pedestrian_Pavers|MAT_Promenade_Paver_Coping)$/],
    ['courtyard', garden, /^(?:MAT_Sandstone_Pedestrian_Pavers|MAT_Garden_cream)$/],
  ] as const) {
    const obsolete = SUPERSEDED_WALK_SECTIONS.filter(section => section.layer === layer);
    model.getObjectByName(name)?.traverse(object => {
      if (!isMesh(object) || !finishes.test(finishName(object))) return;
      keepTriangles(object, (a, b, c) => {
        const p: XZ = [(a.x + b.x + c.x) / 1.56 + 490, (a.z + b.z + c.z) / 1.56 + 540];
        if (layer === 'graded' && (distanceToRoute(p, broad103) < 6.2
          || (p[1] >= 617.2 && distanceToRoute(p, turnout104) < 2.8))) return true;
        return !obsolete.some(({ points, halfWidth }) => distanceToRoute(p, points) < halfWidth);
      });
    });
  }
  const groundBatches = ['SM_Parcels_Roads_And_Stream', 'SM_Graded_Pedestrian_Routes', 'SM_Rebuilt_Seam_Park', garden,
    'SM_Approach_Promenades_106_107'].flatMap(name => {
    const meshes: Mesh[] = [];
    model.getObjectByName(name)?.traverseVisible(object => {
      if (!isMesh(object) || (name === 'SM_Rebuilt_Seam_Park' && !object.userData.siteSurface)) return;
      if (name === garden && !/^(MAT_Garden_(?:border_green|fresh)|MAT_Sandstone_Pedestrian_Pavers)$/.test(finishName(object))) return;
      meshes.push(object);
    });
    return meshes;
  });
  const footprint = SITE_FACILITIES.find(({ id }) => id === 'community-1')?.footprint;
  const roof = footprint?.surface === 'terrain' ? footprint.outline : [];
  const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0));
  const ground = (p: XZ): number => {
    ray.ray.origin.set(p[0], 36, p[1]);
    return ray.intersectObjects(groundBatches, false)[0]?.point.y ?? .48;
  };
  const group = new Group();
  group.name = PROMENADE;
  const promenade = roundedRoute(COMMUNITY_PROMENADE.map(([x, z]) => plan(x, z)));
  const bakedPaving = groundBatches.find(mesh => finishName(mesh) === 'MAT_Sandstone_Pedestrian_Pavers')?.material;
  const routeStations = (route: XZ[], width: number, goesOverRoof: boolean, layer: number) => {
    const arc: number[] = [0];
    route.slice(1).forEach((b, i) => arc.push(arc[i] + Math.hypot(b[0] - route[i][0], b[1] - route[i][1])));
    const sections = route.map((p, i) => {
      const [dx, dz] = unit(route[Math.max(0, i - 1)], route[Math.min(route.length - 1, i + 1)]);
      return { p, normal: [-dz, dx] as XZ, y: ground(p), arc: arc[i] };
    });
    const onRoof = goesOverRoof ? sections.filter(({ p, normal }) => [0, -.48, .48].some(offset =>
      polygonContains(add(p, normal, width * offset), roof))).map(s => s.arc) : [];
    const batch = new SurfaceBatch();
    const graded = sections.map(s => {
      const distance = onRoof.reduce((best, pos) => Math.min(best, Math.abs(s.arc - pos)), Infinity);
      const rise = (Math.max(s.y, 5.08 + .105) - s.y) * smoothStep(1 - distance / 17);
      return { ...s, rise, edgeY: [-1, 1].map(side => ground(add(s.p, s.normal, side * width / 2))) };
    });
    const yAt = (s: typeof graded[number], offset: number) => {
      const p = add(s.p, s.normal, offset);
      const y = s.y + (s.edgeY[offset < 0 ? 0 : 1] - s.y) * Math.abs(offset * 2 / width);
      return Math.max(y + s.rise, goesOverRoof && polygonContains(p, roof) ? 5.08 + .105 : 0);
    };
    // The wide community promenade keeps its four pale lines. Quiet garden
    // links meet the surrounding sandstone paving without carrying the stripes
    // into it or drawing a separate outline across each T-junction.
    const bands = goesOverRoof ? [-.5, -.472, -.32, -.28, -.12, -.08, .08, .12, .28, .32, .472, .5] : [-.5, 0, .5];
    const stripMaterials: Finish[] = goesOverRoof ? ['promenadeTrim', 'promenadeBand', 'promenadeTrim', 'promenadeStone',
      'promenadeTrim', 'promenadeStone', 'promenadeTrim', 'promenadeStone', 'promenadeTrim', 'promenadeBand', 'promenadeTrim']
      : ['promenadeStone', 'promenadeStone'];
    const cross = graded.map(s => bands.map(offset => {
      const lateral = offset * width;
      return groundPoint(add(s.p, s.normal, lateral), yAt(s, lateral) + .052 + layer);
    }));
    const shoulders = graded.map((s, i) => [-1, 1].map(side => {
      const x = add(s.p, s.normal, side * (width / 2 + 1.05));
      const original = ground(x);
      return [groundPoint(x, original + .012), cross[i][side < 0 ? 0 : bands.length - 1]] as const;
    }));
    for (let i = 1; i < cross.length; i++) {
      for (let j = 0; j < stripMaterials.length; j++) {
        // Upward normals are part of the facility overlay contract: the red
        // extent clips to these actual paving triangles instead of going under them.
        batch.quad(stripMaterials[j], cross[i - 1][j], cross[i - 1][j + 1], cross[i][j + 1], cross[i][j]);
      }
      if (!goesOverRoof || Math.max(graded[i - 1].rise, graded[i].rise) < .13) continue;
      for (let side = 0; side < 2; side++) {
        const [a, b] = shoulders[i - 1][side], [d, c] = shoulders[i][side];
        // A planted shoulder supports raised approaches outside the roof slab.
        // Do not cover the facility roof or add a staircase to the lower park.
        if (!polygonContains([a[0], a[2]], roof) && !polygonContains([d[0], d[2]], roof)) batch.quad('hedge', a, b, c, d);
      }
    }
    const firstMesh = group.children.length;
    batch.attachTo(group);
    if (!goesOverRoof && bakedPaving instanceof MeshStandardMaterial && bakedPaving.map) {
      for (const node of group.children.slice(firstMesh)) {
        if (!isMesh(node) || !(node.material instanceof MeshStandardMaterial)) continue;
        const p = node.geometry.getAttribute('position');
        const uv: number[] = [];
        for (let i = 0; i < p.count; i++) uv.push(p.getX(i) * .62, 1 + p.getZ(i) * .62);
        node.geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
        node.material.map = bakedPaving.map;
        node.material.color.copy(bakedPaving.color);
      }
    }
  };
  routeStations(promenade, 3.45, true, 0);
  PARK_PATHS.forEach((points, i) => routeStations(roundedRoute(points.map(([x, z]) => plan(x, z))), i === 0 ? 2.10 : 1.68, false, .014 + .006 * i));
  model.add(group);
}

function deForetCafe(model: Object3D): void {
  removeBakedFacilityProxy(model, plan(...CAFE_PLAN.oldCenter), -45, 5.92, 3.94);
  const group = new Group();
  group.name = CAFE;
  group.userData.castsSiteShadow = true;
  const batch = new SurfaceBatch(), center = plan(...CAFE_PLAN.center);
  const h = Math.max(terrainAt(model, center, 2.78), terrainAt(model, add(center, [1.8, 1.5]), 2.78));
  // Match the gabled entrance at the fountain end shown in the plan and P6 rendering.
  const [dx, dz] = CAFE_PLAN.axis;
  const at = (x: number, z: number) => add(add(center, [dx, dz], x), [-dz, dx], z);
  const w = CAFE_PLAN.length / 2, d = CAFE_PLAN.depth / 2, wall = h + 3.18, peak = wall + 1.44;
  batch.prism('stoneInset', 'courtPaver', rectangular(at, -w - .48, -d - .47, w + .91, d + .65), h - .32, h + .13);
  batch.prism('courtStone', 'courtStone', rectangular(at, -w, -d, w, d), h + .13, wall);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const span = (w * 2 - .58) / 5, left = -w + .29 + span * i, right = left + span - .34;
      batch.wall(i % 2 === 0 ? 'cafeGlass' : 'cafeGlassLow', at(left, side * (d + .014)), at(right, side * (d + .014)), h + .29, wall - .18);
      batch.wall('windowGlint', at(left + .09, side * (d + .022)), at(right - .09, side * (d + .022)), wall - .45, wall - .23);
      const mid = (left + right) / 2;
      batch.wall('courtFrame', at(mid - .034, side * (d + .025)), at(mid + .034, side * (d + .025)), h + .46, wall - .21);
    }
    const edge = w * side;
    batch.tri('courtStone', groundPoint(at(edge, -d), wall), groundPoint(at(edge, d), wall), groundPoint(at(edge, 0), peak));
    if (side > 0) {
      const facade = edge + .018;
      const glassEdge = d - .32;
      batch.wall('cafeGlass', at(facade, -glassEdge), at(facade, glassEdge), h + .22, wall);
      batch.wall('cafeGlassLow', at(facade + .008, -glassEdge), at(facade + .008, glassEdge), h + .22, h + .66);
      batch.tri('cafeGlassLow', groundPoint(at(facade, -glassEdge), wall), groundPoint(at(facade, glassEdge), wall),
        groundPoint(at(facade, 0), peak - .23));
      const frame = facade + .012;
      for (const ratio of [-.68, -.24, .24, .68]) {
        const offset = glassEdge * ratio, y = wall + (peak - .23 - wall) * (1 - Math.abs(ratio));
        batch.wall('facadeSash', at(frame, offset - .036), at(frame, offset + .036), h + .22, y);
      }
      batch.wall('facadeSash', at(frame, -glassEdge), at(frame, glassEdge), wall - .032, wall + .032);
      batch.wall('windowGlint', at(frame + .014, -.065), at(frame + .014, .065), h + 1.2, h + 1.45);
      batch.wall('coping', at(frame, -d), at(frame, -glassEdge), h + .13, wall);
      batch.wall('coping', at(frame, glassEdge), at(frame, d), h + .13, wall);
    } else {
      batch.wall('courtGlassShade', at(edge - .015, -d * .58), at(edge - .015, d * .58), h + .28, wall - .25);
    }
    const eave = wall - .11, edgeZ = (d + .34) * side;
    batch.quad('zinc', groundPoint(at(-w - .32, 0), peak + .075), groundPoint(at(w + .32, 0), peak + .075),
      groundPoint(at(w + .32, edgeZ), eave), groundPoint(at(-w - .32, edgeZ), eave));
    for (let x = -w + .07; x < w; x += .56) batch.quad('seams',
      groundPoint(at(x, 0), peak + .091), groundPoint(at(x + .027, 0), peak + .091),
      groundPoint(at(x + .027, edgeZ), eave + .016), groundPoint(at(x, edgeZ), eave + .016));
  }
  batch.attachTo(group);
  model.add(group);
}

function mainGate101Landings(model: Object3D): void {
  const { elevator, kids, lowerPaving, upperGrade } = MAIN_GATE_101;
  const group = new Group();
  group.name = 'SM_Rebuilt_Main_Gate_Landings';
  group.userData.castsSiteShadow = true;
  const batch = new SurfaceBatch();

  // The v9 lift was baked into the far end of the glass frontage, not into
  // the plan's square cabin by 101. Keep all other frontage and coping intact.
  const former = plan(650, 882), axis = unit(plan(650, 886), plan(692, 875));
  const previousCabin = ({ x, y, z }: Vector3): boolean => {
    const dx = x - former[0], dz = z - former[1];
    return y >= .55 && Math.abs(dx * axis[0] + dz * axis[1]) <= 2.23
      && Math.abs(-dx * axis[1] + dz * axis[0]) <= 2.14;
  };
  model.getObjectByName('SM_Main_Gate_Life_Support_Terrace')?.traverse(object => {
    if (isMesh(object) && /MAT_Gate_Support_(?:cap|stone|frame|glass|body)$/.test(finishName(object))) {
      keepTriangles(object, (...points) => !points.every(previousCabin));
    }
  });

  // The raised square over the lift is already on the residential deck.
  // Its lower door opens at the retaining line through a short recessed link,
  // leaving the vehicular loop and adjacent 108 frontage at their own grade.
  const center = plan(...elevator.planPx), d = elevator.halfWidth;
  const across: XZ = [-elevator.axis[1], elevator.axis[0]];
  const at = (x: number, z: number): XZ => add(add(center, elevator.axis, x), across, z);
  const highPaving = upperGrade + .208;
  upperParkPavers(batch, model, [[624.4,899.1],[627.9,899.8],[630.6,901],[633.65,904.4]],
    1.58, () => highPaving);
  batch.prism('stoneInset', 'path', rectangular(at, -d - .24, -d - .18, d + .15, d + .20),
    upperGrade - .11, highPaving + .034);
  batch.prism('limestone', 'limestone', rectangular(at, -d, -d, d, d), highPaving, elevator.roofY - .19);
  batch.prism('stoneInset', 'coping', rectangular(at, -d - .10, -d - .10, d + .10, d + .10),
    elevator.roofY - .194, elevator.roofY);
  batch.wall('door', at(-d - .013, -.72), at(-d - .013, .63), highPaving + .032, elevator.roofY - .32);
  batch.wall('facadeGlass', at(-d - .024, -.59), at(-d - .024, .50), highPaving + .12, elevator.roofY - .44);
  batch.wall('windowGlint', at(-d - .029, -.038), at(-d - .029, .036), highPaving + .13, elevator.roofY - .43);

  const door = plan(...elevator.lowerDoorPx), jamb = unit(plan(641, 901), plan(643, 911));
  const face: XZ = [jamb[1], -jamb[0]];
  const rim = (x: number, offset: number): XZ => add(add(door, jamb, x), face, offset);
  batch.wall('coping', rim(-1.20, .08), rim(1.20, .08), lowerPaving - .03, lowerPaving + 2.37);
  batch.wall('door', rim(-.80, .097), rim(.80, .097), lowerPaving, lowerPaving + 2.18);
  batch.wall('facadeGlass', rim(-.64, .112), rim(.64, .112), lowerPaving + .13, lowerPaving + 2.01);
  batch.wall('windowGlint', rim(-.028, .122), rim(.028, .122), lowerPaving + .14, lowerPaving + 2.0);

  // Raised pedestrian paving follows the 101 side of the car apron. The
  // waiting footprint is small and open; the plan does not show a building.
  upperParkPavers(batch, model, [[641.95,903.7],[644.3,906.9],[648.5,910.6],[653.5,913.5],
    [659.1,914.95],[667.2,917.35],[675.6,920.5],[683.2,923.2],[688.3,923.8],[695.6,920.8],[700.7,914.3]],
  1.42, () => lowerPaving);
  const pickUp = plan(...kids.planPx), cross: XZ = [-kids.axis[1], kids.axis[0]];
  const pad = (x: number, z: number): XZ => add(add(pickUp, kids.axis, x), cross, z);
  const w = kids.halfWidth, h = kids.halfDepth;
  batch.prism('stoneInset', 'coping', rectangular(pad, -w - .08, -h - .12, w + .08, h + .12),
    lowerPaving - .035, kids.surfaceY - .022);
  batch.plate('courtPaver', rectangular(pad, -w, -h, w, h), kids.surfaceY);
  const bench = rectangular(pad, -.83, h + .05, .83, h + .42);
  batch.prism('courtFrame', 'courtDeck', bench, kids.surfaceY + .37, kids.surfaceY + .46);
  for (const x of [-.65, .65]) batch.prism('courtFrame', 'courtFrame',
    rectangular(pad, x - .045, h + .11, x + .045, h + .33), lowerPaving, kids.surfaceY + .37);
  batch.attachTo(group);
  model.add(group);
}

/** Idempotent overlay for the checked-in v9 model. All children are owned by the viewer's model lifecycle. */
export function refineFacilityExteriors(model: Object3D): void {
  if (model.getObjectByName(FACADE)) return;
  model.updateMatrixWorld(true);
  const podiumWalk = communityExteriors(model);
  daycareEntrance(model);
  raiseNorthernParks(model);
  mainUpperEntry(model);
  upperOpenEntry(model);
  rebuildGuardhouses(model);
  mainGate101Landings(model);
  rebuildSeamPark(model);
  rebuildUpperRetail(model);
  upperPodiumPavers(model, podiumWalk);
  southPromenades(model);
  deForetCafe(model);
  refineBrochureGround(model);
  model.updateMatrixWorld(true);
}
