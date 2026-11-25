import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Matrix4, Mesh, MeshStandardMaterial, Vector3,
  type Object3D } from 'three';
import { siteTerrainSampler } from './site-terrain-sampler';
import { subdivideSurfaceInPlan } from './site-upper-terraces';
import { COMMUNITY_TWO_PLAN, podiumAxis } from './site-109-podium-layout';

type Point = readonly [x: number, z: number];
type Position = readonly [number, number, number];
const world = ([x, z]: Point): Point => [(x - 490) * .52, (z - 540) * .52];
const name = 'SM_109_Community_Deck_Walks';

/** North-up registration of the annotated plan; the spur endpoints are the tower-side landings. */
export const COMMUNITY_109_DECK = {
  line2: [[388.8,460.8],[387.2,457.6],[384.8,453.4],[382.45,451.85]],
  line3: [[388.8,460.8],[382.8,466.2],[376.0,470.9],[371.1,471.9],[367.3,470.35],[363.85,470.65]],
  spine: [[395.8,473.3],[397.1,467.85],[395.85,466.35],[392.9,464.2],[388.8,460.8]],
  // The shaft door currently faces the northwestern roof court.
  liftLink: [[384.64,478.12],[384.75,475.8],[386.3,473.4],[389.05,473.45],[392.3,474.5],[395.8,473.3]],
  outerTie: [408.7,485],
  approach: [[408.7,485],[403.2,486.2],[400,487.2],[396.6,486],[393.3,482.8],[391.1,482.45]],
} as const satisfies {
  line2: readonly Point[]; line3: readonly Point[]; spine: readonly Point[];
  liftLink: readonly Point[]; outerTie: Point; approach: readonly Point[];
};

// Where the existing shaft's axis meets the orthogonal outside wall.
// The two visible doors belong to the same E/V, not a second freestanding lift.
const [wallX,wallZ] = world(COMMUNITY_TWO_PLAN[4]);
const axis = podiumAxis;
const normal: Point=[-axis[1],axis[0]];
const marker=world([386.7,480]);
const t=(marker[0]-wallX)*axis[0]+(marker[1]-wallZ)*axis[1];
const lowerDoor: Point=[wallX+axis[0]*t,wallZ+axis[1]*t];
const threshold=(offset: number, depth: number): Point=>
  [lowerDoor[0]+offset*axis[0]+depth*normal[0],lowerDoor[1]+offset*axis[1]+depth*normal[1]];

function levelLowerApproach(model: Object3D, route: readonly Point[], baseY: number,
  outdoorHeight: ReturnType<typeof siteTerrainSampler>): void {
  const mesh=model.getObjectByName('SM_Parcels_Roads_And_Stream')?.children.find(node=>
    node instanceof Mesh && !Array.isArray(node.material) && node.material.name==='MAT_Site_Grass');
  if (!(mesh instanceof Mesh)) return;
  const d=(x:number,z:number)=>{
    let nearest=Infinity;
    for (let i=1;i<route.length;i++) {
      const a=route[i-1],b=route[i],dx=b[0]-a[0],dz=b[1]-a[1];
      const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));
      nearest=Math.min(nearest,Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz));
    }
    return nearest;
  };
  subdivideSurfaceInPlan(mesh,(x,z)=>d(x,z)<3.28,.76);
  const p=mesh.geometry.getAttribute('position'), v=new Vector3(), inverse=new Matrix4().copy(mesh.matrixWorld).invert();
  for (let i=0;i<p.count;i++) {
    v.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);
    const dist=d(v.x,v.z);
    if (dist>=3.04) continue;
    const k=Math.max(0,Math.min(1,(dist-1.13)/1.91));
    const weight=1-k*k*(3-2*k);
    const outer=outdoorHeight([v.x,v.z],Infinity);
    // Unlike this landing, the continuing outdoor walk changes grade along
    // its curve. Never let the landing's turf adjustment rise into it.
    v.y=Math.min(v.y+(baseY-.07-v.y)*weight,outer-.085);
    v.applyMatrix4(inverse);
    p.setXYZ(i,v.x,v.y,v.z);
  }
  p.needsUpdate=true;
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
  mesh.geometry.computeVertexNormals();
}

/** A small paving-only mesh batch, using the same sandstone and UV scale as the outer walk. */
class DeckPaving {
  private readonly top: number[] = [];
  private readonly sides: number[] = [];
  private readonly door: number[] = [];
  private readonly limestone: number[] = [];

  private quad(output: number[], a: Position, b: Position, c: Position, d: Position): void {
    output.push(...a,...b,...c,...a,...c,...d);
  }

