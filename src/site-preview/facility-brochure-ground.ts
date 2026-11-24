import {
  BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Raycaster,
  ShapeUtils, Vector2, Vector3, type Object3D,
} from 'three';

type XZ = readonly [number, number];
type XYZ = readonly [number, number, number];
const POINTS = { park: [604, 837], play: [289, 166], retail: [650, 966] } as const;
const PLAN_SCALE = .52;
const plan = ([x, z]: XZ): XZ => [(x - 490) * PLAN_SCALE, (z - 540) * PLAN_SCALE];
const pointAt = (p: XZ, y: number): XYZ => [p[0], y, p[1]];
const lerp = (a: XZ, b: XZ, t: number): XZ => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const frame = (center: XZ, radians: number) => (x: number, z: number): XZ => [
  center[0] + x * Math.cos(radians) - z * Math.sin(radians),
  center[1] + x * Math.sin(radians) + z * Math.cos(radians),
];
const palette = {
  turf: '#91a764', lawn: '#9bb575', bed: '#647e54', leaf: '#77945b', spring: '#94a963', petals: '#b79aba',
  limestone: '#c1bbae', sill: '#ddd0b9', pavers: '#ada79d', ash: '#7d847d', slate: '#4e504b',
  blue: '#5ea4ab', aqua: '#99c4bb', sand: '#d9c8a6', pink: '#cc776f', rose: '#b95d60', coral: '#d38d76',
  shade: '#3c4241', glass: '#5d7375', window: '#b09167', light: '#cda873',
} as const;
type Finish = keyof typeof palette;

class BrochureBatch {
  private readonly vertices = new Map<Finish, number[]>();
  tri(key: Finish, a: XYZ, b: XYZ, c: XYZ): void {
    const data = this.vertices.get(key) ?? [];
    data.push(...a, ...b, ...c);
    this.vertices.set(key, data);
  }
  quad(key: Finish, a: XYZ, b: XYZ, c: XYZ, d: XYZ): void {
    this.tri(key, a, b, c);
    this.tri(key, a, c, d);
  }
  surface(key: Finish, outline: XZ[], height: number | ((p: XZ) => number)): void {
    const y = typeof height === 'number' ? () => height : height;
    const polygon = outline.map(([x, z]) => new Vector2(x, z));
    for (const indices of ShapeUtils.triangulateShape(polygon, [])) {
      const [a, b, c] = indices.map(i => outline[i]);
      this.tri(key, pointAt(a, y(a)), pointAt(c, y(c)), pointAt(b, y(b)));
    }
  }
  wall(key: Finish, a: XZ, b: XZ, low: number, top: number): void {
    this.quad(key, pointAt(a, low), pointAt(a, top), pointAt(b, top), pointAt(b, low));
  }
  block(key: Finish, outline: XZ[], low: number, top: number): void {
    this.surface(key, outline, top);
    outline.forEach((a, i) => this.wall(key, a, outline[(i + 1) % outline.length], low, top));
  }
  make(name: string, castShadow = false): Group {
    const group = new Group();
    group.name = name;
    for (const [key, data] of this.vertices) {
      const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(data, 3));
      geometry.computeVertexNormals();
      const glass = key === 'glass' || key === 'window' || key === 'light';
      const material = new MeshStandardMaterial({ color: palette[key], side: DoubleSide, roughness: glass ? .46 : .85,
        ...(glass ? { emissive: palette[key], emissiveIntensity: key === 'light' ? .22 : .07 } : {}) });
      material.name = `MAT_Brochure_${key}`;
      const mesh = new Mesh(geometry, material);
      mesh.name = `${name}_${key}`;
      mesh.userData.castsSiteShadow = castShadow && ['limestone', 'ash', 'shade', 'pink', 'rose', 'coral', 'slate'].includes(key);
      group.add(mesh);
    }
    return group;
  }
}

function sampling(model: Object3D): (p: XZ, fallback: number) => number {
  const terrain = model.getObjectByName('SM_Parcels_Roads_And_Stream');
  const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0), 0, 100);
  return (p, fallback) => {
    ray.ray.origin.set(p[0], 35, p[1]);
    return (terrain && ray.intersectObject(terrain, true).find(({ object }) => object.visible)?.point.y) ?? fallback;
  };
}

