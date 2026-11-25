import {
  BufferGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group,
  IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Vector3, type Object3D,
} from 'three';
import { siteTerrainSampler } from './site-terrain-sampler';

type XZ = readonly [number, number];
const scale = .52;
const world = ([x, z]: XZ): XZ => [(x - 490) * scale, (z - 540) * scale];
const blend = (a: XZ, b: XZ, t: number): XZ => [a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t];
const distance = (a: XZ, b: XZ) => Math.hypot(b[0]-a[0], b[1]-a[1]);
const smooth = (x: number) => x*x*(3-2*x);

// West face of the north-up parcel trace, then the planted seam and lower
// parcel. The east road and purpose-built parking/community grade breaks
// aren't part of this boundary. No elevation contours are given in the plan.
const rim = [
  [176,53],[170,108],[166,147],[166,187],[174,224],[185,263],[203,306],[228,350],
  [254,393],[280,431],[306,477],[332,521],[347,539],[348,539],[360,557],[367,575],
  [371,590],[372,602],[377,626],[393,655],[413,699],[428,747],[443,794],
  [459,838],[475,883],[488,925],[503,962],[517,980],[542,992],[591,1006],
  [637,1019],[680,1033],
].map(([x,z]) => world([x,z]));
const channel = [
  [147,31],[148,94],[144,155],[146,216],[161,265],[183,319],[216,377],[252,431],
  [281,488],[307,544],[335,593],[361,637],[391,689],[410,742],[434,811],[454,875],
  [478,944],[499,981],[530,1003],[600,1030],[650,1045],[707,1055],
].map(([x,z]) => world([x,z]));

function nearest(point: XZ, line: readonly XZ[]) {
  let best = { point: line[0], segment: 0, t: 0, d: Infinity };
  for (let i = 0; i + 1 < line.length; i++) {
    const [a, b] = [line[i], line[i+1]], dx = b[0]-a[0], dz = b[1]-a[1];
    const t = Math.max(0, Math.min(1, ((point[0]-a[0])*dx + (point[1]-a[1])*dz)/(dx*dx+dz*dz)));
    const p = blend(a, b, t), d = distance(point, p);
    if (d < best.d) best = { point:p, segment:i, t, d };
  }
  return best;
}

function materialName(object: Mesh): string {
  return Array.isArray(object.material) ? '' : object.material.name;
}

/** Remove just the old cliff triangles on the west parcel trace (not actual retaining structures). */
function hideBakedCliff(root: Object3D): void {
  root.traverseVisible(object => {
    if (!(object instanceof Mesh) || !/^(?:MAT_Retaining_Edge|MAT_Rebuilt_hedge)$/.test(materialName(object))) return;
    const geometry = object.geometry, position = geometry.getAttribute('position'), index = geometry.getIndex();
    const count = index?.count ?? position.count, kept: number[] = [];
    const points = [new Vector3(), new Vector3(), new Vector3()];
    for (let i = 0; i+2 < count; i += 3) {
      const ids = [index?.getX(i) ?? i, index?.getX(i+1) ?? i+1, index?.getX(i+2) ?? i+2];
      ids.forEach((id, j) => points[j].fromBufferAttribute(position, id).applyMatrix4(object.matrixWorld));
      const [a,b,c] = points;
      const area = (b.x-a.x)*(c.z-a.z) - (b.z-a.z)*(c.x-a.x);
      if (Math.abs(area) > .003 || !points.every(p => nearest([p.x,p.z], rim).d < .3)) kept.push(...ids);
    }
    if (!kept.length) object.visible = false;
    else if (kept.length !== count) geometry.setIndex(kept);
  });
}

