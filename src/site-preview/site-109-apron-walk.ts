type XZ = readonly [number, number];

// Orange trace: central split to garage and then the narrower guard spur.
// Cyan trace: the separate retail/guard pedestrian connectors.
export const AUX_PEDESTRIAN = {
  drive: [[434.7,437],[425.3,432.7],[419.7,428.7],[414.3,424],[409.6,419.3]],
  bay: [[434.7,437],[440.1,444.4],[442.4,452.8],[444.1,459.2],[446.5,464.5],[448.1,468.6]],
  retailLink: [[426.7,452.5],[429.2,451.4],[431.5,451.25]],
  guardReturn: [[451.2,461.1],[454.7,459.2],[456.7,456.2],[458.1,452],
    [460.1,447.9],[465.6,445.3],[470.7,446.8]],
} as const;

const cross = (a:XZ,b:XZ) => a[0]*b[1]-a[1]*b[0];
const delta = (a:XZ,b:XZ):XZ => [a[0]-b[0],a[1]-b[1]];
const lerp = (a:XZ,b:XZ,t:number):XZ=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
/** Clip a paver cell at any inside bend of the vehicle outline. */
export function outsideApron(paving:readonly XZ[], lane:readonly XZ[]): XZ[][] {
  const orientation=Math.sign(lane.reduce((s,a,i)=>s+cross(a,lane[(i+1)%lane.length]),0));
  if (!orientation) return [[...paving]];
  let inner=[...paving];
  const exterior:XZ[][]=[];
  for (let i=0;i<lane.length&&inner.length>=3;i++) {
    const a=lane[i], edge=delta(lane[(i+1)%lane.length],a), keep:XZ[]=[],cut:XZ[]=[];
    for (let j=0;j<inner.length;j++) {
      const p=inner[j],q=inner[(j+1)%inner.length];
      const u=orientation*cross(edge,delta(p,a)),v=orientation*cross(edge,delta(q,a));
      (u>=0?keep:cut).push(p);
      if ((u>=0)!==(v>=0)) { const h=lerp(p,q,u/(u-v)); keep.push(h); cut.push(h); }
    }
    if (cut.length>=3) exterior.push(cut);
    inner=keep;
  }
  return inner.length>=3?exterior:[[...paving]];
}