function omitLegacy(model: Object3D, ids: string[], mask: (p: Vector3, material: string) => boolean): void {
  const corners = [new Vector3(), new Vector3(), new Vector3()];
  for (const id of ids) {
    model.getObjectByName(id)?.traverseVisible(object => {
      if (!(object instanceof Mesh) || Array.isArray(object.material)) return;
      const points = object.geometry.getAttribute('position'), indices = object.geometry.getIndex();
      const count = indices?.count ?? points.count, left: number[] = [];
      for (let i = 0; i + 2 < count; i += 3) {
        const triangle = [0, 1, 2].map(j => indices?.getX(i + j) ?? i + j);
        triangle.forEach((index, j) => corners[j].fromBufferAttribute(points, index).applyMatrix4(object.matrixWorld));
        if (!corners.every(p => mask(p, object.material.name))) left.push(...triangle);
      }
      if (left.length === 0) object.visible = false;
      else if (left.length < count) object.geometry.setIndex(left);
    });
  }
}

function orbit(at: (x: number, z: number) => XZ, rx: number, rz: number, count: number, raisedShape = false): XZ[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = Math.PI * 2 * i / count;
    const soft = raisedShape ? 1 + .074 * Math.cos(angle * 2 + .7) + .085 * Math.sin(angle * 3 - .6) : 1;
    return at(rx * soft * Math.cos(angle), rz * soft * Math.sin(angle));
  });
}

function ring(batch: BrochureBatch, key: Finish, inside: XZ[], outside: XZ[], level: (p: XZ) => number): void {
  inside.forEach((p, i) => {
    const j = (i + 1) % inside.length;
    batch.quad(key, pointAt(p, level(p)), pointAt(inside[j], level(inside[j])),
      pointAt(outside[j], level(outside[j])), pointAt(outside[i], level(outside[i])));
  });
}

function shrub(batch: BrochureBatch, origin: XZ, size: number, y: number, finish: Finish): void {
  const rim = orbit(frame(origin, 0), size, size * .81, 6);
  const high: XZ = [origin[0] + size * .22, origin[1] - size * .12];
  rim.forEach((p, i) => batch.tri(finish, pointAt(p, y), pointAt(rim[(i + 1) % rim.length], y), pointAt(high, y + size * .62)));
}

function rebuildDeForetPark(model: Object3D, ground: ReturnType<typeof sampling>): void {
  const center = plan(POINTS.park), a = 11 * Math.PI / 180, at = frame(center, a);
  omitLegacy(model, ['SM_Courtyard_Lawns_And_Play'], (p, material) => {
    if (!material.startsWith('MAT_Garden_')) return false;
    const dx = p.x - center[0], dz = p.z - center[1];
    const x = dx * Math.cos(a) + dz * Math.sin(a), z = -dx * Math.sin(a) + dz * Math.cos(a);
    // Only the old isolated oval, its trim and two benches; surrounding paths survive.
    return Math.hypot(x / 13.75, z / 17.0) < 1;
  });
  const batch = new BrochureBatch();
  const original = (p: XZ) => ground(p, 4.1), paving = (p: XZ) => original(p) + .20;
  const inner = orbit(at, 10.65, 13.35, 48, true), outer = orbit(at, 12.53, 15.38, 48, true);
  const lawn = orbit(at, 8.18, 11.42, 48, true), wall = orbit(at, 8.52, 11.76, 48, true);
  ring(batch, 'pavers', inner, outer, paving);
  ring(batch, 'sill', orbit(at, 12.45, 15.3, 48, true), outer, (p) => paving(p) + .013);
  ring(batch, 'bed', wall, inner, (p) => paving(p) + .025);
  const centerY = original(center), raised = (p: XZ) => Math.max(centerY, original(p)) + .56;
  // The rendered brochure shows a low, gently raised green island with a
  // planted apron and curved stone curb, not a sunken formal traffic circle.
  for (let i = 0; i < lawn.length; i++) {
    const next = (i + 1) % lawn.length, [p, q] = [lawn[i], lawn[next]];
    batch.tri('lawn', pointAt(center, centerY + .68), pointAt(q, raised(q)), pointAt(p, raised(p)));
    const opening = (i >= 10 && i <= 13) || (i >= 33 && i <= 36);
    batch.quad(opening ? 'turf' : 'ash', pointAt(p, raised(p)), pointAt(wall[i], opening ? paving(wall[i]) : raised(p) - .065),
      pointAt(wall[next], opening ? paving(wall[next]) : raised(q) - .065), pointAt(q, raised(q)));
    if (!opening) {
      batch.quad('limestone', pointAt(wall[i], paving(wall[i]) + .008), pointAt(wall[i], raised(p) - .065),
        pointAt(wall[next], raised(q) - .065), pointAt(wall[next], paving(wall[next]) + .008));
      const theta = i * 2 * Math.PI / lawn.length, s = .45 + (i % 4) * .10;
      const plant = at(9.3 * Math.cos(theta), 12.55 * Math.sin(theta));
      shrub(batch, plant, s, paving(plant) + .048, i % 5 === 0 ? 'petals' : i % 3 === 0 ? 'spring' : 'leaf');
    }
  }
  model.add(batch.make('SM_Brochure_DeForet_Park'));
}