export function rebuildRiversideGrade(model: Object3D): void {
  const parcel = model.getObjectByName('SM_Parcels_Roads_And_Stream');
  const woods = model.getObjectByName('SM_Woodland_Terrain');
  const grass = parcel?.children.find((object): object is Mesh => object instanceof Mesh && materialName(object) === 'MAT_Site_Grass');
  if (!parcel || !woods || !(grass?.material instanceof MeshStandardMaterial)) return;
  const seam = model.getObjectByName('SM_Rebuilt_Seam_Park');
  const seamGrass = seam?.getObjectByName('SM_Rebuilt_Seam_Park_siteGrass');
  model.updateMatrixWorld(true);

  const bounds = [[-260,-285],[145,310]] as const;
  const siteGrade = siteTerrainSampler(seamGrass ? [grass,seamGrass] : [grass], ...bounds);
  const forestGrade = siteTerrainSampler([woods], ...bounds);
  const ground = new Group();
  ground.name = 'SM_Rebuilt_Riverside_Grade';

  // Pair each surveyed parcel segment with a monotonically advancing station
  // along the existing stream. Sample the old lawn at the inner joint only.
  const chain = channel.reduce<number[]>((lengths, p, i) => i ? [...lengths, lengths[i-1]+distance(channel[i-1],p)] : [0], []);
  const pairs = rim.map(p => {
    const {segment,t} = nearest(p,channel);
    return {p, s:chain[segment]+(chain[segment+1]-chain[segment])*t};
  });
  const station = (s: number) => {
    const i = Math.max(0, Math.min(chain.length-2, chain.findIndex(value => value > s)-1));
    return { i, center:blend(channel[i],channel[i+1],(s-chain[i])/(chain[i+1]-chain[i])) };
  };
  const end = chain[chain.length-1];
  const stations = [...new Set([...chain, ...pairs.map(p => p.s), ...Array.from({length:Math.ceil(end/2.2)}, (_, i) => i*2.2)])].sort((a,b) => a-b);
  const profiles = stations.map(s => {
    const {i,center} = s === end ? {i:channel.length-2,center:channel[channel.length-1]} : station(s);
    const [a,b] = [channel[i],channel[i+1]], d = distance(a,b);
    const normal: XZ = [(b[1]-a[1])/d, (a[0]-b[0])/d]; // landward (east/north of stream)
    const offset = (m: number): XZ => [center[0]+normal[0]*m, center[1]+normal[1]*m];
    const next = pairs.findIndex(p => p.s >= s), last = pairs[pairs.length-1];
    const before = next === 0, after = next < 0;
    const p = before ? blend(offset(11),pairs[0].p,s/pairs[0].s)
      : after ? blend(last.p,offset(10),(s-last.s)/(end-last.s))
        : blend(pairs[next-1].p,pairs[next].p,(s-pairs[next-1].s)/(pairs[next].s-pairs[next-1].s));
    const side = distance(center,p) || 1;
    const toward = (m: number) => blend(center,p,m/side);
    const tie = siteGrade(p, siteGrade(toward(side+.36), siteGrade(toward(side+1.6), .5)));
    const fade = smooth(Math.max(0, Math.min(1, before ? s/pairs[0].s : after ? (end-s)/(end-last.s) : 1)));
    return {s,p,side,toward,grade:-.16 + (tie+.16)*fade,fade};
  });
  const rows = profiles.map(({s,p,side,toward,grade,fade},i) => {
    // Keep the inner shoreline joint exact, but damp short-scale variation
    // in the channel from individual triangles along the original lawn rim.
    const localWater = grade - .28*fade;
    let weighted = 0, weights = 0;
    for (let j=Math.max(0,i-6); j<=Math.min(profiles.length-1,i+6); j++) {
      const other = profiles[j], weight = 1 - Math.abs(s-other.s)/4.5;
      if (weight > 0) {
        weighted += (other.grade-.28*other.fade)*weight;
        weights += weight;
      }
    }
    const water = localWater + Math.max(-.34,Math.min(.34,weighted/weights-localWater))*fade;
    const land = (m: number, fraction: number): [XZ,number] => [toward(m), water + (grade-water)*fraction];
    const outer = (m: number, fraction: number): [XZ,number] => {
      const q = toward(-m);
      return [q, water + (forestGrade(q,-2.9)-water)*fraction];
    };
    // Preserve a wet channel only ~28 cm below the adjacent model lawn; a
    // wide continuous woodland transition replaces the old dropped platform.
    return [outer(34,1),outer(23,.62),outer(14,.24),outer(6.3,0),outer(4.3,0),
      land(4.3,0),land(6.35,.68),land(6.35+(side-6.35)*.52,1),[p,grade + .017] as [XZ,number]];
  });
  const positions = rows.flatMap(row => row.flatMap(([p,y]) => [p[0],y,p[1]]));
  const vert = (r: number, c: number) => r*rows[0].length+c;
  const landIndices: number[] = [], waterIndices: number[] = [];
  for (let r=0; r<rows.length-1; r++) for (let c=0; c<rows[0].length-1; c++) {
    const indices = c === 4 ? waterIndices : landIndices;
    indices.push(vert(r,c),vert(r+1,c),vert(r,c+1), vert(r,c+1),vert(r+1,c),vert(r+1,c+1));
  }
  const palette = [
    '#354f41','#3a5545','#526c51','#617c56','#699174','#699174','#809468',
    grass.material.color,grass.material.color,
  ].map(c => new Color(c));
  const colors = rows.flatMap(row => row.flatMap((_, i) => palette[i].toArray()));
  for (const [label, indices] of [['land',landIndices],['water',waterIndices]] as const) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions,3));
    if (label === 'land') geometry.setAttribute('color', new Float32BufferAttribute(colors,3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new MeshStandardMaterial({
      color: label === 'land' ? '#ffffff' : '#426e73',
      vertexColors:label === 'land', roughness:label === 'land' ? grass.material.roughness : .48, side:DoubleSide,
    });
    const surface = new Mesh(geometry,material);
    surface.name = `${ground.name}_${label}`;
    ground.add(surface);
  }
  for (const object of parcel.children) if (object instanceof Mesh && /^MAT_(?:Stream|Stream_Bank|Water_Reeds_Reflection)$/.test(materialName(object))) object.visible = false;
  hideBakedCliff(parcel);
  const retaining = model.getObjectByName('SM_East_West_Retaining_And_Main_Gate_Break');
  if (retaining) hideBakedCliff(retaining);
  if (seam) hideBakedCliff(seam);
  model.add(ground);
  ground.updateMatrixWorld(true);
  const fill = siteTerrainSampler([ground], ...bounds);

  // Preserve the baked woodland scatter; re-seat only trees whose ground
  // moved and clear the channel itself. Add a modest planted parcel line.
  const forest = model.getObjectByName('Landscape_Grove_Instances');
  const matrix = new Matrix4(), local = new Vector3(), point = new Vector3(), inverse = new Matrix4();
  forest?.traverseVisible(object => {
    if (!(object instanceof InstancedMesh)) return;
    let count = 0, changed = false;
    inverse.copy(object.matrixWorld).invert();
    for (let i=0; i<object.count; i++) {
      object.getMatrixAt(i,matrix);
      point.setFromMatrixPosition(matrix).applyMatrix4(object.matrixWorld);
      const y = fill([point.x,point.z], -Infinity);
      if (Number.isFinite(y) && nearest([point.x,point.z],channel).d < 4.4) { changed = true; continue; }
      if (y > point.y+.035) {
        local.set(point.x,y,point.z).applyMatrix4(inverse);
        matrix.setPosition(local);
        changed = true;
      }
      object.setMatrixAt(count++,matrix);
    }
    if (changed) { object.count=count; object.instanceMatrix.needsUpdate=true; object.computeBoundingSphere(); }
  });
  const trees = rows.filter((_, i) => i > 12 && i < rows.length-13 && (i%11 === 0 || i%17 === 0))
    .map((row, i) => ({p:blend(row[7][0],row[8][0], i%3===0 ? .32 : .62), size:1.45 + (i*13%11)*.074}));
  const trunk = new InstancedMesh(new CylinderGeometry(.105,.15,1,5),new MeshStandardMaterial({color:'#706951'}),trees.length);
  const crown = new InstancedMesh(new IcosahedronGeometry(1,0),new MeshStandardMaterial({color:'#78905c',roughness:.95}),trees.length*2);
  trees.forEach(({p,size},i) => {
    const y = fill(p,.5);
    trunk.setMatrixAt(i,matrix.makeScale(size,size*1.38,size).setPosition(p[0],y+size*.68,p[1]));
    for (const [j,f] of [[0,1],[1,.62]] as const) {
      const index=i*2+j, h=size*f;
      crown.setMatrixAt(index,matrix.makeScale(h,h*.83,h).setPosition(p[0]+j*size*.49,y+size*(1.52+j*.31),p[1]-j*size*.4));
      crown.setColorAt(index,new Color(i%5===0 ? '#e0c7c6' : i%3===0 ? '#b2c3a0' : '#87a47b'));
    }
  });
  trunk.name = 'SM_Riverside_Tree_Stems';
  crown.name = 'SM_Riverside_Tree_Canopies';
  ground.add(trunk,crown);
}
