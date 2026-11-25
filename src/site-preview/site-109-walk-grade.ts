import { InstancedMesh, Matrix3, Matrix4, Vector3, type Mesh, type Object3D } from 'three';
import { siteTerrainSampler } from './site-terrain-sampler';
import { subdivideSurfaceInPlan } from './site-upper-terraces';

type XZ = readonly [number, number];
type WalkSection = { readonly position: XZ; readonly y: number; readonly halfWidth: number };
type Project = (point: XZ) => XZ;
const plan = (x: number, z: number): XZ => [(x-490)*.52,(z-540)*.52];
const smooth = (v: number): number => { const t = Math.max(0,Math.min(1,v)); return t*t*(3-2*t); };

/** Same longitudinal height as the walk, with just enough transverse fall for an outboard green strip. */
export function create109WalkGrade(walk: readonly WalkSection[], rim: readonly XZ[], project: Project) {
  const stations = walk.map(({position,y,halfWidth})=>({p:position,station:project(position),y,halfWidth}));
  const boundary = rim.map(project);
  const min = project(plan(448,465))[0], max = project(plan(351,527))[0];
  const low = project(plan(439,470))[0], high = project(plan(370,521))[0];
  const pairs = stations.slice(1).map((b,i)=>[stations[i],b] as const).filter(([a,b])=>{
    const p=(a.p[0]+b.p[0])/2/.52+490, z=(a.p[1]+b.p[1])/2/.52+540;
    return p>=346 && p<=452 && z>=454 && z<=534 && Math.abs(a.station[0]-b.station[0])>.02;
  });

  const section = (s: number) => {
    if (s<=min || s>=max) return;
    let edge=NaN;
    for (let i=1;i<boundary.length;i++) {
      const [a,b]=[boundary[i-1],boundary[i]];
      if (s>=a[0] && s<=b[0]) { edge=a[1]+(b[1]-a[1])*(s-a[0])/(b[0]-a[0]); break; }
    }
    if (!Number.isFinite(edge)) return;
    let selected: {center:number; y:number; w:number; edge:number; weight:number} | undefined;
    for (const [a,b] of pairs) {
      const ds=b.station[0]-a.station[0], t=(s-a.station[0])/ds;
      if (t<0 || t>1) continue;
      const du=b.station[1]-a.station[1], center=a.station[1]+du*t;
      if (edge<=center || edge-center>16 || (selected && center<selected.center)) continue;
      const w=(a.halfWidth+(b.halfWidth-a.halfWidth)*t)*Math.min(1.72,Math.hypot(ds,du)/Math.abs(ds));
      selected={center,y:a.y+(b.y-a.y)*t,w,edge,weight:smooth((s-min)/(low-min))*smooth((max-s)/(max-high))};
    }
    return selected;
  };
  const gradeAt = (p: XZ) => {
    const [s,u]=project(p), row=section(s);
    if (!row) return;
    const outside=row.center+row.w;
    const weight=row.weight*smooth((u-outside+.82)/.68)*smooth((row.edge+.84-u)/.64);
    if (weight<=0) return;
    return { weight, y:row.y-.084-.013*Math.max(0,u-outside) };
  };
  const desired = (p:XZ,current:number) => {
    const sample=gradeAt(p);
    return sample ? current+(sample.y-current)*sample.weight : current;
  };
  return { desired, gradeAt };
}

/** Regrade the decoded grass; the adjacent park samples this exact edge in the same render pass. */
export function lay109WalkGrade(model: Object3D, grass: Mesh, grade: ReturnType<typeof create109WalkGrade>): void {
  const lo=plan(342,454), hi=plan(453,546);
  const wasGrass=siteTerrainSampler([grass],lo,hi);
  subdivideSurfaceInPlan(grass,(x,z)=>!!grade.gradeAt([x,z]),.87);
  const geometry=grass.geometry, pos=geometry.getAttribute('position');
  const p=new Vector3(), inv=new Matrix4().copy(grass.matrixWorld).invert();
  for (let i=0;i<pos.count;i++) {
    p.fromBufferAttribute(pos,i).applyMatrix4(grass.matrixWorld);
    const gradeY=grade.desired([p.x,p.z],p.y);
    if (Math.abs(gradeY-p.y)<.0001) continue;
    p.setY(gradeY).applyMatrix4(inv);
    pos.setXYZ(i,p.x,p.y,p.z);
  }
  pos.needsUpdate=true;
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  // Leave the established flat shading elsewhere in the site untouched.
  if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals();
  const surface=siteTerrainSampler([grass],lo,hi), normals=geometry.getAttribute('normal');
  if (normals) {
    const toLocal=new Matrix3().getNormalMatrix(inv), normal=new Vector3(), old=new Vector3();
    for (let i=0;i<pos.count;i++) {
      p.fromBufferAttribute(pos,i).applyMatrix4(grass.matrixWorld);
      const {x,y,z}=p, scope=grade.gradeAt([x,z]);
      if (!scope) continue;
      const t=.62;
      normal.set(surface([x-t,z],y)-surface([x+t,z],y),2*t,surface([x,z-t],y)-surface([x,z+t],y))
        .applyNormalMatrix(toLocal);
      old.fromBufferAttribute(normals,i).lerp(normal,scope.weight).normalize();
      normals.setXYZ(i,old.x,old.y,old.z);
    }
    normals.needsUpdate=true;
  }
  const tree=new Matrix4();
  model.traverse(node=>{
    if (!(node instanceof InstancedMesh) || !node.parent?.name.startsWith('Courtyard_Grove_Instances')) return;
    inv.copy(node.matrixWorld).invert();
    let updated=false;
    for (let i=0;i<node.count;i++) {
      node.getMatrixAt(i,tree);
      p.setFromMatrixPosition(tree).applyMatrix4(node.matrixWorld);
      const {x,y,z}=p;
      if (!grade.gradeAt([x,z])) continue;
      const before=wasGrass([x,z],y), after=surface([x,z],grade.desired([x,z],before));
      if (Math.abs(after-before)<.0001) continue;
      tree.setPosition(p.setY(y+after-before).applyMatrix4(inv));
      node.setMatrixAt(i,tree);
      updated=true;
    }
    if (updated) { node.instanceMatrix.needsUpdate=true; node.computeBoundingBox(); node.computeBoundingSphere(); }
  });
}
