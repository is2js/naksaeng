import {
  BufferGeometry, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, Matrix3, Matrix4, Mesh, MeshStandardMaterial,
  Raycaster, ShapeUtils, Vector2, Vector3,
  type Object3D,
} from 'three';
import { SITE_FACILITIES } from './facility-markers';
import { MAIN_GATE_101 } from './facility-gate101-layout';
import { DAYCARE_ENTRY_FRONTAGE, DAYCARE_ENTRY_OUTWARD } from './facility-daycare-placement';
import { DAYCARE_COURTYARD } from './daycare-courtyard-layout';
import { siteTerrainSampler } from './site-terrain-sampler';
import { rebuildRiversideGrade } from './site-riverside-grade';
import { CAFE_PLAN, COMMUNITY_PROMENADE, PARK_PATHS, SUPERSEDED_WALK_SECTIONS } from './site-promenade-layout';
import { refineBrochureGround } from './facility-brochure-ground';
import { UPPER_AUX_GUARD, UPPER_DISTRICT_GRADE, UPPER_MAIN_DECK, upperAuxGrade, upperAuxRimGrade,
  upperDistrictRoadX, upperDistrictStreetRise } from './site-upper-main-layout';
import { MISTY_GARDEN } from './site-misty-foret-layout';
import { gradeUpperTerraces, subdivideSurfaceInPlan } from './site-upper-terraces';
import { raiseUpperTerraceAmenities } from './upper-terrace-amenities';

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
  portalIvory: '#ded9cb', portalReveal: '#bbb4a5', portalCharcoal: '#383d43', portalInset: '#232a2b',
  promenadeStone: '#bdb2a0', promenadeBand: '#716d64', promenadeTrim: '#e0d7c4',
  cafeGlass: '#62746f', cafeGlassLow: '#435651',
  daycareRubber: '#88a76b', daycareSage: '#a8be74', daycareMark: '#e1d4aa', daycareSky: '#9dbdba',
  daycareSlide: '#dc8b42', daycareLime: '#97af53', daycarePost: '#be9554',
  gardenBark: '#736356', gardenLeaf: '#657e4d', gardenBud: '#8e9f56', gardenFlower: '#d9b6ba', gardenBed: '#778e5e',
} as const;
type Finish = keyof typeof COLORS;

