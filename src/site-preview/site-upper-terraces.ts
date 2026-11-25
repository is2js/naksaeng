import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, InstancedMesh, Matrix4, Mesh,
  MeshStandardMaterial, Vector3, type Object3D } from 'three';
import { siteTerrainSampler } from './site-terrain-sampler';
import { UPPER_DISTRICT_GRADE, upperDistrictRoadX } from './site-upper-main-layout';

type XZ = readonly [number, number];
const plan = (x: number, z: number): XZ => [(x - 490) * .52, (z - 540) * .52];
const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t*t*(3-2*t);
};
const bounds = [plan(156, 28), plan(447, 405)] as const;
const pathRoot = 'SM_Graded_Pedestrian_Routes';

// P4 north-up plan: continue the garage roof grade through the whole upper
// garden and 111/112 courts. The planted break runs north of the 110/T202
// pads; its eastern end follows the existing garage/lift retaining frontage.
const breakline = [[163, 205], [211, 207], [247, 220], [280, 235], [300, 257],
  [321, 240], [342, 222], [367, 187], [434, 154]] as const;

export function upperTerraceGrade([x, z]: XZ, original: number): number {
  const px = x/.52 + 490, pz = z/.52 + 540;
  if (px < 156 || px > 447 || pz < 28 || pz > 405) return original;
  const eastTurf = upperDistrictRoadX(z) - x;
  const parcelWeight = (1-smooth((pz-375)/30)) * smooth((eastTurf-5.0)/3.8);
  if (parcelWeight === 0) return original;
  const endpoint = breakline.findIndex(([right]) => right >= px);
  const end = endpoint < 0 ? breakline.length - 1 : Math.max(1, endpoint);
  const [a, b] = [breakline[end-1], breakline[end]];
  const cut = a[1] + (b[1]-a[1]) * Math.max(0, Math.min(1,(px-a[0])/(b[0]-a[0])));
  const rise = smooth((cut + 9 - pz)/16) * smooth((eastTurf-6.4)/7.3);
  const goal = UPPER_DISTRICT_GRADE.arrivalY + (UPPER_DISTRICT_GRADE.parkY-UPPER_DISTRICT_GRADE.arrivalY)*rise;
  return original + (goal-original)*parcelWeight;
}

type Sampler = ReturnType<typeof siteTerrainSampler>;
const materialName = (node: Mesh) => Array.isArray(node.material) ? '' : node.material.name;

/** Long archived paving triangles can cut straight through a curved grade. Split their slope-side edges before draping. */
function addPavingSamples(mesh: Mesh): void {
  const geometry = mesh.geometry, position = geometry.getAttribute('position'), oldIndex=geometry.getIndex();
  const point = new Vector3();
  const world = Array.from({length:position.count},(_,i): XZ => {
    point.fromBufferAttribute(position,i).applyMatrix4(mesh.matrixWorld);
    return [point.x,point.z];
  });
  const attrs = Object.entries(geometry.attributes).map(([key,attr]) => ({key,attr,added:[] as number[]}));
  const result: number[] = [], edges = new Map<string,number>();
  function edgeLength(a: XZ,b: XZ): number {
    const x=(a[0]+b[0])/2, z=(a[1]+b[1])/2, pz=z/.52+540;
    const clearance=upperDistrictRoadX(z)-x;
    if (x<bounds[0][0] || x>bounds[1][0] || pz<32 || pz>390 || clearance<3.5) return 0;
    if (!((pz>194 && pz<271) || clearance<16)) return 0;
    return (a[0]-b[0])**2+(a[1]-b[1])**2;
  }
  function midpoint(a: number,b: number) {
    const key = a<b ? `${a}:${b}` : `${b}:${a}`;
    const existing = edges.get(key);
    if (existing !== undefined) return existing;
    for (const {attr,added} of attrs) for (let k=0;k<attr.itemSize;k++) {
      const component = (i:number) => i<position.count ? attr.getComponent(i,k) : added[(i-position.count)*attr.itemSize+k];
      added.push((component(a)+component(b))/2);
    }
    const i=world.push([(world[a][0]+world[b][0])/2,(world[a][1]+world[b][1])/2])-1;
    edges.set(key,i);
    return i;
  }
  function emit(a:number,b:number,c:number): void {
    const pairs = [[a,b,c],[b,c,a],[c,a,b]];
    let longest = 1.15**2, candidate: number[] | undefined;
    for (const edge of pairs) {
      const length=edgeLength(world[edge[0]],world[edge[1]]);
      if (length>longest) { longest=length; candidate=edge; }
    }
    if (!candidate) { result.push(a,b,c); return; }
    const [p,q,r]=candidate, m=midpoint(p,q);
    emit(p,m,r); emit(m,q,r);
  }
  for (let i=0,count=oldIndex?.count ?? position.count;i+2<count;i+=3) {
    emit(oldIndex?.getX(i) ?? i,oldIndex?.getX(i+1) ?? i+1,oldIndex?.getX(i+2) ?? i+2);
  }
  if (!edges.size) return;
  for (const {key,attr,added} of attrs) {
    const values=new Float32Array(world.length*attr.itemSize);
    for (let i=0;i<position.count;i++) for (let k=0;k<attr.itemSize;k++) values[i*attr.itemSize+k]=attr.getComponent(i,k);
    values.set(added,position.count*attr.itemSize);
    geometry.setAttribute(key,new Float32BufferAttribute(values,attr.itemSize));
  }
  geometry.setIndex(result);
}