  ribbon(points: readonly Point[], width: number, height: (p: Point, t: number) => number,
    sideDepth = .034): void {
    if (points.length < 2) return;
    let run=0;
    const stations = points.map((a,i) => {
      if (i) run+=Math.hypot(a[0]-points[i-1][0],a[1]-points[i-1][1]);
      return run;
    });
    const half=width/2;
    const rows = points.map((p,i) => {
      const a=points[Math.max(0,i-1)], b=points[Math.min(i+1,points.length-1)];
      const length=Math.hypot(b[0]-a[0],b[1]-a[1]) || 1;
      const dx=(b[1]-a[1])/length, dz=(a[0]-b[0])/length;
      const y=height(p, stations[i]/(run||1));
      return [-half,half].map((s): Position=>[p[0]+s*dx,y,p[1]+s*dz]);
    });
    for (let i=1;i<rows.length;i++) {
      const a=rows[i-1],b=rows[i];
      this.quad(this.top,a[0],b[0],b[1],a[1]);
      const foot=(p: Position): Position=>[p[0],p[1]-sideDepth,p[2]];
      for (const j of [0,1]) this.quad(this.sides,a[j],foot(a[j]),foot(b[j]),b[j]);
    }
  }

  doorway(y: number): void {
    const wall=(positions:number[], a:number, b:number, y0:number,y1:number,depth:number)=>{
      const p=threshold(a,depth),q=threshold(b,depth);
      this.quad(positions,[p[0],y0,p[1]],[p[0],y1,p[1]],[q[0],y1,q[1]],[q[0],y0,q[1]]);
    };
    // Pale matching reveal and two smoked sliding door leaves. Sit very
    // slightly proud of the existing outer wall to avoid coplanar flicker.
    wall(this.limestone,-.99,.99,y-.04,y+2.15,.045);
    wall(this.door,-.77,.77,y+.015,y+1.94,.053);
  }

  attach(model: Object3D, terrace: Group): void {
    const archived = model.getObjectByName('SM_Graded_Pedestrian_Routes');
    let sandstone: MeshStandardMaterial | undefined;
    archived?.traverse(node=>{
      if (node instanceof Mesh && node.material instanceof MeshStandardMaterial
        && node.material.name==='MAT_Sandstone_Pedestrian_Pavers') sandstone=node.material;
    });
    const root = new Group();
    root.name=name;
    for (const [id,positions,color] of [
      ['paving',this.top,'#b8aa98'],['edge',this.sides,'#9c9587'],
      ['lower_lift_door',this.door,'#41484a'],['lower_lift_frame',this.limestone,'#c8bdab'],
    ] as const) {
      if (!positions.length) continue;
      const geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(positions,3));
      geometry.computeVertexNormals();
      if (id==='paving') {
        const uv = [];
        for (let i=0;i<positions.length;i+=3) uv.push(positions[i]*.62,1+positions[i+2]*.62);
        geometry.setAttribute('uv',new Float32BufferAttribute(uv,2));
      }
      const material=id==='paving' && sandstone ? sandstone : new MeshStandardMaterial({color,roughness:.92,side:DoubleSide});
      const mesh=new Mesh(geometry,material);
      mesh.name=`${name}_${id}`;
      mesh.userData.siteSurface=id==='paving';
      root.add(mesh);
    }
    terrace.add(root);
  }
}

export function rebuild109DeckWalks(model: Object3D, roofY: number): void {
  const terrace=model.getObjectByName('SM_Rebuilt_Community_Terraces_community-2');
  if (!(terrace instanceof Group) || terrace.getObjectByName(name)) return;
  const paving=new DeckPaving();
  const upper=roofY+.057;
  model.updateMatrixWorld(true);
  const outer=terrace.getObjectByName(`${terrace.name}_courtPaver`);
  const sample=siteTerrainSampler(outer ? [outer] : [],world([390,477]),world([414,504]));
  const tie=world(COMMUNITY_109_DECK.outerTie);
  const fallbackTie=world([403.5,488.7]);
  const directTieY=sample(tie,NaN);
  const approachY=(Number.isFinite(directTieY) ? directTieY : sample(fallbackTie,2.72))+.015;
  const approach=[...(Number.isFinite(directTieY)?[]:[fallbackTie]),...COMMUNITY_109_DECK.approach.map(world),threshold(0,.06)];
  levelLowerApproach(model,approach,approachY,sample);
  paving.ribbon(approach,1.67,(_,t)=>approachY+.07*t,.14);
  paving.doorway(approachY+.07);
  paving.ribbon(COMMUNITY_109_DECK.spine.map(world),1.65,()=>upper);
  paving.ribbon(COMMUNITY_109_DECK.liftLink.map(world),1.42,()=>upper+.002);
  paving.ribbon(COMMUNITY_109_DECK.line2.map(world),1.47,(_,t)=>upper+.026*t);
  paving.ribbon(COMMUNITY_109_DECK.line3.map(world),1.43,(_,t)=>upper+.019*t);
  paving.attach(model,terrace);
}