const FACADE = 'SM_Rebuilt_Community_Terraces';
const DAYCARE = 'SM_Rebuilt_Daycare_Pavilion';
const DAYCARE_GARDEN = 'SM_Rebuilt_Daycare_Courtyard';
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
  ].map(([d, y, c, l, r]): EntryStation => [d, y + UPPER_DISTRICT_GRADE.rise, c, l, r]),
};
const upperAuxFrame: EntryFrame = {
  origin: plan(454.8202, 421.2464), inward: [-.588649, .808389], across: [.808389, .588649],
  stations: [
    [4.34, .555, 0, 5.6, 5.7], [7.55, .584, 1.05, 4.65, 4.95],
    [10.7, .613, 1.5, 4.5, 4.32], [12.4, .628, 1.4, 4.45, 4.1],
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

/** Deform every lane, marking and curb in the same grade; leave the original trace in plan unchanged. */
function gradeUpperDistrictRoad(model: Object3D): void {
  const street = model.getObjectByName('SM_District_Arterial_Road_And_Sidewalk');
  const moved = new Vector3(), inverse = new Matrix4();
  const reshape = (root: Object3D | undefined, mode: 'street' | 'terrain' | 'edge') => root?.traverseVisible(object => {
    if (!isMesh(object) || (mode === 'terrain' && finishName(object) !== 'MAT_Site_Grass')) return;
    const geometry = object.geometry, pos = geometry.getAttribute('position');
    const verge = finishName(object) === 'MAT_District_Graded_Verge';
    inverse.copy(object.matrixWorld).invert();
    let changed = false;
    for (let i = 0; i < pos.count; i++) {
      moved.fromBufferAttribute(pos,i).applyMatrix4(object.matrixWorld);
      const rise = upperDistrictStreetRise(moved.z);
      if (rise < EPSILON) continue;
      const offset = moved.x - upperDistrictRoadX(moved.z);
      if (mode !== 'street') {
        if (Math.abs(offset) > 15.4) continue;
        const lift = rise * (1 - smoothStep((Math.abs(offset) - 6.3) / 9.1));
        // Raise only the low shoulder. Leave inboard tower pads and real
        // retaining faces at their authored elevation.
        const target = Math.max(moved.y, UPPER_DISTRICT_GRADE.lowerRoadY + lift - .29);
        if (target - moved.y < EPSILON) continue;
        moved.y = target;
      } else if (verge && moved.y < -.1) {
        // Keep the outer roadbed seated in the original woodland and fan the
        // embankment out rather than lifting its buried bottom into the air.
        if (offset <= 0) continue;
        moved.x += rise * 1.65;
      } else {
        // The roadbed and asphalt are triangulated separately. Recess the
        // bed on the slope so the two meshes cannot cross between samples.
        moved.y += rise - (verge ? .16 * smoothStep(rise / .14) : 0);
      }
      moved.applyMatrix4(inverse);
      pos.setXYZ(i,moved.x,moved.y,moved.z);
      changed = true;
    }
    if (!changed) return;
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  });
  reshape(street,'street');
  reshape(model.getObjectByName('SM_Parcels_Roads_And_Stream'),'terrain');
  reshape(model.getObjectByName('SM_East_West_Retaining_And_Main_Gate_Break'),'edge');
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

function entryPortal(batch: SurfaceBatch, frame: EntryFrame, station: number, width: number): void {
  const [, base, center] = entryProfile(frame, station);
  const at = (x: number, z: number): XZ => entryAt(frame, station + z, center + x);
  const post = width / 2;
  const roof = base + 3.87;
  for (const side of [-1, 1]) {
    const x = side * post;
    batch.prism('door', 'zinc', rectangular(at, x - .43, -.62, x + .43, .77), .47, roof + .14);
  }
  batch.prism('coping', 'coping', rectangular(at, -post - .72, -.80, post + .84, .83), roof -.39, roof + .12);
  batch.wall('stoneInset', at(-1.02, -.809), at(1.02, -.809), roof -.24, roof -.14);
}

const LOWER_PORTAL_ORIGIN = plan(711.847648526, 924.605104167);
const LOWER_PORTAL_INWARD: XZ = [-.953927569, -.300036987];
const LOWER_PORTAL_RIGHT: XZ = [.300036987, -.953927569];
const LOWER_PORTAL_GRADE = .48;

function lowerPortalAt(right: number, inward: number): XZ {
  return add(add(LOWER_PORTAL_ORIGIN, LOWER_PORTAL_INWARD, inward), LOWER_PORTAL_RIGHT, right);
}

/** Flyover proportions: thin ivory lintel, recessed supports, tall right blade, open walk bays. */
function mainPortal(model: Object3D, parent: Object3D, id: '101' | '110', frame?: EntryFrame, station = 0): void {
  const [, grade, center] = frame ? entryProfile(frame, station) : [0, LOWER_PORTAL_GRADE + .132, 0];
  // EntryFrame lateral coordinates face the driver's left; portal coordinates face right.
  const at = frame ? (right: number, inward: number): XZ => entryAt(frame, station + inward, center - right) : lowerPortalAt;
  const ground = (depth: number): number => frame ? entryProfile(frame, station + depth)[1] : grade;
  const lower = id === '101';
  const [leftBlade, rightBlade, walkwayPosts, edgeLeft, edgeRight] = lower
    ? [-6.82, 7.73, 4.43, -9.35, 9.34]
    : [-6.68, 7.38, 5.03, -8.65, 8.74];
  const finish = grade + (lower ? 4.94 : 4.70), cap = finish + (lower ? 1.84 : 1.74);
  const footing = Math.min(ground(-1.2), ground(1.2)) - .22;
  const group = new Group();
  group.name = `SM_Rebuilt_Main_Portal_${id}`;
  group.userData.castsSiteShadow = true;
  const batch = new SurfaceBatch();
  const rect = (x0: number, z0: number, x1: number, z1: number): XZ[] => rectangular(at, x0, z0, x1, z1);
  for (const x of [-walkwayPosts, walkwayPosts]) {
    batch.prism('portalCharcoal', 'portalInset', rect(x - .24, .05, x + .24, 1.19), footing, finish - .43);
    batch.prism('portalReveal', 'portalReveal', rect(x - .26, .02, x + .26, 1.22), footing, grade + .21);
  }
  batch.prism('portalCharcoal', 'portalCharcoal', rect(leftBlade - .56, -.85, leftBlade + .56, 1.05), footing, finish - .34);
  batch.prism('portalCharcoal', 'portalCharcoal', rect(rightBlade - .76, -.92, rightBlade + .76, 1.07), footing, cap - .12);
  batch.prism('portalReveal', 'portalIvory', rect(rightBlade - .80, -.97, rightBlade + .80, 1.12), cap - .13, cap);
  batch.wall('portalInset', at(rightBlade - .43, -.931), at(rightBlade + .38, -.931), grade + .31, cap - .33);
  batch.prism('portalReveal', 'portalIvory', rect(rightBlade - .39, -1.025, rightBlade - .29, -.927), grade + .57, cap - .38);

  batch.prism('portalCharcoal', 'portalCharcoal', rect(edgeLeft + .42, -1.14, edgeRight - .48, 1.17), finish - .54, finish - .42);
  batch.prism('portalReveal', 'portalReveal', rect(edgeLeft + .16, -1.33, edgeRight - .16, 1.32), finish - .43, finish - .31);
  batch.prism('portalIvory', 'portalIvory', rect(edgeLeft, -1.49, edgeRight, 1.48), finish - .33, finish);
  batch.prism('portalReveal', 'portalIvory', rect(edgeLeft + .16, 1.37, edgeRight - .16, 1.44), finish - .04, finish + .028);
  batch.prism('portalIvory', 'portalIvory', rect(-2.88, -1.55, 1.77, -1.46), finish - .34, finish - .062);
  // A real soffit keeps the shadow underside legible from the street, not just in the top view.
  batch.plate('portalInset', rect(edgeLeft + .42, -1.14, edgeRight - .48, 1.17), finish - .54);
  batch.attachTo(group);
  const lettering = model.getObjectByName('SM_Entry_Portals_And_Parking_Ramp')?.children.find(
    (node): node is Mesh<BufferGeometry> => isMesh(node) && finishName(node) === 'MAT_Entry_Original_Lettering',
  )?.material;
  if (lettering instanceof MeshStandardMaterial && lettering.map) {
    const xy = [groundPoint(at(-2.40, -1.553), finish - .288), groundPoint(at(1.29, -1.553), finish - .288),
      groundPoint(at(1.29, -1.553), finish - .116), groundPoint(at(-2.40, -1.553), finish - .116)];
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(xy.flat(), 3));
    geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.computeVertexNormals();
    const material = lettering.clone();
    material.side = DoubleSide;
    const sign = new Mesh(geometry, material);
    sign.name = `${group.name}_lettering`;
    group.add(sign);
  }
  parent.add(group);
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

function rebuildLowerMainPortal(model: Object3D): void {
  const bakedGate = model.getObjectByName('SM_Entry_Portals_And_Parking_Ramp');
  bakedGate?.traverse(node => {
    if (!isMesh(node) || !/^MAT_Entry_(?:Pale_Limestone|Ramp_Charcoal_Lattice|Recess_Shade|Light_Trim|Clad_Guardhouse_Stone|Original_Lettering)$/.test(finishName(node))) return;
    keepTriangles(node, (...verts) => {
      const points = verts.map(p => {
        const x = p.x - LOWER_PORTAL_ORIGIN[0], z = p.z - LOWER_PORTAL_ORIGIN[1];
        return { right: x * LOWER_PORTAL_RIGHT[0] + z * LOWER_PORTAL_RIGHT[1],
          inward: x * LOWER_PORTAL_INWARD[0] + z * LOWER_PORTAL_INWARD[1], h: p.y - LOWER_PORTAL_GRADE };
      });
      // The archived booths, planter, sidewalk and 105 ramp share this batch.
      // Crop the gateway by its measured bounds and target only its small low plinths.
      if (!points.every(p => p.inward >= -1.55 && p.inward <= 1.49 && Math.abs(p.right) <= 7.88 && p.h >= .055)) return true;
      if (points.some(p => p.h >= 3.55)) return false;
      if (points.every(p => Math.abs(Math.abs(p.right) - 4.49) <= .33 && p.inward >= -.25 && p.h <= .265)) return false;
      if (points.every(p => p.right >= 6.0 && p.right <= 7.49 && p.h <= .305) && points.some(p => p.right < 7.25)) return false;
      return true;
    });
  });
  mainPortal(model, model, '101');
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
// Page 4, north-up site plan: one creek-side walk, outside both the red
// Community II outline and the separate retail return. Keep the planted verge
// between its inside curb and the podium, including at the narrow NW shoulder.
const upperPodiumWalk = [[274,385], [271.5,394], [273.6,402], [279.9,415],
  [285.1,423], [297.4,441], [307.6,456], [316.0,470], [327.9,489], [335.4,503],
  [344.0,515], [352.3,520.4], [363.3,522.0], [373.5,520.1], [385,514],
  [401.8,501], [417.5,487], [430.2,476.3], [435.1,471.6], [437.35,469.26]]
  .map(([x, z]) => plan(x, z));

// Baked v9 route, retained here only to remove its old triangles. The source
// GLB combines both original finishes with the whole site's pedestrian layer.
const archivedPodiumWalk = [[274,385], [298,422], [320,459], [342,493], [359,518],
  [373,522], [390,511], [416,488], [431,475], [432,463]]
  .map(([x, z]) => plan(x, z));
const PODIUM_WALK_HALF_WIDTH = 1.78;
const RETAIL_ACCESS_WALK_Y = .76;

function stationAlongPolylines(route: readonly XZ[]) {
  const stations = [0];
  for (let i = 1; i < route.length; i++) {
    stations.push(stations[i - 1] + Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]));
  }
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
  return { stations, total: stations.at(-1)!, nearest };
}

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
  const { stations, total, nearest } = stationAlongPolylines(route);
  const legacy = stationAlongPolylines(roundedRoute(archivedPodiumWalk));
  const level = COMMUNITY_TWO_ROOF - PODIUM_VISIBLE_FLOOR + .06;
  const bakedPaths = model.getObjectByName('SM_Graded_Pedestrian_Routes');
  const originalWalk = siteTerrainSampler(bakedPaths ? [bakedPaths] : [], plan(260,374), plan(290,402));
  const startGrade = originalWalk(route[0], terrainAt(model, route[0], level-.19)+.19);
  // One longitudinal datum, independent of the irregular archived grass.
  // Spread the two level changes along the full approaches; the long west
  // retail frontage stays level and the return meets the low access apron.
  const northRun = Math.max(29, Math.abs(startGrade-level)*15);
  const southRun = 48, easeLength = 5;
  const accessBlend = (station: number): number => {
    const s = Math.max(0, Math.min(southRun, station - total + southRun));
    const gradedRun = southRun - easeLength;
    const distance = s < easeLength ? s*s/(2*easeLength) : s > southRun-easeLength
      ? gradedRun-(southRun-s)**2/(2*easeLength) : s-easeLength/2;
    return distance / gradedRun;
  };
  const pavingY = (station: number) => level + (startGrade - level) * (1 - smoothStep(station / northRun))
    + (RETAIL_ACCESS_WALK_Y - level) * accessBlend(station);
  const halfWidth = (station: number) => PODIUM_WALK_HALF_WIDTH
    - (PODIUM_WALK_HALF_WIDTH - 1.2) * smoothStep((station - total + 7.5) / 7.5);
  const first = route[0], last = route.at(-1)!;
  const firstAxis = unit(first,route[1]), lastAxis = unit(route[route.length-2],last);
  const podiumRoofs = [[outline, COMMUNITY_TWO_ROOF], [upperRetailOutline, UPPER_RETAIL_ROOF]] as const;
  const roofAreas = podiumRoofs.map(([ring, height]) => ({
    ring, height,
    minX: Math.min(...ring.map(p => p[0])) - 2.2, maxX: Math.max(...ring.map(p => p[0])) + 2.2,
    minZ: Math.min(...ring.map(p => p[1])) - 2.2, maxZ: Math.max(...ring.map(p => p[1])) + 2.2,
    outline: stationAlongPolylines([...ring, ring[0]]),
  }));
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
  const lower = (v: Vector3, keepRoofsClear = false): number => {
    let capped = Math.min(v.y, floorLimit([v.x, v.z]));
    // The original hill's coarse triangles can otherwise emerge as
    // triangular patches on the podium's planted roof.
    if (keepRoofsClear) for (const area of roofAreas) {
      if (v.x >= area.minX && v.x <= area.maxX && v.z >= area.minZ && v.z <= area.maxZ
        && (polygonContains([v.x, v.z], area.ring) || area.outline.nearest(v.x, v.z).distance < 2.0)) {
        capped = Math.min(capped, area.height - .16);
      }
    }
    const { distance, station } = nearest(v.x, v.z);
    const lateral = 1 - smoothStep((distance - halfWidth(station) - .64) / 2.55);
    const before = station < EPSILON ? (first[0]-v.x)*firstAxis[0]+(first[1]-v.z)*firstAxis[1] : 0;
    const beyond = station > total-EPSILON ? (v.x-last[0])*lastAxis[0]+(v.z-last[1])*lastAxis[1] : 0;
    const tie = 1 - smoothStep(Math.max(0,before,beyond) / 1.7);
    return v.y - (capped + (pavingY(station) - .085 - capped) * lateral * tie);
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
    if (!isMesh(node) || finishName(node) !== 'MAT_Site_Grass') return;
    // Subdivide only the local verge. The previous coarse triangles left
    // little humps inside the path even when their outer vertices were reset.
    subdivideSurfaceInPlan(node, (x,z) => nearest(x,z).distance < 5.08, .92);
    moveVertices(node, point => lower(point, true));
    // The original GLB has split vertices for its broad flat-shaded hills.
    // Along this narrow graded verge, use the same continuous normal on both
    // sides of those edges rather than exposing an artificial sawtooth.
    const surface = siteTerrainSampler([node], plan(254,371), plan(454,539));
    const pos = node.geometry.getAttribute('position'), nor = node.geometry.getAttribute('normal');
    if (!nor) return;
    const normal = new Vector3(), previous = new Vector3();
    const toLocal = new Matrix3().getNormalMatrix(inverse.copy(node.matrixWorld).invert());
    for (let i = 0; i < pos.count; i++) {
      point.fromBufferAttribute(pos,i).applyMatrix4(node.matrixWorld);
      const { x,y,z } = point, { distance } = nearest(x,z);
      if (distance > 5.3) continue;
      const step = .64;
      const dx = surface([x-step,z],y)-surface([x+step,z],y);
      const dz = surface([x,z-step],y)-surface([x,z+step],y);
      normal.set(dx,2*step,dz).applyNormalMatrix(toLocal);
      previous.fromBufferAttribute(nor,i).lerp(normal,1-smoothStep((distance-4.4)/.9)).normalize();
      nor.setXYZ(i,previous.x,previous.y,previous.z);
    }
    nor.needsUpdate = true;
  });

  // Remove the old arc at its own location, and remove any baked strip
  // intersecting the corrected course. The upstream junction stays in place.
  const withinRebuiltWalk = (p: Vector3) => {
    const old = legacy.nearest(p.x, p.z), next = nearest(p.x, p.z);
    return (old.distance < 2.58 && old.station > .10)
      || (next.distance < halfWidth(next.station) + .52 && next.station > .55 && next.station < total - .14);
  };
  const midpoint = new Vector3();
  bakedPaths?.traverse(node => {
    if (!isMesh(node) || !/^(?:MAT_Sandstone_Pedestrian_Pavers|MAT_Promenade_Paver_Coping)$/.test(finishName(node))) return;
    keepTriangles(node, (a, b, c) => !withinRebuiltWalk(midpoint.copy(a).add(b).add(c).multiplyScalar(1/3)));
    moveVertices(node, p => {
      const tie = nearest(p.x,p.z);
      if (tie.station < 1.8 && tie.distance < 3.2) return 0;
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
  return route.map((p, i) => ({ position: p, y: pavingY(stations[i]), halfWidth: halfWidth(stations[i]) }));
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

type PodiumWalkPoint = { position: XZ; y: number; halfWidth: number };

function upperPodiumPavers(model: Object3D, route: readonly PodiumWalkPoint[]): void {
  const terrace = model.getObjectByName(`${FACADE}_community-2`);
  if (!(terrace instanceof Group) || route.length < 2) return;
  const batch = new SurfaceBatch();
  const surfaces = ['SM_Parcels_Roads_And_Stream', `${SEAM_PARK}_siteGrass`]
    .map(name => model.getObjectByName(name)).filter((object): object is Object3D => object !== undefined);
  model.updateMatrixWorld(true);
  const groundY = siteTerrainSampler(surfaces, plan(262,374), plan(450,532));
  const course = route.flatMap((a, i) => {
    const b = route[i + 1];
    if (!b) return [a];
    const count = Math.ceil(Math.hypot(b.position[0] - a.position[0], b.position[1] - a.position[1]) / .55);
    return Array.from({ length: count }, (_, j) => ({ position: mix(a.position, b.position, j/count),
      y: a.y + (b.y - a.y) * j/count, halfWidth: a.halfWidth + (b.halfWidth - a.halfWidth) * j/count }));
  });
  const sections = course.map(({ position: p, y, halfWidth: w }, i) => {
    const [dx, dz] = unit(course[Math.max(0, i - 1)].position, course[Math.min(course.length - 1, i + 1)].position);
    const offsets = [-w, -w + .09, -w*.63, -w*.31, 0, w*.31, w*.63, w - .09, w];
    const edges = offsets.map(offset => add(p, [dz, -dx], offset));
    // No highest-edge probing: one profile carries the center and curbs.
    return edges.map(edge => groundPoint(edge, y));
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
  const paving = terrace.getObjectByName(`${terrace.name}_courtPaver`);
  // Match the adjoining v9 block-paved ribbon's material and world UV.
  // Only this new strip takes the shared material; community decks do not.
  if (!paving || !isMesh(paving)) return;
  model.getObjectByName('SM_Graded_Pedestrian_Routes')?.traverse(node => {
    if (!isMesh(node) || finishName(node) !== 'MAT_Sandstone_Pedestrian_Pavers'
      || Array.isArray(node.material) || paving.material === node.material) return;
    const position = paving.geometry.getAttribute('position');
    const uv = new Float32Array(position.count * 2);
    for (let i = 0; i < position.count; i++) {
      uv[i * 2] = position.getX(i) * .62;
      uv[i * 2 + 1] = 1 + position.getZ(i) * .62;
    }
    paving.geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    if (!Array.isArray(paving.material)) paving.material.dispose();
    paving.material = node.material;
  });
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

function daycareEntrance(model: Object3D): { threshold: XZ; sill: number } | undefined {
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
  return { threshold: at(center, front + .34), sill };
}

/** Remodel only the P4 play wedge and its approaches; keep the v9 shell and the 105 roof promenade. */
function daycareCourtyard(model: Object3D, entry: ReturnType<typeof daycareEntrance>): void {
  if (!entry) return;
  const toPlan = ([x, z]: XZ): XZ => [x / .52 + 490, z / .52 + 540];
  const fromPlan = ([x, z]: XZ): XZ => plan(x, z);
  const distance = (p: XZ, points: readonly XZ[]): number => points.slice(1).reduce((best, b, i) => {
    const a = points[i], vx = b[0] - a[0], vz = b[1] - a[1];
    const lengthSq = vx * vx + vz * vz;
    const t = lengthSq ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / lengthSq)) : 0;
    return Math.min(best, Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vz));
  }, Infinity);
  const formerLanes: readonly (readonly XZ[])[] = [
    [[408,656],[396,623],[391,600],[401,576],[419,559],[434,547],[451,532],[470,515],[481,504]],
    [[434,547],[455,554],[466,573],[478,597],[494,617]],
  ];
  const center = fromPlan(DAYCARE_COURTYARD.playCenter);
  const along: XZ = DAYCARE_COURTYARD.longSide, cross: XZ = [along[1], -along[0]];
  const at = (x: number, z: number) => add(add(center, cross, x), along, z);
  const world = new Vector3(), garden = model.getObjectByName('SM_Courtyard_Lawns_And_Play');
  garden?.traverseVisible(object => {
    if (!isMesh(object) || !/^MAT_Garden_/.test(finishName(object))) return;
    keepTriangles(object, (a, b, c) => {
      world.copy(a).add(b).add(c).multiplyScalar(1 / 3);
      const [x, z] = toPlan([world.x, world.z]);
      // Old rectangular pad, orange slide and the unreferenced oval beside it.
      return Math.hypot((x - 462) / 25, (z - 600) / 24) > 1 && Math.hypot((x - 491) / 19, (z - 583) / 21) > 1;
    });
  });
  const bakedWalk = model.getObjectByName('SM_Graded_Pedestrian_Routes');
  let pavingMaterial: MeshStandardMaterial | undefined;
  bakedWalk?.traverseVisible(object => {
    if (!isMesh(object) || !/^MAT_(?:Sandstone_Pedestrian_Pavers|Promenade_Paver_Coping)$/.test(finishName(object))) return;
    if (finishName(object) === 'MAT_Sandstone_Pedestrian_Pavers' && object.material instanceof MeshStandardMaterial) pavingMaterial = object.material;
    keepTriangles(object, (a, b, c) => {
      world.copy(a).add(b).add(c).multiplyScalar(1 / 3);
      const p = toPlan([world.x, world.z]);
      if (p[1] >= 654 || p[0] > 487 && p[1] > 612) return true;
      return !formerLanes.some(line => distance(p, line) < 4.6);
    });
  });
  // Remove just the old scatter inside this courtyard. Reuse the surrounding
  // baked trees and keep the parcel-wide scenery intact.
  const instance = new Matrix4();
  model.traverseVisible(object => {
    if (!(object instanceof InstancedMesh) || !object.parent?.name.startsWith('Courtyard_Grove_Instances')) return;
    let count = 0;
    for (let i = 0; i < object.count; i++) {
      object.getMatrixAt(i, instance);
      world.setFromMatrixPosition(instance).applyMatrix4(object.matrixWorld);
      const [x, z] = toPlan([world.x, world.z]);
      if (Math.hypot((x - 473) / 43, (z - 576) / 57) < 1) continue;
      if (i !== count) object.setMatrixAt(count, instance);
      count++;
    }
    if (count !== object.count) {
      object.count = count;
      object.instanceMatrix.needsUpdate = true;
      object.computeBoundingSphere();
    }
  });

  const group = new Group();
  group.name = DAYCARE_GARDEN;
  const batch = new SurfaceBatch();
  const surfaces = ['SM_Parcels_Roads_And_Stream', `${SEAM_PARK}_siteGrass`].flatMap(name => {
    const surface = model.getObjectByName(name);
    return surface ? [surface] : [];
  });
  const sample = siteTerrainSampler(surfaces, plan(370,480), plan(537,663));
  const base = (p: XZ) => sample(p, entry.sill - .20);
  const grade = (p: XZ) => base(p) + .123;
  const padY = Math.max(...[at(-5, -6.7), at(5, -6.7), at(5, 6.7), at(-5, 6.7), center].map(base)) + .086;
  const padOutline = [[-4.78,-6.6],[4.76,-6.6],[5.12,-6.2],[5.12,6.29],[4.72,6.7],[-4.74,6.7],[-5.12,6.24],[-5.12,-6.18]] as const;
  const inset = (scale: number) => padOutline.map(([u, v]) => at(u * scale, v * scale));
  batch.prism('stoneInset', 'daycareMark', inset(1), Math.min(padY - .22, base(center) - .06), padY);
  batch.plate('daycareRubber', inset(.937), padY + .009);
  batch.plate('daycareSage', [[-4.6,-2.9],[-2.4,-2.9],[-1.8,-4],[1.4,-4],[1.4,-2],[3.5,-1.7],
    [3.7,2.35],[1.2,2.35],[.65,4.4],[-3.75,4.4],[-4.6,3.15]].map(([x, z]) => at(x, z)), padY + .018);
  batch.plate('daycareMark', [[-2.6,4.65],[-2.6,2.05],[-1.5,1.15],[.6,1.15],[.6,-2.7],[2.35,-2.7],
    [2.35,-4.8],[3.38,-4.8],[3.38,-1.65],[1.63,-1.65],[1.63,2.15],[-.87,2.15],[-1.58,2.8],[-1.58,4.65]].map(([x,z]) => at(x,z)), padY + .026);
  for (const [u, v, w, d, finish] of [[-3.7,-3.2,1.2,1.4,'daycareSky'],[3.1,3.8,1.3,1.4,'daycareSlide'],[-3.5,4.9,1.4,.7,'daycareMark']] as const) {
    batch.plate(finish, rectangular(at, u, v, u + w, v + d), padY + .033);
  }
  const tower = (u: number, v: number) => at(u - 1.28, v - 2.0);
  const y = padY + .04;
  const box = (finish: Finish, u: number, v: number, w: number, d: number, h0: number, h1: number) =>
    batch.prism(finish, finish, rectangular(tower, u, v, u + w, v + d), y + h0, y + h1);
  for (const u of [-.72, .57]) for (const v of [-.70, .54]) box('daycarePost', u, v, .15, .15, 0, 2.83);
  box('daycareLime', -.86, -.82, 1.72, 1.66, 2.62, 2.83);
  box('daycareLime', -.60, -.60, 1.2, 1.2, 1.17, 1.29);
  for (const u of [-.70, .57]) box('daycarePost', u, -.64, .13, 1.29, 1.29, 1.84);
  for (let i = 1; i <= 4; i++) box('daycarePost', -.57, -.84 - (4-i)*.095, 1.13, .15, i*.25, i*.25+.08);
  const slide = [[.60,1.29],[1.14,1.2],[2.13,.64],[2.96,.22],[3.28,.13]] as const;
  for (let i = 1; i < slide.length; i++) {
    const [[a, h0], [b, h1]] = [slide[i - 1], slide[i]];
    batch.quad('daycareSlide', groundPoint(tower(-.42,a),y+h0),groundPoint(tower(.42,a),y+h0),
      groundPoint(tower(.42,b),y+h1),groundPoint(tower(-.42,b),y+h1));
    for (const u of [-.42,.42]) batch.quad('daycareSlide', groundPoint(tower(u,a),y+h0),groundPoint(tower(u,b),y+h1),
      groundPoint(tower(u,b),y+h1+.15),groundPoint(tower(u,a),y+h0+.15));
  }

  const usedPaths = DAYCARE_COURTYARD.paths.map(({ points, width }) => ({ points: roundedRoute(points), width }));
  const entryPath = [toPlan(entry.threshold), DAYCARE_COURTYARD.innerJunction];
  upperParkPavers(batch, model, entryPath, 2.13, p => {
    const t = Math.min(1, Math.hypot(p[0] - entry.threshold[0], p[1] - entry.threshold[1]) / 2.8);
    return entry.sill + .014 + (grade(p) - entry.sill) * smoothStep(t);
  });
  usedPaths.forEach(({ points, width }, index) => upperParkPavers(batch, model, points, width, p => grade(p) + .006 * index));
  // Short access spur from the porch side of the loop to the rubber edge.
  // Stop at the kerb; do not draw gravel paving across the play surface.
  const padEntry = at(-5.07,-5.1), loopEntry = plan(460.5,565.5);
  const playAccess = [toPlan(loopEntry),toPlan(padEntry)];
  upperParkPavers(batch, model, playAccess, 1.46, p => {
    const t = 1 - Math.min(1, Math.hypot(p[0]-padEntry[0],p[1]-padEntry[1]) / Math.hypot(loopEntry[0]-padEntry[0],loopEntry[1]-padEntry[1]));
    return (grade(p) + .027) * (1-t) + (padY + .016) * t;
  });
  const clear = (p: XZ, radius: number) => {
    const worldP = fromPlan(p), dx = worldP[0]-center[0], dz = worldP[1]-center[1];
    const [nx, nz] = DAYCARE_ENTRY_OUTWARD;
    const [bodyX, bodyZ] = fromPlan(DAYCARE_ENTRY_FRONTAGE.centerPlanPx);
    const wallX = worldP[0] - bodyX, wallZ = worldP[1] - bodyZ;
    return (Math.abs(dx*cross[0]+dz*cross[1]) > 5.14 + radius || Math.abs(dx*along[0]+dz*along[1]) > 6.71 + radius)
      && (Math.abs(wallX*nx+wallZ*nz) > DAYCARE_ENTRY_FRONTAGE.lengthMeters / 2 + radius
        || Math.abs(wallX*nz-wallZ*nx) > DAYCARE_ENTRY_FRONTAGE.widthMeters / 2 + radius)
      && distance(p, entryPath) * .52 > 1.04 + radius
      && distance(p, playAccess) * .52 > .73 + radius
      && distance(p, COMMUNITY_PROMENADE) * .52 > 1.725 + radius
      && usedPaths.every(path => distance(p, path.points) * .52 > path.width/2 + radius);
  };
  const mound = (p: XZ, start: number, radius: number, height: number, phase: number, colors: readonly Finish[], broad = false) => {
    const ring = Array.from({ length: 7 }, (_, i) => {
      const angle = phase + i * Math.PI * 2 / 7, r = radius * (1 + .13 * Math.sin(i * 4.1 + phase));
      return add(p,[Math.cos(angle),Math.sin(angle)],r);
    });
    const peak = groundPoint(add(p,[.17,-.24],radius),start + height);
    ring.forEach((a,i) => {
      const b = ring[(i+1)%ring.length], finish = colors[i % colors.length];
      if (!broad) batch.tri(finish,groundPoint(a,start),groundPoint(b,start),peak);
      else {
        // A wider shoulder and rounded lower edge read as broadleaf canopy,
        // rather than a row of conical background trees.
        const shoulderA = groundPoint(a,start+height*.47), shoulderB = groundPoint(b,start+height*.47);
        batch.quad(finish,groundPoint(mix(p,a,.54),start),groundPoint(mix(p,b,.54),start),shoulderB,shoulderA);
        batch.tri(finish,shoulderA,shoulderB,peak);
      }
    });
  };
  for (const { kind, points } of DAYCARE_COURTYARD.trees) points.forEach((p, i) => {
    if (!clear(p, .54)) return;
    const worldP = fromPlan(p), trunkY = base(worldP), height = 2.8 + (i % 4) * .34;
    const frame = (x: number, z: number): XZ => [worldP[0]+x,worldP[1]+z];
    batch.prism('gardenBark', 'gardenBark', rectangular(frame,-.091,-.085,.091,.085),trunkY,trunkY+height*.64);
    const shades = kind === 'flower' ? ['gardenFlower','gardenFlower','daycareMark'] as const : ['gardenLeaf','gardenBud','gardenLeaf'] as const;
    for (let j=0;j<3;j++) {
      const angle = i * 2.11 + j * Math.PI * 2/3, radius = .78 + (i % 3)*.12;
      mound(add(worldP,[Math.cos(angle),Math.sin(angle)],.58),trunkY+height*(.42+j*.045),radius,height*.62,angle,shades,true);
    }
  });
  DAYCARE_COURTYARD.beds.forEach((line, j) => {
    const samples = roundedRoute(line);
    for (let i = 1; i < samples.length; i++) {
      if (!clear(samples[i-1],.50) || !clear(samples[i],.50)) continue;
      const a = fromPlan(samples[i-1]), b = fromPlan(samples[i]), [vx,vz] = unit(a,b);
      const edges = [add(a,[-vz,vx],.47),add(a,[-vz,vx],-.47),add(b,[-vz,vx],-.42),add(b,[-vz,vx],.42)];
      const [r,s,t,u] = edges.map(p => groundPoint(p,base(p)+.035));
      batch.quad('gardenBed',r,s,t,u);
    }
    samples.filter((_, i) => i % 2 === 0).forEach((p,i) => {
      const q: XZ = [p[0]+Math.sin(i*9.1+j)*.68,p[1]+Math.cos(i*7.3)*.92];
      if (!clear(q,.30)) return;
      const point = fromPlan(q), size = .30 + (i % 4)*.075;
      mound(point,base(point)+.02,size,size*.85,i*1.27,['gardenLeaf','gardenBud',j%3 === 0 ? 'gardenFlower' : 'gardenLeaf']);
    });
  });
  batch.attachTo(group);
  group.traverse(node => {
    if (!isMesh(node) || !(node.material instanceof MeshStandardMaterial)) return;
    if (/gardenBark|gardenLeaf|gardenFlower|daycareLime|daycarePost|daycareSlide/.test(node.name)) node.userData.castsSiteShadow = true;
    if (!node.name.endsWith('_path') || !pavingMaterial?.map) return;
    const p = node.geometry.getAttribute('position'), uv: number[] = [];
    for (let i = 0; i < p.count; i++) uv.push(p.getX(i) * .62, 1 + p.getZ(i) * .62);
    node.geometry.setAttribute('uv',new Float32BufferAttribute(uv,2));
    node.material.map = pavingMaterial.map;
    node.material.color.copy(pavingMaterial.color);
  });
  model.add(group);
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

function upperBasementPortal(batch: SurfaceBatch, model: Object3D, frame: EntryFrame, roof: number): void {
  const end = frame.stations[frame.stations.length - 1];
  const at = (depth: number, cross: number): XZ => entryAt(frame, depth, end[2] + cross);
  const face = 27.4, back = 34.65, halfWidth = 4.5;
  const sill = end[1] - .08;
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
      const top = (r: XZ, floor: number) => Math.min(roof - .065, side > 0
        ? Math.max(floor + .17, terrainAt(model, add(r, frame.across, .30), floor + .25) + .05)
        : floor + .95);
      const pTop = top(p, a[1]), qTop = top(q, b[1]);
      batch.quad('courtFrame', groundPoint(p, a[1] - .18), groundPoint(p, pTop), groundPoint(q, qTop), groundPoint(q, b[1] - .18));
      batch.quad('stoneInset', groundPoint(p, pTop), groundPoint(q, qTop),
        groundPoint(add(q, frame.across, .17 * side), qTop), groundPoint(add(p, frame.across, .17 * side), pTop));
    }
  }
  batch.wall('coping', at(face - .03, -halfWidth - .31), at(face - .03, halfWidth + .31), roof - .39, roof + .045);
  batch.wall('door', at(back, -halfWidth), at(back, halfWidth), sill, roof - .3);
  batch.plate('courtFrame', rectangular(at, face, -halfWidth, back, halfWidth), roof - .34);
  batch.plate('asphalt', rectangular(at, end[0] - .013, -4.23, back, 4.23), end[1]);
}

/** Cut coarse archived triangles at the drive edges; moving only their vertices would leave grass over the ramp. */
function cutUpperBasementApproach(model: Object3D, frame: EntryFrame, extendToRoof = true): void {
  const [, y, center, left, right] = frame.stations.at(-1)!;
  const stations: readonly EntryStation[] = extendToRoof
    ? [...frame.stations, [34.66, y, center, left, right]] : frame.stations;
  const sections = stations.slice(1).map((b, i) => {
    const a = stations[i], incline = (y0: number, y1: number) => (d: number) => y0 + (y1 - y0) * (d - a[0]) / (b[0] - a[0]);
    return { start: a[0], end: b[0], left: incline(a[2] - a[3] - .06, b[2] - b[3] - .06),
      right: incline(a[2] + a[4] + .06, b[2] + b[4] + .06) };
  });
  const minCross = Math.min(...sections.map(s => Math.min(s.left(s.start), s.left(s.end))));
  const maxCross = Math.max(...sections.map(s => Math.max(s.right(s.start), s.right(s.end))));
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
            || triangle.every(p => p.cross < minCross) || triangle.every(p => p.cross > maxCross)) continue;
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

/** Close the structural garage roof without overlaying the surrounding park. */
function upperMainPlayDeck(batch: SurfaceBatch, model: Object3D): void {
  const { roofY, arrivalEdgePx, capBackPx, elevator, kids } = UPPER_MAIN_DECK;
  const frame = upperMainFrame;
  const arrival = arrivalEdgePx.map(([x, z]) => plan(x, z));
  const fascia = (d: number, side: number) => entryAt(frame, d, 1.43 + side * 4.81);
  const roofEdge = [fascia(27.4, -1), fascia(27.4, 1), fascia(34.68, 1), fascia(34.68, -1)];
  const outline = [...arrival, ...roofEdge, ...capBackPx.map(([x, z]) => plan(x, z))];

  const laneHeight = (d: number) => entryProfile(frame, d)[1];
  const arrivalStations = arrival.map(p => {
    const x = p[0] - frame.origin[0], z = p[1] - frame.origin[1];
    const depth = x * frame.inward[0] + z * frame.inward[1];
    const edge = x * frame.across[0] + z * frame.across[1];
    const [, floor, center, left] = entryProfile(frame, depth);
    const gutter = Math.max(edge + .08, center - left - .89);
    return { p, depth, edge, gutter, clipRight: center - left + .12, floor };
  });
  // Clear the actual paved shoulder between the purple trace and the ramp.
  // Polygon clipping (not just flattening vertices) prevents visible green
  // slivers from being stretched across the entry by an old terrain triangle.
  cutUpperBasementApproach(model, { ...frame, stations: arrivalStations.map(s => (
    [s.depth, s.floor, (s.edge + s.clipRight) / 2, (s.clipRight - s.edge) / 2, (s.clipRight - s.edge) / 2]
  )) }, false);

  // The broad parcel already has this grade. Infill only closes the garage
  // cut and retaining frontage, slightly inset beneath the inland lawn.
  batch.plate('siteGrass', outline, roofY - .018);
  const lowY = (d: number, side: number) => laneHeight(d) + .045 + side * .12;
  for (let i = 1; i < arrivalStations.length; i++) {
    const a = arrivalStations[i - 1], b = arrivalStations[i];
    const cross = (s: typeof a, j: number) => mix(entryAt(frame, s.depth, s.gutter), s.p, j);
    const at = (s: typeof a, j: number) => groundPoint(cross(s, j), lowY(s.depth, j));
    batch.quad('path', at(a, 0), at(a, 1), at(b, 1), at(b, 0));
    batch.quad('courtStone', groundPoint(a.p, lowY(a.depth, 1) - .13), groundPoint(a.p, roofY),
      groundPoint(b.p, roofY), groundPoint(b.p, lowY(b.depth, 1) - .13));
    const normal: XZ = [unit(a.p, b.p)[1], -unit(a.p, b.p)[0]];
    const inner = b.depth - a.depth > 2 ? .20 : .14;
    batch.quad('coping', groundPoint(add(a.p, normal, .09), roofY + .085),
      groundPoint(add(b.p, normal, .09), roofY + .085), groundPoint(add(b.p, normal, -inner), roofY + .085),
      groundPoint(add(a.p, normal, -inner), roofY + .085));
    batch.wall('stoneInset', add(a.p, normal, .016), add(b.p, normal, .016), roofY - .32, roofY - .265);
    batch.wall('limestone', add(a.p, normal, .015), add(b.p, normal, .015), roofY - 2.10, roofY - 2.072);
    const bays = Math.max(1, Math.round(Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]) / 3.65));
    for (let j = 1; j < bays; j++) {
      const joint = add(mix(a.p, b.p, j / bays), normal, .014);
      batch.wall('stoneJoint', joint, add(joint, unit(a.p, b.p), .024),
        lowY(a.depth + (b.depth - a.depth) * j / bays, 1), roofY - .31);
    }
  }
  // Close the edge at the public pavement; the dark substrate should not
  // show through where the new lower court meets the archived shoulder.
  const first = arrivalStations[0];
  const firstGutter = entryAt(frame, first.depth, first.gutter);
  const approachEdgeY = UPPER_DISTRICT_GRADE.arrivalY - .14;
  batch.quad('courtPaver', groundPoint(firstGutter, approachEdgeY), groundPoint(first.p, approachEdgeY),
    groundPoint(first.p, lowY(first.depth, 1)), groundPoint(firstGutter, lowY(first.depth, 0)));

  const origin = plan(...elevator.planPx), axis = elevator.axis;
  const liftAt = (x: number, z: number): XZ => add(add(origin, [-axis[1], axis[0]], x), axis, z);
  const w = elevator.halfWidth;
  const liftBaseY = UPPER_DISTRICT_GRADE.arrivalY + .12;
  // A single glazed shaft straddles the east retaining edge. Its lower
  // doors and the upper park landing are not two disconnected structures.
  batch.prism('courtStone', 'courtStone', rectangular(liftAt, -w, -1.19, w, 1.19), liftBaseY - .22, elevator.roofY - .14);
  batch.prism('stoneInset', 'coping', rectangular(liftAt, -w - .09, -1.27, w + .09, 1.27), elevator.roofY - .15, elevator.roofY);
  batch.wall('door', liftAt(-.76, -1.204), liftAt(.76, -1.204), roofY + .05, roofY + 2.16);
  batch.wall('facadeGlass', liftAt(-.64, -1.222), liftAt(.64, -1.222), roofY + .13, roofY + 2.07);
  batch.wall('windowGlint', liftAt(-.025, -1.227), liftAt(.025, -1.227), roofY + .14, roofY + 2.06);
  batch.wall('door', liftAt(-.98, 1.202), liftAt(.98, 1.202), liftBaseY + .04, elevator.roofY - .38);
  batch.wall('entranceGlass', liftAt(-.85, 1.217), liftAt(.85, 1.217), liftBaseY + .16, elevator.roofY - .54);
  batch.wall('windowGlint', liftAt(-.027, 1.231), liftAt(.027, 1.231), liftBaseY + .17, elevator.roofY - .55);
  batch.wall('facadeSash', liftAt(-.86, 1.232), liftAt(.86, 1.232), roofY + .07, roofY + .15);
  batch.plate('courtPaver', rectangular(liftAt, -1.26, 1.21, 1.26, 2.53), liftBaseY + .027);

  const pad = plan(...kids.planPx), [dx, dz] = kids.axis;
  const padAt = (x: number, z: number): XZ => add(add(pad, [dx, dz], x), [-dz, dx], z);
  batch.prism('stoneInset', 'courtPaver', rectangular(padAt, -kids.halfWidth, -kids.halfDepth, kids.halfWidth, kids.halfDepth),
    liftBaseY - .18, kids.surfaceY);
  batch.prism('courtFrame', 'courtDeck', rectangular(padAt, -.93, .88, .93, 1.19), kids.surfaceY + .31, kids.surfaceY + .43);
  for (const x of [-.72, .72]) batch.prism('courtFrame', 'courtFrame',
    rectangular(padAt, x - .045, .91, x + .045, 1.16), liftBaseY, kids.surfaceY + .315);
  upperParkPavers(batch, model, [[340, 194.9], [339.6, 199.2], [342.2, 203.5], [345.8, 207.55]],
    1.64, () => roofY + .078);
  upperParkPavers(batch, model, [[353.4, 215.6], [354, 213.8], [352.7, 212.4], [351.9, 211.65]],
    .98, () => liftBaseY + .047);
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
  const group = new Group();
  group.name = UPPER_MAIN;
  group.userData.castsSiteShadow = true;
  const batch = new SurfaceBatch();
  upperMainPlayDeck(batch, model);
  // Match the cut to the full pedestrian shoulder, not just asphalt width.
  cutUpperBasementApproach(model, { ...upperMainFrame, stations: upperMainFrame.stations.map(
    ([depth, y, center, left, right]) => [depth, y, center, left + .84, right + .84],
  ) });
  paveEntry(batch, model, upperMainFrame, false);
  mainPortal(model, group, '110', upperMainFrame, 14.15);
  // The old cut left a hole in the street's raised sidewalk. A short strip
  // restores continuity south of the relocated throat without touching the lanes.
  const a = plan(355.4, 260.0), b = plan(354.8, 279.2);
  const skirtHeight = (point: XZ) => UPPER_DISTRICT_GRADE.lowerRoadY + upperDistrictStreetRise(point[1]);
  const patch = (finish: Finish, offset: number, half: number, raise: number) => {
    const edge = (p: XZ, side: number) => groundPoint(add(p,[1,0],offset+half*side),skirtHeight(p)+raise);
    batch.quad(finish,edge(a,-1),edge(a,1),edge(b,1),edge(b,-1));
  };
  patch('path',0,.64,.012);
  patch('coping',.7,.08,.047);
  upperBasementPortal(batch, model, upperMainFrame, UPPER_MAIN_DECK.roofY);
  // Retain the wide park loop. Short links shown behind 111/112 meet its
  // pale pedestrian pavement rather than extending the vehicular entrance.
  upperParkPavers(batch, model, [[301, 52], [305, 66], [306, 78], [304, 91], [303, 99]], 2.05);
  upperParkPavers(batch, model, [[223, 50], [222, 60], [229, 69], [238, 78]], 1.60);
  upperParkPavers(batch, model, [[398, 88], [392, 100], [385, 106], [378, 113]], 1.74);
  batch.attachTo(group);
  model.add(group);
}

const MISTY_ROOF = UPPER_DISTRICT_GRADE.mistyRoofY;
const MISTY_FLOOR = MISTY_ROOF - PODIUM_VISIBLE_FLOOR;

function shareMistyPavers(model: Object3D, group: Group): void {
  const paving = model.getObjectByName('SM_Graded_Pedestrian_Routes')?.children.find((node): node is Mesh =>
    isMesh(node) && finishName(node) === 'MAT_Sandstone_Pedestrian_Pavers')?.material;
  const path = group.getObjectByName(`${group.name}_path`);
  if (paving instanceof MeshStandardMaterial && paving.map && path && isMesh(path) && path.material instanceof MeshStandardMaterial) {
    const pos = path.geometry.getAttribute('position'), uv: number[] = [];
    for (let i = 0; i < pos.count; i++) uv.push(pos.getX(i)*.62,1+pos.getZ(i)*.62);
    path.geometry.setAttribute('uv',new Float32BufferAttribute(uv,2));
    path.material.map = paving.map;
    path.material.color.copy(paving.color);
  }
}

/** P4 north-up trace: the east edge retains an upper garden; the south edge meets the parking roof. */
function buildMistyForet(model: Object3D, parkingRoofEdge: readonly [XZ, XZ]): (readonly [XZ, XZ, XZ, XZ])[] {
  const streetEdge = [[342, 288], [341, 302], [345, 320], [353, 340], [365, 359],
    [378, 375], [389, 388]].map(([x, z]) => plan(x, z)).concat([parkingRoofEdge[0]]);
  const walkEdge = [[376, 394], [357, 374], [339, 354], [322, 335], [309, 319], [304, 310],
    [309, 301], [323, 293]].map(([x, z]) => plan(x, z));
  const outline = [...streetEdge, parkingRoofEdge[1], ...walkEdge];
  const sections = streetEdge.slice(1).map((b, i) => {
    const a = streetEdge[i], tangent = unit(a, b), outward: XZ = [tangent[1], -tangent[0]];
    return { a, b, tangent, outward, length: Math.hypot(b[0] - a[0], b[1] - a[1]) };
  });
  const streetGrade = (p: XZ) => UPPER_DISTRICT_GRADE.lowerRoadY + upperDistrictStreetRise(p[1]);
  const bankEdge = (p: XZ) => Math.min(MISTY_ROOF-.28, Math.max(MISTY_FLOOR-.12, streetGrade(p)+.36));
  // Lower the coarse archived grassy bank outboard of the wall. Do not lift
  // the street or purge the continuing path and 109's existing tower pads.
  const inLocalSite = ([x, z]: XZ) => x > plan(291, 0)[0] && x < plan(422, 0)[0]
    && z > plan(0, 276)[1] && z < plan(0, 412)[1];
  const limit = (p: XZ): number | null => {
    if (!inLocalSite(p)) return null;
    let ceiling = polygonContains(p, outline) ? MISTY_ROOF - .32 : Infinity;
    for (const {a, tangent, outward, length} of sections) {
      const dx = p[0] - a[0], dz = p[1] - a[1];
      const t = dx * tangent[0] + dz * tangent[1], d = dx * outward[0] + dz * outward[1];
      if (t < -3.8 || t > length + 3.8 || d < -2.6 || d > 14) continue;
      const fade = Math.max(smoothStep(Math.max(0,-t,t-length) / 3.8), smoothStep((-d - .38) / 2.22),
        smoothStep((d - 10.25) / 3.75));
      ceiling = Math.min(ceiling, bankEdge(p)-.33 + 4.9 * fade);
    }
    return Number.isFinite(ceiling) ? ceiling : null;
  };
  lowerEntryGround(model, limit);
  const oldOval = (p: Vector3) => p.x > plan(295, 0)[0] && p.x < plan(371, 0)[0]
    && p.z > plan(0, 308)[1] && p.z < plan(0, 389)[1];
  model.getObjectByName('SM_Courtyard_Lawns_And_Play')?.traverse(object => {
    if (isMesh(object) && finishName(object).startsWith('MAT_Garden_')) {
      keepTriangles(object, (...points) => !points.every(oldOval));
    }
  });

  const group = new Group();
  group.name = 'SM_Rebuilt_Misty_Foret';
  group.userData.castsSiteShadow = true;
  const b = new SurfaceBatch();
  b.plate('roofLawn', outline, MISTY_ROOF);
  for (const {a, b: end, tangent, outward, length} of sections) {
    const on = (t: number, d: number): XZ => add(add(a, tangent, t), outward, d);
    // Real retaining face, stone footing, horizontal coping and recessed
    // stone bays. Opaque stone avoids implying retail entrances under the lawn.
    b.wall('courtStone', a, end, .39, MISTY_ROOF);
    b.wall('stoneInset', on(0,.025), on(length,.025), MISTY_FLOOR-.22, MISTY_FLOOR+.28);
    b.prism('limestone', 'coping', rectangular(on, 0, -.13, length, .21), MISTY_ROOF-.31, MISTY_ROOF+.11);
    const bays = Math.max(1, Math.round(length / 3.42));
    for (let i = 0; i < bays; i++) {
      const start = length * i / bays, finish = length * (i+1) / bays;
      b.wall('limestone', on(start+.25,.022), on(finish-.24,.022), MISTY_FLOOR+.3, MISTY_ROOF-.38);
      b.wall('stoneJoint', on(finish-.17,.026), on(finish-.147,.026), MISTY_FLOOR+.25, MISTY_ROOF-.31);
      b.wall('stoneJoint', on(start+.05,.04), on(finish-.07,.04), MISTY_FLOOR+1.26, MISTY_FLOOR+1.295);
    }
  }
  const parcels = model.getObjectByName('SM_Parcels_Roads_And_Stream');
  const sample = siteTerrainSampler(parcels ? [parcels] : [],plan(291,276),plan(422,420));
  const level = (p: XZ) => sample(p,MISTY_ROOF-.78);
  // The low planting verge belongs to this face, not the upper garden.
  // Replace only the grass between wall and sidewalk; whole source triangles
  // here used to poke through the facing as jagged piles along the roadway.
  const avenueEdge = [[352,288],[354,302],[355.7,320],[362,340],[371.1,359],[381.6,375],
    [392.5,388],[404.2,399.14]].map(([x,z]) => plan(x,z));
  const shoulder = streetEdge.map((p,i) => {
    const q=avenueEdge[i];
    const innerY = bankEdge(p);
    const outerY = Math.min(MISTY_ROOF-.29, streetGrade(q)+.003);
    return [0,.26,.52,.78,1].map(t => groundPoint(mix(p,q,t), innerY+(outerY-innerY)*smoothStep(t)));
  });
  const cuts: (readonly [XZ, XZ, XZ, XZ])[] = [];
  for (let i=1;i<streetEdge.length;i++) {
    const a=shoulder[i-1], e=shoulder[i];
    cuts.push([streetEdge[i-1],avenueEdge[i-1],avenueEdge[i],streetEdge[i]]);
    for (let j=1;j<a.length;j++) b.quad('siteGrass',a[j-1],e[j-1],e[j],a[j]);
  }
  // The long park side faces the main pedestrian ribbon. Low stone on this
  // side only fills the tolerance gap where the saved ground converges.
  const west = [parkingRoofEdge[1], ...walkEdge, streetEdge[0]];
  for (let i = 1; i < west.length; i++) {
    const a = west[i-1], end = west[i];
    b.wall('limestone',a,end,Math.min(MISTY_ROOF-.14,level(a)-.38,level(end)-.38),MISTY_ROOF);
  }
  // Keep the broad 109/110 exterior promenade outside the garden. The
  // shaded paths in the plan are the short internal branches and an
  // independently traceable narrow spine, not a second promenade.
  const pavingY = MISTY_ROOF+.055;
  upperParkPavers(b, model, MISTY_GARDEN.spine, 1.54, () => pavingY);
  const promenade = model.getObjectByName('SM_Graded_Pedestrian_Routes');
  const walkHeight = siteTerrainSampler(promenade ? [promenade] : [],plan(291,276),plan(422,420));
  const join = (points: readonly XZ[]) => {
    const a = plan(...points[0]), q = plan(...points[points.length-1]), dir = unit(a,q);
    const length = Math.hypot(q[0]-a[0],q[1]-a[1]);
    const outerY = walkHeight(a,level(a)+.22)+.024;
    // Reach the flat paving before the link crosses the lawn edge. Using the
    // full length would hide its sloped end behind the deck or leave a step.
    let start = 0, end = length;
    for (let i = 0; i < 8; i++) {
      const at = (start+end)/2;
      if (polygonContains(add(a,dir,at),outline)) end = at;
      else start = at;
    }
    const landing = Math.min(length,Math.max(.40,end-.42));
    upperParkPavers(b, model, points, 1.36, p => {
      if (polygonContains(p,outline)) return pavingY;
      const along = (p[0]-a[0])*dir[0]+(p[1]-a[1])*dir[1];
      return Math.max(sample(p,outerY-.09)+.024,outerY + (pavingY-outerY)*smoothStep(along/landing));
    });
  };
  MISTY_GARDEN.links.forEach(join);
  for (const {center, axis, length, width} of MISTY_GARDEN.pockets) {
    const position = plan(center[0], center[1]), side: XZ = [axis[1], -axis[0]];
    const at = (u: number, v: number) => add(add(position, axis, u), side, v);
    const l = length/2, w = width/2, bevel = .46;
    const bay = [at(-l+bevel,-w),at(l-bevel,-w),at(l,-w+bevel),at(l,w-bevel),
      at(l-bevel,w),at(-l+bevel,w),at(-l,w-bevel),at(-l,-w+bevel)];
    b.plate('courtPaver',bay,pavingY+.018);
    // A narrow edging line and two low seats leave the diagonal through
    // route visibly open. Seating is diagrammatic (not a furniture claim).
    for (const v of [-w+.12,w-.12]) b.strip('coping',at(-l+bevel,v),at(l-bevel,v),.12,pavingY+.024);
    for (const u of [-l+.85, l-.86]) {
      b.prism('stoneInset','deck',rectangular(at,u-.59,w-.69,u+.59,w-.29),pavingY+.018,pavingY+.47);
    }
  }
  const flora = (p: XZ, radius: number, tall: number, type: Finish, seed: number, trunk = 0, surfaceY: number = MISTY_ROOF) => {
    const ring: XZ[] = Array.from({length:6},(_,i) => {
      const theta = seed + i * Math.PI / 3;
      return add(p,[Math.cos(theta),Math.sin(theta)],radius*(.84+.13*((i+seed)%3)));
    });
    const top = groundPoint(add(p,[.16,-.17],radius),surfaceY+trunk+tall);
    const mid = surfaceY+trunk+tall*.42;
    for (let i = 0; i < ring.length; i++) {
      b.tri(type,groundPoint(ring[i],mid),groundPoint(ring[(i+1)%ring.length],mid),top);
      b.tri(type,groundPoint(ring[(i+1)%ring.length],mid),groundPoint(ring[i],mid),groundPoint(p,surfaceY+trunk+.04));
    }
  };
  const blossom = (mid: XZ, radius: number, tall: number, type: Finish, seed: number, surfaceY: number) => {
    b.prism('gardenBark','gardenBark',[[mid[0]-.11,mid[1]-.11],[mid[0]+.11,mid[1]-.11],
      [mid[0]+.11,mid[1]+.11],[mid[0]-.11,mid[1]+.11]],surfaceY-.12,surfaceY+tall);
    flora(mid,radius,tall,type,seed,tall-.35,surfaceY);
  };
  for (const [i, bed] of MISTY_GARDEN.beds.entries()) {
    const ring = bed.map(([x,z]) => plan(x,z));
    const mid = ring.reduce<XZ>((sum,p) => add(sum,p,1/ring.length),[0,0]);
    const softBand = ring.map(p => mix(p,mid,.23));
    b.plate('gardenBed',ring,MISTY_ROOF+.017);
    const radius = 1.05+(i%4)*.16;
    const tall = 1.9+(i%3)*.29;
    blossom(mid,radius,tall,i%3===0?'gardenFlower':'gardenLeaf',i,MISTY_ROOF+.018);
    // Low, laid-out understory in clustered beds, not an equally spaced
    // single line of the same tree along the whole street frontage.
    for (let j = 0; j < softBand.length; j++) {
      const p = mix(softBand[j],softBand[(j+1)%softBand.length],.18+(j%3)*.14);
      flora(p,.42+(j%4)*.11,.48+(j%3)*.23,j%3===0?'gardenBud':'hedge',i+j);
    }
  }
  for (const [i,[x,z]] of MISTY_GARDEN.promenadeBlooms.entries()) {
    const p = plan(x,z), y = polygonContains(p,outline) ? MISTY_ROOF : level(p);
    blossom(p,1.12+(i%3)*.21,1.47+(i%4)*.14,'gardenFlower',i+2,y);
    flora(add(p,[-.68,.36]),.48,.62,'gardenBud',i,0,y);
  }
  b.attachTo(group);
  shareMistyPavers(model,group);
  model.add(group);
  return cuts;
}

/** Shared surface apron; the two branches separate before the garage and retail walk. */
function upperOpenEntry(model: Object3D): void {
  const oldRamp = model.getObjectByName('SM_Seam_North_Covered_Parking_Ramp');
  if (oldRamp) oldRamp.visible = false;
  const group = new Group();
  group.name = DRIVE;
  group.userData.castsSiteShadow = true;
  const batch = new SurfaceBatch();
  paveEntry(batch, model, upperAuxFrame, false);
  entryPortal(batch, upperAuxFrame, 10.25, 7.65);
  // Crescent-shaped planted shoulder, following the gray turnout around it.
  const island = [[440.2,421.8],[436.3,424.4],[432.9,427.6],[433.9,429.1],
    [437.6,431.6],[440.2,430.9],[442.3,427.3]].map(([x, z]) => plan(x, z));
  batch.prism('limestone', 'siteGrass', island, .54, 1.03);
  const terminal = upperAuxFrame.stations.at(-1)!;
  const apronGrade = upperAuxGrade;
  const face = plan(405.7, 414.6), axis = unit(plan(413.8, 426.1), face);
  const cross: XZ = [axis[1], -axis[0]];
  const portalAt = (depth: number, lateral: number): XZ => add(add(face, axis, depth), cross, lateral);
  const throatY = apronGrade(face);
  const [stemLeft,stemRight] = [entryAt(upperAuxFrame,terminal[0],terminal[2]-terminal[3]),
    entryAt(upperAuxFrame,terminal[0],terminal[2]+terminal[4])];
  // North-up registration of the attached plan. Follow the north island,
  // the garage face, and the full strip to the walk beside the guardhouse.
  // It is one continuous paved apron, not two ribbons split by a mound.
  const px = (points: readonly XZ[]) => points.map(([x,z])=>plan(x,z));
  const north = px([[432.6,434.7],[427,433.1],[422.2,430.7],[417.8,427.4],[413.8,422.3],[411.0,416.2]]);
  const south = px([[404.3,423.9],[409.1,430.4],[415.3,436.8],[423.9,444.6],[430.7,452.9],
    [434.2,459.3],[437.0,465.4],[438.65,468.9],[441.0,470.15],[443.4,469.25],[446.1,465.2],
    [447.9,461.2],[448.35,457.8],[448.8,453.1],[449.2,448.4]]);
  const road = [stemLeft,...north,portalAt(0,-3.23),portalAt(0,3.23),...south,stemRight];
  const triangles=ShapeUtils.triangulateShape(road.map(p=>new Vector2(...p)),[]);
  for (const [a,b,c] of triangles) {
    const at=(i:number)=>groundPoint(road[i],apronGrade(road[i]));
    batch.tri('asphalt',at(a),at(b),at(c));
  }
  const covered = [0,2.6,7.4];
  const coverAt=(i:number,s:number): XYZ=> {
    const p=portalAt(covered[i],s);
    return groundPoint(p,i===0 ? apronGrade(p) : throatY-(i===2?.31:0));
  };
  for (let i=1;i<covered.length;i++) batch.quad('asphalt',coverAt(i-1,-3.23),coverAt(i-1,3.23),coverAt(i,3.23),coverAt(i,-3.23));
  // Backfill the legacy excavated court at the same datum as the new
  // surface, extending through the guardhouse rather than stopping at it.
  const pad = px([[429.5,441],[440.5,439],[452.9,438.8],[465.2,445.5],[460.2,451.9],
    [451.4,463.5],[442.1,474.3],[433.6,474.1],[426,467.8],[421.1,458.6],[423.6,450.6]]);
  const padTriangles=ShapeUtils.triangulateShape(pad.map(p=>new Vector2(...p)),[]);
  for (const [a,b,c] of padTriangles) {
    const at=(i:number)=>groundPoint(pad[i],apronGrade(pad[i])-.064);
    batch.tri('siteGrass',at(a),at(b),at(c));
  }
  const deckHeight = MISTY_ROOF;
  const vergeCuts = buildMistyForet(model, [portalAt(7.43,-3.49), portalAt(7.43,3.49)]);
  // The v9 tree at the new tunnel mouth must sit on the planted roof, not
  // grow from the drive under it. All instanced parts share the same pivot.
  const tree = new Vector3(), treeMatrix = new Matrix4(), treeInverse = new Matrix4();
  model.traverse(node => {
    if (!(node instanceof InstancedMesh) || !node.parent?.name.startsWith('Courtyard_Grove_Instances')) return;
    treeInverse.copy(node.matrixWorld).invert();
    let moved = false;
    for (let i=0;i<node.count;i++) {
      node.getMatrixAt(i,treeMatrix);
      tree.setFromMatrixPosition(treeMatrix).applyMatrix4(node.matrixWorld);
      const dx = tree.x-face[0], dz = tree.z-face[1];
      const depth = dx*axis[0]+dz*axis[1], lateral = dx*cross[0]+dz*cross[1];
      if (depth < -4.85 || depth > 7.43 || Math.abs(lateral)>3.49) continue;
      const p = portalAt(3.45+Math.max(depth,-2.1)*.25,1.77);
      treeMatrix.setPosition(tree.set(p[0],deckHeight+.02,p[1]).applyMatrix4(treeInverse));
      node.setMatrixAt(i,treeMatrix);
      moved = true;
    }
    if (moved) {
      node.instanceMatrix.needsUpdate = true;
      node.computeBoundingBox();
      node.computeBoundingSphere();
    }
  });
  const cutSections: (readonly XZ[])[] = [];
  const stemRows = upperAuxFrame.stations.map(([d,,c,l,r])=>[entryAt(upperAuxFrame,d,c-l-.92),entryAt(upperAuxFrame,d,c+r+.92)] as const);
  stemRows.slice(1).forEach((r,i)=>cutSections.push([stemRows[i][0],stemRows[i][1],r[1],r[0]]));
  for (const ids of triangles) cutSections.push(ids.map(i=>road[i]));
  cutSections.push(rectangular((l,d)=>portalAt(d,l),-3.24,0,3.24,7.44));
  // Trim the decoded grass triangles on the exact corridor edges. Lowering
  // the corners of the coarse source triangles instead drapes grass across
  // the asphalt (and would also pull the upper park's path into the tunnel).
  const grass = model.getObjectByName('SM_Parcels_Roads_And_Stream')?.children.find((node): node is Mesh =>
    isMesh(node) && finishName(node) === 'MAT_Site_Grass');
  if (grass) {
    // Keep an even planted shoulder around the new low apron. Trimmed road
    // cut edges and the adjacent ground use the same gently sloped datum.
    const localLo=plan(397,409), localHi=plan(475,501);
    const shoulderDistance = (x: number, z: number) => {
      if (x<localLo[0] || x>localHi[0] || z<localLo[1] || z>localHi[1]) return Infinity;
      let result=Infinity;
      for (const ring of cutSections) for (let i=0;i<ring.length;i++) {
        const a=ring[i], b=ring[(i+1)%ring.length], dx=b[0]-a[0], dz=b[1]-a[1];
        const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz || 1)));
        result=Math.min(result,Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t));
      }
      return result;
    };
    const apronRim=stationAlongPolylines([...pad,pad[0]]);
    const padWeight=(x:number,z:number) => 1-smoothStep((apronRim.nearest(x,z).distance-.42)/2.58);
    const rimWeight=(x:number,z:number) => {
      const px=x/.52+490, pz=z/.52+540;
      if (px<415 || px>473 || pz<438 || pz>500) return 0;
      const seamZ=446+(466-px)*32/27;
      return smoothStep((px-415)/9)*smoothStep((473-px)/5)*smoothStep((pz-438)/7)*smoothStep((seamZ+17-pz)/9);
    };
    subdivideSurfaceInPlan(grass,(x,z)=>shoulderDistance(x,z)<3.8 || padWeight(x,z)>.005 || rimWeight(x,z)>.025,1.05);
    const lanePosition=grass.geometry.getAttribute('position'), world=new Vector3(), inverse=grass.matrixWorld.clone().invert();
    for (let i=0;i<lanePosition.count;i++) {
      world.fromBufferAttribute(lanePosition,i).applyMatrix4(grass.matrixWorld);
      const distance=shoulderDistance(world.x,world.z);
      const weight = Math.max(1-smoothStep((distance-.66)/2.49),padWeight(world.x,world.z));
      const rim = rimWeight(world.x,world.z);
      if (Math.max(weight,rim) < EPSILON) continue;
      const p: XZ=[world.x,world.z], front=apronGrade(p)-.045;
      world.y+=(upperAuxRimGrade(p,world.y)-world.y)*rim;
      world.y+=(front-world.y)*weight;
      world.applyMatrix4(inverse);
      lanePosition.setXYZ(i,world.x,world.y,world.z);
    }
    grass.geometry.computeVertexNormals();
    type ClipVertex = { readonly x: number; readonly z: number; readonly attrs: readonly (readonly number[])[] };
    const source = grass.geometry, position = source.getAttribute('position');
    const attributes = Object.entries(source.attributes);
    const index = source.getIndex(), vertex = new Vector3();
    const cut = [...cutSections, ...padTriangles.map(ids=>ids.map(i=>pad[i])), ...vergeCuts].map(polygon => {
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
  const edge = (p: XZ, q: XZ, out: XZ) => {
    const a = apronGrade(p), b = apronGrade(q), r = add(q,out,.17), s = add(p,out,.17);
    batch.quad('coping',groundPoint(p,a+.029),groundPoint(q,b+.029),groundPoint(r,b+.024),groundPoint(s,a+.024));
    batch.quad('stoneInset',groundPoint(p,a-.13),groundPoint(q,b-.13),groundPoint(q,b+.028),groundPoint(p,a+.028));
  };
  for (let i=0;i+1<road.length;i++) {
    if (i===north.length+1 || i===north.length+9) continue; // garage threshold and flush walk connection
    const p=road[i], q=road[i+1], [dx,dz]=unit(p,q);
    edge(p,q,[-dz,dx]);
  }
  const garageStripe=px([[435.6,441.8],[429.1,437.9],[421.1,433.6],[415.7,428.1],[410.6,420.5]]);
  for (let i=1;i<garageStripe.length;i++) {
    const p=garageStripe[i-1], q=garageStripe[i], [dx,dz]=unit(p,q);
    const line=(v:XZ,s:number)=>groundPoint(add(v,[dz,-dx],s*.055),apronGrade(v)+.022);
    batch.quad('roadAmber',line(p,-1),line(p,1),line(q,1),line(q,-1));
  }
  // White structural entrance face as on 105; above it the same park turf
  // carries to Misty Forêt. The dark opening ends at a normal garage
  // lintel; the actual drop begins several metres inside the cover.
  const lintel = throatY+3.45;
  batch.prism('courtStone', 'siteGrass', rectangular(portalAt, .03, -3.49, 7.43, 3.49), deckHeight-.37, deckHeight);
  batch.prism('courtStone', 'coping', rectangular(portalAt, -.19, -3.61, .47, 3.61), lintel, deckHeight + .018);
  batch.prism('stoneInset','coping',rectangular(portalAt,-.23,-3.61,.04,3.61),lintel-.08,lintel+.15);
  batch.plate('courtFrame',rectangular(portalAt, .04,-3.23,7.44,3.23),lintel);
  for (const side of [-1, 1]) {
    batch.prism('courtStone', 'coping', rectangular(portalAt, -.20, side * 3.19, .62, side * 3.61), throatY-.11, lintel+.03);
    batch.wall('courtFrame', portalAt(.48, side * 3.31), portalAt(7.46, side * 3.31), throatY-.32, lintel);
  }
  batch.wall('door', portalAt(7.44,-3.23), portalAt(7.44,3.23), throatY-.33, lintel);
  // The small pedestrian approach on the planted lid joins the upper park
  // paving on the same datum. The low vehicle lane remains open below.
  const parkWalk: XZ[] = [portalAt(2.7, -.55), portalAt(5.2, -.55), portalAt(7.55, -.62), plan(395, 400)];
  upperParkPavers(batch, model, parkWalk.map(([x, z]) => [490 + x / .52, 540 + z / .52]), 1.52, () => deckHeight + .053);
  batch.attachTo(group);
  shareMistyPavers(model,group);
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
    ['security-105', null], ['security-109', upperAuxGrade(plan(...UPPER_AUX_GUARD))], ['security-110', UPPER_DISTRICT_GRADE.arrivalY],
  ] as const) {
    const security = SITE_FACILITIES.find(item => item.id === id);
    if (!security) continue;
    const axis = security.roofMark?.axis ?? [-.195, .981];
    const halfWidth = (security.roofMark?.halfWidth ?? 1.89) - .21;
    const halfDepth = (security.roofMark?.halfDepth ?? 1.48) - .21;
    const mid: XZ = [security.x, security.z];
    const cross: XZ = [-axis[1], axis[0]];
    const at = (x: number, z: number): XZ => add(add(mid, axis, x), cross, z);
    if (id === 'security-110') lowerEntryGround(model, position => {
      const dx = position[0] - mid[0], dz = position[1] - mid[1];
      const distance = Math.hypot(dx, dz);
      return distance < 5.95 ? preferred - .08 + 7 * smoothStep((distance - 2.5) / 3.45) : null;
    });
    const base = preferred ?? terrainAt(model, mid, .65);
    const body = rectangular(at, -halfWidth, -halfDepth, halfWidth, halfDepth);
    const batch = new SurfaceBatch();
    batch.prism('stoneInset', 'path', rectangular(at, -halfWidth - .62, -halfDepth - .61, halfWidth + .62, halfDepth + .61),
      id === 'security-110' ? base - .94 : Math.min(.52, base - .40), base + .08);
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
  // Stitch the 109 and 104 parcel rims. The upper walk, not a detached
  // green retaining face or a second path, marks this boundary.
  const upper = [[466,446],[439,478],[408,506],[377,535],[365,545],[348,539]].map(([x,z]) => plan(x,z));
  const lower = [[507,475.2],[489,483],[482,489],[451,515],[404,556],[376,583],[372,602]].map(([x,z]) => plan(x,z));
  const river = [[371,590],[367,575],[360,557]].map(([x,z]) => plan(x,z));
  const roadside = [[494,463],[498.5,465.2],[504,471.7]].map(([x,z]) => plan(x,z));
  const outline = [upper[0], ...roadside, ...lower, ...river, ...upper.slice(1).reverse()];
  const group = new Group();
  group.name = SEAM_PARK;
  const batch = new SurfaceBatch();
  const origin = plan(478, 463), along = unit(origin, plan(464, 475));
  const across: XZ = [along[1], -along[0]];
  const frame = (p: XZ, dir: XZ): number => (p[0] - origin[0]) * dir[0] + (p[1] - origin[1]) * dir[1];
  const joins = [stationAlongPolylines(upper), stationAlongPolylines(lower)];
  const oldGuardSkirt = (a: Vector3,b: Vector3,c: Vector3): boolean => {
    const area=(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
    return Math.abs(area)<.012 && [a,b,c].every(p=>{
      const q=joins[0].nearest(p.x,p.z);
      return q.distance<.55 && q.station<=joins[0].stations[1]+.45;
    });
  };
  const parcel = model.getObjectByName('SM_Parcels_Roads_And_Stream');
  const grass = parcel?.children.find((node): node is Mesh => isMesh(node) && finishName(node) === 'MAT_Site_Grass');
  // The original v9 green spine is a separate flat slab. Leaving it visible
  // would still leak a thin tongue towards the bank after clipping the new park.
  parcel?.traverse(object => {
    if (!isMesh(object)) return;
    if (finishName(object) === 'MAT_Separation_Lawn') object.visible = false;
    if (finishName(object) !== 'MAT_Retaining_Edge') return;
    keepTriangles(object, (...points) => !oldGuardSkirt(...points) && !(points.every(p => p.y <= .510 && p.y >= -1.47
      && p.x >= plan(334, 0)[0] && p.x <= plan(499, 0)[0] && p.z >= plan(0, 445)[1] && p.z <= plan(0, 601)[1])
      && points.some(p => Math.abs(p.y + 1.45) < .020)));
  });
  const sample = siteTerrainSampler(grass ? [grass] : [], plan(340,432), plan(523,613));
  const stationAt = (edge: readonly XZ[], station: number): XZ => {
    const i = edge.findIndex(p => frame(p, along) >= station);
    if (i < 0) return edge[edge.length - 1];
    if (i === 0) return edge[0];
    const a = edge[i - 1], b = edge[i], s0 = frame(a, along);
    return mix(a, b, (station - s0) / (frame(b, along) - s0));
  };
  const rimHeight = (p: XZ, side: -1 | 1, fallback: number): number => {
    // Short inboard search for clipped grass at the ramp and for centimeters
    // of difference between the source mesh and the traced boundary.
    for (const offset of [0, .13, .34, .66, 1.20]) {
      const y = sample(add(p, across, offset * side), NaN);
      if (Number.isFinite(y)) return y;
    }
    return fallback;
  };
  const first = frame(upper[0], along);
  const grade = (p: XZ): number => {
    const station = frame(p, along), north = stationAt(upper, station), south = stationAt(lower, station);
    const left = frame(north, across), right = frame(south, across);
    const runIn = smoothStep((station - first + .8) / 20);
    const northY = upperAuxRimGrade(north,rimHeight(north, -1, .55 + 5 * runIn));
    const southY = rimHeight(south, 1, .56 + 1.37 * runIn);
    const u = smoothStep((frame(p, across) - left) / (right - left));
    const y = northY * (1 - u) + southY * u;
    const roadTie = smoothStep((station - first + .2) / 2.8);
    return y * roadTie + .54 * (1 - roadTie) + .018;
  };

  // Cover the joint in the same turf, and remove the old parcel skirt that
  // showed through it. Neither garage cut nor the creek edge is here.
  model.getObjectByName('SM_East_West_Retaining_And_Main_Gate_Break')?.traverse(object => {
    if (!isMesh(object) || finishName(object) !== 'MAT_Retaining_Edge') return;
    keepTriangles(object, (a,b,c) => {
      if (oldGuardSkirt(a,b,c)) return false;
      const area = (b.x-a.x)*(c.z-a.z) - (b.z-a.z)*(c.x-a.x);
      return Math.abs(area) > .01 || !joins.some(join => [a,b,c].every(p => {
        const nearest = join.nearest(p.x,p.z);
        return nearest.distance < .62 && nearest.station > 1.1 && nearest.station < join.total - .6;
      }));
    });
  });
  // Triangulate paired cross-sections, with shared vertices on the two joins.
  // Splitting unrelated triangles separately can open cracks on a steep grade.
  const contour = outline.map(p => [frame(p,along),frame(p,across)] as XZ);
  const ends = [...new Set(contour.map(p => p[0]))].sort((a,b) => a-b);
  const stations = ends.slice(1).flatMap((b,i) => {
    const a = ends[i], n = Math.ceil((b-a)/1.15);
    return Array.from({length:n},(_,j) => a + (b-a)*j/n);
  }).concat(ends[ends.length-1]);
  const rows = stations.map(s => {
    const crossings = contour.flatMap(([s0,u0],i) => {
      const [s1,u1] = contour[(i+1)%contour.length];
      if (s < Math.min(s0,s1) || s > Math.max(s0,s1)) return [];
      return Math.abs(s1-s0) < EPSILON ? [u0,u1] : [u0+(u1-u0)*(s-s0)/(s1-s0)];
    });
    const left = Math.min(...crossings), right = Math.max(...crossings);
    const section = (u: number): XZ => add(add(origin,along,s),across,u);
    const make = (u: number): XYZ => {
      const p = section(u);
      return groundPoint(p,grade(p));
    };
    const underlap = (u: number, axis: readonly XZ[], side: -1|1): XYZ => {
      const join = frame(stationAt(axis,s),across);
      const width = Math.abs(u-join) < .04
        ? .32 * Math.max(0,Math.min(1,s-frame(axis[0],along),frame(axis[axis.length-1],along)-s)) : 0;
      const p = section(u+side*width), y = grade(section(u));
      return groundPoint(p,width ? Math.min(y,rimHeight(p,side,y))-.024 : y);
    };
    return [underlap(left,upper,-1), ...Array.from({length:17},(_,i) => make(left+(right-left)*i/16)), underlap(right,lower,1)];
  });
  for (let i = 1; i < rows.length; i++) for (let j = 1; j < rows[i].length; j++) {
    batch.quad('siteGrass',rows[i-1][j-1],rows[i][j-1],rows[i][j],rows[i-1][j]);
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
  gradeUpperDistrictRoad(model);
  raiseUpperTerraceAmenities(model, gradeUpperTerraces(model));
  const podiumWalk = communityExteriors(model);
  const daycareEntry = daycareEntrance(model);
  mainUpperEntry(model);
  upperOpenEntry(model);
  rebuildGuardhouses(model);
  rebuildLowerMainPortal(model);
  mainGate101Landings(model);
  rebuildSeamPark(model);
  rebuildUpperRetail(model);
  upperPodiumPavers(model, podiumWalk);
  southPromenades(model);
  daycareCourtyard(model, daycareEntry);
  deForetCafe(model);
  refineBrochureGround(model);
  rebuildRiversideGrade(model);
  model.updateMatrixWorld(true);
}