function rebuildDeForetPlay(model: Object3D, ground: ReturnType<typeof sampling>): void {
  const center = plan(POINTS.play), a = 18 * Math.PI / 180, at = frame(center, a);
  omitLegacy(model, ['SM_Courtyard_Lawns_And_Play'], (p, material) => {
    if (!material.startsWith('MAT_Garden_')) return false;
    const dx = p.x - center[0], dz = p.z - center[1];
    const x = dx * Math.cos(a) + dz * Math.sin(a), z = -dx * Math.sin(a) + dz * Math.cos(a);
    // Remove only the upper play inset; lower blue figure-eight and walks keep their materials.
    return Math.hypot(x / 18.9, z / 20.2) < 1;
  });
  const batch = new BrochureBatch();
  const turf = (p: XZ) => ground(p, 3.6) + .10;
  const outer = orbit(at, 17, 17.5, 42, true), inner = orbit(at, 15.75, 16.29, 42, true);
  const innerLevels = inner.map(turf), centerLevel = turf(center);
  ring(batch, 'bed', inner, outer, (p) => turf(p) + .02);
  inner.forEach((p, i) => {
    const j = (i + 1) % inner.length;
    batch.tri('turf', pointAt(center, centerLevel), pointAt(inner[j], innerLevels[j]), pointAt(p, innerLevels[i]));
  });
  const floorAt = (p: XZ): number => {
    const x = p[0] - center[0], z = p[1] - center[1];
    for (let i = 0; i < inner.length; i++) {
      const j = (i + 1) % inner.length;
      const ax = inner[i][0] - center[0], az = inner[i][1] - center[1];
      const bx = inner[j][0] - center[0], bz = inner[j][1] - center[1];
      const cross = ax * bz - az * bx;
      const t = (x * bz - z * bx) / cross, s = (ax * z - az * x) / cross;
      if (t >= -1e-4 && s >= -1e-4 && t + s <= 1.0001) {
        return Math.max(turf(p), centerLevel + (innerLevels[i] - centerLevel) * t + (innerLevels[j] - centerLevel) * s);
      }
    }
    return turf(p);
  };
  for (const [i, u, v, r] of [[0, -6.3, 4.20, 4.61], [1, -7.4, -4.20, 2.88], [2, 1, -6.40, 2.37],
    [3, 6.1, 4.60, 2.83], [4, 8.5, -3.40, 3.51]] as const) {
    const pad = at(u, v), locate = frame(pad, a);
    const rim = orbit(locate, r, r, 24);
    const padLevel = Math.max(floorAt(pad), ...rim.map(floorAt), ...rim.map(p => floorAt(lerp(pad, p, .52))));
    rim.forEach((p, j) => {
      const q = rim[(j + 1) % rim.length];
      batch.quad('bed', pointAt(p, floorAt(p) - .045), pointAt(q, floorAt(q) - .045),
        pointAt(q, padLevel + .095), pointAt(p, padLevel + .095));
    });
    for (const [factor, finish, rise] of [[1, i === 4 ? 'sand' : 'aqua', .095],
      [i === 0 ? .84 : .78, i === 0 || i === 4 ? 'blue' : 'pink', .110],
      [i === 0 ? .54 : .58, 'rose', .122],
      [.39, i === 0 ? 'pink' : 'coral', .136]] as const) {
      const contour = orbit(locate, r * factor, r * factor, 24);
      batch.surface(finish, contour, padLevel + rise);
    }
    if (i !== 0) continue;
    const base = padLevel + .145;
    // The official pavilion image shows a tall salmon-and-pale sculptural
    // climber, with two visible slide slopes, rather than the baked box tower.
    for (const [side, top] of [[-.88, 4.05], [.02, 4.78], [.89, 3.54]] as const) {
      const a0 = locate(side - .27, -.42), a1 = locate(side + .30, -.42);
      const a2 = locate(side + .20, .47), a3 = locate(side - .32, .42);
      const b0 = locate(side - .08, -.56), b1 = locate(side + .15, -.54);
      const b2 = locate(side + .15, -.34), b3 = locate(side - .09, -.36);
      for (const [finish, p, q, pp, qq] of [
        ['pink', a0, a1, b0, b1], ['rose', a1, a2, b1, b2], ['limestone', a2, a3, b2, b3], ['coral', a3, a0, b3, b0],
      ] as const) batch.quad(finish, pointAt(p, base), pointAt(q, base), pointAt(qq, base + top - .12), pointAt(pp, base + top));
      batch.quad('limestone', pointAt(b0, base + top), pointAt(b1, base + top - .12),
        pointAt(b2, base + top - .12), pointAt(b3, base + top));
    }
    for (const [offset, sign, high] of [[-.82, 1, 2.05], [.72, -1, 1.49]] as const) {
      const runs = [[0.40, high], [1.28, high * .80], [2.35, .38], [2.9, .16]] as const;
      for (let k = 1; k < runs.length; k++) {
        const [d0, y0] = runs[k - 1], [d1, y1] = runs[k];
        const aa = locate(offset - .32, d0 * sign), ab = locate(offset + .32, d0 * sign);
        const ba = locate(offset - .32, d1 * sign), bb = locate(offset + .32, d1 * sign);
        batch.quad('limestone', pointAt(aa, base + y0), pointAt(ab, base + y0), pointAt(bb, base + y1), pointAt(ba, base + y1));
        for (const [p, q] of [[aa, ba], [ab, bb]]) {
          batch.quad('rose', pointAt(p, base + y0), pointAt(p, base + y0 + .13),
            pointAt(q, base + y1 + .13), pointAt(q, base + y1));
        }
      }
    }
  }
  for (let i = 0; i < 34; i++) {
    const angle = Math.PI * 2 * i / 34, scale = .82 + .12 * (i % 3);
    const p = at(Math.cos(angle) * 16.1 * scale, Math.sin(angle) * 17 * scale);
    shrub(batch, p, .62 + .15 * (i % 4), turf(p) + .014, i % 4 === 0 ? 'petals' : 'leaf');
  }
  model.add(batch.make('SM_Brochure_DeForet_Play', true));
}

