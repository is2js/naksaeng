type XZ = readonly [number, number];

// Latest marked overhead view, registered in the model's north-up plan pixels.
// The black edges stop at the garage and the tapered guard forecourt.
export const AUX_109 = {
  garageSide: [[412.4,415.3],[417,419.2],[422.9,424.7],[426.9,429.7],[430.3,434.2],
    [434.1,437.1],[437.6,437.2],[440.6,436.4],[442,434.7],[444.5,431.1]],
  retailSide: [[455.2,440.2],[452.2,441.5],[448.5,444.5],[445.7,448],[445.1,450.5],
    [445.3,454],[446.8,457.8],[449.5,461.6],[448.1,465.9],[442.8,469.5],[440.3,470.4],
    [438.9,468.8],[436.5,463.4],[433.1,458.2],[429.9,455.2],[427.4,450],[424.3,447.4],
    [420.6,444.2],[417.4,442.4],[414.7,440.1],[410.7,432.5],[403,422.5]],
  // Gray only: the gate-side sidewalk and the retail perimeter, not a curb ring.
  guardWalk: [[445.8,451.7],[448.4,448.3],[451.6,445.7],[455.1,443.6],
    [458.2,442.8],[461,440.7],[463.3,439.1],[464.8,444.4]],
  retailWalk: [[386.4,504],[393.3,498.3],[398.3,493.4],[403.5,488.7],[408.7,485],[416.3,480.5],[421.8,476.4],
    [426.7,472],[430.8,467.8],[431.3,464.5],[429.5,460.8],[426.5,456.8],[423.3,453.6],
    [418.8,449.4],[414.9,445.2],[410.4,440],[407.9,435.8]],
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