function blendNorthernShoulder(model: Object3D, lawn: Sampler, tint: Color): void {
  const woods = model.getObjectByName('SM_Woodland_Terrain');
  if (!woods) return;
  const rim = [plan(176,53),plan(192,42),plan(395,34),plan(413,42)];
  const stripBounds = [plan(174,-45),plan(414,55)] as const;
  const natural = siteTerrainSampler([woods], ...stripBounds);
  const contour = rim.flatMap((a,i) => {
    const b = rim[i+1];
    if (!b) return [a];
    const n = Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/2.4);
    return Array.from({length:n},(_,j): XZ => [a[0]+(b[0]-a[0])*j/n, a[1]+(b[1]-a[1])*j/n]);
  });
  const falloff = [0,.16,.36,.58,.80,1];
  const field = new Color('#51694e');
  const vertices: number[] = [], colors: number[] = [], faces: number[] = [];
  contour.forEach(([x,z],i) => {
    // The two ends fold into the adjacent riverbank and roadside shoulder.
    const width = .10+37*smooth(Math.min(x-rim[0][0],rim[3][0]-x)/13);
    const h = lawn([x,z+.24],UPPER_DISTRICT_GRADE.parkY)-.035;
    for (const [j,t] of falloff.entries()) {
      const p: XZ = [x,z+.23-width*t];
      const forest = natural(p,-3.2)-.065;
      const tBlend = smooth(t);
      vertices.push(x, h+(forest-h)*tBlend, p[1]);
      colors.push(...tint.clone().lerp(field,tBlend).toArray());
      if (i && j) {
        const v=i*falloff.length+j, left=v-1, above=v-falloff.length;
        faces.push(v,left,above-1,v,above-1,above);
      }
    }
  });
  const geom = new BufferGeometry();
  geom.setAttribute('position',new Float32BufferAttribute(vertices,3));
  geom.setAttribute('color',new Float32BufferAttribute(colors,3));
  geom.setIndex(faces);
  geom.computeVertexNormals();
  const slope = new Mesh(geom,new MeshStandardMaterial({vertexColors:true,roughness:.94,side:DoubleSide}));
  slope.name = 'SM_Rebuilt_North_Terrace_Shoulder';
  model.add(slope);
  slope.updateWorldMatrix(true,false);
  const surface = siteTerrainSampler([slope], ...stripBounds);
  const matrix = new Matrix4(), inverse = new Matrix4(), trunk = new Vector3();
  model.getObjectByName('Landscape_Grove_Instances')?.traverseVisible(node => {
    if (!(node instanceof InstancedMesh)) return;
    inverse.copy(node.matrixWorld).invert();
    let changed = false;
    for (let i = 0; i < node.count; i++) {
      node.getMatrixAt(i,matrix);
      trunk.setFromMatrixPosition(matrix).applyMatrix4(node.matrixWorld);
      const y = surface([trunk.x,trunk.z],-Infinity);
      if (y <= trunk.y) continue;
      matrix.setPosition(trunk.setY(y).applyMatrix4(inverse));
      node.setMatrixAt(i,matrix);
      changed = true;
    }
    if (changed) { node.instanceMatrix.needsUpdate = true; node.computeBoundingBox(); node.computeBoundingSphere(); }
  });
}

