import {
  BoxGeometry, CanvasTexture, Color, DoubleSide, Euler, ExtrudeGeometry, Group, InstancedMesh, Line, LineBasicMaterial,
  BufferGeometry, Matrix4, Mesh, MeshStandardMaterial, Quaternion, RepeatWrapping, RingGeometry, Shape, ShapeGeometry,
  SRGBColorSpace, Vector3,
  type Material, type Texture,
} from 'three';
import type { FacilityFloor, FacilityRoom } from './facility-detail-data';

type Point = readonly [number, number];

function shapeOf(points: readonly Point[]): Shape {
  const shape = new Shape();
  points.forEach(([x, z], i) => i ? shape.lineTo(x, -z) : shape.moveTo(x, -z));
  shape.closePath();
  return shape;
}

function surfaceTexture(kind: FacilityRoom['kind']): CanvasTexture {
  const sheet = document.createElement('canvas');
  sheet.width = sheet.height = 128;
  const ctx = sheet.getContext('2d')!;
  ctx.fillStyle = '#faf8ef';
  ctx.fillRect(0, 0, 128, 128);
  if (kind === 'program') {
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = ['#efebe0', '#f6f1e8', '#fff8ef', '#f3eee3'][i % 4];
      ctx.fillRect(0, i * 16 + 1, 128, 15);
      ctx.fillStyle = '#e3dbcb';
      ctx.fillRect(0, i * 16, 128, 1);
      ctx.fillRect(18 + i * 43 % 103, i * 16, 1, 16);
    }
  } else {
    const steps = kind === 'outdoor' ? 16 : 32;
    ctx.fillStyle = kind === 'outdoor' ? '#efede4' : '#f0eee5';
    for (let i = 0; i < 128; i += steps) {
      ctx.fillRect(i, 0, 1, 128);
      ctx.fillRect(0, i, 128, 1);
    }
  }
  const texture = new CanvasTexture(sheet);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(kind === 'program' ? .65 : .8, kind === 'program' ? .75 : .8);
  texture.anisotropy = 4;
  return texture;
}