function rebuild101Retail(model: Object3D, ground: ReturnType<typeof sampling>): void {
  let tower: Object3D | undefined;
  model.traverse(object => { if (String(object.userData.buildingId) === '101') tower = object; });
  if (!tower) return;
  const old = plan([630, 978]), oldAngle = 43 * Math.PI / 180;
  omitLegacy(model, ['SM_Terraces_And_Community', 'SM_Low_Rise_Facility_Foundations'], p => {
    const dx = p.x - old[0], dz = p.z - old[1];
    const u = dx * Math.cos(oldAngle) + dz * Math.sin(oldAngle), v = -dx * Math.sin(oldAngle) + dz * Math.cos(oldAngle);
    return Math.abs(u) < 9.6 && Math.abs(v) < 5.12;
  });
  const center = plan(POINTS.retail), at = frame(center, -43 * Math.PI / 180), batch = new BrochureBatch();
  const corner = [[-15.5, -6.3], [19, -6.3], [19, 8.8], [17.75, 10.05], [8.9, 10.05],
    [7.55, 12.15], [-13.95, 12.15], [-15.5, 10.6]] as const;
  const outline = corner.map(([x, z]) => at(x, z));
  const reference = ground(center, 4.12), roof = reference + 3.11;
  batch.surface('limestone', outline, roof);
  outline.forEach((p, i) => {
    const q = outline[(i + 1) % outline.length], dx = q[0] - p[0], dz = q[1] - p[1];
    const length = Math.hypot(dx, dz), out: XZ = [dz / length, -dx / length];
    const forward = (t: number, offset: number): XZ => {
      const m = lerp(p, q, t);
      return [m[0] + out[0] * offset, m[1] + out[1] * offset];
    };
    const level = (v: XZ) => ground(v, reference) + .045;
    batch.wall('shade', p, q, Math.min(level(p), level(q)) - .30, roof - .27);
    batch.block('sill', [p, q, forward(1, .17), forward(0, .17)], roof - .31, roof + .06);
    if (i === 0) return;
    const bays = Math.max(1, Math.round(length / 3.28));
    for (let n = 0; n < bays; n++) {
      const u = n / bays, v = (n + 1) / bays;
      const start = u + .19 / length, end = v - .19 / length;
      const entryY = Math.max(level(forward(start, .48)), level(forward(end, .48)));
      const width = end - start;
      const fascia = roof - .31;
      if (entryY > fascia - 1.2) continue;
      batch.wall('glass', forward(start, .022), forward(end, .022), entryY + .27, fascia);
      for (const [k, finish] of [[0, 'window'], [1, 'light'], [2, 'window']] as const) {
        const l = start + width * k / 3, r = start + width * (k + 1) / 3 - .035 / length;
        batch.wall(finish, forward(l, .041), forward(r, .041), entryY + .35, Math.min(entryY + 1.92, fascia - .17));
      }
      for (const k of [0, 1 / 3, 2 / 3, 1]) {
        const t = start + (end - start) * k;
        batch.wall('slate', forward(t - .021 / length, .057), forward(t + .021 / length, .057), entryY + .27, fascia);
      }
      const pier = n ? .245 : .16;
      batch.block('limestone', [forward(u, -.018), forward(u + pier / length, -.018),
        forward(u + pier / length, .29), forward(u, .29)], level(forward(u, .27)) - .10, fascia + .018);
    }
    if (i >= 2) {
      const j = forward(0, .17), k = forward(1, .17), l = forward(1, 1.33), m = forward(0, 1.33);
      batch.quad('pavers', pointAt(j, level(j) + .127), pointAt(k, level(k) + .127),
        pointAt(l, level(l) + .095), pointAt(m, level(m) + .095));
    }
  });
  // Keep the retail roof visibly continuous with the 101 pilotis/facade;
  // only the exposed rim is green, so no lawn geometry is inside the homes.
  batch.surface('bed', [at(-13.24, 7.0), at(16.9, 6.85), at(16.9, 8.75), at(8.2, 9.0),
    at(7.08, 11.15), at(-13.29, 11.25)], roof + .018);
  for (let i = 0; i < 21; i++) {
    const x = -12.65 + i * 1.43, z = x > 7 ? 7.95 : 9.65;
    shrub(batch, at(x, z), .56 + .16 * (i % 3), roof + .043, i % 6 === 0 ? 'petals' : 'leaf');
  }
  const plinth = batch.make('SM_Brochure_101_Retail_Platform', true);
  // Build in the north-up brochure plan, then reparent while preserving axes;
  // the base and tower stay one selectable 101 without changing its source mesh.
  model.add(plinth);
  tower.attach(plinth);
}

export function refineBrochureGround(model: Object3D): void {
  if (model.getObjectByName('SM_Brochure_DeForet_Park')) return;
  model.updateMatrixWorld(true);
  const ground = sampling(model);
  rebuildDeForetPark(model, ground);
  rebuildDeForetPlay(model, ground);
  rebuild101Retail(model, ground);
}