/** One grade pass before local ramp, facility, and riverside overlays are built. */
export function gradeUpperTerraces(model: Object3D): Sampler {
  const ground = model.getObjectByName('SM_Parcels_Roads_And_Stream');
  const grass: Mesh[] = [];
  ground?.traverseVisible(node => {
    if (node instanceof Mesh && materialName(node) === 'MAT_Site_Grass') grass.push(node);
  });
  const original = siteTerrainSampler(grass, ...bounds);
  const world = new Vector3(), local = new Vector3(), inverse = new Matrix4();
  function reshape(object: Mesh, height: (p: XZ, y: number) => number) {
    const geometry = object.geometry, pos = geometry.getAttribute('position');
    inverse.copy(object.matrixWorld).invert();
    let moved = false;
    for (let i = 0; i < pos.count; i++) {
      world.fromBufferAttribute(pos,i).applyMatrix4(object.matrixWorld);
      const y = height([world.x,world.z],world.y);
      if (Math.abs(world.y-y) < .0001) continue;
      world.y = y;
      world.applyMatrix4(inverse);
      pos.setXYZ(i,world.x,world.y,world.z);
      moved = true;
    }
    if (moved) {
      pos.needsUpdate = true;
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    }
  }
  for (const lawn of grass) reshape(lawn, (p,y) => y > -.2 ? upperTerraceGrade(p,y) : y);
  const grade = siteTerrainSampler(grass, ...bounds);
  const moves = (p: XZ) => Math.abs(upperTerraceGrade(p, 1)-1) > .001;
  model.getObjectByName(pathRoot)?.traverseVisible(node => {
    if (!(node instanceof Mesh)) return;
    const coping = materialName(node) === 'MAT_Promenade_Paver_Coping';
    if (!coping && materialName(node) !== 'MAT_Sandstone_Pedestrian_Pavers') return;
    addPavingSamples(node);
    reshape(node, (p,y) => {
      if (!moves(p)) return y;
      const before = original(p,-Infinity), after = grade(p,-Infinity);
      if (!Number.isFinite(before) || !Number.isFinite(after)) return y;
      // Some original ribbons were below ground. Re-seat those on the new
      // surface rather than carrying forward a negative vertical offset.
      return after + (coping ? .145 : .193);
    });
  });
  model.getObjectByName('SM_Courtyard_Lawns_And_Play')?.traverseVisible(node => {
    if (!(node instanceof Mesh)) return;
    reshape(node, (p,y) => {
      if (!moves(p)) return y;
      const before = original(p,-Infinity), after = grade(p,-Infinity);
      return Number.isFinite(before) && Number.isFinite(after) ? y + after-before : y;
    });
  });
  model.getObjectByName('SM_East_West_Retaining_And_Main_Gate_Break')?.traverseVisible(node => {
    if (!(node instanceof Mesh) || materialName(node) !== 'MAT_Retaining_Edge') return;
    reshape(node,(p,y) => {
      if (!moves(p) || y <= -.2) return y;
      const before = original(p,y), after = grade(p,before);
      return y+after-before;
    });
  });
  const matrix = new Matrix4();
  model.traverseVisible(node => {
    if (node.userData.buildingId === '110' || node.userData.buildingId === '111' || node.userData.buildingId === '112') {
      const tier = node.userData.buildingId === '110' ? UPPER_DISTRICT_GRADE.arrivalY : UPPER_DISTRICT_GRADE.parkY;
      world.setFromMatrixPosition(node.matrixWorld);
      node.position.y += tier - world.y;
      return;
    }
    if (!(node instanceof InstancedMesh) || !node.parent?.name.startsWith('Courtyard_Grove_Instances')) return;
    let moved = false;
    inverse.copy(node.matrixWorld).invert();
    for (let i = 0; i < node.count; i++) {
      node.getMatrixAt(i,matrix);
      world.setFromMatrixPosition(matrix).applyMatrix4(node.matrixWorld);
      const p: XZ = [world.x,world.z];
      if (!moves(p)) continue;
      const before = original(p,-Infinity), after = grade(p,-Infinity);
      if (!Number.isFinite(before) || !Number.isFinite(after)) continue;
      local.set(world.x,world.y+after-before,world.z).applyMatrix4(inverse);
      node.setMatrixAt(i,matrix.setPosition(local));
      moved = true;
    }
    if (moved) { node.instanceMatrix.needsUpdate = true; node.computeBoundingBox(); node.computeBoundingSphere(); }
  });
  model.updateMatrixWorld(true);
  const lawnMaterial = grass[0]?.material;
  if (lawnMaterial instanceof MeshStandardMaterial) blendNorthernShoulder(model, grade, lawnMaterial.color);
  return grade;
}