export function createFacilityFloorModel(floor: FacilityFloor, accent: string) {
  const root = new Group();
  const geometries = new Set<BufferGeometry>(), materials = new Set<Material>(), textures = new Set<Texture>();
  const fixtures = new Set<InstancedMesh>();
  const surfaces = new Map<string, Mesh<ShapeGeometry, MeshStandardMaterial>>();
  const outlines = new Map<string, Line>();
  const baseColor = new Map<string, Color>();
  const labelGroups = new Map<string, string>();
  const paint = new Map<FacilityRoom['kind'], CanvasTexture>();
  const palette: Record<FacilityRoom['kind'], string> = {
    program: '#dcba8c', circulation: '#e3e2ce', service: '#bdcecd', outdoor: '#a8b78c',
  };
  const highlight = new Color(accent);

  function material(color: string) {
    const m = new MeshStandardMaterial({ color, roughness: .78 });
    materials.add(m);
    return m;
  }
  const fascia = material('#a29583');
  const board = material('#c2b6a0');
  const wallInner = material('#eee7d6');
  const wallOuter = material('#ded7c7');
  const wallCap = material('#a6967f');
  const trim = material('#8d7966');
  const metal = material('#5f7470');
  const porchThreshold = material('#928777');
  const porchFrame = material('#4b4c44');
  const glass = material('#7cadb3');
  glass.transparent = true;
  glass.opacity = .58;
  glass.depthWrite = false;
  const chalk = material('#f0edcd');
  const bleachedWood = material('#d4ba8e');

  function addMesh<G extends BufferGeometry, M extends Material>(geometry: G, mat: M, parent = root) {
    geometries.add(geometry);
    const mesh = new Mesh(geometry, mat);
    mesh.castShadow = !mat.transparent;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function box(x: number, y: number, z: number, width: number, height: number, depth: number, mat: Material, parent = root) {
    if (Math.min(width, height, depth) < .015) return;
    const mesh = addMesh(new BoxGeometry(width, height, depth), mat, parent);
    mesh.position.set(x, y, z);
    return mesh;
  }

  // Keep the small props from the brochure as visual cues, with tight batches
  // for mobile. They don't change room bounds, labels, or picking surfaces.
  type FixturePart = readonly [x: number, y: number, z: number, width: number, height: number, depth: number, pitch?: number];
  function addCommunityFixtures(room: FacilityRoom): void {
    if (!['fitness', 'group-exercise', 'lounge-library', 'indoor-driving-range', 'multi-room', 'private-office', 'kids-lounge'].includes(room.id)) return;
    const props = new Group();
    props.position.set(room.center[0], 0, room.center[1]);
    const [origin, across] = room.polygon;
    props.rotation.y = -Math.atan2(across[1] - origin[1], across[0] - origin[0]);
    root.add(props);
    const batches = new Map<string, FixturePart[]>();
    const put = (color: string, ...part: FixturePart) => {
      const batch = batches.get(color) ?? [];
      batch.push(part);
      batches.set(color, batch);
    };
    const ivory = '#e8dfc7', oliveGray = '#655e52', peach = '#bc8074', green = '#9da67a', yellow = '#d3a33d';
    const seat = (x: number, z: number, color: string, high = .32) => {
      put(oliveGray, x, high * .43, z, .36, high * .74, .33);
      put(color, x, high, z, .56, .13, .51);
    };
    if (room.id === 'fitness') {
      // Two parallel equipment runs sit alongside the glazed workout strip.
      for (const x of [-7, -4.7, -2.4, -.1, 2.2]) for (const z of [-3.4, 1.9]) {
        put('#444b49', x, .17, z, .78, .18, 1.62);
        put('#a7ae9e', x, .22, z + .56, .9, .14, .34);
        for (const side of [-.31, .31]) put(oliveGray, x + side, .59, z + .59, .09, .84, .12);
        put('#58625e', x, 1.02, z + .52, .79, .15, .29, -.38);
      }
    } else if (room.id === 'group-exercise') {
      for (const x of [-3.2, -1.6, 0, 1.6, 3.2]) for (const z of [-1.1, 1.1]) {
        put('#9eaaa5', x, .036, z, .9, .035, 1.55);
      }
    } else if (room.id === 'lounge-library') {
      for (const x of [-6.75, -2.25, 2.25, 6.75]) for (const z of [-1.85, 1.65]) {
        put(ivory, x, .68, z, 2.05, .11, 1.14);
        put(oliveGray, x, .35, z, 1.55, .66, .34);
        seat(x - .49, z - .86, green);
        seat(x + .49, z + .86, green);
      }
    } else if (room.id === 'indoor-driving-range') {
      for (const z of [-9, -5.4, -1.8, 1.8, 5.4, 9]) {
        put('#65765b', 2.05, .073, z, 2.45, .095, 2.66);
        put('#7e9a64', 1.85, .132, z, 1.68, .046, 1.6);
        put('#828976', 3.57, .49, z - 1.45, .43, .91, .13);
        put('#dedbc7', 3.76, 1.04, z, .045, 1.7, 2.44);
      }
    } else if (room.id === 'multi-room') {
      for (const x of [-2.55, 2.55]) {
        put(ivory, x, .68, 0, 3.05, .13, 1.06);
        for (const leg of [x - 1.25, x + 1.25]) put(oliveGray, leg, .34, 0, .12, .65, .73);
        for (const offset of [-.92, 0, .92]) seat(x + offset, -.92, ivory, .37);
      }
    } else if (room.id === 'private-office') {
      const run = Math.hypot(across[0] - origin[0], across[1] - origin[1]);
      for (const fraction of [-.375, -.125, .125, .375]) {
        const x = run * fraction;
        put(ivory, x, .69, 1.08, 1.61, .13, .78);
        put(oliveGray, x - .65, .36, 1.08, .16, .66, .66);
        put(oliveGray, x + .65, .36, 1.08, .16, .66, .66);
        put(oliveGray, x + .24, .95, 1.30, .54, .36, .095);
        seat(x - .10, .30, green, .38);
      }
    } else {
      const x = 2.2, z = -5.02, frameHeight = 1.58;
      put('#626977', x + .1, .046, z + .22, 6.15, .045, 5.42);
      // Pale structural lattice and the yellow play decks/slide visible against
      // the blue-grey safety floor at the back of the kids lounge.
      for (const column of [-2.15, -.72, .72, 2.15]) {
        for (const row of [-1.78, 0, 1.78]) put(ivory, x + column, .80, z + row, .085, 1.55, .085);
        for (const y of [.73, frameHeight]) put(ivory, x + column, y, z, .07, .07, 3.56);
      }
      for (const row of [-1.78, 0, 1.78]) {
        for (const y of [.73, frameHeight]) put(ivory, x, y, z + row, 4.38, .07, .07);
      }
      put(yellow, x - 1.43, .57, z - .84, 1.36, .11, 1.73);
      put(yellow, x + .02, .85, z - .87, 1.43, .11, 1.76);
      put(yellow, x + 1.44, 1.08, z - .80, 1.43, .11, 1.73);
      const slope = .44;
      put(yellow, x + 1.44, .55, z + 1.22, .62, .14, 2.48, slope);
      for (const side of [-.35, .35]) put(yellow, x + 1.44 + side, .65, z + 1.22, .10, .17, 2.48, slope);
      for (let n = 0; n < 4; n++) put(yellow, x - 1.45, .12 + .13 * n, z + .9 - n * .22, .65, .11, .23);
      for (const [dx, dz, color] of [[-.9, 2.6, peach], [1.45, 3.1, peach], [2.73, 4.7, ivory], [.1, 5.15, ivory]] as const) {
        seat(dx, dz, color);
      }
      put(green, 4.6, .27, 4.15, .48, .5, 3.5);
    }
    const unitBox = new BoxGeometry();
    geometries.add(unitBox);
    const p = new Vector3(), size = new Vector3(), orientation = new Euler(), q = new Quaternion(), matrix = new Matrix4();
    for (const [color, parts] of batches) {
      const group = new InstancedMesh(unitBox, material(color), parts.length);
      group.castShadow = group.receiveShadow = true;
      parts.forEach(([x, y, z, width, height, depth, pitch = 0], index) => {
        matrix.compose(p.set(x, y, z), q.setFromEuler(orientation.set(pitch, 0, 0)), size.set(width, height, depth));
        group.setMatrixAt(index, matrix);
      });
      fixtures.add(group);
      props.add(group);
    }
  }

  // Recognizable features from the PDF cutaway, without invented room uses.
  function addPlanFeature(room: FacilityRoom): void {
    const court = room.id === 'sports-court';
    const stairs = room.label === '계단' || room.label === '계단실';
    if (!court && !stairs) return;
    const edges = room.polygon.map(([x, z], i) => {
      const next = room.polygon[(i + 1) % room.polygon.length];
      return [next[0] - x, next[1] - z] as const;
    });
    const long = edges.reduce((a, b) => Math.hypot(...a) >= Math.hypot(...b) ? a : b);
    const angle = Math.atan2(long[1], long[0]);
    const c = Math.cos(angle), s = Math.sin(angle);
    const xs = room.polygon.map(([x, z]) => x * c + z * s), zs = room.polygon.map(([x, z]) => -x * s + z * c);
    const width = Math.max(...xs) - Math.min(...xs), depth = Math.max(...zs) - Math.min(...zs);
    const feature = new Group();
    feature.position.set(room.center[0], 0, room.center[1]);
    feature.rotation.y = -angle;
    root.add(feature);
    if (court) {
      const xEdge = width * .385, zEdge = depth * .36;
      for (const z of [-zEdge, zEdge]) box(0, .027, z, xEdge * 2, .016, .055, chalk, feature);
      for (const x of [-xEdge, 0, xEdge]) box(x, .027, 0, .055, .016, zEdge * 2, chalk, feature);
      const ringRadius = Math.min(depth * .16, 1.3);
      const ring = addMesh(new RingGeometry(ringRadius - .04, ringRadius, 36).rotateX(-Math.PI / 2), chalk, feature);
      ring.position.y = .038;
      for (const x of [-xEdge, xEdge]) {
        const goalHalf = Math.min(1.15, zEdge * .44);
        for (const z of [-goalHalf, goalHalf]) box(x, .62, z, .075, 1.2, .075, chalk, feature);
        box(x, 1.23, 0, .075, .075, goalHalf * 2, chalk, feature);
      }
    } else {
      const usableWidth = width * .77, tread = usableWidth / 9;
      for (let i = 0; i < 9; i++) box((i + .5) * tread - usableWidth / 2, .044 + i * .036, 0, tread + .01, .07 + i * .072, depth * .59, bleachedWood, feature);
    }
  }
  const slab = addMesh(new ExtrudeGeometry(shapeOf(floor.outline), { depth: .32, bevelEnabled: false }).rotateX(-Math.PI / 2), fascia);
  slab.position.y = -.39;
  const slabLip = addMesh(new ExtrudeGeometry(shapeOf(floor.outline), { depth: .06, bevelEnabled: false }).rotateX(-Math.PI / 2), board);
  slabLip.position.y = -.075;

  for (const room of floor.rooms) {
    let pattern = paint.get(room.kind);
    if (!pattern) {
      pattern = surfaceTexture(room.kind);
      paint.set(room.kind, pattern);
      textures.add(pattern);
    }
    const color = room.id === 'sports-court' ? '#548e6c' : room.id === 'entry' ? '#b8b2a3'
      : room.label.includes('보육실') ? '#b6c8ad' : palette[room.kind];
    const mat = new MeshStandardMaterial({ color, map: pattern, roughness: .85, side: DoubleSide });
    materials.add(mat);
    const surface = addMesh(new ShapeGeometry(shapeOf(room.polygon)).rotateX(-Math.PI / 2), mat);
    surface.position.y = .018;
    surface.castShadow = false;
    const labelId = room.labelGroup ?? room.id;
    surface.userData.facilityRoom = labelId;
    labelGroups.set(room.id, labelId);
    surfaces.set(room.id, surface);
    baseColor.set(room.id, mat.color.clone());

    const outlineGeometry = new BufferGeometry().setFromPoints([...room.polygon, room.polygon[0]].map(([x, z]) => new Vector3(x, .032, z)));
    const outlineMat = new LineBasicMaterial({ color: highlight, transparent: true, opacity: .95 });
    const line = new Line(outlineGeometry, outlineMat);
    line.visible = false;
    root.add(line);
    outlines.set(room.id, line);
    geometries.add(outlineGeometry);
    materials.add(outlineMat);
    addPlanFeature(room);
    addCommunityFixtures(room);
  }

  for (const wall of floor.walls) {
    const [ax, az] = wall.start, [bx, bz] = wall.end;
    const span = Math.hypot(bx - ax, bz - az);
    if (span <= .04) continue;
    const ux = (bx - ax) / span, uz = (bz - az) / span;
    const distance = ([x, z]: Point) => Math.max(0, Math.min(span, (x - ax) * ux + (z - az) * uz));
    const isWestEast = Math.abs(ux) >= Math.abs(uz);
    const mayHideFloor = wall.exterior && (isWestEast ? (az + bz) / 2 > (Math.min(...floor.outline.map(p => p[1])) + Math.max(...floor.outline.map(p => p[1]))) / 2 : false);
    const group = new Group();
    root.add(group);
    group.position.set(ax, 0, az);
    group.rotation.y = -Math.atan2(uz, ux);
    const openings = floor.openings.filter(({ wallId }) => wallId === wall.id).map((entry) => {
      const a = distance(entry.start), b = distance(entry.end);
      return { ...entry, from: Math.min(a, b), to: Math.max(a, b) };
    }).filter(({ from, to }) => to - from > .12).sort((a, b) => a.from - b.from);
    const thickness = Math.max(.075, wall.thickness);
    const height = wall.exterior ? (mayHideFloor ? .88 : 1.82) : .78;
    const wallMat = wall.exterior ? wallOuter : wallInner;
    const segment = (a: number, b: number, h = height, base = 0, cap = true) => {
      box((a + b) / 2, base + h / 2, 0, b - a, h, thickness, wallMat, group);
      if (cap) box((a + b) / 2, base + h + .025, 0, b - a, .05, thickness * 1.04, wallCap, group);
    };
    let from = 0;
    for (const opening of openings) {
      const a = Math.max(from, opening.from), b = opening.to;
      if (b - a <= .12) continue;
      segment(from, a);
      const mid = (a + b) / 2, length = b - a;
      if (opening.kind === 'window') {
        const sill = Math.min(.62, height * .38), top = height - .20;
        segment(a, b, sill, 0, false);
        segment(a, b, height - top, top);
        box(mid, (sill + top) / 2, 0, length - .055, top - sill, .042, glass, group);
        box(mid, sill + .027, 0, length, .054, thickness * .86, metal, group);
        box(mid, top - .027, 0, length, .054, thickness * .86, metal, group);
        const divisions = Math.max(1, Math.round(length / 1.55));
        for (let i = 0; i <= divisions; i++) box(a + length * i / divisions, (sill + top) / 2, 0, .05, top - sill, thickness * .84, metal, group);
      } else if (floor.id === '1f' && wall.exterior && opening.kind === 'door') {
        // The daycare portico is roofless in the cutaway: show its stone sill
        // and dark sides, but keep the doorway itself visibly passable.
        box(mid, .04, 0, length, .052, thickness * 2.25, porchThreshold, group);
        for (const x of [a + .042, b - .042]) box(x, height / 2, 0, .084, height, thickness * 1.22, porchFrame, group);
      } else {
        box(mid, .035, 0, length, .042, thickness * 1.05, trim, group);
        if (opening.kind === 'door') for (const x of [a + .028, b - .028]) box(x, height / 2, 0, .058, height, thickness * 1.07, trim, group);
      }
      from = b;
    }
    segment(from, span);
  }

  return {
    root,
    pickables: [...surfaces.values()],
    select(id?: string) {
      for (const [key, surface] of surfaces) {
        surface.material.color.copy(baseColor.get(key)!);
        if (id === labelGroups.get(key)) surface.material.color.lerp(highlight, .56);
        outlines.get(key)!.visible = id === labelGroups.get(key);
      }
    },
    dispose() {
      root.removeFromParent();
      for (const fixture of fixtures) fixture.dispose();
      for (const geometry of geometries) geometry.dispose();
      for (const mat of materials) mat.dispose();
      for (const texture of textures) texture.dispose();
    },
  };
}
